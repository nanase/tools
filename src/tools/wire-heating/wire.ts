/**
 * 配線の発熱の線（1 次元）の計算。抵抗の温度変化・表皮効果・空気の対流・放射・端子への伝導を入れ、
 * 線に沿った温度の時間変化を陰解法で解く
 */

export const SIG = 5.670374e-8;
export const GRAV = 9.81;
export const K0 = 273.15;
const MU0 = 4e-7 * Math.PI;

export type MatId = 'cu' | 'al' | 'ag' | 'au' | 'fe' | 'nc' | 'w';
/** 20 °C の値。rho 抵抗率 [Ω·m]・a 温度係数 [1/K]・d 密度 [kg/m³]・c 比熱 [J/(kg·K)]・k 熱伝導率 [W/(m·K)]・mp 融点 [°C] */
export interface Mat {
  n: string;
  rho: number;
  a: number;
  d: number;
  c: number;
  k: number;
  mp: number;
}
export const MAT: Record<MatId, Mat> = {
  cu: { n: '銅', rho: 1.68e-8, a: 3.93e-3, d: 8960, c: 385, k: 401, mp: 1085 },
  al: { n: 'アルミニウム', rho: 2.65e-8, a: 4.29e-3, d: 2700, c: 897, k: 237, mp: 660 },
  ag: { n: '銀', rho: 1.59e-8, a: 3.8e-3, d: 10490, c: 235, k: 429, mp: 962 },
  au: { n: '金', rho: 2.24e-8, a: 3.4e-3, d: 19300, c: 129, k: 318, mp: 1064 },
  fe: { n: '鉄', rho: 9.7e-8, a: 6.5e-3, d: 7874, c: 449, k: 80, mp: 1538 },
  nc: { n: 'ニクロム', rho: 1.1e-6, a: 0.4e-3, d: 8400, c: 450, k: 11.3, mp: 1400 },
  w: { n: 'タングステン', rho: 5.6e-8, a: 4.5e-3, d: 19300, c: 132, k: 173, mp: 3422 },
};
export type SurfId = 'bright' | 'oxid' | 'pvc';
export const SURF: Record<SurfId, { n: string; e: number }> = {
  bright: { n: '光沢', e: 0.05 },
  oxid: { n: '酸化', e: 0.6 },
  pvc: { n: '被覆', e: 0.9 },
};
/** 被覆（PVC）。t 厚さ [m]・k 熱伝導率・dc 体積比熱 [J/(m³·K)]・lim 耐熱 [°C] */
export const PVC = { t: 0.4e-3, k: 0.19, dc: 1400 * 900, lim: 105 };

/** 温度 T [°C] の抵抗率。温度係数で直線に伸ばす */
export const rhoAt = (m: Mat, T: number): number => m.rho * Math.max(0.05, 1 + m.a * (T - 20));

/** 乾いた空気（1 気圧）の物性。Tf [K] */
export function air(Tf: number): { k: number; nu: number; al: number; Pr: number } {
  const k = 0.0241 * (Tf / K0) ** 0.81,
    nu = 1.33e-5 * (Tf / K0) ** 1.75;
  return { k, nu, al: nu / 0.71, Pr: 0.71 };
}
/** 横置きの円柱の熱伝達率 [W/(m²·K)]。自然対流は Churchill–Chu、風は Churchill–Bernstein、合わせ方は 3 乗和 */
export function hCyl(D: number, Ts: number, Ta: number, v: number): number {
  const Tf = (Ts + Ta) / 2 + K0,
    A = air(Tf),
    dT = Math.abs(Ts - Ta);
  const Ra = ((GRAV / Tf) * dT * D ** 3) / (A.nu * A.al);
  const Nn = (0.6 + (0.387 * Ra ** (1 / 6)) / (1 + (0.559 / A.Pr) ** (9 / 16)) ** (8 / 27)) ** 2;
  let Nu = Nn;
  if (v > 0) {
    const Re = (v * D) / A.nu,
      Nf =
        0.3 +
        ((0.62 * Re ** 0.5 * A.Pr ** (1 / 3)) / (1 + (0.4 / A.Pr) ** (2 / 3)) ** 0.25) *
          (1 + (Re / 282000) ** 0.625) ** 0.8;
    Nu = Math.cbrt(Nf ** 3 + Nn ** 3);
  }
  return (Nu * A.k) / D;
}

/* ---------- 表皮効果 ---------- */
/** 第 1 種 Bessel 関数 J_n(z) の複素数版（級数）。z = zr + i zi */
export function besselC(n: number, zr: number, zi: number): [number, number] {
  const hr = zr / 2,
    hi = zi / 2;
  let tr = 1,
    ti = 0;
  for (let k = 0; k < n; k++) {
    const r = tr * hr - ti * hi;
    ti = tr * hi + ti * hr;
    tr = r;
  }
  let f = 1;
  for (let k = 2; k <= n; k++) f *= k;
  tr /= f;
  ti /= f;
  const qr = hr * hr - hi * hi,
    qi = 2 * hr * hi;
  let sr = 0,
    si = 0;
  for (let k = 0; k < 400; k++) {
    sr += tr;
    si += ti;
    const d = (k + 1) * (k + 1 + n),
      r = -(tr * qr - ti * qi) / d;
    ti = -(tr * qi + ti * qr) / d;
    tr = r;
    if (Math.abs(tr) + Math.abs(ti) < 1e-17 * (Math.abs(sr) + Math.abs(si))) break;
  }
  return [sr, si];
}
/** 表皮の深さ [m]。直流（f = 0）は Infinity */
export const skinDepth = (rho: number, f: number): number =>
  f > 0 ? Math.sqrt(rho / (Math.PI * f * MU0)) : Number.POSITIVE_INFINITY;

