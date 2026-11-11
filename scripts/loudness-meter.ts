/**
 * ITU-R BS.1770 の聞こえの大きさ（LUFS）の計算。scripts/loudness.ts が使う
 * kWeight はページの中の AudioWorklet へ文字列で渡すので、外の名前を参照しない
 */

/** 双二次フィルタの係数（a0 = 1 に正規化） */
export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** K 特性の 2 段のフィルタ（高域の棚・低域の除去）。libebur128 と同じ式で、48 kHz では BS.1770 の表の係数になる */
export function kWeight(fs: number): [Biquad, Biquad] {
  const norm = (b: number[], a: number[]) => ({
    b0: b[0] / a[0],
    b1: b[1] / a[0],
    b2: b[2] / a[0],
    a1: a[1] / a[0],
    a2: a[2] / a[0],
  });
  let f0 = 1681.974450955533,
    Q = 0.7071752369554196,
    K = Math.tan((Math.PI * f0) / fs);
  const G = 3.999843853973347,
    Vh = 10 ** (G / 20),
    Vb = Vh ** 0.4996667741545416,
    shelf = norm(
      [Vh + (Vb * K) / Q + K * K, 2 * (K * K - Vh), Vh - (Vb * K) / Q + K * K],
      [1 + K / Q + K * K, 2 * (K * K - 1), 1 - K / Q + K * K],
    );
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / fs);
  const d = 1 + K / Q + K * K,
    high = norm([d, -2 * d, d], [d, 2 * (K * K - 1), 1 - K / Q + K * K]);
  return [shelf, high];
}

const lufs = (z: number) => -0.691 + 10 * Math.log10(z);
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;

/**
 * 100 ms ごとの K 特性の二乗平均（チャンネルの和）から、ゲートを掛けた積分の大きさ [LUFS]。
 * 400 ms の区間を 100 ms ずつずらし、−70 LUFS の絶対ゲートと −10 LU の相対ゲートを掛ける。音のない区間は数えない
 */
export function integrated(ms: number[]): number {
  const blocks: number[] = [];
  for (let i = 0; i + 4 <= ms.length; i++) blocks.push((ms[i] + ms[i + 1] + ms[i + 2] + ms[i + 3]) / 4);
  const g1 = blocks.filter((z) => lufs(z) > -70);
  if (!g1.length) return -Infinity;
  const rel = lufs(mean(g1)) - 10,
    g2 = g1.filter((z) => lufs(z) > rel);
  return lufs(mean(g2));
}

/** 音が出ていた区間の割合（−70 LUFS の絶対ゲートを越えた 400 ms の区間の割合） */
export function activeRatio(ms: number[]): number {
  let n = 0,
    on = 0;
  for (let i = 0; i + 4 <= ms.length; i++, n++) if (lufs((ms[i] + ms[i + 1] + ms[i + 2] + ms[i + 3]) / 4) > -70) on++;
  return n ? on / n : 0;
}
