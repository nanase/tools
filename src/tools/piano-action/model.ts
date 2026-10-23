/**
 * グランドピアノのアクションの多体の模型（Hirschkorn 2004）。
 * 5 つの剛体（鍵・ウィッペン・ジャック・レペティションレバー・ハンマー）を、一般化座標
 * q = [θk, θw, θj, θr, θh]（θj・θr はウィッペンから測る）で表し、13 か所の接触の力・ばね・
 * 軸の摩擦・重力・鍵の前にかける力で動かす。
 * 積分は半陰的オイラー法: 速さに比例する力（接触の減衰・摩擦・軸の摩擦）だけを陰的に扱い、
 * 摩擦のしきい値の小さい速さでも安定させる
 */
import {
  BODIES,
  type Body,
  CONTACTS,
  type ContactDef,
  FEAT,
  type Feature,
  G,
  JACK_T,
  JOINT_A,
  MASS,
  type Owner,
  PG1,
  PG2,
  PG3,
  PK2,
  PW2,
  PW3,
  Q_FIG,
  REP_K,
  REP_TH0,
} from './geom';

type V2 = [number, number];
const N = 5;
/** 部品ごとの自由度（その部品を回す軸の番号） */
const DOFS: Record<Body, readonly number[]> = { key: [0], whippen: [1], jack: [1, 2], rep: [1, 3], hammer: [4] };
const BI: Record<Body, number> = { key: 0, whippen: 1, jack: 2, rep: 3, hammer: 4 };

/** 摩擦のしきい値の速さ [m/s]（論文の図 2.7 の例の値）と、軸の摩擦のしきい値の角速度 [rad/s]（論文に記載なし） */
const VT = 1e-5;
const WT = 1e-3;

/* ---------- 整調 ---------- */
/** 整調の値 [m]。spring はレペティションのばねの倍率 */
export interface Reg {
  dip: number;
  blow: number;
  letoff: number;
  drop: number;
  check: number;
  spring: number;
}
export const REG0: Reg = { dip: 0.01, blow: 0.048, letoff: 0.002, drop: 0.003, check: 0.015, spring: 1 };

/** 整調で動かす地面の点（と鍵の上のバックチェック）。ほかの点は表のまま */
export interface Rig {
  /** フロントレールの山の中心の y・弦の y・レットオフボタンの下面の y・ドロップねじの中心の y [m] */
  front: number;
  str: number;
  button: number;
  dropY: number;
  /** バックチェックの面の点（鍵の座標） */
  check: V2;
  spring: number;
}

/* ---------- 姿勢 ---------- */
export interface Pose {
  /** 部品の原点と角度 */
  o: Record<Body, V2>;
  a: Record<Body, number>;
  /** 自由度ごとの軸の位置（地面） */
  piv: V2[];
}
const rot = (a: number, p: readonly [number, number]): V2 => {
  const c = Math.cos(a),
    s = Math.sin(a);
  return [c * p[0] - s * p[1], s * p[0] + c * p[1]];
};
export function pose(q: ArrayLike<number>): Pose {
  const w2 = rot(q[1], PW2),
    w3 = rot(q[1], PW3);
  const jo: V2 = [PG2[0] + w2[0], PG2[1] + w2[1]],
    ro: V2 = [PG2[0] + w3[0], PG2[1] + w3[1]];
  return {
    o: { key: [PG1[0], PG1[1]], whippen: [PG2[0], PG2[1]], jack: jo, rep: ro, hammer: [PG3[0], PG3[1]] },
    a: { key: q[0], whippen: q[1], jack: q[1] + q[2], rep: q[1] + q[3], hammer: q[4] },
    piv: [[PG1[0], PG1[1]], [PG2[0], PG2[1]], jo, ro, [PG3[0], PG3[1]]],
  };
}
/** 部品の座標の点を地面の座標へ */
export function gp(P: Pose, b: Body, p: readonly [number, number]): V2 {
  const r = rot(P.a[b], p);
  return [P.o[b][0] + r[0], P.o[b][1] + r[1]];
}

