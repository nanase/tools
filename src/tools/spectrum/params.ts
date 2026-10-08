/** スペクトラムアナライザの入力の定義: 解析（FFT の長さ）と表示（周波数の範囲・強度の範囲） */
import { pow2List } from '../../lib/eseries';
import { fmt, minus } from '../../lib/format';
import type { ParamDef, ParamFormat } from '../../lib/param-def';

export type Key = 'n' | 'fl' | 'fh' | 'top' | 'bot';

const HZ: ParamFormat = {
  input: (v) => (v ? fmt(v, '', 4) : '0'),
  step: (v) => (v >= 1000 ? `${Number((v / 1000).toPrecision(3))}k` : String(v)),
  text: (v) => fmt(v, 'Hz', 4),
};
const DB: ParamFormat = {
  input: (v) => minus(String(v)),
  step: (v) => minus(String(v)),
  text: (v) => `${minus(String(v))} dBFS`,
};
/** 強度の範囲（5 dB 刻み） */
const db = (
  k: 'top' | 'bot',
  name: string,
  sub: string,
  v: number,
  min: number,
  max: number,
): ParamDef & { k: Key } => ({
  k,
  nm: name,
  sym: '',
  name,
  sub,
  unit: 'dB',
  min,
  max,
  v,
  lin: { step: 5, big: 20 },
  sign: 'any',
  ph: '例 −20',
  bad: '読めない値です（例 0・−20・−100）',
  pre: [],
  format: DB,
});

export const PARAMS: (ParamDef & { k: Key })[] = [
  {
    k: 'n',
    nm: 'N',
    sym: '<i>N</i>',
    name: 'FFT の長さ',
    sub: '1 回の FFT に使う点数。大きいほど周波数は細かく、時間の変化には遅れる',
    unit: '',
    min: 256,
    max: 32768,
    v: 4096,
    list: pow2List(8, 15),
    log: true,
    snap: true,
    notation: 'plain',
    ph: '例 4096',
    bad: '読めない値です（例 4096・8k）',
    pre: [],
    format: { input: String, step: (v) => (v >= 1024 ? `${v / 1024}k` : String(v)), text: (v) => `${v} 点` },
  },
  {
    k: 'fl',
    nm: 'fL',
    sym: '',
    name: '最低周波数',
    sub: '対数の軸では Δf と 1 Hz より下は表示しない',
    unit: 'Hz',
    min: 0,
    max: 5000,
    v: 20,
    list: [0, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000],
    snap: true,
    sign: 'nonneg',
    ph: '例 20',
    bad: '読めない値です（例 20・100）',
    pre: [],
    format: HZ,
  },
  {
    k: 'fh',
    nm: 'fH',
    sym: '',
    name: '最高周波数',
    sub: '標本化周波数の半分（fs/2）を超える分は表示しない',
    unit: 'Hz',
    min: 500,
    max: 24000,
    v: 20000,
    list: [500, 1000, 2000, 4000, 5000, 8000, 10000, 12000, 16000, 20000, 24000],
    log: true,
    snap: true,
    ph: '例 20k',
    bad: '読めない値です（例 5k・20k）',
    pre: [],
    format: HZ,
  },
  db('top', '最高強度', 'スペクトラムの上端と、スペクトログラムの最も明るい色（dBFS）', 0, -130, 20),
  db('bot', '最低強度', 'スペクトラムの下端と、スペクトログラムの地の色（dBFS）', -120, -160, 10),
];
export const P = Object.fromEntries(PARAMS.map((d) => [d.k, d])) as Record<Key, ParamDef>;

/** 平均化: パワーの指数移動平均の係数 */
export const AVG = { off: 0, lo: 0.6, hi: 0.9 } as const;
export type Avg = keyof typeof AVG;
/** スペクトログラムの時間の幅（秒） */
export const SPANS = [5, 10, 20, 60] as const;
