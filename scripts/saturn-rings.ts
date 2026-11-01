/**
 * 土星のページの模様の帯（public/saturn/s2025a.webp）と環の表（public/saturn/rings.bin）を作る。
 * 画像の読み書きに ImageMagick（magick）を使う。
 *
 *   bun scripts/saturn-rings.ts [置き場]
 *
 * 置き場（リポジトリの外のディレクトリ。省略すると OS の一時ディレクトリの nanase-tools-saturn）に元のファイルがなければ
 * ダウンロードする。出典と許諾は src/tools/saturn/SOURCES.md。
 *
 * 模様の帯: OPAL の 2025 年の全球の地図を行ごとの中央値にして経度方向にならす。環で隠れた赤道と撮れていない極は近い行で埋める。
 *   OPAL の色合成は 395 nm を青に当てるので青みが強い。目で見た淡い黄土色へ寄せるため、sRGB の値に色ごとの TINT を掛ける。
 *
 * 環の表: 半径 74000〜141000 km を N 等分し、1 点あたり 4 バイト（sRGB の色と、a = 1 − exp(−τ)）を並べる。
 * - τ（法線方向の光学的厚さ）: Cassini VIMS のγ Cru の恒星掩蔽（波長 2.9 µm、10 km 分解能）の中央値
 * - 色: Cassini の自然色の動径モザイク PIA11142 の中央の行の明るさを、撮影の幾何と τ の単散乱の式で割ったもの
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { R0, R1, RING_N } from '../src/tools/saturn/rings';

const OUT = new URL('../public/saturn/', import.meta.url);
const OPAL =
  'https://archive.stsci.edu/hlsps/opal/cycle32/saturn/hlsp_opal_hst_wfc3-uvis_saturn-2025a_f395n-f502n-f631n_v1_globalmap.tif';
const VIMS = 'https://pds-rings.seti.org/holdings/volumes/COVIMS_8xxx/COVIMS_8001/data/';
const PIA = 'https://assets.science.nasa.gov/content/dam/science/psd/photojournal/pia/pia11/pia11142/PIA11142.jpg';
/** 模様の色に掛ける値（赤・緑・青） */
const TINT = [1.12, 0.96, 0.7];
/** PIA11142 の撮影の幾何: 照らされた面の 10° 下から（キャプション）、太陽は 2008-11-26 に環の面の南 4.0°（このページの計算） */
const MU = Math.sin((10 * Math.PI) / 180);
const MU0 = Math.sin((4.0 * Math.PI) / 180);

const dir = process.argv[2] ?? join(tmpdir(), 'nanase-tools-saturn');
mkdirSync(dir, { recursive: true });
mkdirSync(OUT, { recursive: true });

