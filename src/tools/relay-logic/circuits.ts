/** リレーで作る論理回路のサンプル 23 個（基本ゲート 9・組み合わせ回路 8・順序回路 6） */
import { CH, ca, cb, DECO, type Load, MUX, type Net, P, type Rung, S, WAY3 } from './net';
import { IC_MIN, type Relay } from './relay';

/**
 * 入力: rel はスイッチでリレーのコイルを入り切りする（接点はリレーのもの）、
 * sw はスイッチそのものの接点、push は押している間だけ閉じる押しボタン
 */
export interface Input {
  id: string;
  lb: string;
  kind: 'rel' | 'sw' | 'push';
  /** リレーと接点の名前（lb と違うときだけ） */
  rn?: string;
  /** 押しボタンの色 */
  col?: 'g' | 'r' | 'b';
}
export type Group = 'basic' | 'comb' | 'seq';
export interface Def {
  id: string;
  g: Group;
  name: string;
  sub: string;
  ins: Input[];
  rungs: Rung[];
  /** 初めの速さ（1 は等倍） */
  speed?: number;
  /** コンデンサで延ばす復帰の時間 [ms] */
  delay?: number;
  /** 初めの入力 */
  init?: Record<string, number>;
  /** 図の下の札（今の状態から） */
  hint?: (inp: Record<string, number>, R: Record<string, Relay>) => string;
}

export const GROUPS: readonly (readonly [Group, string])[] = [
  ['basic', '基本ゲート'],
  ['comb', '組み合わせ回路'],
  ['seq', '順序回路'],
];

const rel = (...ids: string[]): Input[] => ids.map((id) => ({ id, lb: id, kind: 'rel' }));
const lamp = (lb = 'ランプ'): Load => ({ kind: 'lamp', lb });
const coil = (id: string): Load => ({ kind: 'coil', id });
const one = (net: Net, lb?: string): Rung[] => [{ net, loads: [lamp(lb)] }];
/** 3 個のうち 2 個以上 */
const maj = (a: string, b: string, c: string): Net => P(S(ca(a), ca(b)), S(ca(a), ca(c)), S(ca(b), ca(c)));
const push = (id: string, lb: string, col: 'g' | 'r' | 'b'): Input => ({ id, lb, kind: 'push', col });
const keepHint = (inp: Record<string, number>, R: Record<string, Relay>): string =>
  R.R1.a && !inp.SET && !inp.RST ? 'R1 自身の接点を通る電流' : '';