/* ---------- 接触の形 ---------- */
interface WFeat {
  t: Feature['t'];
  b: Owner;
  p: V2;
  r: number;
  n: V2;
  a0: number;
  a1: number;
}
function feat(P: Pose, name: string, rig: Rig): WFeat {
  const { b, f } = FEAT[name];
  let fp: readonly [number, number] = f.p;
  if (name === 'Pg4') fp = [f.p[0], rig.front];
  else if (name === 'Pg9') fp = [f.p[0], rig.str];
  else if (name === 'Pg6') fp = [f.p[0], rig.button];
  else if (name === 'Pg7') fp = [f.p[0], rig.dropY];
  else if (name === 'Pk6') fp = rig.check;
  const ang = b === 'ground' ? 0 : P.a[b];
  const p: V2 = b === 'ground' ? [fp[0], fp[1]] : gp(P, b, fp);
  return {
    t: f.t,
    b,
    p,
    r: f.t === 'line' ? 0 : f.r,
    n: f.t === 'line' ? rot(ang, f.n) : [0, 0],
    a0: f.t === 'hybrid' ? f.a0 + ang : 0,
    a1: f.t === 'hybrid' ? f.a1 + ang : 0,
  };
}
export interface Touch {
  /** 食い込み [m]（負なら離れている）・面から円へ向かう法線・接点・面の側と円の側の部品 */
  pen: number;
  n: V2;
  x: V2;
  sb: Owner;
  cb: Owner;
}
/** 接触の食い込みと向き */
export function touch(P: Pose, c: ContactDef, rig: Rig): Touch {
  const f1 = feat(P, c.p[0], rig),
    f2 = feat(P, c.p[1], rig);
  const [S, K] = f1.t !== 'circle' || f2.t === 'circle' ? [f1, f2] : [f2, f1];
  let pen: number, n: V2;
  if (S.t === 'circle') {
    const dx = K.p[0] - S.p[0],
      dy = K.p[1] - S.p[1],
      L = Math.hypot(dx, dy) || 1e-12;
    n = [dx / L, dy / L];
    pen = S.r + K.r - L;
  } else if (S.t === 'line') {
    n = S.n;
    pen = K.r - (n[0] * (K.p[0] - S.p[0]) + n[1] * (K.p[1] - S.p[1]));
  } else {
    const dx = K.p[0] - S.p[0],
      dy = K.p[1] - S.p[1];
    const mid = (S.a0 + S.a1) / 2,
      half = (S.a1 - S.a0) / 2;
    let d = Math.atan2(dy, dx) - mid;
    d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
    if (Math.abs(d) <= half) {
      const L = Math.hypot(dx, dy) || 1e-12;
      n = [dx / L, dy / L];
      pen = S.r + K.r - L;
    } else {
      const ae = d > 0 ? S.a1 : S.a0;
      n = [Math.cos(ae), Math.sin(ae)];
      const ex = S.p[0] + S.r * n[0],
        ey = S.p[1] + S.r * n[1];
      pen = K.r - (n[0] * (K.p[0] - ex) + n[1] * (K.p[1] - ey));
    }
  }
  return { pen, n, x: [K.p[0] - K.r * n[0], K.p[1] - K.r * n[1]], sb: S.b, cb: K.b };
}

/* ---------- 整調から点の位置を決める ---------- */
const bisect = (f: (x: number) => number, lo: number, hi: number, it = 60): number => {
  let flo = f(lo);
  for (let i = 0; i < it; i++) {
    const m = (lo + hi) / 2,
      fm = f(m);
    if (fm === 0) return m;
    if (fm > 0 === flo > 0) {
      lo = m;
      flo = fm;
    } else hi = m;
  }
  return (lo + hi) / 2;
};
const HEAD = FEAT.Ph4.f as { p: readonly [number, number]; r: number };
/** ハンマーの頭と弦の間 [m] */
export function headGap(P: Pose, str: number): number {
  return str - gp(P, 'hammer', HEAD.p)[1] - HEAD.r;
}
const BASE: Rig = {
  front: FEAT.Pg4.f.p[1],
  str: FEAT.Pg9.f.p[1],
  button: FEAT.Pg6.f.p[1],
  dropY: FEAT.Pg7.f.p[1],
  check: [FEAT.Pk6.f.p[0], FEAT.Pk6.f.p[1]],
  spring: 1,
};
const CT = (n: number) => CONTACTS[n - 1];

