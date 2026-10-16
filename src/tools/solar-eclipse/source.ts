/**
 * ビルドのときだけ使う: リポジトリに置いた NASA の五千年正典の CSV を読み、100 年ごと・サロス系列ごとに分ける
 *
 * CSV は eclipse.gsfc.nasa.gov/eclipse_besselian_from_mysqldump2.csv（2026-10-16 取得）。
 * "Eclipse Predictions by Fred Espenak (NASA's GSFC)"
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseRow, splitCsv } from './catalog';
import { centuryOf, type Packed, pack } from './pack';

let cache: { year: number; saros: number; p: Packed }[] | null = null;

export function allPacked() {
  if (cache) return cache;
  const rows = splitCsv(readFileSync(join(process.cwd(), 'src/tools/solar-eclipse/data/5mcse-besselian.csv'), 'utf8'));
  cache = rows.slice(1).map((r) => {
    const { entry, el, tdSec } = parseRow(rows[0], r);
    return { year: entry.year, saros: entry.saros, p: pack(entry, el, tdSec) };
  });
  return cache;
}

export const centuries = () => [...new Set(allPacked().map((r) => centuryOf(r.year)))];
export const sarosList = () => [...new Set(allPacked().map((r) => r.saros))];
export const byCentury = (c: number) =>
  allPacked()
    .filter((r) => centuryOf(r.year) === c)
    .map((r) => r.p);
export const bySaros = (s: number) =>
  allPacked()
    .filter((r) => r.saros === s)
    .map((r) => r.p);
