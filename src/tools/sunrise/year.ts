/**
 * 地点の 1 年の昼夜の格子（DOM に依存しない）。列は 1 月 1 日からの日、行は現地の 10 分刻み（144 行）。
 * 値は段（sun.ts の band）。点が多いので低精度の式で求める
 */
import { band, geoAltAz, sunEqLow } from './sun';

export const ROWS = 144;

/**
 * year 年の格子。off は時刻 ms での UTC との差 [ms]（夏時間に追従する）。
 * 日ごとに、その日の現地の正午の差で現地の 0 時を決める
 */
export function yearGrid(
  lat: number,
  lon: number,
  year: number,
  off: (ms: number) => number,
): { nd: number; cells: Uint8Array } {
  const y0 = Date.UTC(year, 0, 1);
  const nd = Math.round((Date.UTC(year + 1, 0, 1) - y0) / 864e5);
  const cells = new Uint8Array(nd * ROWS);
  const cell = 864e5 / ROWS;
  for (let d = 0; d < nd; d++) {
    const u = y0 + d * 864e5;
    const d0 = u - off(u + 12 * 36e5);
    for (let k = 0; k < ROWS; k++) cells[k * nd + d] = band(geoAltAz(sunEqLow(d0 + (k + 0.5) * cell), lat, lon).h);
  }
  return { nd, cells };
}