/**
 * 整調の値から点の位置を決める。静止の姿勢 q0 と、ゆっくり押したときの姿勢
 * （ジャックはジャックの止め、レペティションはねじに当てたまま、ジャックの角がナックルを支える）で合わせる
 */
export function rigOf(reg: Reg, q0: ArrayLike<number>): Rig {
  const rig: Rig = { ...BASE, check: [...BASE.check] as V2, spring: reg.spring };
  const P0 = pose(q0);
  /* 打弦距離: 静止のハンマーの頭から弦まで */
  rig.str = gp(P0, 'hammer', HEAD.p)[1] + HEAD.r + reg.blow;
  /* ハンマーが弦から g のときの姿勢 */
  const at = (g: number) => {
    const h = bisect((a) => headGap(pose([q0[0], q0[1], q0[2], q0[3], a]), rig.str) - g, q0[4] - 0.8, q0[4]);
    const w = bisect((a) => touch(pose([q0[0], a, q0[2], q0[3], h]), CT(7), rig).pen, q0[1], q0[1] + 0.3);
    return pose([q0[0], w, q0[2], q0[3], h]);
  };
  /* レットオフ: ジャックのつま先がボタンに触れるとき */
  const Pl = at(reg.letoff);
  const toe = FEAT.Pj3.f as { p: readonly [number, number]; r: number };
  rig.button = gp(Pl, 'jack', toe.p)[1] + toe.r;
  /* ドロップ: レペティションの面がドロップねじに触れるとき */
  const Pd = at(reg.drop);
  const r5 = FEAT.Pr5.f as { p: readonly [number, number]; n: readonly [number, number] };
  const p5 = gp(Pd, 'rep', r5.p),
    n5 = rot(Pd.a.rep, r5.n),
    dr = (FEAT.Pg7.f as { r: number }).r,
    x0 = FEAT.Pg7.f.p[0];
  rig.dropY = p5[1] + (dr - n5[0] * (x0 - p5[0])) / n5[1];
  /* 鍵の深さ: 鍵の前（力をかける点）が dip 下がったとき、前の面がフロントレールの山に触れる */
  const y2 = gp(P0, 'key', PK2)[1];
  const kb = bisect((a) => y2 - gp(pose([a, q0[1], q0[2], q0[3], q0[4]]), 'key', PK2)[1] - reg.dip, q0[0] - 0.1, q0[0]);
  const Pk = pose([kb, q0[1], q0[2], q0[3], q0[4]]);
  const k4 = FEAT.Pk4.f as { p: readonly [number, number]; n: readonly [number, number] };
  const p4 = gp(Pk, 'key', k4.p),
    n4 = rot(kb, k4.n),
    fr = (FEAT.Pg4.f as { r: number }).r;
  rig.front = p4[1] + (fr - n4[0] * (FEAT.Pg4.f.p[0] - p4[0])) / n4[1];
  /* バックチェック: 鍵が底にあり、ハンマーが弦から check のとき、尾が面に触れる */
  const hc = bisect((a) => headGap(pose([kb, q0[1], q0[2], q0[3], a]), rig.str) - reg.check, q0[4] - 0.8, q0[4]);
  const Pc = pose([kb, q0[1], q0[2], q0[3], hc]);
  const tail = FEAT.Ph3.f as { p: readonly [number, number]; r: number };
  const k6 = FEAT.Pk6.f as { p: readonly [number, number]; n: readonly [number, number] };
  const c = gp(Pc, 'hammer', tail.p),
    p6 = gp(Pc, 'key', k6.p),
    n6 = rot(kb, k6.n);
  const shift = n6[0] * (c[0] - p6[0]) + n6[1] * (c[1] - p6[1]) - tail.r;
  rig.check = [k6.p[0] + shift * k6.n[0], k6.p[1] + shift * k6.n[1]];
  return rig;
}

