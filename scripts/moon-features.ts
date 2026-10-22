/**
 * 月のページの地名（src/tools/moon/features.json と features.meta.json）を作る。
 *
 *   bun scripts/moon-features.ts [置き場]
 *
 * 置き場（リポジトリの外のディレクトリ。省略すると OS の一時ディレクトリの nanase-tools-moon）に
 * 元のファイルがなければダウンロードする。
 * 1 件は [日本語名 | null, 英語名（IAU）, 緯度, 経度（東が正、−180〜180）, 直径 [km], 種類]。
 * 種類は 'mare'（海・大洋・湖・入江・沼）・'crater'・'mons'（山・山脈）・'other'（断崖・谷・岬）。
 * 選ぶもの: 海・大洋・湖・入江・沼はすべて、クレーターは直径 20 km 以上で中心の経度が −100〜+100 のもの、
 * 山・山脈・断崖・谷・岬は日本語名があるもの。直径の大きい順に並べる。
 *
 * 出典（許諾・出典表記は src/tools/moon/SOURCES.md）:
 * - 地名・位置・直径: USGS/IAU Gazetteer of Planetary Nomenclature の MOON_nomenclature_center_pts.zip
 *   （パブリックドメイン） https://planetarynames.wr.usgs.gov/GIS_Downloads
 * - 日本語名: 日本語版ウィキペディアの一覧（CC BY-SA 4.0）。版は下の PAGES で固定する
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

type Kind = 'mare' | 'crater' | 'mons' | 'other';
type Row = [string | null, string, number, number, number, Kind];

const USGS = 'https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/MOON_nomenclature_center_pts.zip';
const OUT = new URL('../src/tools/moon/features.json', import.meta.url);
const META = new URL('../src/tools/moon/features.meta.json', import.meta.url);

/** 日本語名を取るページと版。同じ地名が複数のページにあれば、先のページを使う */
const PAGES = [
  { title: '月の海の一覧', revid: 103420195 },
  { title: '月のクレーターの一覧', revid: 104605018 },
  { title: '月の地形一覧', revid: 103502553 },
];

/**
 * 一覧の名前を記事名に合わせるもの。月の海の一覧の「氷の海」「虹の入り江」はリンクが転送で、
 * 記事名（と月の地形一覧の表記）は「寒さの海」「虹の入江」
 */
const RENAME: Record<string, string> = { 'Mare Frigoris': '寒さの海', 'Sinus Iridum': '虹の入江' };

/** 月の地形一覧の「峡谷」の表はラテン語名がないので、ここで対応させる */
const VALLIS: Record<string, string> = {
  アルプス峡谷: 'Vallis Alpes',
  バーデ峡谷: 'Vallis Baade',
  ボーア峡谷: 'Vallis Bohr',
  ブヴァール峡谷: 'Vallis Bouvard',
  カペッラ峡谷: 'Vallis Capella',
  インギラミ峡谷: 'Vallis Inghirami',
  パリッチュ峡谷: 'Vallis Palitzsch',
  プランク峡谷: 'Vallis Planck',
  レイタ峡谷: 'Vallis Rheita',
  シュレーディンガー峡谷: 'Vallis Schrödinger',
  シュレーター峡谷: 'Vallis Schröteri',
  スネリウス峡谷: 'Vallis Snellius',
};

/* ---------- ファイルの読み出し（zip・DBF） ---------- */

/** zip の中のファイルのうち、名前が suffix で終わるもの。圧縮は無圧縮と deflate だけ扱う */
function unzipOne(buf: Uint8Array, suffix: string): Uint8Array {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--)
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error('zip の終端が見つかりません');
  const td = new TextDecoder();
  let p = dv.getUint32(eocd + 16, true);
  for (let k = 0, n = dv.getUint16(eocd + 10, true); k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('zip の中央ディレクトリが壊れています');
    const method = dv.getUint16(p + 10, true),
      size = dv.getUint32(p + 20, true),
      nameLen = dv.getUint16(p + 28, true),
      local = dv.getUint32(p + 42, true);
    const name = td.decode(buf.subarray(p + 46, p + 46 + nameLen));
    if (name.endsWith(suffix)) {
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const data = buf.subarray(start, start + size);
      if (method === 0) return data;
      if (method === 8) return new Uint8Array(inflateRawSync(data));
      throw new Error(`${name}: zip の圧縮方式 ${method} は扱えません`);
    }
    p += 46 + nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
  }
  throw new Error(`zip に ${suffix} がありません`);
}

