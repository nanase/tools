/**
 * 試しの信号（DOM に依存しない）。区間 [0, 1) を n 点で標本化する。
 * Blocks・Bumps・HeaviSine・Doppler は Donoho・Johnstone（1994）の 4 つ（WaveLab の MakeSignal と同じ値）
 */

export type Sig = 'doppler' | 'blocks' | 'bumps' | 'heavisine' | 'chirp' | 'click';
export const SIGS: readonly (readonly [Sig, string])[] = [
  ['doppler', 'ドップラー'],
  ['blocks', '段'],
  ['bumps', '山'],
  ['heavisine', '跳びのある正弦'],
  ['chirp', 'チャープ'],
  ['click', '低い音と打音'],
];

const T0 = [0.1, 0.13, 0.15, 0.23, 0.25, 0.4, 0.44, 0.65, 0.76, 0.78, 0.81];
const BLK = [4, -5, 3, -4, 5, -4.2, 2.1, 4.3, -3.1, 2.1, -4.2];
const BMP = [4, 5, 3, 4, 5, 4.2, 2.1, 4.3, 3.1, 5.1, 4.2];
const BMW = [0.005, 0.005, 0.006, 0.01, 0.01, 0.03, 0.01, 0.01, 0.005, 0.008, 0.005];

/** t ∈ [0, 1) の値 */
export function sigAt(s: Sig, t: number): number {
  switch (s) {
    case 'doppler':
      return Math.sqrt(t * (1 - t)) * Math.sin((2 * Math.PI * 1.05) / (t + 0.05));
    case 'blocks': {
      let f = 0;
      for (let i = 0; i < T0.length; i++) f += (BLK[i] * (1 + Math.sign(t - T0[i]))) / 2;
      return f;
    }
    case 'bumps': {
      let f = 0;
      for (let i = 0; i < T0.length; i++) f += BMP[i] / (1 + Math.abs((t - T0[i]) / BMW[i])) ** 4;
      return f;
    }
    case 'heavisine':
      return 4 * Math.sin(4 * Math.PI * t) - Math.sign(t - 0.3) - Math.sign(0.72 - t);
    case 'chirp':
      /* 周波数が 1 周期あたり 4 → 128 と指数で上がる（低い所ほどゆっくり） */
      return Math.sin(((2 * Math.PI * 4) / Math.log(32)) * (32 ** t - 1));
    case 'click': {
      /* 12 周期の正弦（ずっと鳴る）に、細い打音を 2 つ重ねる */
      const c = (u: number) => 3 * Math.exp(-(((t - u) / 0.002) ** 2));
      return Math.sin(2 * Math.PI * 12 * t) + c(0.3) + c(0.62);
    }
  }
}

/** n 点の列。t = i / n */
export const sample = (s: Sig, n: number): Float64Array => Float64Array.from({ length: n }, (_, i) => sigAt(s, i / n));

/** 標準正規の乱数（Box-Muller）。rnd は [0, 1) の一様乱数 */
export function gauss(rnd: () => number): number {
  let u = 0;
  while (u === 0) u = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}
/** 再現できる一様乱数（mulberry32） */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 信号の標準偏差を 1 にそろえ、SN 比 snr（標準偏差の比）になる雑音を足す。
 * Donoho・Johnstone は SN 比 7 で試した。返すのは [きれいな信号, 雑音の入った信号, 雑音の σ]
 */
export function noisy(x: Float64Array, snr: number, seed = 1): [Float64Array, Float64Array, number] {
  const n = x.length,
    m = x.reduce((s, v) => s + v, 0) / n,
    sd = Math.sqrt(x.reduce((s, v) => s + (v - m) ** 2, 0) / n) || 1,
    c = x.map((v) => v / sd),
    sg = 1 / snr,
    r = rng(seed);
  return [c, c.map((v) => v + sg * gauss(r)), sg];
}