/* ---------- 運動方程式 ---------- */
const poly = (c: ContactDef, x: number) => (x > 0 ? ((c.a * x + c.b) * x + c.c) * x : 0);
function mu(c: ContactDef, s: number): [number, number] {
  const u = s / VT,
    th = Math.tanh(u),
    d = 1 + c.B2 * u ** 4;
  const m = c.A * (th + (c.B1 * u) / d);
  const dm = (c.A / VT) * (1 - th * th + (c.B1 * (1 - 3 * c.B2 * u ** 4)) / (d * d));
  return [m, dm];
}

/** 5 × 5 の連立 1 次方程式（部分ピボット選択のガウスの消去法）。A は壊す */
function solve(A: Float64Array, b: Float64Array, x: Float64Array): void {
  for (let k = 0; k < N; k++) {
    let p = k;
    for (let i = k + 1; i < N; i++) if (Math.abs(A[i * N + k]) > Math.abs(A[p * N + k])) p = i;
    if (p !== k) {
      for (let j = 0; j < N; j++) {
        const t = A[k * N + j];
        A[k * N + j] = A[p * N + j];
        A[p * N + j] = t;
      }
      const t = b[k];
      b[k] = b[p];
      b[p] = t;
    }
    for (let i = k + 1; i < N; i++) {
      const f = A[i * N + k] / A[k * N + k];
      for (let j = k; j < N; j++) A[i * N + j] -= f * A[k * N + j];
      b[i] -= f * b[k];
    }
  }
  for (let i = N - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < N; j++) s -= A[i * N + j] * x[j];
    x[i] = s / A[i * N + i];
  }
}

/** 一歩ぶんの力の計算の結果 */
interface Eval {
  /** 一般化力・質量行列・速さの比例の係数の行列 */
  Q: Float64Array;
  M: Float64Array;
  C: Float64Array;
  /** 接触の法線の力 [N] */
  fn: Float64Array;
}

export class Action {
  q = new Float64Array(N);
  qd = new Float64Array(N);
  t = 0;
  /** 鍵の前にかける力 [N]（下向きが正） */
  force = 0;
  rig: Rig;
  private readonly e: Eval = {
    Q: new Float64Array(N),
    M: new Float64Array(N * N),
    C: new Float64Array(N * N),
    fn: new Float64Array(CONTACTS.length),
  };
  private readonly A = new Float64Array(N * N);
  private readonly b = new Float64Array(N);
  private readonly x = new Float64Array(N);

  constructor(rig: Rig, q0: ArrayLike<number> = Q_FIG) {
    this.rig = rig;
    this.q.set(q0);
  }

  /** 接触の法線の力 [N]（直前の一歩） */
  get fn(): Float64Array {
    return this.e.fn;
  }

