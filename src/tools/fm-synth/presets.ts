/**
 * 音色の例（アルゴリズムの枠の「音色」の行）。FMシンセサイザで試聴して選んだ音色（fm-synthesizer/tones-picked.ts）から、
 * このページの値（アルゴリズム・帰還量・波形・周波数比・変調指数・出力レベル・デチューン・ADSR）だけを写した。
 * ベロシティの効き・キースケール・LFO・音量の補正は使わない。同じ値であることはテストで確かめる
 */
import { ALG0, FB0, I0, L0, R0, W0 } from './params';
import { ENV0, waveIndex } from './synth';

/** オペレータの値（S は 0〜1） */
export interface PresetOp {
  w: number;
  r: number;
  i: number;
  l: number;
  dt: number;
  ar: number;
  dr: number;
  sl: number;
  rr: number;
}
export interface Preset {
  /** 選択の値（初期値は 'init'、ほかは GM のプログラム番号） */
  v: string;
  name: string;
  /** GM のプログラム番号（0 始まり。初期値はなし） */
  gm?: number;
  alg: number;
  fb: number;
  ops: readonly PresetOp[];
}

const op = (
  w: number,
  r: number,
  i: number,
  l: number,
  ar: number,
  dr: number,
  sl: number,
  rr: number,
  dt = 0,
): PresetOp => ({
  w,
  r,
  i,
  l,
  dt,
  ar,
  dr,
  sl,
  rr,
});

/** 初期値（ページを開いたときの音色） */
export const INIT: Preset = {
  v: 'init',
  name: '初期値',
  alg: ALG0,
  fb: FB0,
  ops: [0, 1, 2, 3].map((k) => op(waveIndex(W0[k]), R0[k], I0[k], L0[k], ENV0.ar, ENV0.dr, ENV0.sl, ENV0.rr)),
};

export const PRESETS: readonly Preset[] = [
  INIT,
  {
    v: 'gm4',
    name: 'エレクトリックピアノ 1',
    gm: 4,
    alg: 4,
    fb: 0,
    ops: [
      op(3, 7, 0.6, -8, 0, 0.12, 0, 0.08),
      op(0, 1, 1, -3, 0.001, 1.6, 0, 0.5),
      op(5, 0.5, 1.6, -8, 0, 0.8, 0.3, 0.4),
      op(0, 1, 1, 0, 0.001, 5, 0, 0.5),
    ],
  },
  {
    v: 'gm33',
    name: 'フィンガーベース',
    gm: 33,
    alg: 4,
    fb: 0,
    ops: [
      op(5, 0.5, 1.4, -8, 0, 0.5, 0.25, 0.1),
      op(0, 1, 1, 0, 0.002, 3, 0, 0.12),
      op(1, 1, 0.7, -8, 0, 0.08, 0, 0.03),
      op(1, 1, 1, -6, 0.001, 0.6, 0, 0.1),
    ],
  },
  {
    v: 'gm61',
    name: 'ブラスセクション',
    gm: 61,
    alg: 4,
    fb: 4,
    ops: [
      op(0, 1, 2.4, -8, 0.06, 0.5, 0.7, 0.15),
      op(0, 1, 1, -3, 0.025, 2, 0.9, 0.15),
      op(0, 0.502, 1.6, -8, 0.1, 0.8, 0.8, 0.18),
      op(0, 0.502, 1, -5, 0.05, 2, 0.9, 0.18),
    ],
  },
  {
    v: 'gm16',
    name: 'ドローバーオルガン',
    gm: 16,
    alg: 7,
    fb: 0,
    ops: [
      op(6, 3, 1, -6, 0, 0.03, 0, 0.01),
      op(0, 0.5, 1, -3, 0.003, 1, 1, 0.03),
      op(4, 1, 1, -3, 0.003, 1, 1, 0.03),
      op(0, 1.5, 1, -5, 0.003, 1, 1, 0.03),
    ],
  },
  {
    v: 'gm73',
    name: 'フルート',
    gm: 73,
    alg: 7,
    fb: 7,
    ops: [
      op(1, 2, 1, -24, 0.01, 0.15, 0.4, 0.1),
      op(0, 1, 1, 0, 0.06, 1, 1, 0.12),
      op(0, 2, 1, -12, 0.06, 1, 1, 0.12),
      op(1, 1, 1, -9, 0.06, 1, 1, 0.12),
    ],
  },
  {
    v: 'gm14',
    name: 'チューブラーベル',
    gm: 14,
    alg: 6,
    fb: 0,
    ops: [
      op(0, 1, 1.2, -8, 0, 0.4, 0, 0.3),
      op(0, 2, 1, -2, 0, 7, 0, 2.5),
      op(0, 2.99, 1, -4, 0, 5, 0, 2),
      op(0, 4.17, 1, -8, 0, 3.5, 0, 1.5),
    ],
  },
];
