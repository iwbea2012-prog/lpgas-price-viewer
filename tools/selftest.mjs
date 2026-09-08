// エンドツーエンドの自己テスト:  node tools/selftest.mjs
// builder.html / viewer-template.html と同じロジック・同じ暗号パラメータを再現し、
// sample-data.csv を 集計 → 暗号化 → 復号 まで通して結果を検証する。
// さらに大きい合成CSV（数十万行）で、逐次リーダ＋チャンク集計が
// 総当たり集計と同じ結果になること・現実的な時間で終わることを確認する。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const webcrypto = globalThis.crypto;

/* ---- builder.html と同一: CSV 逐次リーダ ---- */
function makeCsvReader(text){
  let i=0; const n=text.length;
  function next(){
    if(i>=n) return null;
    let row=[], field='', inQ=false, c, k, q;
    for(;;){
      if(i>=n){ row.push(field); return row; }
      c=text.charCodeAt(i);
      if(inQ){
        if(c===34){
          if(text.charCodeAt(i+1)===34){ field+='"'; i+=2; continue; }
          inQ=false; i++; continue;
        }
        q=text.indexOf('"', i);
        if(q<0){ field+=text.slice(i); i=n; row.push(field); return row; }
        field+=text.slice(i,q); i=q; continue;
      }
      if(c===34){ inQ=true; i++; continue; }
      if(c===44){ row.push(field); field=''; i++; continue; }
      if(c===10){ i++; row.push(field); return row; }
      if(c===13){ i++; if(text.charCodeAt(i)===10) i++; row.push(field); return row; }
      k=i;
      while(k<n){ c=text.charCodeAt(k); if(c===44||c===10||c===13||c===34) break; k++; }
      field+=text.slice(i,k); i=k;
    }
  }
  return { next };
}

const toISO = s => {
  if(s==null) return null; s=String(s).trim(); if(!s) return null;
  let m=s.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/);
  if(m) return m[1]+'-'+('0'+m[2]).slice(-2)+'-'+('0'+m[3]).slice(-2);
  m=s.match(/^(\d{4})(\d{2})(\d{2})$/); if(m) return m[1]+'-'+m[2]+'-'+m[3];
  const d=new Date(s); return isNaN(d)?null:d.toISOString().slice(0,10);
};
const toNum = s => {
  if(s==null||s==='') return null;
  const n=parseFloat(String(s).replace(/[^0-9.\-]/g,'')); return isNaN(n)?null:n;
};

/* ---- builder.html と同一: 直近3件だけ保持する挿入 ---- */
const _better = (a,b) => a.d>b.d || (a.d===b.d && a.ord>b.ord);
function _insertTop(groups,key,rec){
  let arr=groups.get(key);
  if(!arr){ groups.set(key,[rec]); return; }
  let pos=arr.length;
  for(let x=0;x<arr.length;x++){ if(_better(rec,arr[x])){ pos=x; break; } }
  if(pos>=3) return;
  arr.splice(pos,0,rec);
  if(arr.length>3) arr.length=3;
}