/** DBF の行。文字は UTF-8（.cpg による）、前後の空白は除く */
function dbf(buf: Uint8Array): Record<string, string>[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const count = dv.getUint32(4, true),
    headLen = dv.getUint16(8, true),
    recLen = dv.getUint16(10, true);
  const td = new TextDecoder();
  const fields: { name: string; off: number; len: number }[] = [];
  for (let p = 32, off = 1; buf[p] !== 0x0d; p += 32) {
    const raw = buf.subarray(p, p + 11),
      z = raw.indexOf(0);
    fields.push({ name: td.decode(z < 0 ? raw : raw.subarray(0, z)), off, len: buf[p + 16] });
    off += buf[p + 16];
  }
  const rows: Record<string, string>[] = [];
  for (let i = 0; i < count; i++) {
    const b = headLen + i * recLen;
    if (buf[b] === 0x2a) continue; // 削除済みの行
    const r: Record<string, string> = {};
    for (const f of fields) r[f.name] = td.decode(buf.subarray(b + f.off, b + f.off + f.len)).trim();
    rows.push(r);
  }
  return rows;
}

/* ---------- ウィキペディア ---------- */

async function wikitext(dir: string, revid: number): Promise<string> {
  const path = join(dir, `jawiki-${revid}.txt`);
  if (!existsSync(path)) {
    const u = new URL('https://ja.wikipedia.org/w/api.php');
    const q = { action: 'query', prop: 'revisions', revids: String(revid), rvprop: 'content', rvslots: 'main' };
    for (const [k, v] of Object.entries({ ...q, format: 'json', formatversion: '2' })) u.searchParams.set(k, v);
    console.log(`${u} をダウンロード`);
    const res = await fetch(u, { headers: { 'User-Agent': 'nanase-tools/1.0 (scripts/moon-features.ts)' } });
    const body = (await res.json()) as {
      query?: { pages: { revisions?: { slots: { main: { content: string } } }[] }[] };
    };
    const text = body.query?.pages[0]?.revisions?.[0]?.slots.main.content;
    if (!text) throw new Error(`版 ${revid} が取れません`);
    writeFileSync(path, text);
    await new Promise((r) => setTimeout(r, 2000)); // 続けて取るときの間
  }
  return readFileSync(path, 'utf8');
}

/** テンプレートを外す。{{仮リンク|名前|…}} は名前を残し、ほかのテンプレートは中身ごと消す */
function dropTemplates(s: string): string {
  let out = '',
    i = 0;
  while (i < s.length) {
    if (!s.startsWith('{{', i)) {
      out += s[i++];
      continue;
    }
    let depth = 0,
      j = i;
    for (; j < s.length; j++) {
      if (s.startsWith('{{', j)) {
        depth++;
        j++;
      } else if (s.startsWith('}}', j)) {
        depth--;
        j++;
        if (!depth) break;
      }
    }
    const body = s.slice(i + 2, j - 1);
    if (body.startsWith('仮リンク|')) out += body.split('|')[1];
    i = j + 1;
  }
  return out;
}

/** 表のセルの文字（表示される文字だけ） */
const cellText = (s: string) =>
  dropTemplates(s.replace(/<ref[^>/]*\/>|<ref[^>]*>[\s\S]*?<\/ref>/g, ''))
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/^[|\s]+/, '')
    .trim();

