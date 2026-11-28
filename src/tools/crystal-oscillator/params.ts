import type { ParamDef } from '../../lib/param-def';

export type Key = 'c1' | 'c2' | 'rd' | 'rf';

const CP: [number, string][] = [
  [10e-12, '10p'],
  [22e-12, '22p'],
  [33e-12, '33p'],
  [47e-12, '47p'],
];

/** 既定値（v）は水晶ごとに client.ts が差し替える */
export const PARAMS: (ParamDef & { k: Key })[] = [
  {
    k: 'c1',
    nm: 'C1',
    sym: '<i>C</i><sub>1</sub>',
    name: '負荷容量 1',
    sub: 'XIN–GND 間',
    unit: 'F',
    min: 1e-12,
    max: 470e-12,
    v: 22e-12,
    ph: '例 22p',
    pre: CP,
  },
  {
    k: 'c2',
    nm: 'C2',
    sym: '<i>C</i><sub>2</sub>',
    name: '負荷容量 2',
    sub: '水晶の右端–GND 間',
    unit: 'F',
    min: 1e-12,
    max: 470e-12,
    v: 22e-12,
    ph: '例 22p',
    pre: CP,
  },
  {
    k: 'rd',
    nm: 'Rd',
    sym: '<i>R</i><sub>d</sub>',
    name: '制限抵抗',
    sub: 'XOUT–水晶の右端 間。水晶に流れる電流を抑える',
    unit: 'Ω',
    min: 0,
    floor: 10,
    max: 4.7e6,
    v: 1e3,
    ph: '例 1k',
    pre: [
      [0, '0'],
      [1e3, '1k'],
      [100e3, '100k'],
      [470e3, '470k'],
    ],
  },
  {
    k: 'rf',
    nm: 'Rf',
    sym: '<i>R</i><sub>f</sub>',
    name: '帰還抵抗',
    sub: 'XIN–XOUT 間。インバータを中点にバイアスする',
    unit: 'Ω',
    min: 10e3,
    max: 22e6,
    v: 1e6,
    ph: '例 1M',
    pre: [
      [100e3, '100k'],
      [1e6, '1M'],
      [10e6, '10M'],
    ],
  },
];

export type ViewKey = 'pt';
const times = (v: number) => `×${v}`;
/** 図の表示の設定 */
export const VIEW_PARAMS: (ParamDef & { k: ViewKey })[] = [
  {
    k: 'pt',
    nm: '粒の速さ',
    sym: '',
    name: '電流の粒の速さ',
    sub: '回路図の黄色い粒の速さの倍率',
    unit: '',
    min: 0.25,
    max: 8,
    v: 1,
    list: [0.25, 0.5, 1, 2, 4, 8],
    log: true,
    snap: true,
    notation: 'plain',
    inputmode: 'decimal',
    format: { input: String, view: times, step: times, text: times },
    ph: '例 2',
    pre: [
      [0.5, '×0.5'],
      [1, '×1'],
      [2, '×2'],
    ],
  },
];