/* ---- builder.html の aggregateStreamed と同一（同期版） ---- */
function aggregate(text, map, months, base){
  const rdr=makeCsvReader(text);
  const headers=(rdr.next()||[]).map(s=>String(s).trim());
  const col={}; Object.keys(map).forEach(k=>{ col[k]= map[k]? headers.indexOf(map[k]) : -1; });
  const cut=new Date(base); cut.setMonth(cut.getMonth()-months);
  const cutISO=cut.toISOString().slice(0,10);
  const groups=new Map(); let used=0, skipped=0, total=0, minD=null, maxD=null, ord=0, r;
  for(;;){
    r=rdr.next();
    if(r===null) break;
    if(r.length===1 && r[0]==='') continue;
    total++; ord++;
    const dISO=toISO(col.date>=0?r[col.date]:null);
    const price=toNum(col.price>=0?r[col.price]:null);
    if(!dISO||price==null){ skipped++; continue; }
    if(dISO<cutISO) continue;
    const cc=(col.custCode>=0?String(r[col.custCode]||'').trim():'');
    const cn=(col.custName>=0?String(r[col.custName]||'').trim():'');
    const ic=(col.itemCode>=0?String(r[col.itemCode]||'').trim():'');
    const it=(col.itemName>=0?String(r[col.itemName]||'').trim():'');
    if(!cc&&!cn){ skipped++; continue; }
    if(!it&&!ic){ skipped++; continue; }
    const rec={ d:dISO,p:price,q:toNum(col.qty>=0?r[col.qty]:null),
      cc:cc||cn,cn:cn||cc,ic,it:it||ic,
      mk:(col.maker>=0?String(r[col.maker]||'').trim():''),
      un:(col.unit>=0?String(r[col.unit]||'').trim():''),ord };
    _insertTop(groups, (cc||cn)+''+(ic||it), rec);
    used++;
    if(!minD||dISO<minD) minD=dISO;
    if(!maxD||dISO>maxD) maxD=dISO;
  }
  const records=[]; const custMap=new Map();
  groups.forEach(arr=>{
    const g=arr[0];
    custMap.set(g.cc,g.cn);
    records.push({ cc:g.cc,cn:g.cn,ic:g.ic,it:g.it,mk:g.mk,un:g.un,
      l:{d:arr[0].d,p:arr[0].p,q:arr[0].q},
      h:arr.slice(1).map(x=>({d:x.d,p:x.p,q:x.q})) });
  });
  records.sort((a,b)=> a.cn.localeCompare(b.cn,'ja')||a.it.localeCompare(b.it,'ja'));
  const customers=[...custMap.entries()].map(([code,name])=>({code,name}))
      .sort((a,b)=>a.name.localeCompare(b.name,'ja'));
  return { payload:{v:1,builtAt:base,months,customers,records},
           stats:{used,skipped,groups:groups.size,total} };
}

/* ---- 参照実装: 全行をためてから (得意先×品番) ごとに上位3件 ---- */
function aggregateBrute(text, map, months, base){
  const rdr=makeCsvReader(text);
  const headers=(rdr.next()||[]).map(s=>String(s).trim());
  const col={}; Object.keys(map).forEach(k=>{ col[k]= map[k]? headers.indexOf(map[k]) : -1; });
  const cut=new Date(base); cut.setMonth(cut.getMonth()-months);
  const cutISO=cut.toISOString().slice(0,10);
  const buckets=new Map(); let ord=0, r;
  for(;;){
    r=rdr.next(); if(r===null) break;
    if(r.length===1 && r[0]==='') continue;
    ord++;
    const dISO=toISO(col.date>=0?r[col.date]:null);
    const price=toNum(col.price>=0?r[col.price]:null);
    if(!dISO||price==null) continue;
    if(dISO<cutISO) continue;
    const cc=(col.custCode>=0?String(r[col.custCode]||'').trim():'');
    const cn=(col.custName>=0?String(r[col.custName]||'').trim():'');
    const ic=(col.itemCode>=0?String(r[col.itemCode]||'').trim():'');
    const it=(col.itemName>=0?String(r[col.itemName]||'').trim():'');
    if((!cc&&!cn)||(!it&&!ic)) continue;
    const key=(cc||cn)+''+(ic||it);
    if(!buckets.has(key)) buckets.set(key,[]);
    buckets.get(key).push({ d:dISO,p:price,cc:cc||cn,cn:cn||cc,ic,it:it||ic,ord });
  }
  const out=new Map();
  buckets.forEach((arr,key)=>{
    arr.sort((a,b)=> a.d<b.d?1:a.d>b.d?-1:b.ord-a.ord);
    const top=arr.slice(0,3);
    out.set(key,{ p:top[0].p, d:top[0].d, hist:top.slice(1).map(x=>x.p+'@'+x.d).join(',') });
  });
  return out;
}

/* ================= 1) サンプルデータ ================= */
const csv=readFileSync(join(root,'sample-data.csv'),'utf8');
const map={ date:'伝票日付', custCode:'得意先コード', custName:'得意先名',
  itemCode:'商品コード', itemName:'商品名', maker:'メーカー', unit:'単位', qty:'数量', price:'単価' };