export type Shape = { shape: 'round'; d: number } | { shape: 'rect'; w: number; t: number };
/** 交流抵抗の倍率。丸線は Bessel 関数の厳密解、角線は縁から実効厚さの帯に電流が流れるとみなす */
export function acFactor(g: Shape, rho: number, f: number): number {
  const dl = skinDepth(rho, f);
  if (!Number.isFinite(dl)) return 1;
  if (g.shape === 'round') {
    const a = g.d / 2,
      x = a / dl;
    if (x < 0.05) return 1;
    if (x > 18) return x / 2 + 0.25 + 3 / (32 * x);
    /* k a = (1 − i) a / δ。Z = (1 − i)/δ · ρ / (2π a) · J0/J1、Rdc = ρ / (π a²) */
    const [j0r, j0i] = besselC(0, x, -x),
      [j1r, j1i] = besselC(1, x, -x);
    const den = j1r * j1r + j1i * j1i,
      qr = (j0r * j1r + j0i * j1i) / den,
      qi = (j0i * j1r - j0r * j1i) / den;
    return ((qr + qi) * a) / (2 * dl);
  }
  const de = (s: number) => dl * (1 - Math.exp(-s / 2 / dl));
  const dw = de(g.w),
    dt = de(g.t),
    Ae = g.w * g.t - Math.max(0, g.w - 2 * dw) * Math.max(0, g.t - 2 * dt);
  return (g.w * g.t) / Math.max(Ae, 1e-30);
}
/** 丸線の断面の電流密度の大きさ |J(r)| / |J(a)| */
export function roundJ(a: number, dl: number, r: number): number {
  if (!Number.isFinite(dl) || a / dl < 0.05) return 1;
  const x = a / dl;
  if (x > 18) return Math.exp(-(a - r) / dl) * Math.sqrt(a / Math.max(r, 1e-9));
  const m = (u: number) => {
    const [p, q] = besselC(0, u, -u);
    return Math.hypot(p, q);
  };
  return m(r / dl) / m(x);
}

