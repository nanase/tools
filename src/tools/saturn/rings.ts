/**
 * 土星の環の表（DOM に依存しない）: 半径ごとの光学的厚さと色。
 * 表は public/saturn/rings.bin で、scripts/saturn-rings.ts が作る。
 * 1 点あたり 4 バイト（sRGB の色と、a = 1 − exp(−τ)）。アルファをこの形にすると、ミップマップの平均が透け具合の平均に近くなる
 */
/** 表の範囲 [km] と点の数 */
export const R0 = 74000;
export const R1 = 141000;
export const RING_N = 4000;

/** 表の a から法線方向の光学的厚さ τ へ */
export const tauOf = (a: number): number => -Math.log(1 - Math.min(a, 0.998));

/** 半径 r [km] の τ（表の範囲の外は 0） */
export function ringTau(tab: Uint8Array, r: number): number {
  if (r < R0 || r >= R1) return 0;
  const i = Math.floor(((r - R0) / (R1 - R0)) * RING_N);
  return tauOf(tab[i * 4 + 3] / 255);
}

/**
 * 環の明るさ I/F の形（色を掛ける前）。μ・μ0 は地球と太陽の高さの正弦の絶対値、lit は照らされた面を見ているか、
 * α は位相角 [°]。単散乱の式で、裏から見るときは透過した光になる。surge は衝の前後の増光
 */
export function ringLight(tau: number, mu: number, mu0: number, lit: boolean, alpha: number): number {
  const m = Math.max(mu, 1e-4);
  const m0 = Math.max(mu0, 1e-4);
  const base = lit
    ? (m0 / (m + m0)) * (1 - Math.exp(-tau * (1 / m + 1 / m0)))
    : Math.abs(m - m0) < 1e-4
      ? (tau / m) * Math.exp(-tau / m)
      : (m0 / (m0 - m)) * (Math.exp(-tau / m0) - Math.exp(-tau / m));
  return base * ringSurge(alpha);
}

/**
 * 衝の前後の増光（位相角 6° を 1 とする倍率）。
 * Mallama & Hilton (2018) の土星の等級の α の項（0.026 α と −0.378 sin β e^(−2.25 α)）を環の光だけが受けたとして見積もった
 */
export const ringSurge = (alpha: number): number => 1 + 0.3 * Math.exp(-2.25 * alpha) + 0.07 * Math.max(0, 6 - alpha);