async function download(url: string, name: string): Promise<string> {
  const path = join(dir, name);
  if (existsSync(path)) return path;
  console.log(`${name} をダウンロードします`);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${name}: ${r.status}`);
  writeFileSync(path, new Uint8Array(await r.arrayBuffer()));
  return path;
}

/** 画像を無圧縮の RGB にして読む */
function rawRgb(path: string, args: string[], w: number, h: number): Uint8Array {
  const raw = join(dir, 'tmp.rgb');
  execFileSync('magick', [path, ...args, '-depth', '8', `rgb:${raw}`], { stdio: ['ignore', 'ignore', 'ignore'] });
  const b = new Uint8Array(readFileSync(raw));
  if (b.length !== w * h * 3) throw new Error(`${path}: 大きさが ${b.length}`);
  return b;
}

const median = (a: number[]): number => {
  const s = [...a].sort((x, y) => x - y);
  return s[s.length >> 1];
};
const toLin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

/* ---------- 模様の帯 ---------- */
{
  const W = 1800,
    H = 900;
  const px = rawRgb(await download(OPAL, 'opal-saturn-2025a.tif'), [], W, H);
  const band: number[][] = [];
  const ok: boolean[] = [];
  for (let y = 0; y < H; y++) {
    const c = [0, 1, 2].map((k) => {
      const v: number[] = [];
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 3;
        if (Math.max(px[i], px[i + 1], px[i + 2]) > 8) v.push(px[i + k]);
      }
      return v;
    });
    ok.push(c[0].length > 0.98 * W);
    band.push(c.map((v) => (v.length ? median(v) : 0)));
  }
  /* 欠けた行（極と環で隠れた赤道）は上下の行の間を直線で埋める。縁の 4 行は使わない */
  const good = ok.map((v, y) => v && ok[Math.max(0, y - 4)] && ok[Math.min(H - 1, y + 4)]);
  const idx = good.flatMap((v, y) => (v ? [y] : []));
  const out = new Uint8Array(4 * H * 3);
  for (let y = 0; y < H; y++) {
    let a = idx[0],
      b = idx[idx.length - 1];
    for (const k of idx) {
      if (k <= y) a = k;
      if (k >= y) {
        b = k;
        break;
      }
    }
    const f = b > a ? (y - a) / (b - a) : 0;
    for (let c = 0; c < 3; c++) {
      const v = Math.round(Math.min(255, (band[a][c] * (1 - f) + band[b][c] * f) * TINT[c]));
      for (let x = 0; x < 4; x++) out[(y * 4 + x) * 3 + c] = v;
    }
  }
  const raw = join(dir, 's.rgb');
  writeFileSync(raw, out);
  const webp = fileURLToPath(new URL('s2025a.webp', OUT));
  execFileSync('magick', ['-size', `4x${H}`, '-depth', '8', `rgb:${raw}`, '-define', 'webp:lossless=true', webp]);
  console.log(`s2025a.webp: ${statSync(webp).size} バイト、撮れている行 ${idx[0]}〜${idx[idx.length - 1]}`);
}

/* ---------- 環の光学的厚さ ---------- */
const STEP = 10;
const T0 = 65000;
const TN = Math.round((145000 - T0) / STEP) + 1;
const list = await (await fetch(VIMS)).text();
const files = [...list.matchAll(/href="(VIMS_[^"]+GAMCRU[^"]+_TAU_10KM\.TAB)"/g)].map((m) => m[1]);
const bins: number[][] = Array.from({ length: TN }, () => []);
for (const f of files) {
  const s = readFileSync(await download(VIMS + f, f), 'utf8');
  for (const l of s.trim().split('\n')) {
    const c = l
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    const i = Math.round((c[0] - T0) / STEP);
    if (i < 0 || i >= TN) continue;
    /* 測れる最大を超える所は最大の値とみなす */
    const t = c[3];
    if (t > -9) bins[i].push(Math.min(t < 0 ? 0 : t, c[4] > 0 ? c[4] : 99));
    else if (c[4] > 0) bins[i].push(c[4]);
  }
}
const tau = bins.map((v) => (v.length ? median(v) : 0));
const tauAt = (r: number): number => {
  const u = (r - T0) / STEP;
  const i = Math.max(0, Math.min(TN - 2, Math.floor(u)));
  return tau[i] + (tau[i + 1] - tau[i]) * (u - i);
};

/* ---------- 環の色 ---------- */
const PW = 12126;
const rows = 40;
/* 模様の弧の頂点の行（放射の向きと画素の列がそろう） */
const rowY = 751;
const pia = rawRgb(
  await download(PIA, 'PIA11142.jpg'),
  ['-crop', `${PW}x${rows}+0+${rowY}`, '+repage', '-resize', `${PW}x1!`],
  PW,
  1,
);
const lin = (x: number, c: number) => toLin(pia[Math.round(x) * 3 + c] / 255);
const scatter = (t: number) => (MU0 / (MU + MU0)) * (1 - Math.exp(-t * (1 / MU + 1 / MU0)));

/**
 * 画素と半径の対応 [半径 km, x]。モザイクは放射の向きの縮尺が場所で変わる（1 画素 5.9〜6.7 km）ので、
 * 掩蔽から計算した明るさとの局所の相関が高い所（相関 0.7〜0.97）の値を折れ線でつなぐ
 */
// biome-ignore format: 表
const MARKS = [[75000, 1214], [80000, 2062], [85000, 2902], [90000, 3732], [92500, 4105], [117500, 8090], [120000, 8476], [122500, 8834], [132500, 10418], [135000, 10797], [137500, 11170], [140180, 11635]];
function xOf(r: number): number {
  let i = 0;
  while (i < MARKS.length - 2 && r > MARKS[i + 1][0]) i++;
  const [r0, x0] = MARKS[i],
    [r1, x1] = MARKS[i + 1];
  return x0 + ((r - r0) / (r1 - r0)) * (x1 - x0);
}

const bin = (R1 - R0) / RING_N;
const data = new Uint8Array(RING_N * 4);
const alb: number[][] = [];
for (let i = 0; i < RING_N; i++) {
  const r = R0 + (i + 0.5) * bin;
  /* 1 点の範囲の平均 */
  let t = 0,
    n = 0;
  for (let q = r - bin / 2; q < r + bin / 2; q += 2) {
    t += 1 - Math.exp(-tauAt(q));
    n++;
  }
  const a = t / n;
  const c = [0, 0, 0];
  let m = 0;
  for (let x = xOf(r - bin / 2); x <= xOf(r + bin / 2); x += 1) {
    for (let k = 0; k < 3; k++) c[k] += lin(x, k);
    m++;
  }
  const s = scatter(-Math.log(1 - Math.min(a, 0.999)));
  /* 薄い所は割る値が小さくて暴れるので、色を決められる所だけ使う */
  alb.push(s > 0.04 ? c.map((v) => v / m / s) : [-1, -1, -1]);
  data[i * 4 + 3] = Math.round(Math.min(1, a) * 255);
}
/* 色を決められない所は近い点で埋め、100 km ほどでならす */
const smooth: number[][] = [[], [], []];
for (let c = 0; c < 3; c++) {
  const known = alb.flatMap((v, i) => (v[c] >= 0 ? [i] : []));
  const fill = alb.map((v, i) => {
    if (v[c] >= 0) return v[c];
    const j = known.reduce((p, q) => (Math.abs(q - i) < Math.abs(p - i) ? q : p), known[0]);
    return alb[j][c];
  });
  const w = Math.round(100 / bin);
  for (let i = 0; i < RING_N; i++) {
    let s = 0,
      n = 0;
    for (let d = -w; d <= w; d++) {
      const v = fill[i + d];
      if (v !== undefined) {
        s += v;
        n++;
      }
    }
    smooth[c].push(s / n);
  }
}
/* 明るさの尺度は描くときに決める。B 環の明るい所（緑の 95 パーセンタイル）を 0.95 にする */
const ib = (r: number) => Math.round((r - R0) / bin);
const peak = [...smooth[1].slice(ib(95000), ib(117000))].sort((a, b) => a - b);
const scale = 0.95 / peak[Math.floor(peak.length * 0.95)];
for (let c = 0; c < 3; c++)
  for (let i = 0; i < RING_N; i++) data[i * 4 + c] = Math.round(toSrgb(Math.min(1, smooth[c][i] * scale)) * 255);
const bin2 = fileURLToPath(new URL('rings.bin', OUT));
writeFileSync(bin2, data);
const pick = (r: number) => {
  const i = Math.round((r - R0) / bin);
  return `${r}: ${[...data.slice(i * 4, i * 4 + 3)].join(',')} τ=${(-Math.log(1 - data[i * 4 + 3] / 255.01)).toFixed(2)}`;
};
console.log(`rings.bin: ${data.length} バイト`);
console.log([80000, 86000, 95000, 105000, 112000, 119000, 125000, 132000, 135000].map(pick).join('\n'));
