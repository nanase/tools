/**
 * ヤコビの楕円関数と完全楕円積分（実数の母数 k）。
 * S. J. Orfanidis, "Lecture Notes on Elliptic Filter Design" (2006) の landen・ellipk・sne・cde・acde・asne・ellipdeg を写した。
 * 引数 u は K で割った値（sne(u, k) = sn(uK, k)）。母数が 1 に近いときの桁落ちを避けるため、
 * 補母数 k′ = √(1 − k²) を別に受け取れるようにし、Landen 列は k と k′ を組で進める
 */
import { add, type C, cos, div, mul, scale, sin } from './complex';

/** k′ = √(1 − k²) を桁落ちなく */
export const comp = (k: number): number => Math.sqrt((1 - k) * (1 + k));

/**
 * 降下 Landen 変換の母数の列 k₁, k₂, …（kₙ = (kₙ₋₁ / (1 + k′ₙ₋₁))²）。
 * kₙ が 1e-17 を下回るか 12 項で止める（Orfanidis は 7 項）
 */
export function landen(k: number, kp = comp(k)): number[] {
  const v: number[] = [];
  let a = k,
    b = kp;
  while (v.length < 12) {
    if (a === 0) break;
    const n = (a / (1 + b)) ** 2;
    /* k′ₙ = 2√k′ₙ₋₁ / (1 + k′ₙ₋₁)（1 − kₙ² を引き算で求めない） */
    b = (2 * Math.sqrt(b)) / (1 + b);
    a = n;
    v.push(a);
    if (a < 1e-17) break;
  }
  return v;
}

/** 第 1 種完全楕円積分 K(k) = (π/2) Π (1 + kₙ) */
export function ellipK(k: number, kp = comp(k)): number {
  if (kp === 0) return Infinity;
  return (Math.PI / 2) * landen(k, kp).reduce((p, x) => p * (1 + x), 1);
}

/** K′(k) = K(k′) */
export const ellipKp = (k: number, kp = comp(k)): number => ellipK(kp, k);

/** 昇り Landen 変換で w を戻す */
function ascend(w: C, v: readonly number[]): C {
  let x = w;
  for (let n = v.length - 1; n >= 0; n--) {
    const d = add({ re: 1, im: 0 }, scale(mul(x, x), v[n]));
    x = div(scale(x, 1 + v[n]), d);
  }
  return x;
}

/** sn(uK, k)（u は複素数でもよい） */
export const sne = (u: C, k: number, kp = comp(k)): C => ascend(sin(scale(u, Math.PI / 2)), landen(k, kp));

/** cd(uK, k)（u は複素数でもよい） */
export const cde = (u: C, k: number, kp = comp(k)): C => ascend(cos(scale(u, Math.PI / 2)), landen(k, kp));

/** 実数の sn(uK, k) */
export const sneR = (u: number, k: number, kp = comp(k)): number => sne({ re: u, im: 0 }, k, kp).re;
/** 実数の cd(uK, k) */
export const cdeR = (u: number, k: number, kp = comp(k)): number => cde({ re: u, im: 0 }, k, kp).re;

/** cd(uK, k) = w を満たす u（0 ≤ w ≤ 1 の実数、0 ≤ u ≤ 1） */
export function acdeR(w: number, k: number, kp = comp(k)): number {
  const v = landen(k, kp);
  let x = w;
  for (let n = 0; n < v.length; n++) {
    const v1 = n === 0 ? k : v[n - 1];
    x = (x / (1 + Math.sqrt(Math.max(0, 1 - x * x * v1 * v1)))) * (2 / (1 + v[n]));
  }
  return (2 / Math.PI) * Math.acos(Math.max(-1, Math.min(1, x)));
}

/** sn(uK, k) = w を満たす u（0 ≤ w ≤ 1 の実数） */
export const asneR = (w: number, k: number, kp = comp(k)): number => 1 - acdeR(w, k, kp);

/**
 * 次数の式 N·K′(k)/K(k) = K′(k₁)/K(k₁) を k について解く（ellipdeg）。
 * k′ = k₁′ᴺ Π sn⁴(uᵢK₁′, k₁′)、uᵢ = (2i − 1)/N。[k, k′] を返す
 */
export function ellipdeg(N: number, k1: number, k1p = comp(k1)): [number, number] {
  const L = Math.floor(N / 2);
  let kp = k1p ** N;
  for (let i = 1; i <= L; i++) kp *= sneR((2 * i - 1) / N, k1p, k1) ** 4;
  return [comp(kp), kp];
}
