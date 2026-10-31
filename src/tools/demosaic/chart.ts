/**
 * テスト画像（384 × 256、128 × 128 の区画を 3 × 2）。デモザイクの失敗が出やすい模様を並べる。
 * 上段: 柵のある風景・ゾーンプレート・ジーメンススター
 * 下段: 色の境界と斜めの縁・文字（呼び出し側で描く）・布目
 * 各画素は 4 × 4 の副画素の平均にする（センサーの画素の開口で平均した値）
 */
import { newRgb, type Rgb } from './demosaic';

export const TILE = 128;
export const CHART_W = 3 * TILE;
export const CHART_H = 2 * TILE;

type Col = readonly [number, number, number];
/** 区画の中の座標 (u, v)（0〜128 の実数）から色 */
type TileFn = (u: number, v: number) => Col;

const mix = (a: Col, b: Col, t: number): Col => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const gray = (a: number): Col => [a, a, a];

/** 柵のある風景。奥へ行くほど杭の間隔が狭まり、ナイキスト周波数を越える */
const fence: TileFn = (u, v) => {
  const sky = mix([0.36, 0.6, 0.86], [0.82, 0.9, 0.96], v / 60);
  /* 家（赤い屋根と黄色い壁） */
  if (u > 70 && u < 118) {
    const roof = 30 + Math.abs(u - 94) * 0.55;
    if (v > roof && v < 46) return [0.72, 0.13, 0.1];
    if (v >= 46 && v < 82) {
      if (u > 86 && u < 100 && v > 54 && v < 68) return [0.2, 0.3, 0.42];
      return [0.93, 0.8, 0.42];
    }
  }
  if (v < 60) return sky;
  /* 柵: 杭の位置は u の 2 次の関数で、左は 7 画素おき、右は 2.2 画素おき */
  const top = 64 + u * 0.02,
    bottom = 112 - u * 0.12;
  const phase = u / 7 + (u * u) / 380;
  const f = phase - Math.floor(phase);
  if (v > top && v < bottom) {
    if (f < 0.5) return [0.96, 0.96, 0.94];
    if (Math.abs(v - (top + 8)) < 1.2 || Math.abs(v - (bottom - 9)) < 1.2) return [0.86, 0.86, 0.84];
  }
  if (v >= bottom) return mix([0.2, 0.46, 0.16], [0.12, 0.32, 0.1], (v - bottom) / 20);
  return [0.24, 0.5, 0.2];
};

/** ゾーンプレート。中心から 64 画素でナイキスト周波数（0.5 周期/画素）になる */
const zone: TileFn = (u, v) => {
  const x = u - 64,
    y = v - 64;
  return gray(0.5 + 0.45 * Math.cos((Math.PI * (x * x + y * y)) / 128));
};

/** ジーメンススター（36 本） */
const star: TileFn = (u, v) => {
  const x = u - 64,
    y = v - 64,
    r = Math.hypot(x, y);
  if (r > 60) return gray(0.85);
  if (r < 1.5) return gray(0.5);
  const a = Math.atan2(y, x);
  return gray(Math.sin(18 * a) > 0 ? 0.08 : 0.92);
};

/** 彩度の高い色の境界と、角度の違う斜めの縁 */
const edges: TileFn = (u, v) => {
  if (v < 64) {
    /* 上半分: 赤・青・緑・黄の帯を 6° 傾けて並べる */
    const s = u + (v - 32) * Math.tan((6 * Math.PI) / 180);
    const cols: Col[] = [
      [0.85, 0.08, 0.06],
      [0.08, 0.16, 0.85],
      [0.1, 0.72, 0.16],
      [0.95, 0.85, 0.1],
      [0.85, 0.08, 0.06],
    ];
    const i = Math.min(4, Math.max(0, Math.floor(s / 26)));
    /* 帯の中に 1 画素幅の色の線 */
    if (v > 40 && v < 56 && Math.abs(s - (i * 26 + 13)) < 0.5) return [0.98, 0.98, 0.98];
    return cols[i];
  }
  /* 下半分: 白地に黒の縁（左 3°、中 30°、右 45°） */
  const x = u,
    y = v - 64;
  if (x < 42) return gray(x - 21 + (y - 32) * Math.tan((3 * Math.PI) / 180) > 0 ? 0.08 : 0.92);
  if (x < 84) return gray(x - 63 + (y - 32) * Math.tan((30 * Math.PI) / 180) > 0 ? 0.08 : 0.92);
  return gray(x - 106 + (y - 32) > 0 ? 0.08 : 0.92);
};

/** 布目。縦糸と横糸を 1 本ずつ互い違いに上下させ、全体を 4° 傾ける */
const cloth: TileFn = (u, v) => {
  const a = (4 * Math.PI) / 180,
    x = u * Math.cos(a) + v * Math.sin(a),
    y = -u * Math.sin(a) + v * Math.cos(a);
  const p = 2.6,
    ix = Math.floor(x / p),
    iy = Math.floor(y / p);
  const fx = x / p - ix,
    fy = y / p - iy;
  const warp = (ix & 1) === (iy & 1);
  /* 縦糸は紺と白、横糸は赤と白を 4 本ずつ */
  const wc: Col = Math.floor(ix / 4) % 2 ? [0.1, 0.14, 0.42] : [0.9, 0.9, 0.86];
  const fc: Col = Math.floor(iy / 4) % 2 ? [0.74, 0.12, 0.12] : [0.9, 0.9, 0.86];
  /* 糸の縁を少し暗く */
  const edge = warp ? Math.sin(Math.PI * fx) : Math.sin(Math.PI * fy);
  return mix(gray(0.05), warp ? wc : fc, 0.55 + 0.45 * edge);
};

const TILES: (TileFn | null)[][] = [
  [fence, zone, star],
  [edges, null, cloth],
];

/**
 * テスト画像を作る。text は文字の区画（下段の中央、128 × 128）で、ブラウザで描いた RGB を渡す。
 * 渡さなければ灰色で埋める
 */
export function makeChart(text?: Rgb): Rgb {
  const im = newRgb(CHART_W, CHART_H),
    S = 4;
  for (let ty = 0; ty < 2; ty++)
    for (let tx = 0; tx < 3; tx++) {
      const fn = TILES[ty][tx];
      for (let y = 0; y < TILE; y++)
        for (let x = 0; x < TILE; x++) {
          const i = (ty * TILE + y) * CHART_W + tx * TILE + x;
          if (!fn) {
            const j = y * TILE + x;
            im.r[i] = text ? text.r[j] : 0.5;
            im.g[i] = text ? text.g[j] : 0.5;
            im.b[i] = text ? text.b[j] : 0.5;
            continue;
          }
          let r = 0,
            g = 0,
            b = 0;
          for (let sy = 0; sy < S; sy++)
            for (let sx = 0; sx < S; sx++) {
              const c = fn(x + (sx + 0.5) / S, y + (sy + 0.5) / S);
              r += c[0];
              g += c[1];
              b += c[2];
            }
          im.r[i] = r / (S * S);
          im.g[i] = g / (S * S);
          im.b[i] = b / (S * S);
        }
    }
  return im;
}

/** 区画の名前（左上から右へ） */
export const TILE_NAMES = ['柵', 'ゾーンプレート', 'ジーメンススター', '色の境界', '文字', '布目'] as const;
