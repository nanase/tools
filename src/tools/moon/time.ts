/** JD（UT）と Date・ΔT の変換（DOM に依存しない）。暦と ΔT の式は日食のページのもの */
import { deltaTEM, jdToCal } from '../solar-eclipse/time';

/** Date（UTC を UT とみなす）を JD に */
export const jdOfDate = (d: Date): number => d.getTime() / 86400000 + 2440587.5;

/** JD を Date に */
export const dateOfJd = (jd: number): Date => new Date((jd - 2440587.5) * 86400000);

/** JD（UT）での ΔT = TT − UT [s]（Espenak & Meeus 2006） */
export function deltaT(jd: number): number {
  const c = jdToCal(jd);
  return deltaTEM(c.year + (c.month - 0.5) / 12);
}
