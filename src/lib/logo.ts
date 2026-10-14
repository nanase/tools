/**
 * 上部バーのアイコンの矩形波（Rail.astro の path）。
 * 周期を s 倍した波を描く。x = 16 の立ち下がりをトリガ位置として固定し、s = 1 で元のアイコンに戻る
 */
const X0 = 5,
  X1 = 25,
  XT = 16,
  HI = 9,
  LO = 20,
  HALF = 6;

/** 番号 j の縁（XT + j × 半周期）を過ぎた後の高さ。偶数は立ち下がり */
const after = (j: number) => (((j % 2) + 2) % 2 === 0 ? LO : HI);
const f = (x: number) => +x.toFixed(2);

export function wavePath(s: number): string {
  const h = HALF * s;
  let k = Math.floor((X0 - XT) / h) + 1;
  let d = `M${X0} ${after(k - 1)}`;
  for (; XT + k * h < X1; k++) d += `H${f(XT + k * h)}V${after(k)}`;
  return `${d}H${X1}`;
}
