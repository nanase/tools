/** 復元に使う窓をかけた sinc（両側 L 個、ブラックマンの窓）。表を引いて線形補間する */
const TAU = 2 * Math.PI;

export const L = 16;
const RES = 256;
const KER = (() => {
  const n = 2 * L * RES + 2,
    k = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const d = i / RES - L;
    if (Math.abs(d) >= L) continue;
    const s = d === 0 ? 1 : Math.sin(Math.PI * d) / (Math.PI * d),
      u = (d + L) / (2 * L);
    k[i] = s * (0.42 - 0.5 * Math.cos(TAU * u) + 0.08 * Math.cos(2 * TAU * u));
  }
  return k;
})();
/** 窓をかけた sinc（d は標本の間隔を 1 とした距離） */
export function ker(d: number): number {
  const x = (d + L) * RES,
    i = Math.floor(x);
  if (i < 0 || i >= KER.length - 1) return 0;
  return KER[i] + (KER[i + 1] - KER[i]) * (x - i);
}
