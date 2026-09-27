import type { ParamDef } from '../../lib/param-def';

export type Key = 'f' | 'vol';

export const PARAMS: (ParamDef & { k: Key })[] = [
  {
    k: 'f',
    nm: 'f',
    sym: '<i>f</i>',
    name: '周波数',
    sub: '可聴音の高さ',
    unit: 'Hz',
    min: 20,
    max: 24000,
    v: 440,
    series: 12,
    ph: '例 1k',
    bad: '読めない値です（例 440・1k・1k5・1e3）',
    pre: [
      [100, '100'],
      [440, '440'],
      [1e3, '1k'],
      [2e3, '2k'],
      [4e3, '4k'],
      [1e4, '10k'],
    ],
    tk: [
      [20, '20'],
      [100, '100'],
      [1e3, '1k'],
      [1e4, '10k'],
    ],
  },
  {
    k: 'vol',
    nm: 'A',
    sym: '<i>A</i>',
    name: '音量',
    sub: '高出力のときの振幅',
    unit: '%',
    min: 0,
    max: 100,
    v: 50,
    lin: { step: 1, big: 10, major: 25, minor: 5 },
    sign: 'nonneg',
    ph: '例 50',
    bad: '読めない値です（例 50・12.5）',
    pre: [
      [10, '10'],
      [25, '25'],
      [50, '50'],
      [75, '75'],
      [100, '100'],
    ],
    tk: [
      [0, '0'],
      [25, '25'],
      [50, '50'],
      [75, '75'],
      [100, '100'],
    ],
  },
];
