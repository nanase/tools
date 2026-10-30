/**
 * テスト画像（256 × 192、64 × 64 の区画を 4 × 3）。カーネルごとの違いが見える模様を並べる。
 * 上段: 点と線（そのままカーネルの形が出る）・傾けた正方形・縞・ジーメンススター
 * 中段: 階調・市松・ゾーンプレート・ごま塩ノイズ
 * 下段: 文字（呼び出し側で描く）・ガウスノイズ・細い円・向きの違う縞
 */
const T = 64;
export const CHART_W = 4 * T;
export const CHART_H = 3 * T;
/** 区画の幅。文字の区画（左下）は呼び出し側が TILE × TILE の明るさを渡す */
export const TILE = T;

/** 決まった種の乱数（mulberry32） */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** 4 × 4 の副画素で塗る割合（縁をなめらかに） */
function cover(inside: (x: number, y: number) => boolean, x: number, y: number): number {
  let n = 0;
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) if (inside(x + (i + 0.5) / 4, y + (j + 0.5) / 4)) n++;
  return n / 16;
}
const DARK = 0.1,
  LIGHT = 0.9;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** 区画の中の座標 (x, y)（0〜63）から明るさ */
const TILES: ((x: number, y: number) => number)[][] = [
  [
    /* 点と線 */
    (x, y) => {
      if (x === 14 && y === 14) return 1;
      if (x === 46 && y >= 6 && y <= 26) return 1;
      if (y === 46 && x >= 6 && x <= 26) return 1;
      if (x >= 38 && x <= 58 && x - 38 === y - 38) return 1;
      return DARK;
    },
    /* 傾けた正方形（縁の向きがいろいろ） */
    (x, y) => {
      const a = (15 * Math.PI) / 180,
        cs = Math.cos(a),
        sn = Math.sin(a);
      const t = cover(
        (u, v) => {
          const dx = u - 32,
            dy = v - 32;
          return Math.abs(dx * cs + dy * sn) < 17 && Math.abs(-dx * sn + dy * cs) < 17;
        },
        x,
        y,
      );
      return mix(DARK, LIGHT, t);
    },
    /* 縞: 上は縦縞、下は横縞。周期 2・3・4・6 画素 */
    (x, y) => {
      const p = [2, 3, 4, 6][Math.floor(x / 16)],
        k = y < 32 ? x : y;
      return (k % p) * 2 < p ? LIGHT : DARK;
    },
    /* ジーメンススター（24 本） */
    (x, y) => {
      const t = cover(
        (u, v) => {
          const dx = u - 32,
            dy = v - 32;
          if (dx * dx + dy * dy > 30 * 30) return false;
          return Math.floor(((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)) * 48) % 2 === 0;
        },
        x,
        y,
      );
      const out = (x + 0.5 - 32) ** 2 + (y + 0.5 - 32) ** 2 > 30 * 30;
      return out ? 0.5 : mix(DARK, LIGHT, t);
    },
  ],
  [
    /* 階調: 上は 8 段、下はなめらか */
    (x, y) => (y < 32 ? Math.floor(x / 8) / 7 : x / 63),
    /* 市松: 8・4・2・1 画素 */
    (x, y) => {
      const s = y < 32 ? (x < 32 ? 8 : 4) : x < 32 ? 2 : 1;
      return (Math.floor(x / s) + Math.floor(y / s)) % 2 ? LIGHT : DARK;
    },
    /* ゾーンプレート（中心から外へ細かく） */
    (x, y) => {
      const r2 = (x - 31.5) ** 2 + (y - 31.5) ** 2;
      return 0.5 + 0.4 * Math.cos((Math.PI * r2) / 64);
    },
    /* ごま塩ノイズ（区画ごとに決まった並び） */
    (() => {
      const r = rng(7),
        v = new Float32Array(T * T);
      for (let y = 0; y < T; y++)
        for (let x = 0; x < T; x++) {
          const d = (x + 0.5 - 32) ** 2 + (y + 0.5 - 32) ** 2 < 18 * 18 ? 0.75 : 0.3;
          const u = r();
          v[y * T + x] = u < 0.05 ? 0 : u < 0.1 ? 1 : d;
        }
      return (x: number, y: number) => v[y * T + x];
    })(),
  ],
  [
    /* 文字（呼び出し側が上書きする） */
    () => LIGHT,
    /* ガウスノイズ（σ 0.1） */
    (() => {
      const r = rng(11),
        v = new Float32Array(T * T);
      for (let y = 0; y < T; y++)
        for (let x = 0; x < T; x++) {
          const d = (x + 0.5 - 32) ** 2 + (y + 0.5 - 32) ** 2 < 18 * 18 ? 0.75 : 0.3;
          const g = Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
          v[y * T + x] = Math.min(1, Math.max(0, d + 0.1 * g));
        }
      return (x: number, y: number) => v[y * T + x];
    })(),
    /* 幅 1 画素の円（半径 6〜30） */
    (x, y) => {
      const r = Math.hypot(x + 0.5 - 32, y + 0.5 - 32);
      const d = Math.abs(r - Math.round(r / 6) * 6);
      return r < 3 || r > 31 ? DARK : mix(DARK, LIGHT, Math.max(0, 1 - d * 1.5));
    },
    /* 向きの違う縞（周期 6 画素）: 縦・横・斜め 2 つ */
    (x, y) => {
      const a = [0, 90, 45, 135][(y < 32 ? 0 : 2) + (x < 32 ? 0 : 1)] * (Math.PI / 180);
      return 0.5 + 0.4 * Math.cos(((2 * Math.PI) / 6) * (x * Math.cos(a) + y * Math.sin(a)));
    },
  ],
];

/** テスト画像の明るさ（0〜1）。text は文字の区画（T × T、null なら白） */
export function testChart(text: Float32Array | null): Float32Array {
  const v = new Float32Array(CHART_W * CHART_H);
  for (let ty = 0; ty < 3; ty++)
    for (let tx = 0; tx < 4; tx++) {
      const f = TILES[ty][tx],
        isText = tx === 0 && ty === 2;
      for (let y = 0; y < T; y++)
        for (let x = 0; x < T; x++) v[(ty * T + y) * CHART_W + tx * T + x] = isText && text ? text[y * T + x] : f(x, y);
    }
  return v;
}
