/**
 * 線に沿った 1 次元の過渡計算。陰解法（三重対角）で、発熱・放熱・線の中の熱伝導を解く。
 * 経路があれば、近くの区間の放射を受け取り、下の区間が温めた空気で上の区間の対流が減る
 */
import { airField, pointPlume, type Src } from './plume';
import {
  acFactor,
  currentFor,
  type Geom,
  geomOf,
  type Loss,
  lossTable,
  MAT,
  type Mat,
  type Path,
  rhoAt,
  skinDepth,
  steadyInf,
  type WireIn,
} from './wire';

/** 熱の内訳 [W]（その時刻の全長の合計） */
export interface Bal {
  gen: number;
  conv: number;
  rad: number;
  term: number;
}
export interface WireSim {
  N: number;
  len: number;
  dx: number;
  g: Geom;
  m: Mat;
  L: Loss;
  Ta: number;
  path: Path | null;
  /** 時定数 [s]（気温の近くでの傾きから） */
  tau: number;
  times: number[];
  frames: Float32Array[];
  bal: Bal[];
  /** 融点に届いた時刻。届かなければ null */
  tMelt: number | null;
  /** 溶けて切れた所（区間 cut と cut + 1 の間）。切れなければ null */
  cut: number | null;
  /** 電流を止めた時刻（パルスの終わりか溶断）。止めなければ null */
  tOff: number | null;
  /** 長い線の中ほどの定常の温度。溶けるなら null */
  Tss: number | null;
  /** 温度上昇 30 K の電流と、溶断する電流（長い線の中ほど） */
  I30: number;
  Imelt: number;
  /** 20 °C の交流抵抗の倍率と表皮の深さ */
  ac20: number;
  delta: number;
  /** 温度の列から全長の抵抗 [Ω] */
  R(T: ArrayLike<number>): number;
}

/** 経路の区間ごとのプルーム（温度 T の列から） */
export function pathPlumes(path: Path, L: Loss, dx: number, Ta: number, T: ArrayLike<number>): Src[] {
  const out: Src[] = [];
  for (let i = 0; i < path.pts.length; i++) {
    const dTs = L.ts(T[i]) - Ta;
    out.push({ x: path.pts[i][0], y: path.pts[i][1], dTs, f: pointPlume(L.qc(T[i]) * dx, dTs, Ta) });
  }
  return out;
}