/* ---------- 断面と放熱 ---------- */
export interface WireIn {
  mat: MatId;
  shape: 'round' | 'rect';
  /** 直径・幅・厚さ [m] */
  d: number;
  w: number;
  t: number;
  /** 長さ [m]（経路があれば経路の長さを使う） */
  len: number;
  surf: SurfId;
  /** 端子: sink は気温に固定、free は断熱 */
  ends: 'sink' | 'free';
  /** 電流の実効値 [A]、周波数 [Hz]（0 は直流） */
  I: number;
  f: number;
  /** 通電: cont は連続、pulse は幅 tp [s] のパルス */
  mode: 'cont' | 'pulse';
  tp: number;
  /** 観察時間 [s]。0 は自動（定常になるか気温へ戻った時刻の 1.5 倍まで） */
  span?: number;
  /** 気温 [°C]、風速 [m/s] */
  Ta: number;
  wind: number;
  path?: Path;
}
export type Geom = Shape & {
  A: number;
  p: number;
  ins: number;
  pOut: number;
  Deq: number;
  Rins: number;
  Cins: number;
};
/** 断面と表面。pOut は空気に触れる外周、Deq はその相当直径 */
export function geomOf(o: WireIn): Geom {
  const base: Shape & { A: number; p: number } =
    o.shape === 'round'
      ? { shape: 'round', d: o.d, A: (Math.PI * o.d * o.d) / 4, p: Math.PI * o.d }
      : { shape: 'rect', w: o.w, t: o.t, A: o.w * o.t, p: 2 * (o.w + o.t) };
  const ins = o.surf === 'pvc' ? PVC.t : 0;
  const pOut = base.shape === 'round' ? Math.PI * (base.d + 2 * ins) : 2 * (base.w + base.t + 4 * ins);
  const Deq = pOut / Math.PI;
  const Rins = !ins
    ? 0
    : base.shape === 'round'
      ? Math.log((base.d / 2 + ins) / (base.d / 2)) / (2 * Math.PI * PVC.k)
      : ins / ((PVC.k * (base.p + pOut)) / 2);
  const Cins = !ins ? 0 : PVC.dc * ((Deq / 2) ** 2 * Math.PI - base.A);
  return { ...base, ins, pOut, Deq, Rins, Cins };
}
export interface Loss {
  /** 導体の温度 → 長さあたりの放熱 [W/m]（全体・対流・放射）と表面の温度 */
  q(T: number): number;
  qc(T: number): number;
  qr(T: number): number;
  ts(T: number): number;
  /** q の傾き */
  dq(T: number): number;
}
/** 導体の温度ごとの放熱の表を作る。被覆があれば表面の温度を二分法で求める */
export function lossTable(g: Geom, o: WireIn): Loss {
  const e = SURF[o.surf].e,
    Ta = o.Ta,
    n = 900,
    Tmax = Math.max(1600, MAT[o.mat].mp + 300),
    step = (Tmax - Ta) / n;
  const qc = new Float64Array(n + 1),
    qr = new Float64Array(n + 1),
    ts = new Float64Array(n + 1);
  const surf = (Ts: number): [number, number] => {
    const h = hCyl(g.Deq, Ts, Ta, o.wind);
    return [g.pOut * h * (Ts - Ta), g.pOut * e * SIG * ((Ts + K0) ** 4 - (Ta + K0) ** 4)];
  };
  for (let i = 0; i <= n; i++) {
    const Tc = Ta + i * step;
    let Ts = Tc;
    if (g.Rins > 0 && i > 0) {
      let lo = Ta,
        hi = Tc;
      for (let k = 0; k < 40; k++) {
        const m = (lo + hi) / 2,
          [c, r] = surf(m);
        if ((c + r) * g.Rins < Tc - m) lo = m;
        else hi = m;
      }
      Ts = (lo + hi) / 2;
    }
    const [c, r] = i ? surf(Ts) : [0, 0];
    qc[i] = c;
    qr[i] = r;
    ts[i] = Ts;
  }
  const at = (arr: Float64Array, T: number) => {
    const u = Math.max(0, Math.min(n - 1e-9, (T - Ta) / step)),
      i = Math.floor(u),
      f = u - i;
    return arr[i] + (arr[i + 1] - arr[i]) * f;
  };
  const q = (T: number) => at(qc, T) + at(qr, T);
  return {
    q,
    qc: (T) => at(qc, T),
    qr: (T) => at(qr, T),
    ts: (T) => at(ts, T),
    dq: (T) => (q(T + step) - q(T - step)) / (2 * step) || q(Ta + step) / step,
  };
}
/** 長さによらない定常の温度（長い線の中ほど）。融点の上まで発熱が放熱を上回るなら null */
export function steadyInf(o: WireIn, g: Geom, L: Loss, I: number): number | null {
  const m = MAT[o.mat],
    gen = (T: number) => (I * I * rhoAt(m, T) * acFactor(g, rhoAt(m, T), o.f)) / g.A;
  let a = o.Ta;
  for (let T = o.Ta + 2; T <= m.mp + 50; T += 2) {
    if (L.q(T) >= gen(T)) {
      let lo = a,
        hi = T;
      for (let k = 0; k < 40; k++) {
        const c = (lo + hi) / 2;
        if (L.q(c) >= gen(c)) hi = c;
        else lo = c;
      }
      return (lo + hi) / 2;
    }
    a = T;
  }
  return null;
}
/** 長い線の中ほどの定常の温度が T になる電流 */
export function currentFor(o: WireIn, g: Geom, L: Loss, T: number): number {
  const r = rhoAt(MAT[o.mat], T);
  return Math.sqrt((L.q(T) * g.A) / (r * acFactor(g, r, o.f)));
}

/* ---------- 経路 ---------- */
export interface Path {
  /** 区間の中点 [m]（y は下向き） */
  pts: [number, number][];
  len: number;
  n: number;
}
/** 制御点を Catmull–Rom でつなぎ、等間隔に n 点へ並べる */
export function pathOf(ctrl: readonly (readonly [number, number])[], n: number): Path {
  const dense: [number, number][] = [];
  for (let k = 0; k < ctrl.length - 1; k++) {
    const p0 = ctrl[Math.max(0, k - 1)],
      p1 = ctrl[k],
      p2 = ctrl[k + 1],
      p3 = ctrl[Math.min(ctrl.length - 1, k + 2)];
    for (let s = 0; s < 24; s++) {
      const u = s / 24,
        u2 = u * u,
        u3 = u2 * u;
      const f = (i: 0 | 1) =>
        0.5 *
        (2 * p1[i] +
          (-p0[i] + p2[i]) * u +
          (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * u2 +
          (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * u3);
      dense.push([f(0), f(1)]);
    }
  }
  const lastC = ctrl[ctrl.length - 1];
  dense.push([lastC[0], lastC[1]]);
  const acc = [0];
  for (let i = 1; i < dense.length; i++)
    acc.push(acc[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  const len = acc[acc.length - 1],
    pts: [number, number][] = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const s = ((i + 0.5) / n) * len;
    while (j < acc.length - 2 && acc[j + 1] < s) j++;
    const u = (s - acc[j]) / (acc[j + 1] - acc[j] || 1);
    pts.push([dense[j][0] + (dense[j + 1][0] - dense[j][0]) * u, dense[j][1] + (dense[j + 1][1] - dense[j][1]) * u]);
  }
  return { pts, len, n };
}
