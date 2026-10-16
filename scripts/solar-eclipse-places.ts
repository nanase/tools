/**
 * 日食のページの地名の検索に使う地名のデータ（src/tools/solar-eclipse/places.json）を作る。
 *
 *   bun scripts/solar-eclipse-places.ts <P05-22_GML.zip> <都道府県コード及び市区町村コード.xlsx> \
 *     <ne_10m_populated_places.zip> <ne_10m_admin_0_countries.zip>
 *
 * 引数は、下の 4 つの出典からダウンロードしたファイル（展開しないまま）。
 * 1 件は [表示名, 読み（ひらがな）, 補足（都道府県名・国名）, 緯度, 経度, 英語名（世界だけ。日本は空）]。
 * 緯度・経度は度で小数 4 桁。日本の市（団体コードの順）を先に、世界の都市（人口の多い順）を後に並べる。
 *
 * 出典（許諾・出典表記・加工の詳細は src/tools/solar-eclipse/SOURCES.md）:
 * - 日本の市の位置: 国土数値情報「市町村役場等及び公的集会施設データ」2022 年版（CC BY 4.0）の全国の zip
 *   https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-P05-2022.html
 * - 日本の市の名前と読み: 総務省「全国地方公共団体コード」の「都道府県コード及び市区町村コード」の Excel
 *   （令和 6 年 1 月 1 日更新、公共データ利用規約 第 1.0 版） https://www.soumu.go.jp/denshijiti/code.html
 * - 世界の都市と国名: Natural Earth 1:10m Cultural Vectors の Populated Places（5.1.2）と
 *   Admin 0 – Countries（5.1.1）（パブリックドメイン） https://www.naturalearthdata.com/downloads/10m-cultural-vectors/
 * - 東京都庁・潟上市役所・安芸市役所の位置: Wikidata（CC0）。値はこのスクリプトに書いてある
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

type Row = [string, string, string, number, number, string];
type Rec = Record<string, string>;

const OUT = new URL('../src/tools/solar-eclipse/places.json', import.meta.url);

/* ---------- ファイルの読み出し（zip・DBF・xlsx） ---------- */

/** zip の中のファイル（名前 → 中身）。圧縮は無圧縮と deflate だけ扱う */
function unzip(buf: Uint8Array): Map<string, Uint8Array> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--)
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error('zip の終端が見つかりません');
  const n = dv.getUint16(eocd + 10, true);
  const td = new TextDecoder();
  const out = new Map<string, Uint8Array>();
  let p = dv.getUint32(eocd + 16, true);
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('zip の中央ディレクトリが壊れています');
    const method = dv.getUint16(p + 10, true),
      size = dv.getUint32(p + 20, true),
      nameLen = dv.getUint16(p + 28, true),
      extraLen = dv.getUint16(p + 30, true),
      commentLen = dv.getUint16(p + 32, true),
      local = dv.getUint32(p + 42, true);
    const name = td.decode(buf.subarray(p + 46, p + 46 + nameLen));
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = buf.subarray(start, start + size);
    if (method === 0) out.set(name, data);
    else if (method === 8) out.set(name, new Uint8Array(inflateRawSync(data)));
    else throw new Error(`${name}: zip の圧縮方式 ${method} は扱えません`);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function entry(zip: Map<string, Uint8Array>, suffix: string): Uint8Array {
  for (const [name, data] of zip) if (name.endsWith(suffix)) return data;
  throw new Error(`zip に ${suffix} がありません`);
}

/** DBF（シェープファイルの属性）の行。文字は UTF-8（Natural Earth の .cpg による）、末尾の NUL と空白は除く */
function dbf(buf: Uint8Array): Rec[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const count = dv.getUint32(4, true),
    headLen = dv.getUint16(8, true),
    recLen = dv.getUint16(10, true);
  const td = new TextDecoder();
  const fields: { name: string; off: number; len: number }[] = [];
  let off = 1;
  for (let p = 32; buf[p] !== 0x0d; p += 32) {
    const raw = buf.subarray(p, p + 11);
    const z = raw.indexOf(0);
    const len = buf[p + 16];
    fields.push({ name: td.decode(z < 0 ? raw : raw.subarray(0, z)), off, len });
    off += len;
  }
  const rows: Rec[] = [];
  for (let i = 0; i < count; i++) {
    const b = headLen + i * recLen;
    if (buf[b] === 0x2a) continue; // 削除済みの行
    const r: Rec = {};
    for (const f of fields) {
      let e = b + f.off + f.len;
      while (e > b + f.off && (buf[e - 1] === 0 || buf[e - 1] === 0x20)) e--;
      r[f.name] = td.decode(buf.subarray(b + f.off, e)).trim();
    }
    rows.push(r);
  }
  return rows;
}

