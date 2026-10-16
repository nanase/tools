/**
 * 太陽の向きと活動（DOM に依存しない）: コロナの形を決めるために使う
 *
 * 自転軸の位置角 P は Meeus『Astronomical Algorithms』29 章の式（太陽の黄経は低精度の式で、P の誤差は 0.1° 程度）。
 * 活動の位相は、周期 11 年・2019 年 12 月の極小を基準にした目安（このツールで決めたこと。過去・未来の実際の周期とは合わない）
 */
const D = Math.PI / 180;

/** JD（TD）での、太陽の北極の位置角（天の北から東へ）[rad] */
export function sunAxisPA(jd: number): number {
  const n = jd - 2451545;
  const g = (357.528 + 0.9856003 * n) * D;
  const lam = (280.46 + 0.9856474 * n + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D;
  const eps = (23.439 - 4e-7 * n) * D;
  const k = (73.6667 + (1.3958333 * (jd - 2396758)) / 36525) * D;
  const x = Math.atan(-Math.cos(lam) * Math.tan(eps));
  const y = Math.atan(-Math.cos(lam - k) * Math.tan(7.25 * D));
  return x + y;
}

/** 年（小数）での活動の目安: 0 で極小、1 で極大。極小から約 4 年で極大になる形 */
export function activityOf(year: number): number {
  const ph = ((((year - 2019.96) / 11) % 1) + 1) % 1;
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * (ph < 0.36 ? ph / 0.72 : 0.5 + (ph - 0.36) / 1.28));
}
