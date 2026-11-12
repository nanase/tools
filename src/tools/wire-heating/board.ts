/**
 * 基板の銅箔の発熱（2 次元の格子）。銅箔の電位を解いて電流の分布と発熱を求め、
 * 銅箔と基材（FR-4）の面内の熱伝導と両面からの放熱で温度を進める。どちらも Gauss–Seidel（SOR）
 */
import { K0, MAT, rhoAt, SIG, skinDepth } from './wire';

/** 格子は 30 × 18 mm を 0.25 mm 角に分ける。kF・dcF は基材の熱伝導率と体積比熱、e は両面の放射率、tg はガラス転移温度 */
export const BD = { NX: 120, NY: 72, dx: 0.25e-3, kF: 0.3, dcF: 1850 * 1000, e: 0.9, tg: 130 } as const;
export type Pattern = 'line' | 'neck' | 'corner' | 'meander';

export interface BoardIn {
  kind: Pattern;
  /** 配線の幅 [mm] */
  w: number;
  /** 銅箔の厚さ・基板の厚さ [m] */
  tcu: number;
  tb: number;
  Ta: number;
  /** 電流の実効値 [A]、周波数 [Hz] */
  I: number;
  f: number;
  /** 通電: cont は連続、pulse は幅 tp [s] のパルス */
  mode: 'cont' | 'pulse';
  tp: number;
  /** 観察時間 [s]。0 は自動 */
  span?: number;
}

/** 銅箔の形。座標は mm で、軸に沿った線分を幅 w の四角で塗る（角は四角）。左右の端に 3.5 × 4 mm のパッド */
export function boardMask(kind: Pattern, w: number): { cu: Uint8Array; fix: Int8Array } {
  const { NX, NY } = BD,
    mm = BD.dx * 1e3,
    cu = new Uint8Array(NX * NY),
    fix = new Int8Array(NX * NY);
  const rect = (x0: number, y0: number, x1: number, y1: number) => {
    for (let j = Math.max(0, Math.round(y0 / mm)); j < Math.min(NY, Math.round(y1 / mm)); j++)
      for (let i = Math.max(0, Math.round(x0 / mm)); i < Math.min(NX, Math.round(x1 / mm)); i++) cu[j * NX + i] = 1;
  };
  const seg = (a: number[], b: number[], ww = w) =>
    rect(
      Math.min(a[0], b[0]) - ww / 2,
      Math.min(a[1], b[1]) - ww / 2,
      Math.max(a[0], b[0]) + ww / 2,
      Math.max(a[1], b[1]) + ww / 2,
    );
  const pl = (ps: number[][], ww = w) => {
    for (let k = 0; k < ps.length - 1; k++) seg(ps[k], ps[k + 1], ww);
  };
  let yl = 9,
    yr = 9;
  if (kind === 'line')
    pl([
      [3, 9],
      [27, 9],
    ]);
  else if (kind === 'neck') {
    pl([
      [3, 9],
      [13, 9],
    ]);
    pl([
      [17, 9],
      [27, 9],
    ]);
    pl(
      [
        [12.5, 9],
        [17.5, 9],
      ],
      Math.max(0.25, Math.round(w / 3 / 0.25) * 0.25),
    );
  } else if (kind === 'corner') {
    yl = 4;
    yr = 14;
    pl([
      [3, 4],
      [15, 4],
      [15, 14],
      [27, 14],
    ]);
  } else {
    const gap = Math.max(1.5, 3 * w),
      ps = [
        [3, 9],
        [7, 9],
      ];
    let x = 7,
      up = true;
    while (x + gap <= 23.01) {
      ps.push([x, up ? 3 : 15]);
      x += gap;
      ps.push([x, up ? 3 : 15]);
      up = !up;
    }
    ps.push([x, 9], [27, 9]);
    pl(ps);
  }
  rect(0.5, yl - 2, 4, yl + 2);
  rect(26, yr - 2, 29.5, yr + 2);
  for (let j = 0; j < NY; j++)
    for (let i = 0; i < NX; i++) {
      const k = j * NX + i;
      if (!cu[k]) continue;
      const x = (i + 0.5) * mm;
      if (x < 1.5) fix[k] = 1;
      else if (x > 28.5) fix[k] = -1;
    }
  return { cu, fix };
}

export interface BoardSim {
  t: number;
  done: boolean;
  times: number[];
  frames: Float32Array[];
  /** パッドの間の抵抗 [Ω]・流れている電流 [A]・最高温度・熱の内訳（各時刻） */
  R: number[];
  Ion: number[];
  maxT: number[];
  bal: { gen: number; conv: number; rad: number; term: number }[];
  /** 初めの銅箔と、その升の番号 */
  cu: Uint8Array;
  idx: Int32Array;
  /** 升が溶けた時刻（溶けていなければ Infinity） */
  cutAt: Float64Array;
  /** パッドの間が切れた時刻と、電流を止めた時刻（パルスの終わりか切断）。どちらもなければ null */
  tOpen: number | null;
  tOff: number | null;
  /** 電圧 1 V をかけたときの電位と、各升の面の導電率 [S]（今の温度で） */
  V: Float64Array;
  sq: Float64Array;
  /** 表皮の深さと、電流が流れる実効の厚さ [m] */
  dl: number;
  tEff: number;
  /** 予算 [ms] の分だけ進める。終わったら true */
  step(budget: number, now?: () => number): boolean;
}

