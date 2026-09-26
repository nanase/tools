import type { ParamDef } from '../../lib/param-def';

export type Key = 'kp' | 'ki' | 'kd' | 'x0' | 'r' | 'v0' | 'w' | 'al';
type Def = ParamDef & { k: Key };

const LOG_HINT = '↑↓: E12 刻みで隣の値　PgUp/PgDn: 10 倍・1/10　Enter: 確定　Esc: 戻す';
const BAD_SIGNED = '読めない値です（例 −20・12.5）';
const LT: [number, string][] = [
  [-100, '−100'],
  [-50, '−50'],
  [0, '0'],
  [50, '50'],
  [100, '100'],
];

/** ゲイン: 0 と E12（0.0001〜20） */
const gain = (k: Key, nm: string, s: string, name: string, sub: string, v: number): Def => ({
  k,
  nm,
  sym: `<i>K</i><sub>${s}</sub>`,
  name,
  sub,
  unit: '',
  min: 0,
  max: 20,
  v,
  series: 12,
  floor: 1e-4,
  ends: true,
  sign: 'nonneg',
  notation: 'plain',
  inputmode: 'decimal',
  hint: LOG_HINT,
  bad: '0 以上の数を入れてください（例 0.47・4.7m・1e-3）',
  ph: '例 0.47',
  pre: [
    [0, '0'],
    [0.01, '0.01'],
    [0.1, '0.1'],
    [1, '1'],
  ],
  tk: [
    [0, '0'],
    [0.01, '0.01'],
    [0.1, '0.1'],
    [1, '1'],
    [10, '10'],
  ],
});

/** 位置・速度: −100〜100 の一様な刻み */
const signed = (d: Omit<Def, 'min' | 'max' | 'sign' | 'notation' | 'stepLabel' | 'bad' | 'tk'>): Def => ({
  ...d,
  min: -100,
  max: 100,
  sign: 'any',
  notation: 'plain',
  stepLabel: '',
  bad: BAD_SIGNED,
  tk: LT,
});

const POS = { step: 1, big: 10, major: 50, minor: 10 },
  VEL = { step: 0.1, big: 1, major: 50, minor: 10 };
const POS_PRE: [number, string][] = LT,
  VEL_PRE: [number, string][] = [
    [-10, '−10'],
    [-1, '−1'],
    [0, '0'],
    [1, '1'],
    [10, '10'],
  ];

export const GAINS: Def[] = [
  gain('kp', 'Kp', 'P', '比例ゲイン', '今の誤差に掛ける', 0.0047),
  gain('ki', 'Ki', 'I', '積分ゲイン', '誤差の蓄積に掛ける', 0),
  gain('kd', 'Kd', 'D', '微分ゲイン', '誤差の変化率に掛ける', 0.33),
];

export const PLANT: Def[] = [
  signed({
    k: 'x0',
    nm: 'x0',
    sym: '<i>x</i><sub>0</sub>',
    name: '初期位置',
    sub: '時刻 0 の位置',
    unit: 'm',
    v: 0,
    lin: POS,
    ph: '例 −20',
    pre: POS_PRE,
  }),
  signed({
    k: 'r',
    nm: 'r',
    sym: '<i>r</i>',
    name: '目標位置',
    sub: '時刻 0 に与える目標',
    unit: 'm',
    v: 50,
    lin: POS,
    ph: '例 50',
    pre: POS_PRE,
  }),
  signed({
    k: 'v0',
    nm: 'v0',
    sym: '<i>v</i><sub>0</sub>',
    name: '初速',
    sub: '流れに対する速さ',
    unit: 'm/s',
    v: 0,
    lin: VEL,
    ph: '例 2.5',
    pre: VEL_PRE,
  }),
  signed({
    k: 'w',
    nm: 'w',
    sym: '<i>w</i>',
    name: '周囲の流速',
    sub: '外乱として位置に加わる',
    unit: 'm/s',
    v: -1,
    lin: VEL,
    ph: '例 −1',
    pre: VEL_PRE,
  }),
  {
    k: 'al',
    nm: 'α',
    sym: '<i>α</i>',
    name: '加速の応答性',
    sub: '操作量が効くまでの 1 次遅れ',
    unit: '',
    min: 1e-4,
    max: 1,
    v: 0.05,
    series: 12,
    notation: 'plain',
    inputmode: 'decimal',
    hint: LOG_HINT,
    bad: '正の数を入れてください（例 0.05・1e-3）',
    ph: '例 0.05',
    pre: [
      [0.01, '0.01'],
      [0.05, '0.05'],
      [0.1, '0.1'],
      [1, '1'],
    ],
    tk: [
      [1e-4, '0.0001'],
      [1e-3, '0.001'],
      [0.01, '0.01'],
      [0.1, '0.1'],
      [1, '1'],
    ],
  },
];

export const PARAMS: Def[] = [...GAINS, ...PLANT];
