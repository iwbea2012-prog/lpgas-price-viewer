// 大きめのダミーCSVを作る（本番データは一切使わない・実店舗名でもない）。
// builder.html を実ブラウザで試すための負荷テスト用データ。
//   node tools/gen-big-dummy.mjs                  → 約12万行のCSVをUTF-8で書き出す
//   node tools/gen-big-dummy.mjs --rows 300000     → 行数を指定
//   node tools/gen-big-dummy.mjs --extra-cols      → 実際のERP風に余計な列（伝票番号など）も付ける
//
// 出力先: big-sample-data.csv（.gitignore の *.csv に該当するのでコミットされない）
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : def;
};
const ROWS = parseInt(arg('--rows', '120000'), 10);
const EXTRA = argv.includes('--extra-cols');
const NCUST = 45;   // 得意先数（現実的な規模）
const NITEM = 260;  // 器具SKU数

const MAKERS = ['リンナイ', 'ノーリツ', '大阪ガス', '新コスモス', '愛知時計', 'パーパス', 'パロマ'];
const CUSTSUF = ['燃料店', 'プロパン', 'ガス商会', '商店', 'エネルギー', 'ガス', '燃料'];
const ITEMKIND = ['ガス給湯器 16号', 'ガス給湯器 20号', 'ガス給湯器 24号', 'ガスコンロ 2口', 'ガスコンロ 3口',
  'ガスファンヒーター', 'ガス炊飯器 3合', 'ガス炊飯器 5合', 'ガス衣類乾燥機 5kg', 'ガス警報器',
  'マイコンメーター S型', 'マイコンメーター E型', '高圧ホース 1m', '高圧ホース 2m', '調整器 単段式', '調整器 2段式'];

// 固定シードの簡易疑似乱数（毎回同じデータになる→再現性あり）
let seed = 20260908;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }

const custCodes = Array.from({ length: NCUST }, (_, i) => 'G' + String(i + 1).padStart(3, '0'));
const custNames = custCodes.map(() => pick(['みどり', 'さくら', '山田', '海山', 'あおぞら', '青空', '大空', 'まるい', 'ひかり', '中央'])
  + pick(CUSTSUF));
const itemCodes = Array.from({ length: NITEM }, (_, i) => 'K' + String(i + 100));
const itemNames = itemCodes.map(() => pick(ITEMKIND));

const baseCols = ['伝票日付', '得意先コード', '得意先名', '商品コード', '商品名', 'メーカー', '単位', '数量', '単価'];
const extraCols = EXTRA ? ['伝票番号', '担当者コード', '部門', '税区分'] : [];
const header = [...baseCols.slice(0, 3), ...(EXTRA ? [extraCols[0]] : []), ...baseCols.slice(3)].join(',');
// ↑ 実ERPだと列の並びがバラバラなことが多いので、あえて途中に列を混ぜる

const lines = [header];
const today = new Date('2026-09-08T00:00:00Z');
for (let i = 0; i < ROWS; i++) {
  const ci = Math.floor(rnd() * NCUST);
  const ii = Math.floor(rnd() * NITEM);
  const dayOffset = Math.floor(rnd() * 400); // 過去約13ヶ月に分布（期間フィルタの効果も確認できる）
  const d = new Date(today); d.setUTCDate(d.getUTCDate() - dayOffset);
  const ds = d.toISOString().slice(0, 10).replace(/-/g, '/');
  const price = 1000 + Math.floor(rnd() * 99000);
  const qty = 1 + Math.floor(rnd() * 5);
  const maker = pick(MAKERS);
  const denpyo = 100000 + i;
  const row = [ds, custCodes[ci], custNames[ci],
    ...(EXTRA ? [String(denpyo)] : []),
    itemCodes[ii], itemNames[ii], maker, (itemNames[ii].includes('ホース') ? '本' : itemNames[ii].includes('警報器') || itemNames[ii].includes('メーター') ? '個' : '台'),
    String(qty), String(price)];
  lines.push(row.join(','));
}
const text = lines.join('\n') + '\n';

const outPath = join(root, 'big-sample-data.csv');
writeFileSync(outPath, text, 'utf8');
console.log('書き出し: ' + outPath);
console.log('行数: ' + ROWS.toLocaleString('ja-JP') + ' / サイズ: ' + (Buffer.byteLength(text, 'utf8') / 1048576).toFixed(1) + 'MB');
console.log('列: ' + header);
console.log('得意先: ' + NCUST + '社 / 器具: ' + NITEM + '種 / 期間: 過去約13ヶ月に分布');
console.log('\nbuilder.html にこのファイルをドラッグ＆ドロップして動作確認してください。');