/** 計算を打ち切る時刻 [s]。電流が止まった後は、冷えるまで（止めてから 30 分まで）追う */
export const T_CAP = 3600;

export function boardSim(o: BoardIn): BoardSim {
  const { NX, NY, dx, kF, dcF, e } = BD,
    n = NX * NY,
    m = MAT.cu,
    tc = o.tcu,
    tb = o.tb,
    Ta = o.Ta,
    pulse = o.mode === 'pulse' ? o.tp : Number.POSITIVE_INFINITY,
    span = o.span ?? 0,
    tCap = span > 0 ? span : T_CAP * 1.5;
  /** 自動のとき計算を終える時刻。止める条件を満たした時刻の 1.5 倍 */
  let endAt: number | null = null;
  const { cu: cu0, fix } = boardMask(o.kind, o.w);
  /* 溶けた升は銅箔から外す（電気も、銅箔どうしの熱伝導も通さない） */
  const cu = Uint8Array.from(cu0),
    cutAt = new Float64Array(n).fill(Number.POSITIVE_INFINITY);
  const listOf = () => {
    const il: number[] = [];
    for (let k = 0; k < n; k++) if (cu[k]) il.push(k);
    return Int32Array.from(il);
  };
  let idx = listOf();
  const idx0 = idx;
  const V = new Float64Array(n),
    T = new Float64Array(n).fill(Ta),
    sq = new Float64Array(n),
    q = new Float64Array(n);
  for (const k of idx) V[k] = fix[k] === 1 ? 1 : fix[k] === -1 ? 0 : 0.5;
  /* 交流では、電流が流れる厚さを表皮の深さで減らす（Yue と Wong の実効厚さ） */
  const dl = skinDepth(m.rho, o.f),
    tEff = Number.isFinite(dl) ? Math.min(tc, dl * (1 - Math.exp(-tc / dl))) : tc;
  const C = new Float64Array(n);
  for (let k = 0; k < n; k++) C[k] = (dcF * tb + (cu0[k] ? m.d * m.c * tc : 0)) * dx * dx;
  const gF = kF * tb,
    gC = m.k * tc;
  const NB: Int32Array[] = [];
  for (let k = 0; k < n; k++) {
    const i = k % NX,
      j = (k / NX) | 0,
      r: number[] = [];
    if (i > 0) r.push(k - 1);
    if (i < NX - 1) r.push(k + 1);
    if (j > 0) r.push(k - NX);
    if (j < NY - 1) r.push(k + NX);
    NB.push(Int32Array.from(r));
  }
  const updSq = () => {
    for (const k of idx) sq[k] = tEff / rhoAt(m, T[k]);
  };
  const gg = (a: number, b: number) => (2 * sq[a] * sq[b]) / (sq[a] + sq[b]);
  const sorV = (it: number) => {
    for (let s = 0; s < it; s++)
      for (const k of idx) {
        if (fix[k]) continue;
        let num = 0,
          den = 0;
        for (const j of NB[k])
          if (cu[j]) {
            const g = gg(k, j);
            num += g * V[j];
            den += g;
          }
        if (den) V[k] += 1.85 * (num / den - V[k]);
      }
  };
  /** 1 V のときの電流から抵抗を出し、電流 I に合わせて各升の発熱を求める */
  const joule = (I: number) => {
    let i1 = 0;
    for (const k of idx) if (fix[k] === 1) for (const j of NB[k]) if (cu[j] && !fix[j]) i1 += gg(k, j) * (V[k] - V[j]);
    const s = I / Math.max(i1, 1e-12);
    q.fill(0);
    if (I > 0)
      for (const k of idx)
        for (const j of NB[k])
          if (cu[j] && j > k) {
            const p = gg(k, j) * ((V[k] - V[j]) * s) ** 2;
            q[k] += p / 2;
            q[j] += p / 2;
          }
    return 1 / Math.max(i1, 1e-12);
  };
  /** 左のパッドから右のパッドまで銅箔がつながっているか */
  const linked = () => {
    const seen = new Uint8Array(n),
      st: number[] = [];
    for (const k of idx)
      if (fix[k] === 1) {
        seen[k] = 1;
        st.push(k);
      }
    while (st.length) {
      const k = st.pop() as number;
      if (fix[k] === -1) return true;
      for (const j of NB[k])
        if (cu[j] && !seen[j]) {
          seen[j] = 1;
          st.push(j);
        }
    }
    return false;
  };
  updSq();
  sorV(1500);
  /* 面の自然対流の代表長さ（面積 ÷ 周長）。上面 1.32、下面 0.59 の係数（(ΔT/L)^(1/4)） */
  const Lc = (30e-3 * 18e-3) / (2 * 48e-3);
  const hl = new Float64Array(n),
    T0 = new Float64Array(n);
  const st: BoardSim = {
    t: 0,
    done: false,
    times: [],
    frames: [],
    R: [],
    Ion: [],
    maxT: [],
    bal: [],
    cu: cu0,
    idx: idx0,
    cutAt,
    tOpen: null,
    tOff: pulse < Number.POSITIVE_INFINITY ? pulse : null,
    V,
    sq,
    dl,
    tEff,
    step(budget, now = () => performance.now()) {
      const t0 = now();
      while (!st.done && now() - t0 < budget) advance();
      return st.done;
    },
  };
  let dt = 0.01,
    R = joule(o.I),
    lastSnap = 0;
  const maxAll = () => {
    let mx = Number.NEGATIVE_INFINITY;
    for (let k = 0; k < n; k++) if (T[k] > mx) mx = T[k];
    return mx;
  };
  /* 記録は、時刻が 1.5 % 進むごと（と出来事の直後）に残す。長い冷却でも枚数を抑える */
  const snap = (I: number, gen: number, conv: number, rad: number, force: boolean) => {
    if (st.times.length && st.times[st.times.length - 1] === st.t) return;
    if (!force && st.times.length > 30 && st.t < lastSnap * 1.015) return;
    lastSnap = st.t;
    st.times.push(st.t);
    st.frames.push(Float32Array.from(T));
    st.R.push(R);
    st.Ion.push(I);
    st.bal.push({ gen, conv, rad, term: 0 });
    st.maxT.push(maxAll());
  };
  snap(o.I, 0, 0, 0, true);
  let prevMx = Ta;
  function advance(): void {
    if (st.t < pulse && st.t + dt > pulse) dt = pulse - st.t;
    if (st.t + dt > tCap) dt = tCap - st.t;
    if (endAt !== null && st.t + dt > endAt) dt = endAt - st.t;
    const I = st.t < pulse && st.tOpen === null ? o.I : 0;
    if (I > 0) {
      updSq();
      sorV(6);
      R = joule(I);
    } else q.fill(0);
    let conv = 0,
      rad = 0,
      gen = 0;
    const ta = Ta + K0;
    for (let k = 0; k < n; k++) {
      const d = Math.max(0.05, T[k] - Ta),
        hcv = (1.32 + 0.59) * (d / Lc) ** 0.25,
        tk = T[k] + K0;
      const hr = 2 * e * SIG * (tk * tk + ta * ta) * (tk + ta);
      hl[k] = (hcv + hr) * dx * dx;
      conv += hcv * dx * dx * (T[k] - Ta);
      rad += 2 * e * SIG * (tk ** 4 - ta ** 4) * dx * dx;
      gen += q[k];
    }
    T0.set(T);
    /* 面からの放熱を線形にした陰解法。赤黒の順の SOR を 14 回 */
    for (let s = 0; s < 14; s++)
      for (let par = 0; par < 2; par++)
        for (let j = 0; j < NY; j++)
          for (let i = (j + par) % 2; i < NX; i += 2) {
            const k = j * NX + i;
            let num = (C[k] / dt) * T0[k] + q[k] + hl[k] * Ta,
              den = C[k] / dt + hl[k];
            for (const jj of NB[k]) {
              const g = gF + (cu[k] && cu[jj] ? gC : 0);
              num += g * T[jj];
              den += g;
            }
            T[k] += 1.5 * (num / den - T[k]);
          }
    st.t += dt;
    /* 融点に届いた升は溶けて外れる。パッドの間が切れたら電流が止まる */
    let melted = false;
    for (const k of idx)
      if (T[k] >= m.mp) {
        cu[k] = 0;
        cutAt[k] = st.t;
        melted = true;
      }
    if (melted) {
      idx = listOf();
      if (!linked()) {
        st.tOpen = st.t;
        st.tOff = Math.min(st.tOff ?? Number.POSITIVE_INFINITY, st.t);
      } else {
        updSq();
        sorV(300);
        R = joule(I);
      }
      dt = Math.min(dt, 0.02);
    }
    const ev = melted || Math.abs(st.t - pulse) < 1e-9;
    snap(I, gen, conv, rad, ev);
    const mx = maxAll(),
      rate = Math.abs(mx - prevMx) / dt;
    prevMx = mx;
    const off = st.tOff !== null && st.t >= st.tOff;
    if (st.t >= tCap - 1e-9) st.done = true;
    else if (span > 0) {
      /* 観察時間を決めたときは、その時刻まで続ける */
    } else {
      const stop = off ? mx < Ta + 0.5 || st.t > (st.tOff ?? 0) + 1800 : st.tOff === null && st.t > 60 && rate < 0.0005;
      if (stop && endAt === null) endAt = Math.min(tCap, 1.5 * st.t);
      if (endAt !== null && st.t >= endAt - 1e-9) st.done = true;
    }
    if (st.done) snap(I, gen, conv, rad, true);
    dt = Math.min(
      dt * 1.05,
      off || rate < 0.002 ? 10 : 4,
      st.t < pulse ? Math.max(pulse / 40, 1e-3) : Number.POSITIVE_INFINITY,
    );
  }
  return st;
}