export const DEFS: readonly Def[] = [
  {
    id: 'and',
    g: 'basic',
    name: 'AND',
    sub: '直列',
    ins: rel('A', 'B'),
    rungs: one(S(ca('A'), ca('B'))),
    init: { A: 1 },
  },
  { id: 'or', g: 'basic', name: 'OR', sub: '並列', ins: rel('A', 'B'), rungs: one(P(ca('A'), ca('B'))) },
  { id: 'not', g: 'basic', name: 'NOT', sub: '動作で開く接点', ins: rel('A'), rungs: one(cb('A')) },
  {
    id: 'nand',
    g: 'basic',
    name: 'NAND',
    sub: '動作で開く接点の並列',
    ins: rel('A', 'B'),
    rungs: one(P(cb('A'), cb('B'))),
  },
  {
    id: 'nor',
    g: 'basic',
    name: 'NOR',
    sub: '動作で開く接点の直列',
    ins: rel('A', 'B'),
    rungs: one(S(cb('A'), cb('B'))),
  },
  { id: 'xor', g: 'basic', name: 'XOR', sub: '切り替えの接点 2 組', ins: rel('A', 'B'), rungs: one(CH(['A', 'B'], 1)) },
  {
    id: 'xnor',
    g: 'basic',
    name: 'XNOR',
    sub: '切り替えの接点 2 組',
    ins: rel('A', 'B'),
    rungs: one(CH(['A', 'B'], 0)),
  },
  {
    id: 'and3',
    g: 'basic',
    name: '3 入力 AND',
    sub: '3 個の直列',
    ins: rel('A', 'B', 'C'),
    rungs: one(S(ca('A'), ca('B'), ca('C'))),
  },
  {
    id: 'or3',
    g: 'basic',
    name: '3 入力 OR',
    sub: '3 個の並列',
    ins: rel('A', 'B', 'C'),
    rungs: one(P(ca('A'), ca('B'), ca('C'))),
  },
  {
    id: 'maj',
    g: 'comb',
    name: '多数決',
    sub: '2 個以上で点灯',
    ins: rel('A', 'B', 'C'),
    rungs: one(maj('A', 'B', 'C')),
  },
  {
    id: 'stairs',
    g: 'comb',
    name: '階段の照明',
    sub: '3 路スイッチの代わりに切り替えの接点 2 個',
    ins: [
      { id: 'F1', lb: '1 階', kind: 'rel', rn: 'F1' },
      { id: 'F2', lb: '2 階', kind: 'rel', rn: 'F2' },
    ],
    rungs: one(WAY3('F1', 'F2'), '照明'),
  },
  {
    id: 'half',
    g: 'comb',
    name: '半加算器',
    sub: '和と繰り上がり',
    ins: rel('A', 'B'),
    rungs: [...one(CH(['A', 'B'], 1), '和'), ...one(S(ca('A'), ca('B')), '繰り上がり')],
  },
  {
    id: 'full',
    g: 'comb',
    name: '全加算器',
    sub: 'C は下の桁からの繰り上がり',
    ins: rel('A', 'B', 'C'),
    rungs: [...one(CH(['A', 'B', 'C'], 1), '和'), ...one(maj('A', 'B', 'C'), '繰り上がり')],
  },
  {
    id: 'mux',
    g: 'comb',
    name: 'マルチプレクサ',
    sub: 'S の切り替えの接点で D0 か D1',
    ins: rel('D0', 'D1', 'S'),
    rungs: one(MUX('D0', 'D1', 'S'), '出力'),
  },
  {
    id: 'deco',
    g: 'comb',
    name: 'デコーダ',
    sub: '切り替えの接点 3 個で 4 本に',
    ins: rel('A', 'B'),
    rungs: [{ net: DECO('A', 'B'), loads: ['AB 00', 'AB 01', 'AB 10', 'AB 11'].map((l) => lamp(l)) }],
  },
  {
    id: 'eq',
    g: 'comb',
    name: '一致',
    sub: '2 桁の A と B が同じで点灯',
    ins: rel('A1', 'A0', 'B1', 'B0'),
    rungs: one(S(CH(['A1', 'B1'], 0), CH(['A0', 'B0'], 0)), '一致'),
  },
  {
    id: 'parity',
    g: 'comb',
    name: 'パリティ',
    sub: '1 の数が奇数で点灯',
    ins: rel('A', 'B', 'C'),
    rungs: one(CH(['A', 'B', 'C'], 1), '奇数'),
  },
  {
    id: 'rst',
    g: 'seq',
    name: '自己保持',
    sub: 'リセット優先',
    ins: [push('SET', 'セット', 'g'), push('RST', 'リセット', 'r')],
    rungs: [{ net: S(P(ca('SET'), ca('R1')), cb('RST')), loads: [coil('R1')] }, ...one(ca('R1'))],
    hint: (inp, R) => (inp.SET && inp.RST ? '両方押すとリセットが優先' : keepHint(inp, R)),
  },
  {
    id: 'setp',
    g: 'seq',
    name: 'セット優先の自己保持',
    sub: 'セット優先',
    ins: [push('SET', 'セット', 'g'), push('RST', 'リセット', 'r')],
    rungs: [{ net: P(ca('SET'), S(ca('R1'), cb('RST'))), loads: [coil('R1')] }, ...one(ca('R1'))],
    hint: (inp, R) => (inp.SET && inp.RST ? '両方押すとセットが優先' : keepHint(inp, R)),
  },
  {
    id: 'il',
    g: 'seq',
    name: 'インターロック',
    sub: '正転と逆転は同時に入らない',
    ins: [push('FW', '正転', 'g'), push('RV', '逆転', 'b'), push('STP', '停止', 'r')],
    rungs: [
      { net: S(P(ca('FW'), ca('R1')), cb('STP'), cb('R2')), loads: [coil('R1')] },
      { net: S(P(ca('RV'), ca('R2')), cb('STP'), cb('R1')), loads: [coil('R2')] },
      ...one(ca('R1'), '正転中'),
      ...one(ca('R2'), '逆転中'),
    ],
    hint: (inp, R) =>
      inp.RV && R.R1.a ? 'R1 が動作中のため R2 は入らない' : inp.FW && R.R2.a ? 'R2 が動作中のため R1 は入らない' : '',
  },
  {
    id: 'buzz',
    g: 'seq',
    name: 'ブザー',
    sub: '動作で開く自分の接点で発振',
    speed: 0.05,
    init: { RUN: 1 },
    ins: [{ id: 'RUN', lb: '動作', kind: 'sw' }],
    rungs: [{ net: S(ca('RUN'), cb('R1')), loads: [coil('R1')] }, ...one(ca('R1'))],
    hint: (inp, R) => (!inp.RUN ? '' : R.R1.b ? '接点が閉じてコイルに電流' : '接点が開いてコイルの電流なし'),
  },
  {
    id: 'tff',
    g: 'seq',
    name: 'T フリップフロップ',
    sub: '押すたびに入り切り',
    ins: [push('PB', '押す', 'g')],
    rungs: [
      { net: P(S(cb('PB'), cb('R2')), S(ca('PB'), ca('R1'))), loads: [coil('R1')] },
      { net: P(S(ca('PB'), ca('R1')), S(cb('PB'), ca('R2'))), loads: [coil('R2')] },
      ...one(ca('R2')),
    ],
    hint: (inp) => (inp.PB ? '押している間 R1 は変わらない' : 'R1 は次に押したときの R2'),
  },
  {
    id: 'offd',
    g: 'seq',
    name: '遅れて切れる回路',
    sub: 'コンデンサで電流が続く',
    delay: 1500,
    ins: [push('PB', 'ボタン', 'g')],
    rungs: [{ net: ca('PB'), loads: [{ kind: 'coilC', id: 'R1' }] }, ...one(ca('R1'))],
    hint: (inp, R) =>
      !inp.PB && R.R1.held ? 'コンデンサからコイルに電流' : R.R1.ic > IC_MIN ? 'コンデンサを充電する電流' : '',
  },
];

export const DEF: Readonly<Record<string, Def>> = Object.fromEntries(DEFS.map((d) => [d.id, d]));

/** 入力の id から接点の名前 */
export const lbOf = (def: Def, r: string): string => {
  const q = def.ins.find((x) => x.id === r);
  return q ? (q.rn ?? q.lb) : r;
};
