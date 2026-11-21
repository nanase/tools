/** 立体音響のページの入力の定義 */
import { linList } from '../../lib/eseries';
import type { ParamDef } from '../../lib/param-def';
import type { Unit } from '../../lib/parse';
import { KINDS } from './model';

const sig = (v: number, s: number) => String(Number(v.toPrecision(s)));
const dB = (v: number) => (v > 0 ? `+${sig(v, 3)}` : sig(v, 3).replace('-', '−'));

/** 数の行の定義をまとめて作る（例は既定値） */
function num<K extends string>(
  k: K,
  name: string,
  unit: Unit,
  min: number,
  max: number,
  v: number,
  list: number[],
  o: { sub?: string; log?: boolean; signed?: boolean; pre?: [number, string][] } = {},
): ParamDef & { k: K } {
  const show = o.signed ? dB : (x: number) => sig(x, 3);
  return {
    k,
    nm: name,
    sym: '',
    name,
    sub: o.sub ?? '',
    unit,
    min,
    max,
    v,
    ph: `例 ${sig(v, 3)}`,
    list,
    log: o.log,
    jump: 6,
    sign: o.signed ? 'any' : 'nonneg',
    notation: 'plain',
    inputmode: 'decimal',
    format: { input: (x) => sig(x, 3), view: show, step: show, text: (x) => `${show(x)} ${unit}` },
    bad: `数を入れてください（例 ${sig(v, 3)}）`,
    pre: o.pre ?? [],
  };
}
/** 長さの並び [m]: 細かい所は細かく */
const LENS = [
  ...linList(3, 10, 0.5),
  ...linList(11, 30, 1),
  ...linList(32, 60, 2),
  ...linList(65, 120, 5),
  ...linList(130, 300, 10),
];

export type PKey = 'vol';
export const PARAMS: (ParamDef & { k: PKey })[] = [
  num('vol', '音量', 'dB', -30, 20, 4, linList(-30, 20, 1), {
    signed: true,
    pre: [
      [-10, '−10'],
      [0, '0'],
      [4, '+4'],
      [10, '+10'],
    ],
  }),
];

export type SKey = 'w' | 'd' | 'h' | 'refl' | 't60' | 'wet';
export const SPACE: (ParamDef & { k: SKey })[] = [
  num('w', '幅', 'm', 3, 300, 60, LENS, { sub: '左右の広さ。路地は通りの長さ', log: true }),
  num('d', '奥行き', 'm', 3, 300, 40, LENS, { sub: '前後の広さ。路地は両側の建物の間', log: true }),
  num('h', '天井の高さ', 'm', 2, 30, 2.6, [...linList(2, 6, 0.1), ...linList(6.5, 30, 0.5)], {
    sub: '屋内の床から天井まで',
  }),
  num('refl', '反射', '%', 0, 95, 45, linList(0, 95, 5), { sub: '地面・壁・天井で跳ね返る音の割合（音圧）' }),
  num('t60', '残響時間', 's', 0.1, 6, 0.6, [...linList(0.1, 2, 0.1), ...linList(2.2, 6, 0.2)], {
    sub: '響きが 60 dB 小さくなるまでの時間',
    log: true,
  }),
  num('wet', '残響の量', '%', 0, 100, 3, linList(0, 100, 1), { sub: '音源から残響へ送る割合' }),
];

export type VKey = 'svol';
export const SRC_VOL: (ParamDef & { k: VKey })[] = [
  num('svol', '選んだ音源の音量', 'dB', -30, 20, 0, linList(-30, 20, 1), {
    signed: true,
    sub: '音源ごとの大きさに足す値',
  }),
];

export type OKey = 'ow' | 'od' | 'oh';
const SIZES = [...linList(0.1, 1, 0.05), ...linList(1.1, 5, 0.1), ...linList(5.5, 20, 0.5)];
export const OBS_P: (ParamDef & { k: OKey })[] = [
  num('ow', '幅', 'm', 0.1, 20, 1.8, SIZES, { sub: '選んだ障害物の左右の大きさ' }),
  num('od', '奥行き', 'm', 0.1, 20, 0.4, SIZES, { sub: '選んだ障害物の前後の大きさ' }),
  num('oh', '高さ', 'm', 0.1, 10, 2, SIZES, { sub: '床からの高さ。耳より低いと横からの音は遮らない' }),
];

export const PLACE_OPT: [string, string][] = KINDS.map((p) => [p.id, p.name]);
export const MODE_OPT: [string, string][] = [
  ['hrtf', '頭部伝達関数'],
  ['pan', 'パン'],
  ['mono', 'モノラル'],
];
export const ONOFF: [string, string][] = [
  ['1', 'あり'],
  ['0', 'なし'],
];
