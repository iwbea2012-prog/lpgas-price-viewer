// エンドツーエンドの自己テスト:  node tools/selftest.mjs
// builder.html / viewer-template.html と同じロジック・同じ暗号パラメータを再現し、
// sample-data.csv を 集計 → 暗号化 → 復号 まで通して結果を検証する。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const webcrypto = globalThis.crypto;

/* ---- builder.html と同一の純ロジック ---- */
function parseCSV(text){
  const rows=[]; let row=[], field='', i=0, inQ=false, c;
  while(i<text.length){
    c=text[i];
    if(inQ){ if(c==='"'){ if(text[i+1]==='"'){field+='"';i+=2;continue;} inQ=false;i++;continue;} field+=c;i++;continue; }
    if(c==='"'){ inQ=true;i++;continue; }
    if(c===','){ row.push(field); field=''; i++; continue; }
    if(c==='\r'){ i++; continue; }
    if(c==='\n'){ row.push(field); rows.push(row); row=[]; field=''; i++; continue; }
    field+=c; i++;
  }
  if(field!==''||row.length){ row.push(field); rows.push(row); }
  return rows;
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
function aggregate(headers, rows, map, months, base){
  const col={}; Object.keys(map).forEach(k=>{ col[k]= map[k]? headers.indexOf(map[k]) : -1; });
  const cut=new Date(base); cut.setMonth(cut.getMonth()-months);
  const cutISO=cut.toISOString().slice(0,10);
  const groups=new Map(); let used=0, skipped=0;
  rows.forEach((r,ord)=>{
    const dISO=toISO(col.date>=0?r[col.date]:null);
    const price=toNum(col.price>=0?r[col.price]:null);
    if(!dISO||price==null){ skipped++; return; }
    if(dISO<cutISO) return;
    const cc=(col.custCode>=0?String(r[col.custCode]||'').trim():'');
    const cn=(col.custName>=0?String(r[col.custName]||'').trim():'');
    const ic=(col.itemCode>=0?String(r[col.itemCode]||'').trim():'');
    const it=(col.itemName>=0?String(r[col.itemName]||'').trim():'');
    if(!cc&&!cn){skipped++;return;} if(!it&&!ic){skipped++;return;}
    const rec={ d:dISO,p:price,q:toNum(col.qty>=0?r[col.qty]:null),
      cc:cc||cn,cn:cn||cc,ic,it:it||ic,
      mk:(col.maker>=0?String(r[col.maker]||'').trim():''),
      un:(col.unit>=0?String(r[col.unit]||'').trim():''),ord };
    const key=rec.cc+''+(ic||it);
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(rec); used++;
  });
  const records=[]; const custMap=new Map();
  groups.forEach(arr=>{
    arr.sort((a,b)=> a.d<b.d?1:a.d>b.d?-1:b.ord-a.ord);
    const top=arr.slice(0,3), g=top[0];
    custMap.set(g.cc,g.cn);
    records.push({ cc:g.cc,cn:g.cn,ic:g.ic,it:g.it,mk:g.mk,un:g.un,
      l:{d:top[0].d,p:top[0].p,q:top[0].q},
      h:top.slice(1).map(x=>({d:x.d,p:x.p,q:x.q})) });
  });
  records.sort((a,b)=> a.cn.localeCompare(b.cn,'ja')||a.it.localeCompare(b.it,'ja'));
  const customers=[...custMap.entries()].map(([code,name])=>({code,name}))
      .sort((a,b)=>a.name.localeCompare(b.name,'ja'));
  return { payload:{v:1,builtAt:base,months,customers,records}, stats:{used,skipped,groups:groups.size} };
}

/* ---- builder.html の encryptPayload と同一 ---- */
const bufToB64 = buf => Buffer.from(new Uint8Array(buf)).toString('base64');
const b64ToBuf = b64 => new Uint8Array(Buffer.from(b64,'base64'));
async function encryptPayload(obj, pass){
  const iter=310000;
  const salt=webcrypto.getRandomValues(new Uint8Array(16));
  const iv=webcrypto.getRandomValues(new Uint8Array(12));
  const base=await webcrypto.subtle.importKey('raw', new TextEncoder().encode(pass),'PBKDF2',false,['deriveKey']);
  const key=await webcrypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:iter,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['encrypt']);
  const ct=await webcrypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(obj)));
  return { kdf:'PBKDF2',hash:'SHA-256',iter,salt:bufToB64(salt),iv:bufToB64(iv),ct:bufToB64(ct) };
}
/* ---- viewer-template.html の復号と同一 ---- */
async function decrypt(blob, pass){
  const base=await webcrypto.subtle.importKey('raw', new TextEncoder().encode(pass),'PBKDF2',false,['deriveKey']);
  const key=await webcrypto.subtle.deriveKey({name:'PBKDF2',salt:b64ToBuf(blob.salt),iterations:blob.iter,hash:'SHA-256'},base,{name:'AES-GCM',length:256},true,['decrypt']);
  const pt=await webcrypto.subtle.decrypt({name:'AES-GCM',iv:b64ToBuf(blob.iv)},key,b64ToBuf(blob.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

/* ---- run ---- */
const csv=readFileSync(join(root,'sample-data.csv'),'utf8');
const all=parseCSV(csv).filter(r=>r.some(c=>String(c).trim()!==''));
const headers=all[0].map(s=>s.trim()), rows=all.slice(1);
const map={ date:'伝票日付', custCode:'得意先コード', custName:'得意先名',
  itemCode:'商品コード', itemName:'商品名', maker:'メーカー', unit:'単位', qty:'数量', price:'単価' };

const { payload, stats } = aggregate(headers, rows, map, 3, '2026-09-08');
console.log('rows:', rows.length, ' stats:', stats);
console.log('customers:', payload.customers.map(c=>c.code+':'+c.name).join(', '));
console.log('records:', payload.records.length);

// 期待値の検証
assert.equal(payload.customers.length, 5, '得意先は5社');
const g3k201 = payload.records.find(r=>r.cc==='G003' && r.ic==='K201');
assert.ok(g3k201, 'G003 x K201 が存在');
assert.equal(g3k201.l.d, '2026-09-08', 'G003 K201 直近日付');
assert.equal(g3k201.l.p, 66000, 'G003 K201 直近単価');
assert.equal(g3k201.h[0].d, '2026-07-28', 'G003 K201 履歴1件目の日付');
assert.equal(g3k201.h[0].p, 66500, 'G003 K201 履歴1件目の単価');
// 2026/05/20 の G001 K201 行は cutoff(2026-06-08)より前 → 履歴に出ない
const g1k201 = payload.records.find(r=>r.cc==='G001' && r.ic==='K201');
assert.ok(g1k201.l.d >= '2026-06-08', '期間外の行が除外されている');
assert.ok(!(g1k201.h||[]).some(h=>h.d < '2026-06-08'), '期間外の行が履歴にも無い');
// 同一器具の店ごとの価格差（横断検索の肝）
const k101 = payload.records.filter(r=>r.ic==='K101').map(r=>r.cc+'='+r.l.p);
console.log('K101 店別直近単価:', k101.join(', '));
assert.ok(new Set(payload.records.filter(r=>r.ic==='K101').map(r=>r.l.p)).size > 1, '店ごとに単価が異なる');

// 暗号ラウンドトリップ（builder→viewer のパラメータ整合）
const pass='みどり ガス 単価 えんぴつ 2026';
const blob=await encryptPayload(payload, pass);
const back=await decrypt(blob, pass);
assert.deepEqual(back, payload, '復号結果が元と一致');
let threw=false; try{ await decrypt(blob,'ちがう合言葉'); }catch(e){ threw=true; }
assert.ok(threw, '誤った合言葉では復号が失敗する');

// テンプレート差し込み
const tpl=readFileSync(join(root,'viewer-template.html'),'utf8');
const html=tpl.replace('__ENCRYPTED_PAYLOAD__', ()=>JSON.stringify(blob));
assert.ok(!html.includes('__ENCRYPTED_PAYLOAD__'), 'プレースホルダが置換された');
assert.ok(html.includes('"ct":'), '暗号文が埋め込まれた');
JSON.parse(html.match(/<script id="payload"[^>]*>([\s\S]*?)<\/script>/)[1]); // 有効なJSON

console.log('\nblob size: ct='+blob.ct.length+' b64chars,  生成HTML='+html.length+' bytes');
console.log('ALL TESTS PASSED ✅');