const unescapeXml = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/** 文字列の中身（ふりがな <rPh> を除いた <t> をつなぐ） */
const xmlText = (s: string) =>
  unescapeXml(
    (s.replace(/<rPh[\s\S]*?<\/rPh>/g, '').match(/<t(?:\s[^>]*)?>[\s\S]*?<\/t>/g) ?? [])
      .map((t) => t.replace(/<[^>]+>/g, ''))
      .join(''),
  );

/** xlsx の最初のシートの行（列 A, B, … の文字列） */
function xlsxRows(buf: Uint8Array): string[][] {
  const zip = unzip(buf);
  const td = new TextDecoder();
  const text = (name: string) => td.decode(entry(zip, name));
  const shared = [...text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xmlText(m[1]));
  const rid = text('xl/workbook.xml').match(/<sheet\s[^>]*r:id="([^"]+)"/)?.[1];
  const target = rid && text('xl/_rels/workbook.xml.rels').match(new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`))?.[1];
  if (!target) throw new Error('xlsx の最初のシートが見つかりません');
  const sheet = text(`xl/${target.replace(/^\/?xl\//, '')}`);
  const rows: string[][] = [];
  for (const m of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const c of m[1].matchAll(/<c\s+r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const col = [...c[1]].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const body = c[3] ?? '';
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      if (/t="s"/.test(c[2])) row[col] = shared[Number(v)];
      else if (/t="inlineStr"/.test(c[2])) row[col] = xmlText(body);
      else row[col] = v === undefined ? '' : unescapeXml(v);
    }
    rows.push(row);
  }
  return rows;
}

/* ---------- 文字の変換 ---------- */

/** カタカナ（半角も）をひらがなに。「・」「＝」と空白は除く（検索は読みの前方一致のため） */
const hira = (s: string) =>
  s
    .normalize('NFKC')
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[・＝\s]/g, '');

const isKana = (s: string) => /^[ァ-ヶー・＝]+$/.test(s);

/** 英語名を ASCII に（ローマ字の入力で前方一致させるため、ダイアクリティカルマークを外す） */
const ascii = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ø/g, 'o')
    .replace(/Ø/g, 'O')
    .replace(/ł/g, 'l')
    .replace(/ß/g, 'ss')
    .replace(/æ/g, 'ae')
    .replace(/đ/g, 'd')
    .replace(/ı/g, 'i')
    .replace(/[‘’ʻ]/g, "'")
    .replace(/\s+/g, ' ');

const deg = (x: number) => Math.round(x * 1e4) / 1e4;

/* ---------- 日本の市 ---------- */

interface Office {
  code: string;
  cls: string;
  name: string;
  lat: number;
  lon: number;
}

/** 国土数値情報 P05 の施設。全国の zip の中に都道府県ごとの zip があり、その中の GeoJSON を読む */
function offices(buf: Uint8Array): Office[] {
  const td = new TextDecoder();
  const out: Office[] = [];
  for (const [name, inner] of unzip(buf)) {
    if (!name.endsWith('.zip')) continue;
    const g = JSON.parse(td.decode(entry(unzip(inner), '.geojson'))) as {
      features: { properties: Rec; geometry: { coordinates: [number, number] } }[];
    };
    for (const f of g.features) {
      const p = f.properties;
      const [lon, lat] = f.geometry.coordinates;
      out.push({ code: p.P05_001, cls: p.P05_002, name: p.P05_003, lat, lon });
    }
  }
  return out;
}

