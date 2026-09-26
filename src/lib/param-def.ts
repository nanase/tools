import type { Unit } from './parse';

/** 数値入力 1 項目の定義。.astro での描画とブラウザでの動作の両方で使う */
export interface ParamDef {
  k: string;
  /** 読み上げ・ラベル用の短い名前（R1） */
  nm: string;
  /** 記号の HTML（<i>R</i><sub>1</sub>） */
  sym: string;
  name: string;
  sub: string;
  unit: Unit;
  min: number;
  max: number;
  /** 初期値 */
  v: number;
  /** E 系列に吸着するなら省略。一様刻みなら刻み・Shift 時の刻み・大目盛りの間隔 */
  lin?: { step: number; big: number; major: number };
  ph: string;
  /** プリセット [値, 表示]（小さい順） */
  pre: [number, string][];
  /** スライダーの目盛りラベル [値, 表示] */
  tk: [number, string][];
}