  private forces(): void {
    const { q, qd, rig } = this;
    const { Q, M, C, fn } = this.e;
    Q.fill(0);
    M.fill(0);
    C.fill(0);
    const P = pose(q);
    /* 自由度ごとの軸の速さ（ジャックとレペティションの軸はウィッペンと動く） */
    const vp: V2[] = P.piv.map((v, i) =>
      i === 2 || i === 3 ? [-(v[1] - PG2[1]) * qd[1], (v[0] - PG2[0]) * qd[1]] : [0, 0],
    );
    /* 点 x が部品 b とともに動く速さ */
    const vel = (b: Owner, x: V2): V2 => {
      if (b === 'ground') return [0, 0];
      let vx = 0,
        vy = 0;
      for (const i of DOFS[b]) {
        vx -= (x[1] - P.piv[i][1]) * qd[i];
        vy += (x[0] - P.piv[i][0]) * qd[i];
      }
      return [vx, vy];
    };
    /* 点 x に力 F をかけたときの一般化力（軸のまわりのトルク） */
    const push = (b: Owner, x: V2, fx: number, fy: number) => {
      if (b === 'ground') return;
      for (const i of DOFS[b]) Q[i] += (x[0] - P.piv[i][0]) * fy - (x[1] - P.piv[i][1]) * fx;
    };
    /* 向き e の相対の速さの、一般化速度に対する係数 */
    const jrow = new Float64Array(N);
    const rel = (b1: Owner, b2: Owner, x: V2, e: V2) => {
      jrow.fill(0);
      const add = (b: Owner, sg: number) => {
        if (b === 'ground') return;
        for (const i of DOFS[b]) jrow[i] += sg * (-(x[1] - P.piv[i][1]) * e[0] + (x[0] - P.piv[i][0]) * e[1]);
      };
      add(b1, 1);
      add(b2, -1);
    };
    const damp = (c: number) => {
      if (!(c > 0)) return;
      for (let i = 0; i < N; i++) if (jrow[i]) for (let j = 0; j < N; j++) C[i * N + j] += c * jrow[i] * jrow[j];
    };

    /* 慣性・重力 */
    for (const b of BODIES) {
      const { m, I, cm } = MASS[b];
      const c = gp(P, b, cm);
      const ds = DOFS[b];
      const J = ds.map((i): V2 => [-(c[1] - P.piv[i][1]), c[0] - P.piv[i][0]]);
      for (let u = 0; u < ds.length; u++)
        for (let v = 0; v < ds.length; v++) M[ds[u] * N + ds[v]] += m * (J[u][0] * J[v][0] + J[u][1] * J[v][1]) + I;
      /* 速さの積の項 h = Σ q̇i perp(v_cm − v_軸i) */
      const v = vel(b, c);
      let hx = 0,
        hy = 0;
      for (const i of ds) {
        hx -= (v[1] - vp[i][1]) * qd[i];
        hy += (v[0] - vp[i][0]) * qd[i];
      }
      for (let u = 0; u < ds.length; u++) Q[ds[u]] -= m * (J[u][0] * hx + J[u][1] * hy) + m * G * J[u][1];
    }
    /* ばね */
    Q[2] += JACK_T;
    Q[3] -= REP_K * rig.spring * (q[3] - REP_TH0);
    /* 軸の摩擦 */
    for (let i = 0; i < N; i++) {
      const A = JOINT_A[BODIES[i]],
        th = Math.tanh(qd[i] / WT);
      Q[i] -= A * th;
      C[i * N + i] += (A / WT) * (1 - th * th);
    }
    /* 鍵の前の力 */
    push('key', gp(P, 'key', PK2), 0, -this.force);
    /* 接触 */
    for (let k = 0; k < CONTACTS.length; k++) {
      const c = CONTACTS[k];
      const T = touch(P, c, rig);
      if (T.pen <= 0) {
        fn[k] = 0;
        continue;
      }
      const vc = vel(T.cb, T.x),
        vs = vel(T.sb, T.x);
      const vr: V2 = [vc[0] - vs[0], vc[1] - vs[1]];
      const xd = -(T.n[0] * vr[0] + T.n[1] * vr[1]);
      const f0 = poly(c, T.pen);
      const f = Math.max(0, f0 * (1 + c.D * xd));
      fn[k] = f;
      let fx = f * T.n[0],
        fy = f * T.n[1];
      if (f0 * (1 + c.D * xd) > 0) {
        rel(T.cb, T.sb, T.x, T.n);
        damp(f0 * c.D);
      }
      if (c.A > 0 && f > 0) {
        const t: V2 = [-T.n[1], T.n[0]];
        const s = t[0] * vr[0] + t[1] * vr[1];
        const [m, dm] = mu(c, s);
        fx -= m * f * t[0];
        fy -= m * f * t[1];
        rel(T.cb, T.sb, T.x, t);
        damp(f * Math.max(0, dm));
      }
      push(T.cb, T.x, fx, fy);
      push(T.sb, T.x, -fx, -fy);
    }
  }

  /** dt [s] だけ進める */
  step(dt: number): void {
    this.forces();
    const { Q, M, C } = this.e;
    const { A, b, x, q, qd } = this;
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let j = 0; j < N; j++) {
        A[i * N + j] = M[i * N + j] + dt * C[i * N + j];
        s += (M[i * N + j] + dt * C[i * N + j]) * qd[j];
      }
      b[i] = s + dt * Q[i];
    }
    solve(A, b, x);
    for (let i = 0; i < N; i++) {
      qd[i] = x[i];
      q[i] += dt * x[i];
    }
    this.t += dt;
  }
}

/** 部品の番号 */
export { BI };
