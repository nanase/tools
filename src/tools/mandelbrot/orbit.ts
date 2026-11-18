/**
 * 基準の点の軌道 Z₀ = 0, Z₁, … を固定小数点で正確に計算し、単精度の列で返す（各画素は Z との差だけを追う）。
 * べきは整数だけ。|Z|² が 1e6 を超えたら、その値まで入れて止める
 */
import { FB } from './fixed';
import type { Formula } from './formula';

export interface Orbit {
  /** Z_k の実部・虚部を交互に並べた列 */
  data: Float32Array;
  /** 入っている点の数（Z₀ を含む） */
  len: number;
}

const abs = (v: bigint): bigint => (v < 0n ? -v : v);

export function orbit(cx: bigint, cy: bigint, f: Formula, want: number): Orbit {
  const data = new Float32Array(2 * (want + 1));
  const T = BigInt(Math.round(f.pre * 1024)),
    S = BigInt(Math.round(f.post * 1024)),
    p = Math.round(f.p);
  /* 2^(FB−92) で割ってから 2^−92 を掛け、BigInt を倍精度へ速く移す */
  const SH = FB - 92n,
    K = 2 ** -92;
  let x = 0n,
    y = 0n,
    n = 1;
  for (; n <= want; n++) {
    let a = x,
      b = y;
    if (T) {
      a += ((abs(a) - a) * T) >> 10n;
      b += ((abs(b) - b) * T) >> 10n;
    }
    if (f.conj) b = -b;
    let wr = a,
      wi = b;
    for (let k = 1; k < p; k++) {
      const r = (wr * a - wi * b) >> FB;
      wi = (wr * b + wi * a) >> FB;
      wr = r;
    }
    if (S) wr += ((abs(wr) - wr) * S) >> 10n;
    x = wr + cx;
    y = wi + cy;
    const fx = Number(x >> SH) * K,
      fy = Number(y >> SH) * K;
    data[2 * n] = fx;
    data[2 * n + 1] = fy;
    if (fx * fx + fy * fy > 1e6) {
      n++;
      break;
    }
  }
  return { data, len: Math.min(n, want + 1) };
}