/**
 * 本庁（施設分類 1）が P05 にない市・P05 の本庁が今の本庁でない市は、P05 の別の施設を名前で選ぶ。
 * どれも市の公式サイトに載っている市役所の所在地を 2026-10-16 に確かめた
 */
const OFFICE: Record<string, string> = {
  // 旭川市: 市役所は 7条通9丁目の総合庁舎。P05 の「総合庁舎」（6条通9）を使う
  '01204': '総合庁舎',
  // 仙北市: 市の代表（総務課）は田沢湖庁舎（田沢湖生保内字宮ノ後30）
  '05215': '仙北市役所田沢湖庁舎',
  // 那須烏山市: 烏山庁舎（中央1-1-1）と南那須庁舎のうち、市が先に挙げている烏山庁舎
  '09215': '烏山庁舎',
  // 北名古屋市: 西庁舎（西之保清水田15）と東庁舎のうち、市が先に挙げている西庁舎。どちらが本庁かは確かめられていない
  '23234': '北名古屋市役所西庁舎',
  // 安来市: 安来庁舎（安来町878-2）
  '32206': '安来庁舎',
  // 志布志市: 2021 年から本庁を志布志支所の庁舎（志布志町志布志2-1-1）へ移した。P05 の本庁は有明町の旧本庁
  '46221': '志布志支所',
};

/** P05 に今の市役所がない市: Wikidata（CC0）の市の座標 */
const FIXED: Record<string, [number, number]> = {
  // 潟上市: 天王字棒沼台226-1 の市役所（Q646780）
  '05211': [39.85725, 140.013028],
  // 安芸市: 2024 年 1 月から土居82-1 の新庁舎。P05 は矢ノ丸の旧庁舎。Q417825 の 2 つの座標のうち土居の方
  '39203': [33.516389, 133.906111],
};

/** 東京: 23 区に分けず 1 件。位置は東京都庁（Wikidata Q111973） */
const TOKYO: Row = ['東京', 'とうきょう', '東京都庁', 35.6895, 139.6917, ''];

function japan(p05: Uint8Array, codeXlsx: Uint8Array): Row[] {
  const all = offices(p05);
  const rows = xlsxRows(codeXlsx);
  if (!rows[0]?.[0]?.includes('団体コード')) throw new Error('団体コードの表の見出しが違います');
  const out: Row[] = [];
  for (const [code6, pref, city, , kana] of rows.slice(1)) {
    if (!city?.endsWith('市')) {
      // 東京は特別区の前に入れる（団体コード 13101 の前）
      if (code6?.startsWith('131') && !out.includes(TOKYO)) out.push(TOKYO);
      continue;
    }
    const code = code6.slice(0, 5);
    let pos: [number, number];
    const fixed = FIXED[code];
    if (fixed) pos = fixed;
    else {
      const pick = OFFICE[code];
      // 政令市の市役所は区のコードで入っているので、同じ都道府県の本庁から名前で探す
      let hit = pick
        ? all.filter((o) => o.code === code && o.name === pick)
        : all.filter((o) => o.cls === '1' && o.code.slice(0, 2) === code.slice(0, 2) && o.name === `${city}役所`);
      // 同じ市役所が別の団体のコードにも入っているもの（石狩市役所が芽室町のコードにも）は、市のコードの方
      if (hit.length > 1) hit = hit.filter((o) => o.code === code);
      if (hit.length !== 1) throw new Error(`${pref}${city}（${code}）の市役所が ${hit.length} 件です`);
      pos = [hit[0].lat, hit[0].lon];
    }
    out.push([city, hira(kana), pref, deg(pos[0]), deg(pos[1]), '']);
  }
  if (!out.includes(TOKYO)) throw new Error('東京を入れる位置（特別区）が見つかりません');
  return out;
}

/* ---------- 世界の都市 ---------- */

/**
 * 選び方: 首都・属領の首府（FEATURECLA が Admin-0 …、または ADM0CAP = 1）と、規模の順位 SCALERANK が
 * 0〜2 の都市・3 で POP_MAX が 50 万人以上・4 で 200 万人以上の都市。日本の都市は除く（日本の市と重ねない）
 */