const { payload, stats } = aggregate(csv, map, 3, '2026-09-08');
console.log('rows:', stats.total, ' stats:', stats);
console.log('customers:', payload.customers.map(c=>c.code+':'+c.name).join(', '));
console.log('records:', payload.records.length);

assert.equal(payload.customers.length, 5, '得意先は5社');
const g3k201 = payload.records.find(r=>r.cc==='G003' && r.ic==='K201');
assert.ok(g3k201, 'G003 x K201 が存在');
assert.equal(g3k201.l.d, '2026-09-08', 'G003 K201 直近日付');
assert.equal(g3k201.l.p, 66000, 'G003 K201 直近単価');
assert.equal(g3k201.h[0].d, '2026-07-28', 'G003 K201 履歴1件目の日付');
assert.equal(g3k201.h[0].p, 66500, 'G003 K201 履歴1件目の単価');
const g1k201 = payload.records.find(r=>r.cc==='G001' && r.ic==='K201');
assert.ok(g1k201.l.d >= '2026-06-08', '期間外の行が除外されている');
assert.ok(!(g1k201.h||[]).some(h=>h.d < '2026-06-08'), '期間外の行が履歴にも無い');
const k101 = payload.records.filter(r=>r.ic==='K101').map(r=>r.cc+'='+r.l.p);
console.log('K101 店別直近単価:', k101.join(', '));
assert.ok(new Set(payload.records.filter(r=>r.ic==='K101').map(r=>r.l.p)).size > 1, '店ごとに単価が異なる');

// 逐次集計 == 総当たり集計（サンプル）
{
  const brute=aggregateBrute(csv, map, 3, '2026-09-08');
  assert.equal(payload.records.length, brute.size, 'サンプル: グループ数が総当たりと一致');
  for(const rec of payload.records){
    const b=brute.get(rec.cc+''+(rec.ic||rec.it));
    assert.ok(b, 'サンプル: 総当たりにも同じキーがある');
    assert.equal(rec.l.p, b.p, 'サンプル: 直近単価が一致');
    assert.equal(rec.l.d, b.d, 'サンプル: 直近日付が一致');
    assert.equal(rec.h.map(x=>x.p+'@'+x.d).join(','), b.hist, 'サンプル: 履歴が一致');
  }
}

/* ================= 2) 大きい合成CSV ================= */
{
  const NCUST=60, NITEM=120, ROWS=300000;
  const base='2026-09-08';
  const hdr='伝票日付,得意先コード,得意先名,商品コード,商品名,メーカー,単位,数量,単価\n';
  // 乱数は固定シードで再現可能に
  let seed=123456789;
  const rnd=()=>{ seed=(seed*1103515245+12345)&0x7fffffff; return seed/0x7fffffff; };
  const parts=[hdr];
  for(let i=0;i<ROWS;i++){
    const c=1+Math.floor(rnd()*NCUST);
    const k=1+Math.floor(rnd()*NITEM);
    // 6ヶ月前〜基準日の範囲でばらつかせる（半分くらいは3ヶ月の窓の外）
    const dayOffset=Math.floor(rnd()*185);
    const d=new Date('2026-09-08T00:00:00Z'); d.setUTCDate(d.getUTCDate()-dayOffset);
    const ds=d.toISOString().slice(0,10).replace(/-/g,'/');
    const price=10000+Math.floor(rnd()*90000);
    parts.push(`${ds},C${c},得意先${c},P${k},品目${k},M,台,1,${price}\n`);
  }
  const big=parts.join('');
  console.log('\n大きいCSV: '+(big.length/1048576).toFixed(1)+'MB / '+ROWS.toLocaleString()+' 行');

  const t0=Date.now();
  const res=aggregate(big, map, 3, base);
  const ms=Date.now()-t0;
  console.log('逐次集計: '+ms+'ms / グループ '+res.stats.groups.toLocaleString()+' / 採用 '+res.stats.used.toLocaleString()+' 行');
  assert.ok(ms < 15000, '大きいCSVでも15秒以内に集計が終わる（実測 '+ms+'ms）');
  assert.equal(res.stats.total, ROWS, '全行を読み切っている');

  const brute=aggregateBrute(big, map, 3, base);
  assert.equal(res.payload.records.length, brute.size, '大きいCSV: グループ数が総当たりと一致');
  let checked=0;
  for(const rec of res.payload.records){
    const b=brute.get(rec.cc+''+(rec.ic||rec.it));
    assert.ok(b, '大きいCSV: 総当たりにも同じキーがある');
    assert.equal(rec.l.p, b.p, '大きいCSV: 直近単価が一致');
    assert.equal(rec.l.d, b.d, '大きいCSV: 直近日付が一致');
    assert.equal(rec.h.map(x=>x.p+'@'+x.d).join(','), b.hist, '大きいCSV: 履歴が一致');
    checked++;
  }
  console.log('総当たりと突き合わせ: '+checked.toLocaleString()+' グループすべて一致');
}