/** 表の行ごとのセル（書式の指定 style=…| は除く） */
function tableRows(text: string): string[][] {
  const rows: string[][] = [];
  for (const table of text.match(/\{\|[\s\S]*?\n\|\}/g) ?? [])
    for (const row of table.split(/\n\|-[^\n]*/).slice(1)) {
      const cells: string[] = [];
      for (const line of row.split('\n')) {
        if (!line.startsWith('|') || line.startsWith('|}') || line.startsWith('|+')) continue;
        for (const c of line.slice(1).split('||')) cells.push(c.replace(/^\s*[a-z-]+="[^"]*"\s*\|(?!\|)/, ''));
      }
      if (cells.length) rows.push(cells);
    }
  return rows;
}

/** 照合の鍵: ダイアクリティカルマークを外し、英数字だけを小文字で */
const key = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** ページの表から 英語名の鍵 → 日本語名 */
function names(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const cells of tableRows(text)) {
    const c0 = cellText(cells[0]);
    let ja: string | undefined, en: string | undefined;
    const m = c0.match(/^(.+?)\s*[（(]([^（）()]+)[)）]$/);
    if (m) [, ja, en] = m;
    else if (VALLIS[c0]) [ja, en] = [c0, VALLIS[c0]];
    else if (cells[1] && /^[A-Z][A-Za-z.' -]+$/.test(cellText(cells[1]))) [ja, en] = [c0, cellText(cells[1])]; // 月の海の一覧: 日本語名・ラテン語名の列
    if (!ja || !en) continue;
    ja = ja.replace(/\s*[（(][^（）()]*クレーター[)）]$/, ''); // 「(月のクレーター)」などの曖昧さ回避
    if (!out.has(key(en))) out.set(key(en), ja);
  }
  return out;
}

/* ---------- 書き出し ---------- */

const dir = process.argv[2] ?? join(tmpdir(), 'nanase-tools-moon');
mkdirSync(dir, { recursive: true });
const zipPath = join(dir, 'MOON_nomenclature_center_pts.zip');
if (!existsSync(zipPath)) {
  console.log(`${USGS} をダウンロード`);
  const res = await fetch(USGS);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  writeFileSync(zipPath, new Uint8Array(await res.arrayBuffer()));
}
const features = dbf(unzipOne(new Uint8Array(readFileSync(zipPath)), '.dbf'));

const ja = new Map<string, string>();
for (const p of PAGES) {
  const m = names(await wikitext(dir, p.revid));
  console.log(`${p.title}（版 ${p.revid}）: ${m.size} 件`);
  for (const [k, v] of m) if (!ja.has(k)) ja.set(k, v);
}
for (const [en, v] of Object.entries(RENAME)) ja.set(key(en), v);

const kindOf = (type: string): Kind | null => {
  const t = type.split(',')[0];
  if (['Mare', 'Oceanus', 'Lacus', 'Sinus', 'Palus'].includes(t)) return 'mare';
  if (t === 'Crater') return 'crater';
  if (t === 'Mons') return 'mons';
  if (['Rupes', 'Vallis', 'Promontorium'].includes(t)) return 'other';
  return null;
};
const r2 = (x: number) => Math.round(x * 100) / 100,
  r1 = (x: number) => Math.round(x * 10) / 10;
const rows: Row[] = [];
const used = new Set<string>();
for (const f of features) {
  if (f.approval !== 'Adopted by IAU') continue;
  const kind = kindOf(f.type);
  if (!kind) continue;
  const lat = Number(f.center_lat),
    lon = ((((Number(f.center_lon) + 180) % 360) + 360) % 360) - 180,
    diam = Number(f.diameter);
  if (![lat, lon, diam].every(Number.isFinite)) throw new Error(`${f.name} の数が読めません`);
  const name = ja.get(key(f.name)) ?? null;
  if (kind === 'crater' && (diam < 20 || Math.abs(lon) > 100)) continue;
  if ((kind === 'mons' || kind === 'other') && !name) continue;
  if (name) used.add(key(f.name));
  rows.push([name, f.name, r2(lat), r2(lon), r1(diam), kind]);
}
rows.sort((a, b) => b[4] - a[4] || a[1].localeCompare(b[1]));

// 日本語名があるのに USGS で見つからない名前（綴りの違いを見つけるため）
const usgsKeys = new Set(features.map((f) => key(f.name)));
const missing = [...ja.keys()].filter((k) => !usgsKeys.has(k));

const json = `[\n${rows.map((r) => `  [${r.map((v) => JSON.stringify(v)).join(', ')}]`).join(',\n')}\n]\n`;
writeFileSync(OUT, json);
const meta = {
  license: 'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/deed.ja',
  format: '[日本語名 | null, 英語名, 緯度, 経度（東が正）, 直径 km, 種類]',
  usgs: { url: USGS, page: 'https://planetarynames.wr.usgs.gov/GIS_Downloads', license: 'public domain' },
  wikipedia: PAGES.map((p) => ({
    title: p.title,
    revid: p.revid,
    url: `https://ja.wikipedia.org/w/index.php?oldid=${p.revid}`,
    license: 'CC BY-SA 4.0',
  })),
};
writeFileSync(META, `${JSON.stringify(meta, null, 2)}\n`);
const n = (k: Kind) => rows.filter((r) => r[5] === k).length;
console.log(
  `${rows.length} 件（日本語名あり ${rows.filter((r) => r[0]).length}）: 海など ${n('mare')}、クレーター ${n('crater')}、山 ${n('mons')}、ほか ${n('other')}、${Buffer.byteLength(json)} バイト`,
);
console.log(`日本語名のうち USGS にない名前 ${missing.length} 件（クレーター以外の地形の名前を含む）`);
console.log(missing.join(' '));
