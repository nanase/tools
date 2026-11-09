/** サイフォンのページの入力の定義。例ごとに使う行だけを見せる（scenes.ts の rows） */
import type { ParamDef } from '../../lib/param-def';
import type { PKey } from './scenes';

const sig = (v: number, s: number) => String(Number(v.toPrecision(s)));
type Def = ParamDef & { k: PKey };

/** 一様な刻みの行 */
function lin(
  k: PKey,
  name: string,
  sub: string,
  unit: string,
  min: number,
  max: number,
  v: number,
  step: number,
  big: number,
  pre: [number, string, string?][],
): Def {
  const dec = step < 1 ? (step < 0.1 ? 2 : 1) : 0,
    f = (x: number) => x.toFixed(dec);
  return {
    k,
    nm: name,
    sym: '',
    name,
    sub,
    unit: unit as Def['unit'],
    min,
    max,
    v,
    ph: `例 ${f(v)}`,
    lin: { step, big },
    sign: min <= 0 ? 'nonneg' : 'pos',
    notation: 'plain',
    inputmode: 'decimal',
    format: { input: f, step: f, text: (x) => `${f(x)} ${unit}` },
    bad: `数を入れてください（例 ${f(v)}）`,
    pre,
  };
}
/** 対数の並びの行 */
function logRow(
  k: PKey,
  name: string,
  sub: string,
  unit: string,
  list: number[],
  v: number,
  pre: [number, string, string?][],
): Def {
  return {
    k,
    nm: name,
    sym: '',
    name,
    sub,
    unit: unit as Def['unit'],
    min: list[0],
    max: list[list.length - 1],
    v,
    ph: `例 ${v}`,
    list,
    log: true,
    jump: 3,
    notation: 'plain',
    inputmode: 'decimal',
    format: { input: (x) => sig(x, 3), step: (x) => sig(x, 3), text: (x) => `${sig(x, 3)} ${unit}` },
    bad: `数を入れてください（例 ${v}）`,
    pre,
  };
}
const series = (lo: number, hi: number): number[] => {
  const E = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8],
    out: number[] = [];
  for (let e = -4; e <= 2; e++)
    for (const m of E) {
      const x = Number((m * 10 ** e).toPrecision(3));
      if (x >= lo - 1e-12 && x <= hi + 1e-12) out.push(x);
    }
  return out;
};

export const PARAMS: Def[] = [
  lin('kst', '台の高さ', 'ポリタンクを載せる台', 'cm', 10, 60, 30, 1, 5, [
    [10, '10'],
    [30, '30'],
    [60, '60'],
  ]),
  lin('kd', 'ホースの内径', '灯油ポンプのホースの太さ', 'mm', 6, 16, 10, 1, 2, [
    [6, '6'],
    [10, '10'],
    [16, '16'],
  ]),
  lin('atip', '吸い口の高さ', '砂利の面から。水位がここまで下がると止まる', 'cm', 2, 27, 19, 1, 5, [
    [5, '5'],
    [19, '19'],
    [25, '25'],
  ]),
  lin('ad', 'ホースの内径', '', 'mm', 6, 16, 12, 1, 2, [
    [8, '8'],
    [12, '12'],
    [16, '16'],
  ]),
  lin('cq', '注ぐ量', '急須から注ぐ毎秒の量', 'mL/s', 0.5, 20, 5, 0.5, 2, [
    [1, '1'],
    [5, '5'],
    [10, '10'],
    [20, '20'],
  ]),
  lin('cc', '管の頂上の高さ', '杯の底から。ここまで注ぐと流れ出す', 'cm', 3.5, 6.2, 5, 0.1, 0.5, [
    [4, '4'],
    [5, '5'],
    [6, '6'],
  ]),
  lin('tv', '洗浄水量', '1 回に流すタンクの水', 'L', 3, 13, 4.8, 0.2, 1, [
    [3.8, '3.8', '節水型の小'],
    [4.8, '4.8', '節水型の大'],
    [13, '13', '古い便器'],
  ]),
  logRow('kq', '地下水の流入', '空洞に入る地下水', 'L/s', series(0.05, 10), 0.6, [
    [0.4, '少雨'],
    [0.6, '普段'],
    [1.5, '雨季'],
    [5, '大雨'],
  ]),
  logRow('pq', '地下水の流入', '洞窟に入る地下水', 'm³/s', series(0.005, 4), 0.08, [
    [0.08, '冬'],
    [0.2, '秋'],
    [3, '夏'],
  ]),
  lin('ht', '頂上の高さ', '上の水槽の底から', 'm', 2, 14, 6, 0.5, 2, [
    [4, '4'],
    [8, '8'],
    [10, '10'],
    [12, '12'],
  ]),
  lin('alt', '標高', '気圧が下がると限界の高さも下がる', 'm', 0, 8800, 0, 100, 1000, [
    [0, '海面'],
    [3800, '富士山頂', '3,776 m を丸めた値'],
    [8800, 'エベレスト山頂', '8,849 m を丸めた値'],
  ]),
  lin('tc', '水温', '高いほど水が沸きやすい', '°C', 1, 95, 20, 1, 10, [
    [5, '5'],
    [20, '20'],
    [60, '60'],
    [90, '90'],
  ]),
];
