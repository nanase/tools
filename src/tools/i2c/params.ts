/** I2C のページの入力の定義 */
import type { ParamDef } from '../../lib/param-def';
import { ABSENT, DEVS, hex, MODES, type ModeId } from './bus';
import type { IconId } from './icons';

export type PKey = 'rp' | 'cb' | 'd0' | 'd1' | 'rate';

const plain = { input: String, view: String, step: String, text: String };
/** データの 1 バイト。欄は 16 進、入力は 10 進 */
const byte = (k: 'd0' | 'd1', nm: string, v: number): ParamDef & { k: PKey } => ({
  k,
  nm,
  sym: '',
  name: nm,
  sub: '',
  unit: '',
  min: 0,
  max: 255,
  v,
  ph: '例 42',
  lin: { step: 1, big: 16 },
  sign: 'nonneg',
  notation: 'plain',
  inputmode: 'decimal',
  format: { input: String, view: hex, step: hex, text: (x) => `${hex(x)}（${x}）` },
  bad: '0〜255 の数を入れてください（例 42）',
  pre: [
    [0, '0x00'],
    [42, '0x2A'],
    [128, '0x80'],
    [255, '0xFF'],
  ],
});

export const PARAMS: (ParamDef & { k: PKey })[] = [
  {
    k: 'rp',
    nm: 'Rp',
    sym: '<i>R</i><sub>p</sub>',
    name: 'プルアップ抵抗',
    sub: 'VDD と線の間',
    unit: 'Ω',
    min: 100,
    max: 100e3,
    v: 4.7e3,
    ph: '例 4.7k',
    series: 12,
    pre: [
      [470, '470'],
      [1e3, '1k'],
      [2.2e3, '2.2k'],
      [4.7e3, '4.7k'],
      [10e3, '10k'],
      [47e3, '47k'],
    ],
  },
  {
    k: 'cb',
    nm: 'Cb',
    sym: '<i>C</i><sub>b</sub>',
    name: '配線の容量',
    sub: '線 1 本と機器の端子の合計',
    unit: 'F',
    min: 10e-12,
    max: 1e-9,
    v: 100e-12,
    ph: '例 100p',
    series: 12,
    pre: [
      [22e-12, '22p'],
      [100e-12, '100p'],
      [400e-12, '400p'],
      [1e-9, '1000p'],
    ],
  },
  byte('d0', 'データ 1', 0x2a),
  byte('d1', 'データ 2', 0x07),
  {
    k: 'rate',
    nm: '速さ',
    sym: '',
    name: '速さ',
    sub: '再生の速さ',
    unit: 'クロック/秒',
    min: 0.5,
    max: 32,
    v: 2,
    ph: '例 2',
    list: [0.5, 1, 2, 4, 8, 16, 32],
    log: true,
    snap: true,
    notation: 'plain',
    format: { ...plain, text: (x) => `${x} クロック/秒` },
    pre: [
      [1, '1'],
      [2, '2'],
      [8, '8'],
    ],
  },
];

type Opt = readonly (readonly [string, string] | readonly [string, string, string])[];
const fmtF = (f: number) => (f < 1e6 ? `${f / 1e3} kHz` : `${f / 1e6} MHz`);
export const MODE_OPT: Opt = (Object.keys(MODES) as ModeId[]).map((k) => [
  k,
  fmtF(MODES[k].f),
  `${MODES[k].name}モード`,
]);
export const VDD_OPT: Opt = [
  ['3.3', '3.3 V'],
  ['5', '5 V'],
];
export const OP_OPT: Opt = [
  ['w', '書き込み'],
  ['r', '読み出し'],
];
/** 宛先の選択肢: [アドレス, 図柄, 名前] */
export const ADDR_OPT: readonly (readonly [number, IconId, string])[] = [
  ...DEVS.map((d) => [d.a, d.k, d.name] as const),
  [ABSENT, 'unk', 'どの機器も持たないアドレス'] as const,
];
