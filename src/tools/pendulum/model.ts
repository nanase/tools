/**
 * 台車型の倒立振子の模型（DOM に依存しない）: 非線形の運動方程式、RK4 の 1 ステップ、
 * レールの端での衝突、押したときの撃力、直立の点での線形化
 *
 * 状態は [x, θ, ẋ, θ̇]。x は台車の位置（右が正）、θ は振子の真上からの角度（先端が右へ傾くと正）
 */
import { type C, eig, type Mat } from './linalg';

export const G = 9.81;

export interface Plant {
  /** 台車の質量 [kg] */
  M: number;
  /** 振子の質量 [kg]、軸から重心まで [m]、重心まわりの慣性モーメント [kg·m²] */
  m: number;
  l: number;
  J: number;
  /** 台車の粘性摩擦 [N·s/m]、クーロン摩擦 [N]、軸の粘性摩擦 [N·m·s/rad] */
  bc: number;
  fc: number;
  bp: number;
  /** 台車が動ける範囲の長さ [m]（中央が 0） */
  rail: number;
  /** 駆動: DC モータ（入力は電圧）か、力をそのまま出す駆動（入力は力） */
  drive: 'motor' | 'force';
  /** 入力の上限 [V] か [N] */
  umax: number;
  /** モータ: トルク定数 [N·m/A]（逆起電力定数と同じ）、巻線抵抗 [Ω]、減速比、ピニオンの半径 [m]、回転子の慣性モーメント [kg·m²] */
  kt: number;
  rm: number;
  kg: number;
  rp: number;
  jm: number;
}

/** 駆動を力に直す係数: F = α·u − β·ẋ。Me は回転子を含む台車の等価質量 */
export interface Drive {
  alpha: number;
  beta: number;
  Me: number;
}
export function driveOf(p: Plant): Drive {
  if (p.drive === 'force') return { alpha: 1, beta: 0, Me: p.M };
  const { kt, rm, kg, rp } = p;
  return {
    alpha: (kg * kt) / (rm * rp),
    beta: (kg * kg * kt * kt) / (rm * rp * rp),
    Me: p.M + (kg * kg * p.jm) / (rp * rp),
  };
}

/** クーロン摩擦を滑らかにする速さ [m/s]（これより遅いと摩擦は速さに比例） */
export const VS = 2e-4;
/** レールの端の反発係数 */
export const REST = 0.2;

/** 台車にかかる駆動の力 [N]（u は上限で切った入力） */
export const forceOf = (d: Drive, u: number, v: number): number => d.alpha * u - d.beta * v;

/**
 * 状態の時間微分。u は上限で切った入力（電圧か力）、f は外から台車に加える力 [N]
 */
export function deriv(p: Plant, d: Drive, s: readonly number[], u: number, out: number[]): void {
  const [, th, v, w] = s,
    sn = Math.sin(th),
    cs = Math.cos(th),
    ml = p.m * p.l,
    a = d.Me + p.m,
    b = ml * cs,
    c = p.J + ml * p.l,
    F = forceOf(d, u, v) - p.bc * v - p.fc * Math.tanh(v / VS),
    r1 = F + ml * sn * w * w,
    r2 = ml * G * sn - p.bp * w,
    D = a * c - b * b;
  out[0] = v;
  out[1] = w;
  out[2] = (c * r1 - b * r2) / D;
  out[3] = (a * r2 - b * r1) / D;
}

const k1 = [0, 0, 0, 0],
  k2 = [0, 0, 0, 0],
  k3 = [0, 0, 0, 0],
  k4 = [0, 0, 0, 0],
  tmp = [0, 0, 0, 0];
/** RK4 で h だけ進める（s を書き換える） */
export function rk4(p: Plant, d: Drive, s: number[], u: number, h: number): void {
  deriv(p, d, s, u, k1);
  for (let i = 0; i < 4; i++) tmp[i] = s[i] + 0.5 * h * k1[i];
  deriv(p, d, tmp, u, k2);
  for (let i = 0; i < 4; i++) tmp[i] = s[i] + 0.5 * h * k2[i];
  deriv(p, d, tmp, u, k3);
  for (let i = 0; i < 4; i++) tmp[i] = s[i] + h * k3[i];
  deriv(p, d, tmp, u, k4);
  for (let i = 0; i < 4; i++) s[i] += (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
}

/**
 * 撃力を加える。水平の撃力 P [N·s] を、振子の軸から長さ r の点（r が null なら台車）に加える。
 * 一般化した撃力 [P, P r cosθ] を質量行列で割って速度を変える
 */
export function impulse(p: Plant, d: Drive, s: number[], P: number, r: number | null): void {
  const cs = Math.cos(s[1]),
    ml = p.m * p.l,
    a = d.Me + p.m,
    b = ml * cs,
    c = p.J + ml * p.l,
    D = a * c - b * b,
    qx = P,
    qt = r === null ? 0 : P * r * cs;
  s[2] += (c * qx - b * qt) / D;
  s[3] += (a * qt - b * qx) / D;
}

/**
 * レールの端で台車を止める。端を越えたら端に戻し、速度を反発係数で反転する。
 * 台車が急に止まる分、振子の角速度も変わる（台車への撃力を質量行列で配る）。端に当たったら true
 */
export function railStop(p: Plant, s: number[]): boolean {
  const h = p.rail / 2;
  if (Math.abs(s[0]) <= h) return false;
  const sg = Math.sign(s[0]);
  s[0] = sg * h;
  const v = s[2];
  if (v * sg <= 0) return true;
  const ml = p.m * p.l,
    b = ml * Math.cos(s[1]),
    c = p.J + ml * p.l,
    dv = -(1 + REST) * v;
  s[2] += dv;
  s[3] -= (b / c) * dv;
  return true;
}

/** 力学的エネルギー [J]（位置エネルギーは軸の高さを 0） */
export function energy(p: Plant, d: Drive, s: readonly number[]): number {
  const [, th, v, w] = s,
    ml = p.m * p.l;
  return (
    0.5 * (d.Me + p.m) * v * v + ml * Math.cos(th) * v * w + 0.5 * (p.J + ml * p.l) * w * w + ml * G * Math.cos(th)
  );
}

/** 振子のエネルギー（直立して止まっていると 0、真下で止まっていると −2mgl）[J] */
export const pendEnergy = (p: Plant, th: number, w: number): number =>
  0.5 * (p.J + p.m * p.l * p.l) * w * w + p.m * G * p.l * (Math.cos(th) - 1);

/** 直立の点での線形化 ẋ = Ax + Bu（クーロン摩擦は除く）。状態は [x, θ, ẋ, θ̇] */
export function linearize(p: Plant): { A: Mat; B: number[] } {
  const d = driveOf(p),
    ml = p.m * p.l,
    a = d.Me + p.m,
    c = p.J + ml * p.l,
    D = a * c - ml * ml,
    bb = d.beta + p.bc;
  return {
    A: [
      [0, 0, 1, 0],
      [0, 0, 0, 1],
      [0, (-ml * ml * G) / D, (-c * bb) / D, (ml * p.bp) / D],
      [0, (a * ml * G) / D, (ml * bb) / D, (-a * p.bp) / D],
    ],
    B: [0, 0, (c * d.alpha) / D, (-ml * d.alpha) / D],
  };
}

/** 開ループの極 */
export const openPoles = (p: Plant): C[] => eig(linearize(p).A) ?? [];

/** 振子を描く長さ: 重心を中心にした同じ慣性モーメントの一様な棒の先端まで [m] */
export const rodLen = (p: Plant): number => p.l + Math.sqrt((3 * p.J) / Math.max(p.m, 1e-9));
