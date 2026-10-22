/**
 * 打鍵 1 回ぶんの動きを計算して、0.1 ms ごとの姿勢と接触の力を記録する。
 * 静止の姿勢は、図 A.1 の姿勢から力をかけずに 0.2 s 動かして決める
 */
import { FORCE_DT, FORTE, PIANO } from './force';
import { CONTACTS, Q_FIG } from './geom';
import { Action, headGap, pose, type Reg, type Rig, rigOf } from './model';

/** 打鍵: 強く・弱く・強く打って鍵を半分戻し、もう一度打つ */
export type TouchKind = 'forte' | 'piano' | 'rep';

/** 積分の刻み [s] と記録の間隔 [s] */
const DT = 2e-5;
export const FRAME = 1e-4;
const EVERY = Math.round(FRAME / DT);

/* 実験の力は、押す前と離したあとにも load cell の 0.2〜0.4 N が残る。押す前の値を引いて、押していない間を 0 にする */
const clean = (F: readonly number[]) => {
  const b = (F[0] + F[5] + F[10]) / 3;
  return F.map((v) => Math.max(0, v - b));
};
const FF = clean(FORTE),
  FP = clean(PIANO);
const at = (F: readonly number[], t: number) => {
  if (t < 0) return 0;
  const k = Math.min(F.length - 2, Math.floor(t / FORCE_DT)),
    f = Math.min(1, t / FORCE_DT - k);
  return F[k] * (1 - f) + F[k + 1] * f;
};
/** 連打: 強く打って 0.25 s で離し、16 ms 後（鍵がほぼ半分戻ったところ）に、強く打つ力を 3 N のところからかけ直す */
export const REP = { off: 0.25, gap: 0.016, from: 0.08 };
export function forceAt(kind: TouchKind, t: number): number {
  if (kind === 'piano') return at(FP, t);
  if (kind === 'forte' || t < REP.off) return at(FF, t);
  const t2 = REP.off + REP.gap;
  return t < t2 ? 0 : at(FF, REP.from + t - t2);
}
/** 計算する長さ [s] */
const DUR: Record<TouchKind, number> = { forte: 0.62, piano: 0.66, rep: 0.52 };

export interface Run {
  kind: TouchKind;
  reg: Reg;
  rig: Rig;
  /** 記録の数と、記録ごとの姿勢（5 個ずつ）・接触の法線の力（13 個ずつ）・鍵の前の力 */
  n: number;
  q: Float32Array;
  fn: Float32Array;
  force: Float32Array;
  /** 静止の姿勢 */
  q0: number[];
}

let rest: { q: number[]; spring: number } | null = null;
/** 力をかけない静止の姿勢（レペティションのばねの強さで少し変わる） */
function restPose(reg: Reg): number[] {
  if (rest && rest.spring === reg.spring) return rest.q;
  const a = new Action(rigOf(reg, Q_FIG), Q_FIG);
  a.rig.spring = reg.spring;
  for (let i = 0; i < 0.2 / DT; i++) a.step(DT);
  rest = { q: [...a.q], spring: reg.spring };
  return rest.q;
}

export function simulate(kind: TouchKind, reg: Reg): Run {
  const q0 = restPose(reg);
  const rig = rigOf(reg, q0);
  const a = new Action(rig, q0);
  const n = Math.round(DUR[kind] / FRAME) + 1;
  const q = new Float32Array(n * 5),
    fn = new Float32Array(n * CONTACTS.length),
    force = new Float32Array(n);
  const rec = (i: number) => {
    q.set(a.q, i * 5);
    fn.set(a.fn, i * CONTACTS.length);
    force[i] = a.force;
  };
  a.step(DT);
  a.t = 0;
  rec(0);
  for (let i = 1; i < n; i++) {
    for (let s = 0; s < EVERY; s++) {
      a.force = forceAt(kind, a.t);
      a.step(DT);
    }
    rec(i);
  }
  return { kind, reg, rig, n, q, fn, force, q0 };
}

/* ---------- 記録から読む ---------- */
export const qAt = (R: Run, i: number): number[] => Array.from(R.q.subarray(i * 5, i * 5 + 5));
export const fnAt = (R: Run, i: number, c: number): number => R.fn[i * CONTACTS.length + c - 1];
export const gapAt = (R: Run, i: number): number => headGap(pose(qAt(R, i)), R.rig.str);
/** 鍵の前（力をかける点）の下がり [m]。鍵の角度の変化 × 腕の長さ */
export const dipAt = (R: Run, i: number): number => (R.q0[0] - R.q[i * 5]) * 0.2293;
/** ハンマーの頭の速さ [m/s]（弦へ向かう向きが正） */
export function headSpeed(R: Run, i: number): number {
  const a = Math.max(0, i - 1),
    b = Math.min(R.n - 1, i + 1);
  return a === b ? 0 : (gapAt(R, a) - gapAt(R, b)) / ((b - a) * FRAME);
}