export function wireSim(o: WireIn): WireSim {
  const m = MAT[o.mat],
    g = geomOf(o),
    L = lossTable(g, o),
    Ta = o.Ta,
    path = o.path ?? null;
  const N = path ? path.n : 60,
    len = path ? path.len : o.len,
    dx = len / N;
  const Cc = (m.d * m.c * g.A + g.Cins) * dx,
    G = (m.k * g.A) / dx,
    Gb = o.ends === 'sink' ? 2 * G : 0;
  /* 近くの区間から受け取る放射の割合（点の放射を投影面積で受けるとみなす。合計 45 % まで） */
  let M: Float32Array | null = null;
  if (path) {
    M = new Float32Array(N * N);
    const P = path.pts,
      D = g.Deq;
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let j = 0; j < N; j++) {
        if (Math.abs(i - j) < 3) continue;
        const r = Math.max(1.5 * D, Math.hypot(P[i][0] - P[j][0], P[i][1] - P[j][1])),
          f = (D * dx) / (4 * Math.PI * r * r);
        M[i * N + j] = f;
        s += f;
      }
      if (s > 0.45) for (let j = 0; j < N; j++) M[i * N + j] *= 0.45 / s;
    }
  }
  const tau = (m.d * m.c * g.A + g.Cins) / L.dq(Ta + 1);
  const pulse = o.mode === 'pulse' ? o.tp : Number.POSITIVE_INFINITY;
  /* 計算を打ち切る時刻。自動では、電流が止まった後は冷えて気温に戻るまで（時定数の 8 倍まで）追う */
  const span = o.span ?? 0,
    T_MAX = span > 0 ? span : 5400;
  /** 自動のとき計算を終える時刻。止める条件を満たした時刻の 1.5 倍（後の様子も見られるように） */
  let endAt: number | null = null;
  let T = new Float64Array(N).fill(Ta),
    t = 0,
    dt = Math.min(tau, pulse) / 600;
  const times = [0],
    frames = [Float32Array.from(T)],
    bal: Bal[] = [{ gen: 0, conv: 0, rad: 0, term: 0 }];
  const a = new Float64Array(N),
    b = new Float64Array(N),
    c = new Float64Array(N),
    r = new Float64Array(N),
    cp = new Float64Array(N),
    dp = new Float64Array(N);
  let tMelt: number | null = null,
    cutAt: number | null = null,
    steps = 0;
  /** 区間 i と i + 1 の間の熱伝導（切れた所は 0） */
  const Gl = (i: number) => (i === cutAt ? 0 : G);
  const tOffOf = () => (tMelt !== null ? Math.min(tMelt, pulse) : pulse < Number.POSITIVE_INFINITY ? pulse : null);
  const genAt = (Ti: number, I: number) => (I * I * rhoAt(m, Ti) * acFactor(g, rhoAt(m, Ti), o.f) * dx) / g.A;
  /* 記録は、時刻が 1 % 進むごと（と出来事の直後）に残す。長い観察でも枚数を抑える */
  let lastSnap = 0,
    held: { t: number; T: Float64Array; b: Bal } | null = null;
  const keep = (tt: number, Tt: Float64Array, b: Bal, force: boolean) => {
    if (!force && times.length > 60 && tt < lastSnap * 1.01) {
      held = { t: tt, T: Tt, b };
      return;
    }
    held = null;
    lastSnap = tt;
    times.push(tt);
    frames.push(Float32Array.from(Tt));
    bal.push(b);
  };
  while (t < T_MAX - 1e-9 && steps < 20000) {
    steps++;
    if (t < pulse && t + dt > pulse) dt = pulse - t;
    if (t + dt > T_MAX) dt = T_MAX - t;
    if (endAt !== null && t + dt > endAt) dt = endAt - t;
    const I = t < pulse && tMelt === null ? o.I : 0;
    let back: Float64Array | null = null,
      th: Float64Array | null = null;
    if (M && path) {
      back = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        let s = 0;
        for (let j = 0; j < N; j++) s += M[i * N + j] * L.qr(T[j]) * dx;
        back[i] = s;
      }
      const pl = pathPlumes(path, L, dx, Ta, T);
      th = new Float64Array(N);
      for (let i = 0; i < N; i++)
        th[i] = Math.min(airField(pl, path.pts[i][0], path.pts[i][1], i)[0], Math.max(0, T[i] - Ta));
    }
    /** 対流のうち、まわりの空気が温まって減った後に残る割合 */
    const cut = (i: number) => (th && T[i] > Ta + 1e-6 ? Math.max(0, 1 - th[i] / (T[i] - Ta)) : 1);
    for (let i = 0; i < N; i++) {
      const q = (L.qr(T[i]) + L.qc(T[i]) * cut(i)) * dx,
        dq = L.dq(T[i]) * dx;
      const gl = i === 0 ? Gb : Gl(i - 1),
        gr = i === N - 1 ? Gb : Gl(i);
      a[i] = i === 0 ? 0 : -gl;
      c[i] = i === N - 1 ? 0 : -gr;
      b[i] = Cc / dt + gl + gr + dq;
      r[i] =
        (Cc / dt) * T[i] +
        genAt(T[i], I) -
        q +
        dq * T[i] +
        (back ? back[i] : 0) +
        (i === 0 ? gl * Ta : 0) +
        (i === N - 1 ? gr * Ta : 0);
    }
    cp[0] = c[0] / b[0];
    dp[0] = r[0] / b[0];
    for (let i = 1; i < N; i++) {
      const den = b[i] - a[i] * cp[i - 1];
      cp[i] = c[i] / den;
      dp[i] = (r[i] - a[i] * dp[i - 1]) / den;
    }
    const Tn = new Float64Array(N);
    Tn[N - 1] = dp[N - 1];
    for (let i = N - 2; i >= 0; i--) Tn[i] = dp[i] - cp[i] * Tn[i + 1];
    let dmax = 0;
    for (let i = 0; i < N; i++) dmax = Math.max(dmax, Math.abs(Tn[i] - T[i]));
    /* 1 歩で 25 K より大きく動くなら刻みを半分にしてやり直す */
    if (dmax > 25 && dt > 1e-6) {
      dt /= 2;
      steps--;
      continue;
    }
    T = Tn;
    t += dt;
    let gen = 0,
      conv = 0,
      rad = 0,
      mx = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < N; i++) {
      gen += genAt(T[i], I);
      conv += L.qc(T[i]) * dx * cut(i);
      rad += L.qr(T[i]) * dx;
      mx = Math.max(mx, T[i]);
    }
    if (back) {
      let s = 0;
      for (let i = 0; i < N; i++) s += back[i];
      rad = Math.max(0, rad - s);
    }
    const term = Gb * (T[0] - Ta + T[N - 1] - Ta);
    /* 融点に届いたら、いちばん熱い所で切れて電流が止まる。そのあとも冷えるまで追う */
    const melt = mx >= m.mp && tMelt === null;
    keep(t, T, { gen, conv, rad, term }, melt || Math.abs(t - pulse) < 1e-12);
    if (melt) {
      tMelt = t;
      let im = 0;
      for (let i = 1; i < N; i++) if (T[i] > T[im]) im = i;
      cutAt = Math.min(im, N - 2);
      dt = Math.max(dt, tau / 400);
    }
    const tOff = tOffOf(),
      quiet = (dmax / dt) * tau < 0.02;
    if (span === 0) {
      const stop =
        tOff !== null && t > tOff ? mx < Ta + 0.3 || t > tOff + 8 * tau : tOff === null && t > 3 * tau && quiet;
      if (stop && endAt === null) endAt = Math.min(T_MAX, 1.5 * t);
      if (endAt !== null && t >= endAt - 1e-9) break;
    }
    /* ほとんど変わらなくなったら刻みを時定数の 2 倍まで伸ばす（長い観察のため） */
    dt = Math.min(
      dt * 1.04,
      quiet && t > 3 * tau ? 2 * tau : tau / 40,
      pulse < Number.POSITIVE_INFINITY && t < pulse ? pulse / 40 : Number.POSITIVE_INFINITY,
    );
  }
  if (held) {
    const h: { t: number; T: Float64Array; b: Bal } = held;
    keep(h.t, h.T, h.b, true);
  }
  const r20 = rhoAt(m, 20);
  return {
    N,
    len,
    dx,
    g,
    m,
    L,
    Ta,
    path,
    tau,
    times,
    frames,
    bal,
    tMelt,
    cut: cutAt,
    tOff: tOffOf(),
    Tss: steadyInf(o, g, L, o.I),
    I30: currentFor(o, g, L, Ta + 30),
    Imelt: currentFor(o, g, L, m.mp),
    ac20: acFactor(g, r20, o.f),
    delta: skinDepth(r20, o.f),
    R(Tl) {
      let s = 0;
      for (let i = 0; i < N; i++) s += (rhoAt(m, Tl[i]) * acFactor(g, rhoAt(m, Tl[i]), o.f) * dx) / g.A;
      return s;
    },
  };
}
