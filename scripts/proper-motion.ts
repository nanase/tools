/**
 * 固有運動のページの星の表（public/proper-motion/stars.bin）・星座と天の川（public/proper-motion/sky.json）・
 * しくみとカードの図柄で使う星（src/tools/proper-motion/fixed.ts）を作る。
 *
 *   bun scripts/proper-motion.ts [置き場]
 *
 * 置き場（リポジトリの外のディレクトリ。省略すると OS の一時ディレクトリの nanase-tools-proper-motion）に元のファイルがなければ
 * ダウンロードする。出典と許諾は src/tools/proper-motion/SOURCES.md。
 *
 * - 星: HYG v3.8 の 8 等までの星（太陽は除く）。位置・距離・速度（視線速度を含む）は HYG の値をそのまま使う
 * - 星座線と星座名: d3-celestial の constellations.lines.json と constellations.json。線の頂点は最も近い星に置き換える
 * - 天の川: HYG の 5〜7.3 等の星（Hipparcos が全天で漏れなく拾った暗さ）を銀河座標の 2° の格子で数え、面積で割ってぼかし、対数で 0〜255 に並べる
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  BV_Q,
  FAR,
  GAL,
  MAG_Q,
  MAG0,
  MW_H,
  MW_STEP,
  MW_W,
  REC,
  type SkyJson,
  V_Q,
} from '../src/tools/proper-motion/format';

const HYG = 'https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/v3/hyg_v38.csv.gz';
const D3 = 'https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/';
const OUT = new URL('../public/proper-motion/', import.meta.url);
const OUT_FIX = new URL('../src/tools/proper-motion/fixed.ts', import.meta.url);
/** 表に入れる星の暗さの限り */
const LIM = 8.0;
/** 天の川に数える星の等級 */
const MW_MAG = [5.0, 7.3] as const;
const D = Math.PI / 180;

const dir = process.argv[2] ?? join(tmpdir(), 'nanase-tools-proper-motion');
mkdirSync(dir, { recursive: true });
mkdirSync(OUT, { recursive: true });

async function download(url: string, name: string): Promise<Buffer> {
  const path = join(dir, name);
  if (!existsSync(path)) {
    console.log('取得', url);
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    writeFileSync(path, Buffer.from(await r.arrayBuffer()));
  }
  return readFileSync(path);
}

type V3 = [number, number, number];
const vec = (ra: number, dec: number): V3 => [
  Math.cos(dec * D) * Math.cos(ra * D),
  Math.cos(dec * D) * Math.sin(ra * D),
  Math.sin(dec * D),
];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/* ---------- 星 ---------- */
interface Star {
  ra: number;
  dec: number;
  u: V3;
  mag: number;
  bv: number;
  /** 距離 [pc]。0 は分からない */
  d: number;
  /** 速度 [pc/千年] */
  v: V3;
  /** J2000 の位置 [pc]（距離が分からない星は FAR に置く） */
  p: V3;
  hr: number;
  bayer: string;
  con: string;
}
const csv = gunzipSync(await download(HYG, 'hyg_v38.csv.gz'))
  .toString('utf8')
  .split('\n');
