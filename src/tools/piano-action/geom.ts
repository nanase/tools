/**
 * グランドピアノのアクションの模型の数値。Hirschkorn (2004) の付録 A（表 A.1〜A.9）による。
 * 座標は地面の座標 [m]: 原点は鍵の支点（バランスレール）、+x は鍵の前（奏者の側）、+y は上。
 * 部品の点は、その部品の軸を原点とする部品の座標で書く。角度は反時計回りが正
 */

/** 部品（自由度の順）。ジャックとレペティションレバーの角度はウィッペンから測る */
export type Body = 'key' | 'whippen' | 'jack' | 'rep' | 'hammer';
export const BODIES: readonly Body[] = ['key', 'whippen', 'jack', 'rep', 'hammer'];

/** 質量 [kg]・重心のまわりの慣性モーメント [kg m²]・重心 [m]（表 A.1） */
export const MASS: Record<Body, { m: number; I: number; cm: readonly [number, number] }> = {
  key: { m: 0.12008, I: 2.75e-3, cm: [0.0514, 0.0158] },
  whippen: { m: 0.01196, I: 1.69e-5, cm: [0.0502, -0.0018] },
  jack: { m: 0.00265, I: 7.78e-7, cm: [0.0008, 0.0195] },
  rep: { m: 0.00371, I: 4.1e-6, cm: [0.0021, -0.0012] },
  hammer: { m: 0.01174, I: 2.9e-5, cm: [-0.1022, 0.0145] },
};

/** 地面の軸: 鍵・ウィッペン・ハンマー（表 A.2） */
export const PG1 = [0, 0] as const;
export const PG2 = [-0.181, 0.0528] as const;
export const PG3 = [-0.0883, 0.1166] as const;
/** ウィッペンの上の軸: ジャック・レペティションレバー（表 A.4） */
export const PW2 = [0.0989, -0.0035] as const;
export const PW3 = [0.0483, 0.0275] as const;
/** 鍵の前に力をかける点（表 A.3） */
export const PK2 = [0.2278, 0.0261] as const;

/** 接触の面の形。line は点と外向きの法線、hybrid は円弧と、両端から接線に延びる直線 */
export type Feature =
  | { t: 'circle'; p: readonly [number, number]; r: number }
  | { t: 'line'; p: readonly [number, number]; n: readonly [number, number] }
  | { t: 'hybrid'; p: readonly [number, number]; r: number; a0: number; a1: number };

/** 部品の上の点（表 A.2〜A.7）。'ground' は地面 */
export type Owner = Body | 'ground';
export const FEAT: Record<string, { b: Owner; f: Feature }> = {
  Pg4: { b: 'ground', f: { t: 'circle', p: [0.2172, -0.0077], r: 0.005 } },
  Pg5: { b: 'ground', f: { t: 'circle', p: [-0.2037, -0.0105], r: 0.005 } },
  Pg6: { b: 'ground', f: { t: 'line', p: [-0.058, 0.064], n: [0, -1] } },
  Pg7: { b: 'ground', f: { t: 'circle', p: [-0.0843, 0.1132], r: 0.0033 } },
  Pg8: { b: 'ground', f: { t: 'circle', p: [-0.1921, 0.0766], r: 0.005 } },
  Pg9: { b: 'ground', f: { t: 'line', p: [-0.2196, 0.1706], n: [0, -1] } },
  Pk3: { b: 'key', f: { t: 'circle', p: [-0.1176, 0.0259], r: 0.0097 } },
  Pk4: { b: 'key', f: { t: 'line', p: [0.2175, 0], n: [0, -1] } },
  Pk5: { b: 'key', f: { t: 'line', p: [-0.2208, 0.001], n: [-0.041, -0.999] } },
  Pk6: { b: 'key', f: { t: 'line', p: [-0.2192, 0.0817], n: [0.904, 0.427] } },
  Pw4: { b: 'whippen', f: { t: 'line', p: [0.0759, 0.0189], n: [0.969, 0.247] } },
  Pw5: { b: 'whippen', f: { t: 'circle', p: [0.0595, 0.003], r: 0.0253 } },
  Pw6: { b: 'whippen', f: { t: 'line', p: [0.017, 0.0015], n: [0, 1] } },
  // biome-ignore lint/suspicious/noApproximativeNumericConstant: 論文の表 A.5 の値のまま
  Pj2: { b: 'jack', f: { t: 'hybrid', p: [-0.001, 0.0495], r: 0.001, a0: 1.571, a1: 3.142 } },
  Pj3: { b: 'jack', f: { t: 'circle', p: [0.0247, -0.005], r: 0.0021 } },
  Pj4: { b: 'jack', f: { t: 'circle', p: [-0.0097, 0.03], r: 0.005 } },
  Pj5: { b: 'jack', f: { t: 'line', p: [0.0031, 0.0477], n: [1, 0] } },
  Pr2: { b: 'rep', f: { t: 'hybrid', p: [0.0363, -0.0521], r: 0.0552, a0: 1.3, a1: 1.571 } },
  Pr3: { b: 'rep', f: { t: 'circle', p: [-0.0361, -0.0093], r: 0.005 } },
  Pr4: { b: 'rep', f: { t: 'circle', p: [0.0527, -0.0009], r: 0.005 } },
  Pr5: { b: 'rep', f: { t: 'line', p: [0.0561, 0.0017], n: [0.317, 0.948] } },
  Ph2: { b: 'hammer', f: { t: 'circle', p: [-0.017, -0.0091], r: 0.0044 } },
  Ph3: { b: 'hammer', f: { t: 'circle', p: [-0.0813, -0.0025], r: 0.0549 } },
  Ph4: { b: 'hammer', f: { t: 'circle', p: [-0.1321, 0.0356], r: 0.0102 } },
  Ph5: { b: 'hammer', f: { t: 'line', p: [-0.11, -0.0031], n: [0, -1] } },
};

