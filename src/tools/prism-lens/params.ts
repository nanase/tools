/** プリズムとレンズのページの入力の定義。部品の長さは mm で出し、図の単位（0.1 mm）へは client が直す */
import type { ParamDef } from '../../lib/param-def';
import type { Unit } from '../../lib/parse';
import type { PartType } from './optics';

export type PKey = 'lam' | 'w' | 'apex' | 'size' | 'R' | 'D' | 'h' | 'r' | 'L' | 'ang';

const sig = (v: number, s: number) => String(Number(v.toPrecision(s)));
const fix1 = (v: number) => String(Math.round(v * 10) / 10);

function def(
  k: PKey,
  name: string,
  sub: string,
  unit: Unit,
  min: number,
  max: number,
  v: number,
  step: number,
  big: number,
  pre: number[],
  extra: Partial<Omit<ParamDef, 'k'>> = {},
): ParamDef & { k: PKey } {
  const show = unit === 'mm' ? fix1 : (x: number) => sig(x, 4);
  return {
    k,
    nm: name,
    sym: '',
    name,
    sub,
    unit,
    min,
    max,
    v,
    ph: `例 ${show(v)}`,
    lin: { step, big },
    notation: 'plain',
    inputmode: 'decimal',
    format: { input: show, step: show, text: (x) => `${show(x)} ${unit}` },
    bad: `数を入れてください（例 ${show(v)}）`,
    pre: pre.map((x) => [x, show(x)] as [number, string]),
    ...extra,
  };
}

/** 選んだ部品の項目の名前・単位・刻み（範囲は部品ごとに RANGE で決める） */
export const PARAMS: (ParamDef & { k: PKey })[] = [
  def('lam', '波長', '単色の光の波長', 'nm', 400, 700, 532, 1, 10, [450, 532, 589, 650]),
  def('w', '幅', '', 'mm', 1, 64, 3, 0.1, 1, []),
  def('apex', '頂角', '光の入る面と出る面のなす角', '°', 20, 90, 60, 1, 5, [30, 45, 60, 90]),
  def('size', '大きさ', '頂角をはさむ辺の長さ', 'mm', 8, 32, 17, 0.1, 1, []),
  def('R', '曲率半径', '面の丸みの半径。小さいほど強く曲がる', 'mm', 9, 80, 22, 0.1, 1, []),
  def('D', '直径', '', 'mm', 6, 30, 17, 0.1, 1, []),
  def('h', '厚さ', '', 'mm', 1, 24, 6, 0.1, 1, []),
  def('r', '半径', '', 'mm', 3, 22, 11, 0.1, 1, []),
  def('L', '長さ', '', 'mm', 4, 42, 17, 0.1, 1, []),
  def('ang', '角度', '橙のつまみ・ホイールでも回せる', '°', -180, 180, 0, 1, 15, [-90, -45, 0, 45, 90], {
    sign: 'any',
  }),
];

/** 部品ごとの範囲と既定値（mm・°・nm） */
type Rng = { min: number; max: number; v: number; sub?: string };
export const RANGE: Record<PartType, Partial<Record<PKey, Rng>>> = {
  beam: { lam: { min: 400, max: 700, v: 532 }, w: { min: 1, max: 30, v: 3, sub: '光の帯の幅' } },
  laser: { lam: { min: 400, max: 700, v: 532 } },
  lamp: { lam: { min: 400, max: 700, v: 532 } },
  prism: { apex: { min: 20, max: 90, v: 60 }, size: { min: 8, max: 32, v: 17 } },
  penta: { size: { min: 8, max: 28, v: 16, sub: '光の入る面の幅' } },
  convex: { R: { min: 9, max: 80, v: 22 }, D: { min: 6, max: 30, v: 17, sub: 'レンズの高さ' } },
  concave: { R: { min: 9, max: 80, v: 22 }, D: { min: 6, max: 30, v: 17, sub: 'レンズの高さ' } },
  semi: { r: { min: 3, max: 22, v: 12 } },
  plate: { w: { min: 4, max: 64, v: 24, sub: '板の幅' }, h: { min: 1, max: 24, v: 6 } },
  drop: { r: { min: 3, max: 22, v: 11 } },
  mirror: { L: { min: 4, max: 42, v: 17 } },
  cmirror: { R: { min: 12, max: 100, v: 36 }, D: { min: 6, max: 30, v: 20, sub: '鏡の高さ' } },
  half: { L: { min: 4, max: 42, v: 15 } },
  screen: { L: { min: 4, max: 42, v: 22 } },
};
/** 明るさ（表示） */
export const EV: ParamDef = {
  k: 'ev',
  nm: '明るさ',
  sym: '',
  name: '明るさ',
  sub: '図の露出。暗い光を見たいときに上げる',
  unit: 'EV',
  min: -3,
  max: 4,
  v: 0,
  ph: '例 0',
  lin: { step: 0.1, big: 1 },
  sign: 'any',
  notation: 'plain',
  inputmode: 'decimal',
  format: { input: fix1, step: fix1, text: (x) => `${fix1(x)} EV` },
  bad: '数を入れてください（例 0）',
  pre: [
    [-2, '−2'],
    [0, '0'],
    [2, '+2'],
  ],
};
