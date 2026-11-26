/**
 * ラプラス変換のページの計算。s 平面の点 s = σ + jω が表す波と、s と s̄ を極に持つ系の伝達関数。
 * 複素数は [実部, 虚部]
 */
export type Cx = readonly [number, number];

export const C = {
  sub: (a: Cx, b: Cx): Cx => [a[0] - b[0], a[1] - b[1]],
  mul: (a: Cx, b: Cx): Cx => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]],
  div: (a: Cx, b: Cx): Cx => {
    const d = b[0] * b[0] + b[1] * b[1];
    return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
  },
  abs: (a: Cx): number => Math.hypot(a[0], a[1]),
};

/** s 平面の範囲 [σ の下限, 上限, ω の下限, 上限] */
export const RANGE = [-2, 2, -10, 10] as const;

/** 係数 g = |p|²。ω = 0 で |H| = 1 にそろえる。p が原点に近いと 0 になるので下限を置く */
export const gain = (s: Cx): number => Math.max(s[0] * s[0] + s[1] * s[1], 0.25);

/**
 * 伝達関数 H(x) = g / ((x − p)(x − p̄))、p = σ + j|ω|。
 * sigma を渡すと極の実部だけ差し替える（断面の縦の目盛りを決めるとき）
 */
export function H(s: Cx, x: Cx, sigma = s[0]): Cx {
  const b = Math.abs(s[1]),
    p: Cx = [sigma, b],
    pb: Cx = [sigma, -b];
  return C.div([gain(s), 0], C.mul(C.sub(x, p), C.sub(x, pb)));
}

/** インパルス応答 h(t) = (g/ω) e^{σt} sin ωt。ω = 0 なら重根で g t e^{σt} */
export function h(s: Cx, t: number): number {
  const a = s[0],
    b = Math.abs(s[1]),
    g = gain(s);
  return b < 1e-9 ? g * t * Math.exp(a * t) : ((g * Math.exp(a * t)) / b) * Math.sin(b * t);
}

/** 1 章の波 Re e^{st} = e^{σt} cos ωt */
export const reWave = (s: Cx, t: number): number => Math.exp(s[0] * t) * Math.cos(s[1] * t);

/** 0〜T の |h(t)| の面積を n 等分の台形で累積した配列（長さ n + 1） */
export function areaCum(s: Cx, T: number, n: number): Float64Array {
  const out = new Float64Array(n + 1);
  let acc = 0,
    prev = Math.abs(h(s, 0));
  for (let i = 1; i <= n; i++) {
    const v = Math.abs(h(s, (T * i) / n));
    acc += ((prev + v) / 2) * (T / n);
    prev = v;
    out[i] = acc;
  }
  return out;
}

/** 0〜∞ の |h(t)| の面積。極が左半分になければ Infinity。h が 1 万分の 1 に縮むまで足す */
export function areaAll(s: Cx): number {
  const a = s[0];
  if (a >= 0) return Infinity;
  const T = Math.log(1e-4) / a + 5,
    n = 20000;
  return areaCum(s, T, n)[n];
}

/** 軸の近くは軸に吸い付け、範囲に収めて 0.01 に丸める */
export function snap(a: number, b: number): [number, number] {
  let x = Math.min(RANGE[1] - 0.05, Math.max(RANGE[0] + 0.05, a)),
    y = Math.min(RANGE[3] - 0.2, Math.max(RANGE[2] + 0.2, b));
  if (Math.abs(x) < 0.06) x = 0;
  if (Math.abs(y) < 0.25) y = 0;
  return [Math.round(x * 100) / 100 || 0, Math.round(y * 100) / 100 || 0];
}