const head = (csv[0] as string).replace(/"/g, '').split(',');
const col = (k: string): number => {
  const i = head.indexOf(k);
  if (i < 0) throw new Error(`HYG に ${k} の列がない`);
  return i;
};
const C = Object.fromEntries(
  ['ra', 'dec', 'dist', 'pmra', 'pmdec', 'mag', 'ci', 'vx', 'vy', 'vz', 'hr', 'bayer', 'con'].map((k) => [k, col(k)]),
);
const stars: Star[] = [];
const faint: V3[] = [];
for (const line of csv.slice(1)) {
  const c = line.replace(/"/g, '').split(',');
  if (c.length < head.length) continue;
  const mag = Number(c[C.mag as number]),
    dist = Number(c[C.dist as number]);
  if (!(dist > 0) || Number.isNaN(mag)) continue;
  const ra = Number(c[C.ra as number]) * 15,
    dec = Number(c[C.dec as number]),
    u = vec(ra, dec);
  if (mag >= MW_MAG[0] && mag <= MW_MAG[1]) faint.push(u);
  if (mag > LIM) continue;
  const known = dist < 99999;
  let v: V3;
  if (known) {
    /* HYG v3.8 の vx・vy・vz [pc/年] は視線速度を含む */
    v = [Number(c[C.vx as number]) * 1000, Number(c[C.vy as number]) * 1000, Number(c[C.vz as number]) * 1000];
  } else {
    /* 距離が分からない星: FAR に置き、固有運動 [mas/年] だけから接線の速度を作る */
    const k = (FAR * 1000 * D) / 3600 / 1000,
      pa = Number(c[C.pmra as number]) * k,
      pd = Number(c[C.pmdec as number]) * k,
      a = ra * D,
      e = dec * D;
    v = [
      -Math.sin(a) * pa - Math.sin(e) * Math.cos(a) * pd,
      Math.cos(a) * pa - Math.sin(e) * Math.sin(a) * pd,
      Math.cos(e) * pd,
    ];
  }
  const d = known ? dist : 0,
    r = known ? dist : FAR;
  stars.push({
    ra,
    dec,
    u,
    mag,
    bv: c[C.ci as number] === '' ? 0.6 : Number(c[C.ci as number]),
    d,
    v,
    p: [u[0] * r, u[1] * r, u[2] * r],
    hr: Number(c[C.hr as number]) || 0,
    bayer: c[C.bayer as number] ?? '',
    con: c[C.con as number] ?? '',
  });
}
stars.sort((a, b) => a.mag - b.mag);
const N = stars.length;

/* ---------- 星座 ---------- */
interface Feature<G> {
  id: string;
  properties: Record<string, string>;
  geometry: G;
}
const consJson = JSON.parse((await download(`${D3}constellations.json`, 'constellations.json')).toString('utf8')) as {
  features: Feature<{ coordinates: number[] }>[];
};
const linesJson = JSON.parse(
  (await download(`${D3}constellations.lines.json`, 'constellations.lines.json')).toString('utf8'),
) as { features: Feature<{ coordinates: number[][][] }>[] };
const CONS: [string, string, number][] = [];
for (const f of consJson.features)
  if (!CONS.some((x) => x[0] === f.id)) CONS.push([f.id, f.properties.ja as string, Number(f.properties.rank)]);
const conIdx = new Map(CONS.map((c, i) => [c[0], i]));

/** 向き u に最も近い星（明るい星を先に見る） */
function nearest(u: V3): [number, number] {
  let bi = 0,
    bd = -2;
  for (let i = 0; i < N; i++) {
    const d = dot((stars[i] as Star).u, u);
    if (d > bd + 1e-9) {
      bd = d;
      bi = i;
    }
  }
  return [bi, Math.acos(Math.min(1, bd)) / D];
}
const lines: Record<string, number[][]> = {};
let far = 0;
for (const f of linesJson.features)
  for (const pl of f.geometry.coordinates) {
    if (!lines[f.id]) lines[f.id] = [];
    (lines[f.id] as number[][]).push(
      pl.map(([ra, dec]) => {
        const [i, d] = nearest(vec(((ra as number) + 360) % 360, dec as number));
        if (d > 0.2) far++;
        return i;
      }),
    );
  }

/* ---------- 名前 ---------- */
const NAMES: Record<string, string> = {
  'Alp CMa': 'シリウス',
  'Alp Car': 'カノープス',
  'Alp Boo': 'アルクトゥルス',
  'Alp Lyr': 'ベガ',
  'Alp Aur': 'カペラ',
  'Bet Ori': 'リゲル',
  'Alp CMi': 'プロキオン',
  'Alp Ori': 'ベテルギウス',
  'Alp Eri': 'アケルナル',
  'Alp Aql': 'アルタイル',
  'Alp Tau': 'アルデバラン',
  'Alp Sco': 'アンタレス',
  'Alp Vir': 'スピカ',
  'Bet Gem': 'ポルックス',
  'Alp PsA': 'フォーマルハウト',
  'Alp Cyg': 'デネブ',
  'Alp Leo': 'レグルス',
  'Alp Gem': 'カストル',
  'Alp UMi': 'ポラリス',
  'Alp Dra': 'トゥバン',
  'Alp Cep': 'アルデラミン',
  'Gam Cep': 'エライ',
  'Bet UMi': 'コカブ',
  'Bet Cen': 'ハダル',
  'Alp Cru': 'アクルックス',
  'Gam Ori': 'ベラトリックス',
  'Bet Leo': 'デネボラ',
  'Alp UMa': 'ドゥーベ',
  'Bet Per': 'アルゴル',
  'Alp Cen': 'リギル・ケンタウルス',
  'Bet Cru': 'ミモザ',
  'Lam Sco': 'シャウラ',
  'Alp Per': 'ミルファク',
  'Alp And': 'アルフェラッツ',
  'Eps UMa': 'アリオト',
  'Eta UMa': 'アルカイド',
  'Alp Oph': 'ラスアルハゲ',
  'Alp Hya': 'アルファルド',
  'Bet Cyg': 'アルビレオ',
  'Bet UMa': 'メラク',
  'Gam UMa': 'フェクダ',
  'Del UMa': 'メグレズ',
  'Zet UMa': 'ミザール',
  'Alp Cas': 'シェダル',
  'Bet Cas': 'カフ',
  'Del Cas': 'ルクバー',
  'Eps Cas': 'セギン',
  'Del Ori': 'ミンタカ',
  'Eps Ori': 'アルニラム',
  'Zet Ori': 'アルニタク',
  'Kap Ori': 'サイフ',
  'Gam Leo': 'アルギエバ',
  'Del Leo': 'ゾスマ',
  'Bet Tau': 'エルナト',
  'Alp Ari': 'ハマル',
  'Bet And': 'ミラク',
  'Alp Peg': 'マルカブ',
  'Alp CrB': 'アルフェッカ',
  'Gam Cyg': 'サドル',
  'Eps Boo': 'イザール',
  'Alp Cet': 'メンカル',
  'Omi Cet': 'ミラ',
};
const names: Record<string, string> = {},
  bay: Record<string, string> = {};
stars.forEach((s, i) => {
  const [g, num] = s.bayer.split('-'),
    key = `${g} ${s.con}`;
  const nm = NAMES[key];
  if (g && nm && !Object.values(names).includes(nm)) names[i] = nm;
  if (g && s.mag < 5) bay[i] = (g as string) + (num ?? '');
});
for (const nm of Object.values(NAMES)) if (!Object.values(names).includes(nm)) throw new Error(`${nm} が見つからない`);

/* ---------- 星の並び ---------- */
const byHr = new Map(stars.filter((s) => s.hr).map((s) => [s.hr, stars.indexOf(s)]));
const hrs = (l: number[]) =>
  l.map((h) => {
    const i = byHr.get(h);
    if (i === undefined) throw new Error(`HR ${h} が見つからない`);
    return i;
  });
const aster = {
  dip: [hrs([5191, 5054, 4905, 4660, 4301, 4295, 4554, 4660])],
  sum: [hrs([7001, 7924, 7557, 7001])],
  win: [hrs([2061, 2943, 2491, 2061])],
};

/* ---------- 天の川 ---------- */
const cnt = new Float64Array(MW_W * MW_H);
for (const u of faint) {
  const g = GAL.map((r) => r[0] * u[0] + r[1] * u[1] + r[2] * u[2]) as V3;
  const l = ((Math.atan2(g[1], g[0]) / D + 360) % 360) / MW_STEP,
    b = (Math.asin(Math.max(-1, Math.min(1, g[2]))) / D + 90) / MW_STEP;
  cnt[Math.min(MW_H - 1, Math.floor(b)) * MW_W + (Math.floor(l) % MW_W)]++;
}
/* 面積（cos b）で割り、球面の上で半径 5.5° ほどぼかす */
const dens = new Float64Array(MW_W * MW_H);
const cell: V3[] = [];
for (let y = 0; y < MW_H; y++)
  for (let x = 0; x < MW_W; x++) {
    const b = -90 + (y + 0.5) * MW_STEP,
      l = (x + 0.5) * MW_STEP;
    cell.push(vec(l, b));
    dens[y * MW_W + x] = (cnt[y * MW_W + x] as number) / Math.max(0.02, Math.cos(b * D));
  }
const SIG = 5.5 * D,
  sm = new Float64Array(MW_W * MW_H);
for (let i = 0; i < cell.length; i++) {
  let s = 0,
    w = 0;
  const ci = cell[i] as V3;
  for (let j = 0; j < cell.length; j++) {
    const c = dot(ci, cell[j] as V3);
    if (c < 0.96) continue;
    const a = Math.acos(Math.min(1, c)),
      k = Math.exp(-(a * a) / (2 * SIG * SIG)) * Math.cos((-90 + (Math.floor(j / MW_W) + 0.5) * MW_STEP) * D);
    s += (dens[j] as number) * k;
    w += k;
  }
  sm[i] = s / w;
}
const logs = [...sm].map((v) => Math.log(v + 1e-9)).sort((a, b) => a - b);
const lo = logs[Math.floor(logs.length * 0.5)] as number,
  hi = logs[Math.floor(logs.length * 0.995)] as number;
const mw = Buffer.alloc(MW_W * MW_H);
sm.forEach((v, i) => {
  mw[i] = Math.round(255 * Math.max(0, Math.min(1, (Math.log(v + 1e-9) - lo) / (hi - lo))));
});

/* ---------- 書き出し ---------- */
const buf = Buffer.alloc(N * REC);
const q = (x: number, a: number, b: number) => Math.max(a, Math.min(b, Math.round(x)));
stars.forEach((s, i) => {
  const o = i * REC;
  buf.writeUInt16LE(q((s.ra / 360) * 65536, 0, 65535) % 65536, o);
  buf.writeInt16LE(q((s.dec / 90) * 32767, -32767, 32767), o + 2);
  buf.writeUInt8(q((s.mag - MAG0) / MAG_Q, 0, 255), o + 4);
  buf.writeInt8(q(s.bv / BV_Q, -127, 127), o + 5);
  buf.writeUInt16LE(s.d ? q((Math.log10(s.d) / 4) * 65535, 1, 65535) : 0, o + 6);
  for (let k = 0; k < 3; k++) buf.writeInt16LE(q((s.v[k] as number) * V_Q, -32767, 32767), o + 8 + k * 2);
  buf.writeUInt8(conIdx.get(s.con) ?? 255, o + 14);
});
writeFileSync(new URL('stars.bin', OUT), buf);
const sky: SkyJson = { cons: CONS, lines, names, bay, aster, mw: mw.toString('base64') };
writeFileSync(new URL('sky.json', OUT), JSON.stringify(sky));

/* しくみとカードの図柄で使う星: 位置 [pc] と速度 [pc/千年] と等級 */
const FIX = [
  'ドゥーベ',
  'メラク',
  'フェクダ',
  'メグレズ',
  'アリオト',
  'ミザール',
  'アルカイド',
  'シリウス',
  'プロキオン',
  'アルタイル',
  'ベガ',
  'リギル・ケンタウルス',
  'フォーマルハウト',
  'アルクトゥルス',
  'リゲル',
  'ポラリス',
  'トゥバン',
];
const fix = FIX.map((nm) => {
  const i = Number(Object.keys(names).find((k) => names[k] === nm)),
    s = stars[i] as Star;
  const r6 = (x: number) => Number(x.toPrecision(7));
  return `  ['${nm}', [${s.p.map(r6).join(', ')}], [${s.v.map(r6).join(', ')}], ${s.mag}],`;
});
writeFileSync(
  OUT_FIX,
  `/** しくみの図とカードの図柄で使う星（scripts/proper-motion.ts が作る）。[名前, J2000 の位置 pc, 速度 pc/千年, 等級] */\nexport const FIXED: readonly (readonly [string, readonly [number, number, number], readonly [number, number, number], number])[] = [\n${fix.join('\n')}\n];\n`,
);
console.log(
  `星 ${N}（${buf.length} バイト）・星座線の頂点の外れ ${far}・名前 ${Object.keys(names).length}・天の川の星 ${faint.length}`,
);
