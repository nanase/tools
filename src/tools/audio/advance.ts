/**
 * AnalyserNode の波形が前回から何標本進んだか（DOM に依存しない）。AnalyserNode は直近の標本をそのまま写すので、
 * 前回の末尾 probe と同じ並びが、新しい波形 cur の末尾から s 点手前にある。時間から見込んだ進み exp の近くから探し、
 * 見つからないとき（間が空きすぎた）や、無音などで決められないときは exp を返す
 */
export function advance(probe: ArrayLike<number>, cur: ArrayLike<number>, exp: number): number {
  const P = probe.length,
    N = cur.length,
    hi = N - P,
    e = Math.max(0, Math.min(hi, Math.round(exp)));
  let flat = true;
  for (let i = 1; i < P; i++) if (probe[i] !== probe[0]) flat = false;
  if (flat) return e;
  const at = (s: number) => {
    const o = hi - s;
    for (let i = 0; i < P; i++) if (cur[o + i] !== probe[i]) return false;
    return true;
  };
  for (let d = 0; d <= hi; d++) {
    if (e + d <= hi && at(e + d)) return e + d;
    if (d && e - d >= 0 && at(e - d)) return e - d;
  }
  return e;
}