/* ================= 3) 引用符つきCSVのパース ================= */
{
  const q='a,b,c\n"x,1","y ""z""",3\np,"q\nr",s\n';
  const rd=makeCsvReader(q);
  assert.deepEqual(rd.next(), ['a','b','c'], '引用: ヘッダ');
  assert.deepEqual(rd.next(), ['x,1','y "z"','3'], '引用: カンマ・エスケープ');
  assert.deepEqual(rd.next(), ['p','q\nr','s'], '引用: フィールド内改行');
  assert.equal(rd.next(), null, '引用: EOF');
}

/* ================= 4) 暗号ラウンドトリップ ================= */
const bufToB64 = buf => Buffer.from(new Uint8Array(buf)).toString('base64');
const b64ToBuf = b64 => new Uint8Array(Buffer.from(b64,'base64'));
async function encryptPayload(obj, pass){
  const iter=310000;
  const salt=webcrypto.getRandomValues(new Uint8Array(16));
  const iv=webcrypto.getRandomValues(new Uint8Array(12));
  const kbase=await webcrypto.subtle.importKey('raw', new TextEncoder().encode(pass),'PBKDF2',false,['deriveKey']);
  const key=await webcrypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:iter,hash:'SHA-256'},kbase,{name:'AES-GCM',length:256},false,['encrypt']);
  const ct=await webcrypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(obj)));
  return { kdf:'PBKDF2',hash:'SHA-256',iter,salt:bufToB64(salt),iv:bufToB64(iv),ct:bufToB64(ct) };
}
async function decrypt(blob, pass){
  const kbase=await webcrypto.subtle.importKey('raw', new TextEncoder().encode(pass),'PBKDF2',false,['deriveKey']);
  const key=await webcrypto.subtle.deriveKey({name:'PBKDF2',salt:b64ToBuf(blob.salt),iterations:blob.iter,hash:'SHA-256'},kbase,{name:'AES-GCM',length:256},true,['decrypt']);
  const pt=await webcrypto.subtle.decrypt({name:'AES-GCM',iv:b64ToBuf(blob.iv)},key,b64ToBuf(blob.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

const pass='みどり ガス 単価 えんぴつ 2026';
const blob=await encryptPayload(payload, pass);
const back=await decrypt(blob, pass);
assert.deepEqual(back, payload, '復号結果が元と一致');
let threw=false; try{ await decrypt(blob,'ちがう合言葉'); }catch(e){ threw=true; }
assert.ok(threw, '誤った合言葉では復号が失敗する');

const tpl=readFileSync(join(root,'viewer-template.html'),'utf8');
const html=tpl.replace('__ENCRYPTED_PAYLOAD__', ()=>JSON.stringify(blob));
assert.ok(!html.includes('__ENCRYPTED_PAYLOAD__'), 'プレースホルダが置換された');
assert.ok(html.includes('"ct":'), '暗号文が埋め込まれた');
JSON.parse(html.match(/<script id="payload"[^>]*>([\s\S]*?)<\/script>/)[1]);

console.log('\nblob size: ct='+blob.ct.length+' b64chars,  生成HTML='+html.length+' bytes');
console.log('ALL TESTS PASSED ✅');
