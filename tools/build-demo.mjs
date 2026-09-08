// デモ用: sample-data.csv から preview.html を生成する（合言葉は下記固定）。
//   node tools/build-demo.mjs
// 本番の index.html は触らない。preview.html は .gitignore 済み。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEMO_PASSPHRASE = 'みどり ガス 単価 2026';
const wc = globalThis.crypto;

function parseCSV(text){
  const rows=[]; let row=[], field='', i=0, inQ=false, c;
  while(i<text.length){ c=text[i];
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
const toISO=s=>{ if(s==null)return null;s=String(s).trim();if(!s)return null;
  let m=s.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/);
  if(m)return m[1]+'-'+('0'+m[2]).slice(-2)+'-'+('0'+m[3]).slice(-2);
  m=s.match(/^(\d{4})(\d{2})(\d{2})$/); if(m)return m[1]+'-'+m[2]+'-'+m[3];
  const d=new Date(s); return isNaN(d)?null:d.toISOString().slice(0,10); };
const toNum=s=>{ if(s==null||s==='')return null; const n=parseFloat(String(s).replace(/[^0-9.\-]/g,'')); return isNaN(n)?null:n; };

function aggregate(headers, rows, map, months, base){
  const col={}; Object.keys(map).forEach(k=>{ col[k]= map[k]? headers.indexOf(map[k]) : -1; });
  const cut=new Date(base); cut.setMonth(cut.getMonth()-months); const cutISO=cut.toISOString().slice(0,10);
  const groups=new Map();
  rows.forEach((r,ord)=>{
    const dISO=toISO(col.date>=0?r[col.date]:null); const price=toNum(col.price>=0?r[col.price]:null);
    if(!dISO||price==null||dISO<cutISO) return;
    const cc=(col.custCode>=0?String(r[col.custCode]||'').trim():'');
    const cn=(col.custName>=0?String(r[col.custName]||'').trim():'');
    const ic=(col.itemCode>=0?String(r[col.itemCode]||'').trim():'');
    const it=(col.itemName>=0?String(r[col.itemName]||'').trim():'');
    if((!cc&&!cn)||(!it&&!ic)) return;
    const rec={ d:dISO,p:price,q:toNum(col.qty>=0?r[col.qty]:null),cc:cc||cn,cn:cn||cc,ic,it:it||ic,
      mk:(col.maker>=0?String(r[col.maker]||'').trim():''),un:(col.unit>=0?String(r[col.unit]||'').trim():''),ord };
    const key=rec.cc+''+(ic||it);
    if(!groups.has(key)) groups.set(key,[]); groups.get(key).push(rec);
  });
  const records=[]; const custMap=new Map();
  groups.forEach(arr=>{ arr.sort((a,b)=> a.d<b.d?1:a.d>b.d?-1:b.ord-a.ord);
    const top=arr.slice(0,3), g=top[0]; custMap.set(g.cc,g.cn);
    records.push({ cc:g.cc,cn:g.cn,ic:g.ic,it:g.it,mk:g.mk,un:g.un,
      l:{d:top[0].d,p:top[0].p,q:top[0].q}, h:top.slice(1).map(x=>({d:x.d,p:x.p,q:x.q})) });
  });
  records.sort((a,b)=> a.cn.localeCompare(b.cn,'ja')||a.it.localeCompare(b.it,'ja'));
  const customers=[...custMap.entries()].map(([code,name])=>({code,name})).sort((a,b)=>a.name.localeCompare(b.name,'ja'));
  return { v:1, builtAt:base, months, customers, records };
}
const bufToB64=buf=>Buffer.from(new Uint8Array(buf)).toString('base64');
async function encryptPayload(obj, pass){
  const iter=310000;
  const salt=wc.getRandomValues(new Uint8Array(16)); const iv=wc.getRandomValues(new Uint8Array(12));
  const base=await wc.subtle.importKey('raw',new TextEncoder().encode(pass),'PBKDF2',false,['deriveKey']);
  const key=await wc.subtle.deriveKey({name:'PBKDF2',salt,iterations:iter,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['encrypt']);
  const ct=await wc.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(obj)));
  return { kdf:'PBKDF2',hash:'SHA-256',iter,salt:bufToB64(salt),iv:bufToB64(iv),ct:bufToB64(ct) };
}

const csv=readFileSync(join(root,'sample-data.csv'),'utf8');
const all=parseCSV(csv).filter(r=>r.some(c=>String(c).trim()!==''));
const headers=all[0].map(s=>s.trim());
const map={ date:'伝票日付',custCode:'得意先コード',custName:'得意先名',itemCode:'商品コード',
  itemName:'商品名',maker:'メーカー',unit:'単位',qty:'数量',price:'単価' };
const payload=aggregate(headers, all.slice(1), map, 3, '2026-09-08');
const blob=await encryptPayload(payload, DEMO_PASSPHRASE);
const tpl=readFileSync(join(root,'viewer-template.html'),'utf8');
const html=tpl.replace('__ENCRYPTED_PAYLOAD__', ()=>JSON.stringify(blob));
writeFileSync(join(root,'preview.html'), html);
console.log('preview.html を書き出しました。合言葉: '+DEMO_PASSPHRASE);
console.log('得意先 '+payload.customers.length+' 社 / 器具 '+payload.records.length+' 件');
