/**
 * 大赤斑の経度と模様の地図（DOM に依存しない）
 *
 * 大赤斑の System II の経度は、Hubble の OPAL の全球の地図で測った値（地図の撮影日の System III の経度を
 * このページの式で System II に直したもの）と、JUPOS の経度の図・BAA の報告から読んだ値をつないだ表から求める。
 * 表の間は直線で補い、表より後は最後の 3 点の回帰直線でのばす。季節ごとに手で表を足す
 */
import { calToJd } from '../../lib/astro/time';

/** [日付（UT）, System II の経度 [°]（360 を超えても続けて数える）, 出典] */
// biome-ignore format: 表
export const GRS_TABLE: [string, number, string][] = [
  ['2015-01-19', 222.6, 'OPAL'],
  ['2016-02-09', 240.2, 'OPAL'],
  ['2017-04-03', 267.3, 'OPAL'],
  ['2018-04-17', 289.0, 'OPAL'],
  ['2019-06-26', 312.1, 'OPAL'],
  ['2020-08-25', 340.0, 'OPAL'],
  ['2021-09-04', 361.4, 'OPAL'],
  ['2022-11-12', 386.4, 'OPAL'],
  ['2024-01-06', 409.3, 'OPAL'],
  ['2024-11-20', 422.9, 'OPAL'],
  ['2025-12-11', 439.6, 'OPAL'],
  ['2026-01-15', 441, 'JUPOS'],
  ['2026-06-15', 448, 'JUPOS'],
  ['2026-10-05', 455.5, 'JUPOS'],
];

const jdOf = (s: string): number => {
  const [y, m, d] = s.split('-').map(Number);
  return calToJd(y, m, d) + 0.5;
};
const PTS = GRS_TABLE.map(([d, l]) => [jdOf(d), l] as const);

/** 表より後の傾き [°/日]（最後の 3 点の回帰直線） */
const SLOPE = (() => {
  const p = PTS.slice(-3);
  const mx = p.reduce((s, q) => s + q[0], 0) / p.length,
    my = p.reduce((s, q) => s + q[1], 0) / p.length;
  let num = 0,
    den = 0;
  for (const [x, y] of p) {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  }
  return num / den;
})();

/** 表の最後の日付 */
export const GRS_LAST = GRS_TABLE[GRS_TABLE.length - 1][0];
/** 表の最後の日付の JD（UT） */
export const GRS_LAST_JD = PTS[PTS.length - 1][0];
/** 表より後の動き [°/月] */
export const GRS_RATE = SLOPE * 30.44;

/** 時刻 jd（UT）の大赤斑の System II の経度 [°]（0〜360） */
export function grsL2(jd: number): number {
  let v: number;
  if (jd <= PTS[0][0]) v = PTS[0][1];
  else if (jd >= PTS[PTS.length - 1][0]) v = PTS[PTS.length - 1][1] + SLOPE * (jd - PTS[PTS.length - 1][0]);
  else {
    let i = 1;
    while (PTS[i][0] < jd) i++;
    const [x0, y0] = PTS[i - 1],
      [x1, y1] = PTS[i];
    v = y0 + ((y1 - y0) * (jd - x0)) / (x1 - x0);
  }
  return ((v % 360) + 360) % 360;
}

/** 模様の地図: ファイル名、撮影日（UT の JD）、表示の年月、地図の上の大赤斑の System III の経度 [°] */
export interface MapInfo {
  file: string;
  jd: number;
  label: string;
  grsL3: number;
}

// biome-ignore format: 表
const MAPS_RAW: [string, string, string, number][] = [
  ['j2015a', '2015-01-19T07:00', '2015-01', 126.3],
  ['j2016a', '2016-02-09T14:30', '2016-02', 246.7],
  ['j2017a', '2017-04-03T06:30', '2017-04', 25.2],
  ['j2018a', '2018-04-17T06:20', '2018-04', 147.7],
  ['j2019a', '2019-06-26T13:30', '2019-06', 286.6],
  ['j2020a', '2020-08-25T02:00', '2020-08', 67.6],
  ['j2021a', '2021-09-04T06:00', '2021-09', 188.8],
  ['j2022b', '2022-11-12T14:00', '2022-11', 329.4],
  ['j2024a', '2024-01-06T01:30', '2024-01', 103.9],
  ['j2024c', '2024-11-20T00:20', '2024-11', 202.3],
  ['j2025a', '2025-12-11T11:30', '2025-12', 321.8],
];

export const MAPS: MapInfo[] = MAPS_RAW.map(([file, iso, label, grsL3]) => ({
  file,
  jd: Date.parse(`${iso}Z`) / 86400000 + 2440587.5,
  label,
  grsL3,
}));

/** 日付に最も近い地図 */
export function nearestMap(jd: number): MapInfo {
  let best = MAPS[MAPS.length - 1];
  for (const m of MAPS) if (Math.abs(m.jd - jd) < Math.abs(best.jd - jd)) best = m;
  return best;
}