/**
 * 13 か所の接触（表 2.1・表 A.8）。法線の力 f = (a x³ + b x² + c x)(1 + D ẋ)、x は食い込み [m]。
 * 摩擦は μ = A (tanh(s/vt) + B1 (s/vt) / (1 + B2 (s/vt)⁴))
 */
export interface ContactDef {
  n: number;
  name: string;
  p: [string, string];
  a: number;
  b: number;
  c: number;
  D: number;
  A: number;
  B1: number;
  B2: number;
}
const C = (
  n: number,
  name: string,
  p1: string,
  p2: string,
  a: number,
  b: number,
  c: number,
  D: number,
  A = 0,
  B1 = 0,
  B2 = 0,
): ContactDef => ({ n, name, p: [p1, p2], a, b, c, D, A, B1, B2 });
export const CONTACTS: readonly ContactDef[] = [
  C(1, 'キャプスタン → ウィッペン', 'Pk3', 'Pw5', 1.26e10, 3.26e7, 7.92e3, 1.877, 0.167, 0, 1),
  C(2, '鍵の前 → フロントレール', 'Pk4', 'Pg4', 4.41e10, -1.02e7, 1.57e4, 1.219),
  C(3, '鍵の後ろ → バックレール', 'Pk5', 'Pg5', 2.42e10, -1.11e7, 6.54e3, 2.502),
  // biome-ignore lint/suspicious/noApproximativeNumericConstant: 論文の表 A.8 の値のまま
  C(4, 'バックチェック → ハンマーの尾', 'Pk6', 'Ph3', 5.86e11, -3.7e7, 3.11e4, 2.446, 0.434, 1.78, 1),
  C(5, 'ジャック → ジャックの止め', 'Pw4', 'Pj4', 5.28e9, -7.54e5, 4.42e3, 5.781),
  C(6, 'レペティションのねじ → ウィッペン', 'Pw6', 'Pr3', 2.53e10, -9.89e6, 7.07e3, 7.732),
  C(7, 'ジャック → ナックル', 'Pj2', 'Ph2', 3.92e11, 1.1e7, 3.23e4, 4.694, 0.177, 1.85, 1),
  C(8, 'ジャック → レットオフボタン', 'Pj3', 'Pg6', 7.46e10, -2.29e7, 1.32e4, 1.527),
  C(9, 'ジャック → レペティション', 'Pj5', 'Pr4', 6.02e10, -1.68e7, 6.96e3, 0.779),
  C(10, 'レペティション → ナックル', 'Pr2', 'Ph2', 1.09e12, -7.51e7, 2.23e4, 2.935, 0.332, 0.73, 1),
  C(11, 'レペティション → ドロップねじ', 'Pr5', 'Pg7', 8.82e11, -7.59e7, 1.67e4, 4.985),
  C(12, 'ハンマー → 弦', 'Ph4', 'Pg9', 1.81e10, 8.19e7, 1.16e4, 0.175),
  C(13, 'ハンマー → ハンマーレール', 'Ph5', 'Pg8', 8.58e8, -1.11e6, 2.39e3, 8.964),
];

/** 軸の摩擦の大きさ [N m]（表 A.9）。T = −A tanh(ω/ωt) */
export const JOINT_A: Record<Body, number> = {
  key: 0.0122,
  whippen: 0.000397,
  jack: 0.000397,
  rep: 0.00247,
  hammer: 0.00101,
};
/** ジャックのばねのトルク [N m]（ほぼ一定、付録 A.4）。向きはジャックをナックルの下へ戻す向き */
export const JACK_T = 0.0042;
/** レペティションのばね T = −k (θr − θ0)（式 A.3） */
export const REP_K = 0.073;
export const REP_TH0 = 0.832;

/** 図 A.1 に描かれた静止の姿勢 [rad]（鍵・ウィッペン・ジャック・レペティション・ハンマー） */
export const Q_FIG = [0.0275, 0.0257, 0.3332, 0.3736, 0.2922] as const;

export const G = 9.81;
