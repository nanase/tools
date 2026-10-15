/**
 * ベッセル要素（DOM に依存しない）: NASA の五千年正典の多項式要素と、その時刻 t での値・時間微分
 *
 * 基準面は地心を通り影の軸に垂直な面で、x は東、y は北、z は太陽の向き。長さの単位は地球の赤道半径。
 * t は t0（最大食に最も近い TD の正時）からの時間 [h]。Espenak & Meeus (2006) NASA/TP-2006-214141
 */

export const DEG = Math.PI / 180;

/** 1 件の日食の多項式要素（NASA の CSV の列の名前に合わせる） */
export interface Elements {
  /** 多項式の基準の時刻 t0 の JD（TD） */
  jd0: number;
  /** NASA が使った ΔT [s] */
  dt: number;
  /** x・y の 3 次の係数、d・μ [°]、l1・l2 の 2 次の係数 */
  x: readonly [number, number, number, number];
  y: readonly [number, number, number, number];
  d: readonly [number, number, number];
  mu: readonly [number, number, number];
  l1: readonly [number, number, number];
  l2: readonly [number, number, number];
  /** 半影・本影の円錐の半頂角の正接 */
  tf1: number;
  tf2: number;
  /** 多項式を使ってよい t の範囲 [h]（NASA の CSV は全件 −3〜+3） */
  tmin: number;
  tmax: number;
}

/** 時刻 t での要素の値と時間微分（d・μ は rad、微分は 1 時間あたり） */
export interface State {
  t: number;
  x: number;
  y: number;
  d: number;
  mu: number;
  l1: number;
  l2: number;
  dx: number;
  dy: number;
  dd: number;
  dmu: number;
  tf1: number;
  tf2: number;
}

const p3 = (c: readonly number[], t: number) => c[0] + t * (c[1] + t * (c[2] + t * (c[3] ?? 0)));
const dp3 = (c: readonly number[], t: number) => c[1] + t * (2 * c[2] + 3 * t * (c[3] ?? 0));

export function stateAt(e: Elements, t: number): State {
  return {
    t,
    x: p3(e.x, t),
    y: p3(e.y, t),
    d: p3(e.d, t) * DEG,
    mu: p3(e.mu, t) * DEG,
    l1: p3(e.l1, t),
    l2: p3(e.l2, t),
    dx: dp3(e.x, t),
    dy: dp3(e.y, t),
    dd: dp3(e.d, t) * DEG,
    dmu: dp3(e.mu, t) * DEG,
    tf1: e.tf1,
    tf2: e.tf2,
  };
}

/** 月の半径比 k。NASA の正典は半影に 0.2724880、本影・金環に 0.272281 を使う（5MCSE 1.5 節） */
export const K_PENUMBRA = 0.272488;
export const K_UMBRA = 0.272281;
