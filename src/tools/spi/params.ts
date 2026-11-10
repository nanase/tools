/** SPI のページの入力の定義 */
import type { ParamDef } from '../../lib/param-def';
import { DEVS, hex } from './bus';
import type { IconId } from './icons';

export type PKey = 'd0' | 'd1' | 'd2' | 'f' | 'len' | 'rate';

const plain = { input: String, view: String, step: String, text: String };
/** データの 1 バイト。欄は 16 進、入力は 10 進 */
const byte = (k: 'd0' | 'd1' | 'd2', nm: string, v: number): ParamDef & { k: PKey } => ({
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
  byte('d0', 'データ 1', 0x2a),
  byte('d1', 'データ 2', 0x07),
  byte('d2', 'データ 3', 0x5a),
  {
    k: 'f',
    nm: 'f',
    sym: '<i>f</i>',
    name: 'クロック',
    sub: 'SCK の周波数',
    unit: 'Hz',
    min: 100e3,
    max: 50e6,
    v: 1e6,
    ph: '例 10M',
    list: [100e3, 200e3, 500e3, 1e6, 2e6, 5e6, 10e6, 20e6, 30e6, 50e6],
    log: true,
    snap: true,
    pre: [
      [1e6, '1M'],
      [10e6, '10M'],
      [20e6, '20M'],
    ],
  },
  {
    k: 'len',
    nm: 'L',
    sym: '<i>L</i>',
    name: '配線の長さ',
    sub: 'マスタと機器の間',
    unit: 'm',
    min: 0.05,
    max: 3,
    v: 0.1,
    ph: '例 0.5',
    list: [0.05, 0.1, 0.2, 0.3, 0.5, 1, 1.5, 2, 3],
    log: true,
    snap: true,
    notation: 'plain',
    format: { ...plain, text: (x) => `${x} m` },
    pre: [
      [0.1, '0.1'],
      [1, '1'],
      [2, '2'],
    ],
  },
  {
    k: 'rate',
    nm: '速さ',
    sym: '',
    name: '速さ',
    sub: '再生の速さ',
    unit: 'クロック/秒',
    min: 0.25,
    max: 16,
    v: 1,
    ph: '例 1',
    list: [0.25, 0.5, 1, 2, 4, 8, 16],
    log: true,
    snap: true,
    notation: 'plain',
    format: { ...plain, text: (x) => `${x} クロック/秒` },
    pre: [
      [0.5, '0.5'],
      [1, '1'],
      [4, '4'],
    ],
  },
];

type Opt = readonly (readonly [string, string] | readonly [string, string, string])[];
export const CONN_OPT: Opt = [
  ['cs', '個別の CS'],
  ['chain', 'デイジーチェーン'],
];
export const MODE_OPT: Opt = [0, 1, 2, 3].map((m) => [String(m), String(m), `CPOL ${m >> 1}・CPHA ${m & 1}`]);
export const ORDER_OPT: Opt = [
  ['msb', 'MSB から'],
  ['lsb', 'LSB から'],
];
/** 宛先の選択肢: [番号, 図柄, 名前] */
export const DEST_OPT: readonly (readonly [number, IconId, string])[] = DEVS.map((d, k) => [k, d.k, d.name] as const);