function chosen(r: Rec): boolean {
  if (r.ADM0_A3 === 'JPN') return false;
  if (r.ADM0CAP === '1' || r.FEATURECLA.startsWith('Admin-0')) return true;
  const rank = Number(r.SCALERANK),
    pop = Number(r.POP_MAX);
  return rank <= 2 || (rank === 3 && pop >= 5e5) || (rank === 4 && pop >= 2e6);
}

/** 落とす都市（キーは ADM0_A3:NAMEASCII）: 日本語名が別の町（錦渓鎮）になっている */
const DROP = new Set(['CHN:Jinxi']);

/** 日本語名を直す都市 */
const NAME_JA: Record<string, string> = {
  'KAZ:Astana': 'アスタナ', // 2022 年に「ヌル・スルタン」から戻った
  'UKR:Kiev': 'キーウ', // 日本政府の表記（2022 年から）
  'BEL:Brussels': 'ブリュッセル', // 「ブリュッセル＝ヴィル」（市の 1 区域）
  'TUV:Funafuti': 'フナフティ', // 「フナフティ島」
  'PLW:Melekeok': 'マルキョク', // 「マルキョク州」
  'CHN:Hami': '哈密', // 「伊州区」（市の中心の区）
};

/** 英語名を直す都市（NAME_EN が別の場所・古い名前のもの） */
const NAME_EN: Record<string, string> = {
  'MEX:Tampico': 'Tampico', // 「Ciudad Madero Tamaulipas」
  'CHN:Hami': 'Hami', // 「Yizhou」
  'KAZ:Astana': 'Astana', // 「Nur-Sultan」
};

/** 都市の ADM0_A3 と国の表の ADM0_A3 が違うもの */
const A3: Record<string, string> = {
  SSD: 'SDS', // 南スーダン
  SJM: 'NOR', // スヴァールバル諸島（ロングイェールビーン）。国の表ではノルウェーに含まれる
};

/** 国名を、ふだん使う短い名前にする（Natural Earth の NAME_JA は正式名に近いものがある） */
const COUNTRY: Record<string, string> = {
  USA: 'アメリカ', // アメリカ合衆国
  CHN: '中国', // 中華人民共和国
  TWN: '台湾', // 中華民国
  KOR: '韓国', // 大韓民国
  PRK: '北朝鮮', // 朝鮮民主主義人民共和国
  THA: 'タイ', // タイ王国
  MNG: 'モンゴル', // モンゴル国
  MLI: 'マリ', // マリ共和国
  KOS: 'コソボ', // コソボ共和国
  ZAF: '南アフリカ', // 南アフリカ共和国
};

/** 中国・台湾・韓国・北朝鮮・香港の都市は、名前の末尾の「市」「特別市」「広域市」を外す（例: 北京市 → 北京） */
const NO_SHI = new Set(['CHN', 'TWN', 'KOR', 'PRK', 'HKG', 'MAC']);

/** 漢字の都市名の読み（日本で使う読み） */
const YOMI: Record<string, string> = {
  北京: 'ぺきん',
  上海: 'しゃんはい',
  天津: 'てんしん',
  重慶: 'じゅうけい',
  広州: 'こうしゅう',
  深圳: 'しんせん',
  東莞: 'とうかん',
  武漢: 'ぶかん',
  成都: 'せいと',
  西安: 'せいあん',
  南京: 'なんきん',
  杭州: 'こうしゅう',
  瀋陽: 'しんよう',
  長春: 'ちょうしゅん',
  大連: 'だいれん',
  青島: 'ちんたお',
  済南: 'さいなん',
  鄭州: 'ていしゅう',
  太原: 'たいげん',
  石家荘: 'せっかそう',
  合肥: 'ごうひ',
  福州: 'ふくしゅう',
  廈門: 'あもい',
  長沙: 'ちょうさ',
  南昌: 'なんしょう',
  昆明: 'こんめい',
  貴陽: 'きよう',
  南寧: 'なんねい',
  蘭州: 'らんしゅう',
  西寧: 'せいねい',
  銀川: 'ぎんせん',
  包頭: 'ぱおとう',
  吉林: 'きつりん',
  淄博: 'しはく',
  煙台: 'えんたい',
  臨沂: 'りんぎ',
  棗荘: 'そうそう',
  徐州: 'じょしゅう',
  温州: 'おんしゅう',
  南充: 'なんじゅう',
  淮南: 'わいなん',
  汕頭: 'すわとう',
  桂林: 'けいりん',
  萍郷: 'ひょうきょう',
  哈密: 'はみ',
  香港: 'ほんこん',
  台北: 'たいぺい',
  台中: 'たいちゅう',
  高雄: 'たかお',
  仁川: 'いんちょん',
  釜山: 'ぷさん',
  平壌: 'ぴょんやん',
  'ワシントンD.C.': 'わしんとんでぃーしー',
};

function world(placesZip: Uint8Array, countriesZip: Uint8Array): Row[] {
  const countries = new Map<string, string>();
  for (const c of dbf(entry(unzip(countriesZip), '.dbf'))) countries.set(c.ADM0_A3, c.NAME_JA);
  const places = dbf(entry(unzip(placesZip), '.dbf'))
    .filter(chosen)
    .sort((a, b) => Number(b.POP_MAX) - Number(a.POP_MAX));
  const out: Row[] = [];
  const keys = new Set<string>();
  const missing: string[] = [];
  for (const r of places) {
    const key = `${r.ADM0_A3}:${r.NAMEASCII}`;
    if (DROP.has(key)) continue;
    if (keys.has(key)) throw new Error(`${key} が 2 件あります`);
    keys.add(key);
    const a3 = A3[r.ADM0_A3] ?? r.ADM0_A3;
    const country = COUNTRY[a3] ?? countries.get(a3);
    if (!country) {
      missing.push(`${key} の国 ${r.ADM0_A3}`);
      continue;
    }
    let name = NAME_JA[key] ?? r.NAME_JA;
    if (NO_SHI.has(r.ADM0_A3)) name = name.replace(/(特別市|広域市|市)$/, '');
    let yomi = YOMI[name];
    if (!yomi && isKana(name)) yomi = hira(name);
    else if (!yomi && name.endsWith('市') && isKana(name.slice(0, -1))) yomi = `${hira(name.slice(0, -1))}し`;
    if (!yomi) {
      missing.push(`${name}（${key}）`);
      continue;
    }
    const en = ascii(NAME_EN[key] ?? (r.NAME_EN || r.NAMEASCII));
    out.push([name, yomi, country, deg(Number(r.LATITUDE)), deg(Number(r.LONGITUDE)), en]);
  }
  if (missing.length) throw new Error(`国か読みが決まらない都市があります: ${missing.join('、')}`);
  return out;
}

/* ---------- 書き出し ---------- */

const [p05, code, placesZip, countriesZip] = process.argv.slice(2);
if (!p05 || !code || !placesZip || !countriesZip) {
  console.error(
    '使い方: bun scripts/solar-eclipse-places.ts <P05-22_GML.zip> <都道府県コード及び市区町村コード.xlsx> <ne_10m_populated_places.zip> <ne_10m_admin_0_countries.zip>',
  );
  process.exit(1);
}
const read = (f: string) => new Uint8Array(readFileSync(f));
const jp = japan(read(p05), read(code));
const ww = world(read(placesZip), read(countriesZip));
// biome の JSON の書式に合わせる: 1 件 1 行。行末のカンマまで含めた幅（全角は 2）が 120 を超える件は、要素ごとに改行する
const wide = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/;
const width = (s: string) => [...s].reduce((w, c) => w + (wide.test(c) ? 2 : 1), 0);
const all = [...jp, ...ww];
const lines = all.map((r, k) => {
  const one = `  [${r.map((v) => JSON.stringify(v)).join(', ')}]`;
  if (width(one) + (k < all.length - 1 ? 1 : 0) <= 120) return one;
  return `  [\n${r.map((v) => `    ${JSON.stringify(v)}`).join(',\n')}\n  ]`;
});
const json = `[\n${lines.join(',\n')}\n]\n`;
writeFileSync(OUT, json);
console.log(`日本 ${jp.length} 件、世界 ${ww.length} 件、${Buffer.byteLength(json)} バイト`);
