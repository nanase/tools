/**
 * 天体の断面（平面ひずみ）の MLS-MPM。天体は円で、重力は中心を向く。岩は粒子で持ち、格子で力を解く。
 * 座標は衝突点が原点で、天体の中心は (0, −R)。小さい衝突では計算の範囲が天体の一部を切り取った形になる
 *
 * - 第 1 段階: Tillotson の状態方程式と人工粘性で衝撃波を解く
 * - 第 2 段階: 衝撃波が抜けたら熱の圧力を切り、掘削と崩壊を解く（時間刻みが 2 倍ほど大きくなる）
 * - 第 3 段階: 岩の動きが止まったら格子を止め、飛んでいる物だけ天体の重力と大気の抵抗で追う
 *
 * 粒子だけでは空を飛ぶ物が少ないので、Housen & Holsapple 2011 の式で放出する細かい噴出物を足す
 * （質量は持たず、地面に積もらない）
 *
 * 計算の範囲の外へ出た衝撃波は、粗い格子の線形の波で追う（圧力の表示だけに使い、岩は動かさない）
 */
import { type EjectaLaw, ejectaSpeed, type ImpactorKey, type TargetKey } from './model';

interface Mat {
  rho0: number;
  A: number;
  B: number;
  a: number;
  b: number;
  E0: number;
  Eiv: number;
  Ecv: number;
  alpha: number;
  beta: number;
  /** 傷のない岩の粘着力 [Pa] */
  Y0: number;
  mui: number;
  Ylim: number;
  /** 砕けた岩の粘着力 [Pa] */
  Yd0: number;
  mud: number;
  /** 融点 [K] */
  Tm: number;
  cv: number;
  /** 引張の限界 [Pa] */
  Pmin: number;
}

/** Tillotson の定数は Melosh 1989 と Benz & Asphaug 1999、強度は Collins ほか 2004 の形。砂は岩の定数を弱くしたもの */
const MATS: Record<TargetKey | ImpactorKey, Mat> = {
  rock: {
    rho0: 2680,
    A: 18e9,
    B: 18e9,
    a: 0.5,
    b: 1.3,
    E0: 16e6,
    Eiv: 3.5e6,
    Ecv: 18e6,
    alpha: 5,
    beta: 5,
    Y0: 10e6,
    mui: 2,
    Ylim: 2.5e9,
    Yd0: 1e4,
    mud: 0.6,
    Tm: 1673,
    cv: 1000,
    Pmin: 100e6,
  },
  sand: {
    rho0: 1750,
    A: 2.67e9,
    B: 2.67e9,
    a: 0.5,
    b: 1.3,
    E0: 16e6,
    Eiv: 3.5e6,
    Ecv: 18e6,
    alpha: 5,
    beta: 5,
    Y0: 1e4,
    mui: 0.6,
    Ylim: 1e9,
    Yd0: 1e4,
    mud: 0.6,
    Tm: 1673,
    cv: 1000,
    Pmin: 1e4,
  },
  water: {
    rho0: 998,
    A: 2.18e9,
    B: 13.25e9,
    a: 0.7,
    b: 0.15,
    E0: 7e6,
    Eiv: 0.419e6,
    Ecv: 2.69e6,
    alpha: 10,
    beta: 5,
    Y0: 0,
    mui: 0,
    Ylim: 0,
    Yd0: 0,
    mud: 0,
    Tm: 1,
    cv: 4186,
    Pmin: 0,
  },
  stone: {
    rho0: 2700,
    A: 26.7e9,
    B: 26.7e9,
    a: 0.5,
    b: 1.5,
    E0: 487e6,
    Eiv: 4.72e6,
    Ecv: 18.2e6,
    alpha: 5,
    beta: 5,
    Y0: 10e6,
    mui: 1.2,
    Ylim: 3.5e9,
    Yd0: 1e4,
    mud: 0.6,
    Tm: 1373,
    cv: 1000,
    Pmin: 100e6,
  },
  iron: {
    rho0: 7800,
    A: 128e9,
    B: 105e9,
    a: 0.5,
    b: 1.5,
    E0: 9.5e6,
    Eiv: 2.4e6,
    Ecv: 8.67e6,
    alpha: 5,
    beta: 5,
    Y0: 100e6,
    mui: 1,
    Ylim: 1e9,
    Yd0: 1e6,
    mud: 0.6,
    Tm: 1811,
    cv: 450,
    Pmin: 500e6,
  },
  ice: {
    rho0: 917,
    A: 9.47e9,
    B: 9.47e9,
    a: 0.3,
    b: 0.1,
    E0: 10e6,
    Eiv: 0.773e6,
    Ecv: 3.04e6,
    alpha: 10,
    beta: 5,
    Y0: 1e6,
    mui: 0.7,
    Ylim: 100e6,
    Yd0: 1e4,
    mud: 0.5,
    Tm: 273,
    cv: 2100,
    Pmin: 2e6,
  },
};

export interface SimParams {
  /** 計算の範囲の基準の直径 [m] */
  D: number;
  /** 円柱の直径 [m] */
  Lc: number;
  /** 衝突の速度 [m/s] */
  v: number;
  thetaDeg: number;
  /** 表面重力 [m/s²] */
  g: number;
  target: TargetKey;
  impactor: ImpactorKey;
  /** 地表の大気の密度 [kg/m³]。大気なしは 0 */
  airRho: number;
  atmH: number;
  /** 天体の半径 [m] */
  R: number;
  /** 細かさ（天体より十分小さい衝突で D あたりの格子の数） */
  dxN: number;
  /** 岩の振動の強さ（音響流動化） */
  cVib: number;
  /** 格子を動かす時間の上限（√(D/g) の倍数） */
  tMaxF: number;
  /** 細かい噴出物 */
  ej: { law: EjectaLaw; a: number; Rc: number; n: number };
  /** 計算を終える時刻 [s]。省略時は軌道の周期の 10 倍 */
  tEnd?: number;
}

export interface SimInfo {
  n: number;
  nx: number;
  nyB: number;
  dx: number;
  /** 計算の範囲の幅 [m] */
  Rw: number;
  D: number;
  /** √(D/g) [s] */
  Tg: number;
  /** 地層の厚さ [m] */
  bandH: number;
  R: number;
  /** 粒子ごとの地層（8 は衝突体） */
  band: Uint8Array;
  /** 細かい噴出物の色を借りる粒子 */
  fragPar: Int32Array;
  /** 粒子の間隔が 2 倍の粒子（範囲の外側）なら 1 */
  coarse: Uint8Array;
  /** 波を吸収する層の幅 [m] */
  swW: number;
  swD: number;
  /** 範囲の外まで伝える波の格子。天体全体を解くときはない */
  wave: { nx: number; ny: number; dg: number; x0: number; y0: number } | null;
}

/**
 * 1 コマ分のデータ。岩の粒子（xy・heat・pr・jv）は第 3 段階では動かないので送らない
 * - xy: 位置（dx/16 刻み）。格子の上にない粒子は −32768
 * - heat: 温度（0–255 で 293–4293 K）
 * - pr: 下位 6 ビットが圧力（地圧を引いた分の対数）、上位 2 ビットが種類（0 岩、1 破片）
 * - jv: 体積の比 J × 64
 * - air: 飛んでいる物 [id, x, y, 種類（1 破片、2 蒸発）, 温度]。id は粒子の番号、n 以上は細かい噴出物
 * - land: このコマで着地した物 [id, x, y, 温度]
 * - wave: 範囲の外まで伝える波の圧力（pr と同じ対数の 0–63）
 */
export interface SimFrame {
  t: number;
  base: boolean;
  xy?: Int16Array;
  heat?: Uint8Array;
  pr?: Uint8Array;
  jv?: Uint8Array;
  surf?: Float32Array;
  wave?: Uint8Array;
  air: Float32Array;
  land: Float32Array;
}

export interface SimResult {
  step: number;
  /** 計算を終えた時刻 [s] */
  t: number;
  /** 岩の動きが止まった時刻 [s] */
  tFall: number;
  /** 戻ってくる噴出物がほぼ落ちた時刻 [s] */
  tDone: number;
  /** 完成したときの地表の高さ（列ごと） [m] */
  surf: Float32Array;
  /** 細かい噴出物の 99% が落ちた距離 [m] */
  farS: number;
  /** 細かい噴出物のうち飛び去った割合 */
  escFrac: number;
  /** 計算を終えたときに軌道に残っていた割合 */
  orbitFrac: number;
}

export const frameBuffers = (f: SimFrame): Transferable[] => {
  const b: Transferable[] = [f.air.buffer as ArrayBuffer, f.land.buffer as ArrayBuffer];
  for (const x of [f.xy, f.heat, f.pr, f.jv, f.surf, f.wave]) if (x) b.push(x.buffer as ArrayBuffer);
  return b;
};

export interface Sim {
  info: SimInfo;
  /** ms ミリ秒だけ進める。新しいコマを emit へ渡す。終わったら true */
  tick(ms: number, emit: (f: SimFrame) => void): boolean;
  result(): SimResult;
}

/** 長方形と天体の円の重なりの面積（格子の細かさを決める） */
function overlapArea(W: number, depth: number, R: number): number {
  const N = 48;
  let c = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = ((i + 0.5) / N - 0.5) * W,
        y = -((j + 0.5) / N) * depth;
      if (x * x + (y + R) * (y + R) < R * R) c++;
    }
  }
  return (c / (N * N)) * W * depth;
}

export function createSim(p: SimParams): Sim {
  const T = MATS[p.target],
    Q = MATS[p.impactor],
    { D, g, v, R } = p,
    Rp = p.Lc / 2,
    /* 衝突が天体の大きさに近づいたら、天体全体を計算する */
    whole = D > 0.8 * R,
    W0 = whole ? 2.3 * R : 2.4 * D,
    depth0 = whole ? 2.15 * R : 0.8 * D,
    /* 粒子の数がほぼ同じになる細かさ。天体より十分小さければ dx = D / dxN */
    dx = Math.sqrt(overlapArea(W0, depth0, R) / ((whole ? 1.104 : 1.92) * p.dxN * p.dxN)),
    nx = Math.ceil(W0 / dx),
    nyB = Math.ceil(depth0 / dx),
    nyT = Math.ceil(Math.max(0.25 * D, 3 * Rp + 4 * dx) / dx),
    pad = 3,
    NX = nx + 2 * pad,
    NY = nyB + nyT + 2 * pad,
    Rw = nx * dx,
    x0 = -Rw / 2 - pad * dx,
    y0 = -nyB * dx - pad * dx,
    ppc = 2,
    sub = dx / ppc,
    /* 細い衝突体でも粒子を保つ */
    sp = Math.min(sub, Rp / 1.5),
    est = nx * nyB * ppc * ppc + Math.ceil((Math.PI * Rp * Rp) / (sp * sp)) + 64,
    f64 = () => new Float64Array(est),
    px = f64(),
    py = f64(),
    vx = f64(),
    vy = f64(),
    C00 = f64(),
    C01 = f64(),
    C10 = f64(),
    C11 = f64(),
    mass = f64(),
    V0 = f64(),
    J = f64(),
    E = f64(),
    sxx = f64(),
    syy = f64(),
    sxy = f64(),
    szz = f64(),
    pOld = f64(),
    Poff = f64(),
    /* 初めの地圧と、その深さでの体積弾性率 */
    P0 = f64(),
    K = f64(),
    dmg = new Float32Array(est),
    vib = new Float32Array(est),
    mat = new Uint8Array(est),
    /* 0 格子の上、1 消えた、2 飛んでいる、4 蒸発、5 着地 */
    state = new Uint8Array(est),
    band = new Uint8Array(est),
    coarse = new Uint8Array(est),
    /* 飛んでいる粒子の座標（天体の中心から） */
    bx = f64(),
    by = f64(),
    bvx = f64(),
    bvy = f64(),
    ballHeat = new Uint8Array(est),
    bandH = Math.max(Math.min(D, 2 * R) * 0.045, dx * 1.5);
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  /* 天体と衝突体の粒子 */
  let n = 0;
  for (let j = 0; j < nyB * ppc; j++) {
    for (let i = 0; i < nx * ppc; i++) {
      const x = -Rw / 2 + (i + 0.5) * sub + (rnd() - 0.5) * 0.45 * sub,
        y = -(j + 0.5) * sub + (j > 0 ? (rnd() - 0.5) * 0.45 * sub : 0),
        d = R - Math.hypot(x, y + R) + sub * 0.5,
        /* クレーターから離れた所は動きが小さいので、粒子を 4 分の 1 にする */
        far = !whole && (Math.abs(x) > 0.85 * D || -y > 0.5 * D);
      if (far && (i % 2 !== 0 || j % 2 !== 0)) continue;
      if (d < 0 || n >= est) continue;
      const cell = far ? dx : sub;
      px[n] = x;
      py[n] = y;
      V0[n] = cell * cell;
      mass[n] = T.rho0 * cell * cell;
      coarse[n] = far ? 1 : 0;
      J[n] = 1;
      P0[n] = T.rho0 * g * d * (1 - d / (2 * R));
      K[n] = T.A + 4 * P0[n];
      band[n] = Math.floor(d / bandH) % 6;
      n++;
    }
  }
  const th = (p.thetaDeg * Math.PI) / 180,
    cth = Math.cos(th),
    yc = Rp + dx * 0.05,
    nr = Math.ceil(Rp / sp) + 1;
  for (let j = -nr; j < nr; j++) {
    for (let i = -nr; i < nr; i++) {
      const xr = (i + 0.5) * sp,
        yr = (j + 0.5) * sp;
      if (xr * xr + yr * yr > Rp * Rp || n >= est) continue;
      px[n] = xr;
      py[n] = yc + yr;
      V0[n] = sp * sp;
      mass[n] = Q.rho0 * sp * sp;
      J[n] = 1;
      K[n] = Q.A;
      vx[n] = v * cth;
      vy[n] = -v * Math.sin(th);
      mat[n] = 1;
      band[n] = 8;
      n++;
    }
  }

  /* 格子: 重力は中心を向き、天体の中では中心からの距離に比例する。波を吸収する層は天体の中だけ */
  const nodes = NX * NY,
    gm = new Float64Array(nodes),
    gu = new Float64Array(nodes),
    gv = new Float64Array(nodes),
    gGx = new Float32Array(nodes),
    gGy = new Float32Array(nodes),
    invdx = 1 / dx,
    Dinv = 4 * invdx * invdx,
    sponge = new Float32Array(nodes),
    sw = Math.ceil(nx * 0.16),
    sb = Math.ceil(nyB * 0.25);
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      const x = x0 + i * dx,
        yr = y0 + j * dx + R,
        r = Math.max(Math.hypot(x, yr), 1),
        gr = r < R ? (g * r) / R : (g * R * R) / (r * r),
        id = j * NX + i,
        dr = Math.max(i - (NX - pad - sw), pad + sw - i),
        db = pad + sb - j;
      gGx[id] = (-gr * x) / r;
      gGy[id] = (-gr * yr) / r;
      let s = 0;
      if (r < R + dx) {
        if (dr > 0) s = Math.max(s, dr / sw);
        if (db > 0) s = Math.max(s, db / sb);
      }
      sponge[id] = Math.min(1, s);
    }
  }

  const cRef = Math.sqrt(T.A / T.rho0),
    dampRate = (0.5 * cRef) / (sw * dx),
    /* 振動が減る時間。円柱の半径を球の半径に戻して使う */
    tau = (115 * Math.max(Rp * 2.8, dx)) / cRef,
    Tg = Math.sqrt(D / g),
    tMax = p.tMaxF * Tg,
    softT = 0.12 * Tg,
    GM = g * R * R,
    atmH = p.atmH,
    airRho = p.airRho,
    /* 低い軌道の周期 */
    orbit = 2 * Math.PI * Math.sqrt(R ** 3 / GM),
    tEnd = p.tEnd ?? 10 * orbit,
    surf = new Float32Array(nx),
    /* 放出の速さに応じた衝撃の熱（温度の 0–255） */
    speedHeat = (sp2: number) => Math.min(255, (Math.min((1.5 * sp2) / 2 / T.cv, 3500) / 4000) * 255),
    top = new Float32Array(nx),
    topFar = new Float32Array(800),
    yTop = y0 + (NY - 5) * dx,
    hasStr = T.Y0 > 0 || T.mui > 0,
    nFramesPerTg = p.dxN >= 140 ? 60 : p.dxN >= 100 ? 80 : 100,
    frameT = (k: number) => Tg * (k / nFramesPerTg) ** 2,
    cq1 = 0.6,
    cq2 = 1.5,
    cVib = p.cVib,
    /* 飛ぶ物の大きさ（大気の抵抗に効く） */
    ejS = Math.max(D / 300, 0.5),
    heatOf = (q: number) => {
      const M = mat[q] ? Q : T;
      return Math.floor(Math.min(255, (E[q] / M.cv / 4000) * 255));
    };

  /* 細かい噴出物: 放出の位置を体積 ∝ x³ から選び、速度と放出の時刻を式で決める */
  const NF = p.ej.n,
    Fs = new Float64Array(NF),
    Fvt = new Float64Array(NF),
    Fvr = new Float64Array(NF),
    Ft = new Float64Array(NF),
    fragPar = new Int32Array(NF),
    Fh = new Uint8Array(NF),
    cxx = new Float64Array(NF),
    cyy = new Float64Array(NF),
    cvx = new Float64Array(NF),
    cvy = new Float64Array(NF),
    cst = new Uint8Array(NF),
    active: number[] = [],
    fragDist: number[] = [];
  {
    const { law, a: a0, Rc } = p.ej,
      U = v * Math.sin(th),
      xEnd = Math.min(law.n2 * Rc * 0.97, 0.8 * Math.PI * R),
      xBeg = Math.min(1.2 * a0, xEnd * 0.5),
      pUp = 0.5 * Math.min(1, (p.thetaDeg / 30) ** 1.2) * (1 - 0.3 * cth),
      /* x までに要する時間の表（dx/dt = v(x) を積分し、掘削の時間に合わせる） */
      NT = 200,
      tTab = new Float64Array(NT + 1);
    for (let i = 0; i < NT; i++) {
      const xa = xBeg + ((i + 0.5) / NT) * (xEnd - xBeg);
      tTab[i + 1] = tTab[i] + (xEnd - xBeg) / NT / Math.max(ejectaSpeed(law, xa, Rc, g), 1);
    }
    const tScale = (0.6 * Tg) / tTab[NT],
      list: { s: number; vt: number; vr: number; t: number; q: number; hot: number }[] = [];
    for (let k = 0; k < NF; k++) {
      const x = Math.cbrt(xBeg ** 3 + rnd() * (xEnd ** 3 - xBeg ** 3)),
        vv = Math.min(0.6 * U, ejectaSpeed(law, x, Rc, g)),
        side = rnd() < pUp ? -1 : 1,
        speed = vv * (1 + side * 0.35 * cth) * (0.85 + rnd() * 0.3),
        ang = (45 - side * 12 * cth + (rnd() - 0.5) * 16) * (Math.PI / 180),
        /* 放出の速さに応じた衝撃の熱を持つ */
        Tgain = (1.5 * speed * speed) / 2 / T.cv,
        ti = Math.min(NT, Math.max(0, Math.round(((x - xBeg) / (xEnd - xBeg)) * NT)));
      list.push({
        s: side * x + 0.05 * D * cth,
        vt: side * speed * Math.cos(ang),
        vr: speed * Math.sin(ang),
        t: tTab[ti] * tScale,
        /* 色は放出の位置に応じた深さの粒子から借りる（衝突体の粒子は避ける） */
        q: Math.floor(rnd() * n),
        hot: Math.min(255, (Math.min(Tgain, 3500) / 4000) * 255),
      });
    }
    list.sort((a, b) => a.t - b.t);
    list.forEach((e, k) => {
      Fs[k] = e.s;
      Fvt[k] = e.vt;
      Fvr[k] = e.vr;
      Ft[k] = e.t;
      /* 浅い粒子を探す */
      let q = e.q;
      for (let tries = 0; tries < 40 && (band[q] === 8 || py[q] < -Math.max(0.12 * Math.abs(e.s), 2 * dx)); tries++)
        q = Math.floor(rnd() * n);
      fragPar[k] = q;
      Fh[k] = e.hot;
    });
  }

  let frameIdx = 0,
    t = 0,
    step = 0,
    cmax = Math.max(cRef, Math.sqrt(Q.A / Q.rho0)),
    vmax = v,
    therm = 1,
    cfl = 0.34,
    phase = 0,
    quietN = 0,
    vsm = 0,
    nextF = 0,
    airCount = 0,
    /* 戻ってくる物だけの数 */
    airBound = 0,
    peakAir = 0,
    launched = 0,
    fragEsc = 0,
    fragLeft = 0,
    tFall = 0,
    tDone = 0,
    ended = false,
    pend: number[] = [];

  function toBall(q: number): void {
    ballHeat[q] = Math.max(heatOf(q), speedHeat(vx[q] * vx[q] + vy[q] * vy[q]));
    bx[q] = px[q];
    by[q] = py[q] + R;
    bvx[q] = vx[q];
    bvy[q] = vy[q];
    state[q] = 2;
  }
  /** 中心からの座標 (X, Y) の真下の地面の高さと、列の番号（計算の範囲の外は −1） */
  function column(X: number, Y: number): number {
    if (Y <= 0 || Math.abs(X) >= Rw / 2) return -1;
    const i = Math.floor((X + Rw / 2) / dx),
      h = (phase === 0 ? surf : top)[i];
    return h > -1e8 ? i : -1;
  }
  /** 中心からの座標 (X, Y) が地面より下か */
  function below(X: number, Y: number, r: number): boolean {
    const i = column(X, Y);
    if (i >= 0) return Y - R <= (phase === 0 ? surf : top)[i];
    const a = Math.abs(R * Math.atan2(X, Y));
    if (a < Rw / 2) return r <= R;
    return r - R <= topFar[(X > 0 ? 400 : 0) + Math.min(399, Math.floor(Math.log(a / (Rw / 2)) / 0.05))];
  }
  /** 地面に積む。積もった位置を返す */
  function pile(X: number, Y: number, area: number): [number, number] {
    const i = column(X, Y);
    if (i >= 0) {
      const dh = area / dx,
        h = (phase === 0 ? surf : top)[i];
      if (phase === 1) {
        top[i] += dh * 0.5;
        if (i > 0) top[i - 1] += dh * 0.25;
        if (i < nx - 1) top[i + 1] += dh * 0.25;
      }
      return [X, h];
    }
    const sv = R * Math.atan2(X, Y),
      a = Math.abs(sv);
    let h = 0;
    if (a >= Rw / 2) {
      const k = (sv > 0 ? 400 : 0) + Math.min(399, Math.floor(Math.log(a / (Rw / 2)) / 0.05));
      h = topFar[k];
      topFar[k] += area / (0.05 * a);
    }
    const b = sv / R,
      r = R + h;
    return [r * Math.sin(b), r * Math.cos(b) - R];
  }
  /** 飛んでいる物を、中心力と大気の抵抗で進める */
  function moveBalls(dt: number): void {
    airCount = 0;
    airBound = 0;
    for (let q = 0; q < n; q++) {
      const st = state[q];
      if (st === 4) {
        const r0 = Math.hypot(px[q], py[q] + R),
          ag = -GM / (r0 * r0 * r0);
        vx[q] += ag * px[q] * dt;
        vy[q] += ag * (py[q] + R) * dt;
        px[q] += vx[q] * dt;
        py[q] += vy[q] * dt;
        if (Math.hypot(px[q], py[q]) > D * 4 || Math.hypot(px[q], py[q] + R) < R) state[q] = 1;
        continue;
      }
      if (st !== 2) continue;
      const x = bx[q],
        y = by[q],
        r2 = x * x + y * y,
        r = Math.sqrt(r2),
        ag = -GM / (r2 * r),
        h = r - R;
      let ux = bvx[q] + ag * x * dt,
        uy = bvy[q] + ag * y * dt;
      if (airRho > 0 && h < atmH * 20) {
        const f = 1 / (1 + ((0.75 * airRho * Math.exp(-h / atmH) * Math.hypot(ux, uy)) / (2700 * ejS)) * dt);
        ux *= f;
        uy *= f;
      }
      bvx[q] = ux;
      bvy[q] = uy;
      const nx2 = x + ux * dt,
        ny2 = y + uy * dt,
        r3 = Math.hypot(nx2, ny2);
      bx[q] = nx2;
      by[q] = ny2;
      if (r3 > 200 * R) {
        state[q] = 1;
        continue;
      }
      if (phase === 0 && Math.abs(nx2) < Rw / 2 - 6 * dx && ny2 - R < yTop - 2 * dx && ny2 - R > y0 + 2 * dx) {
        /* 格子へ戻す */
        px[q] = nx2;
        py[q] = ny2 - R;
        vx[q] = ux;
        vy[q] = uy;
        C00[q] = C01[q] = C10[q] = C11[q] = 0;
        state[q] = 0;
        continue;
      }
      if (below(nx2, ny2, r3)) {
        const [lx, ly] = pile(nx2, ny2, V0[q] * 1.25);
        pend.push(q, lx, ly, ballHeat[q]);
        state[q] = 5;
        continue;
      }
      airCount++;
      if ((ux * ux + uy * uy) / 2 - GM / r3 < 0) airBound++;
    }
    while (launched < NF && Ft[launched] <= t) {
      const k = launched++,
        sv = Fs[k],
        a = sv / R,
        c = Math.cos(a),
        sn = Math.sin(a),
        X = R * sn,
        Y = R * c,
        i = column(X, Y),
        r = i >= 0 ? Math.hypot(X, (phase === 0 ? surf : top)[i] + R) + 0.2 * dx : R + 0.2 * dx;
      cxx[k] = r * sn;
      cyy[k] = r * c;
      cvx[k] = Fvt[k] * c + Fvr[k] * sn;
      cvy[k] = -Fvt[k] * sn + Fvr[k] * c;
      cst[k] = 1;
      active.push(k);
    }
    let bound = 0;
    for (let a = active.length - 1; a >= 0; a--) {
      const id = active[a],
        x = cxx[id],
        y = cyy[id],
        r2 = x * x + y * y,
        r = Math.sqrt(r2),
        ag = -GM / (r2 * r),
        h = r - R;
      let ux = cvx[id] + ag * x * dt,
        uy = cvy[id] + ag * y * dt;
      if (airRho > 0 && h < atmH * 20) {
        const f = 1 / (1 + ((0.75 * airRho * Math.exp(-h / atmH) * Math.hypot(ux, uy)) / (2700 * ejS)) * dt);
        ux *= f;
        uy *= f;
      }
      cvx[id] = ux;
      cvy[id] = uy;
      const nx2 = x + ux * dt,
        ny2 = y + uy * dt,
        r3 = Math.hypot(nx2, ny2);
      cxx[id] = nx2;
      cyy[id] = ny2;
      if (r3 > 200 * R) {
        cst[id] = 0;
        fragEsc++;
      } else if (below(nx2, ny2, r3)) {
        cst[id] = 2;
        const sv = Math.abs(R * Math.atan2(nx2, ny2));
        fragDist.push(sv);
        const b = (R * Math.atan2(nx2, ny2)) / R,
          i = column(nx2, ny2);
        if (i >= 0) pend.push(n + id, nx2, (phase === 0 ? surf : top)[i], Fh[id]);
        else pend.push(n + id, R * Math.sin(b), R * Math.cos(b) - R, Fh[id]);
      } else if ((ux * ux + uy * uy) / 2 - GM / r3 < 0) bound++;
      if (cst[id] !== 1) {
        active[a] = active[active.length - 1];
        active.pop();
      }
    }
    airCount += active.length;
    airBound += bound;
    if (airCount > peakAir) peakAir = airCount;
  }
  function airList(): { air: Float32Array; land: Float32Array } {
    let m = active.length;
    for (let q = 0; q < n; q++) if (state[q] === 2 || state[q] === 4) m++;
    const a = new Float32Array(m * 5);
    let k = 0;
    for (let q = 0; q < n; q++) {
      const st = state[q];
      if (st !== 2 && st !== 4) continue;
      a[k++] = q;
      a[k++] = st === 2 ? bx[q] : px[q];
      a[k++] = st === 2 ? by[q] - R : py[q];
      a[k++] = st === 2 ? 1 : 2;
      a[k++] = st === 2 ? ballHeat[q] : heatOf(q);
    }
    for (let i = 0; i < launched; i++) {
      if (cst[i] !== 1) continue;
      a[k++] = n + i;
      a[k++] = cxx[i];
      a[k++] = cyy[i] - R;
      a[k++] = 1;
      a[k++] = Fh[i];
    }
    const out = { air: a, land: Float32Array.from(pend) };
    pend = [];
    return out;
  }

  /* 範囲の外まで伝える波: 範囲の内側の圧力を与え、外へ広がる線形の波を解く */
  const WC = 3,
    dg = WC * dx,
    wave = whole
      ? null
      : (() => {
          const hx = Math.min(5 * D, 1.05 * R),
            hy = Math.min(5 * D, 2.05 * R),
            wnx = Math.ceil((2 * hx) / dg),
            wny = Math.ceil(hy / dg);
          return { nx: wnx, ny: wny, dg, x0: -hx, y0: -hy };
        })(),
    waveEnd = 1.5 * Tg,
    wn = wave ? wave.nx * wave.ny : 0,
    wp = new Float32Array(wn),
    wu = new Float32Array(wn),
    wv = new Float32Array(wn),
    wSum = new Float32Array(wn),
    wCnt = new Uint16Array(wn),
    wIn = new Uint8Array(wn),
    wForce = new Uint8Array(wn),
    wDamp = new Float32Array(wn),
    dtw = (0.45 * dg) / cRef;
  let tw = 0;
  if (wave) {
    const fx0 = Rw / 2 - sw * dx,
      fy0 = nyB * dx - sb * dx;
    for (let j = 0; j < wave.ny; j++) {
      for (let i = 0; i < wave.nx; i++) {
        const x = wave.x0 + (i + 0.5) * dg,
          y = wave.y0 + (j + 0.5) * dg,
          id = j * wave.nx + i,
          r = Math.hypot(x, y + R),
          dist = Math.max(Math.hypot(x, y), dg),
          edge = Math.min(i, wave.nx - 1 - i, wave.ny - 1 - j, j) / 16;
        wIn[id] = r < R ? 1 : 0;
        wForce[id] = Math.abs(x) < fx0 && y > -fy0 ? 1 : 0;
        /* 実際の球面波は平面の波より早く弱まるので、その差の分を減らす。外周は吸収する */
        wDamp[id] = Math.exp(-dtw * (cRef / (2 * dist) + (edge < 1 ? (1 - edge) ** 2 * (cRef / (4 * dg)) : 0)));
      }
    }
  }
  function waveStep(): void {
    if (!wave) return;
    const { nx: wx, ny: wy, x0: gx, y0: gy } = wave;
    wSum.fill(0);
    wCnt.fill(0);
    for (let q = 0; q < n; q++) {
      if (state[q] !== 0) continue;
      const i = Math.floor((px[q] - gx) / dg),
        j = Math.floor((py[q] - gy) / dg);
      if (i < 0 || j < 0 || i >= wx || j >= wy) continue;
      const id = j * wx + i;
      wSum[id] += pOld[q] - P0[q];
      wCnt[id]++;
    }
    const k1 = dtw / (T.rho0 * dg),
      k2 = (dtw * T.rho0 * cRef * cRef) / dg;
    for (let j = 0; j < wy; j++) {
      for (let i = 0; i < wx; i++) {
        const id = j * wx + i;
        if (i + 1 < wx) wu[id] -= k1 * (wp[id + 1] - wp[id]);
        if (j + 1 < wy) wv[id] -= k1 * (wp[id + wx] - wp[id]);
      }
    }
    for (let j = 0; j < wy; j++) {
      for (let i = 0; i < wx; i++) {
        const id = j * wx + i;
        if (!wIn[id]) {
          wp[id] = 0;
          continue;
        }
        if (wForce[id]) {
          wp[id] = wCnt[id] ? wSum[id] / wCnt[id] : 0;
          continue;
        }
        const du = wu[id] - (i > 0 ? wu[id - 1] : 0),
          dv = wv[id] - (j > 0 ? wv[id - wx] : 0),
          dmp = wDamp[id];
        wp[id] = (wp[id] - k2 * (du + dv)) * dmp;
        wu[id] *= dmp;
        wv[id] *= dmp;
      }
    }
  }
  function waveLevels(): Uint8Array {
    const a = new Uint8Array(wn);
    for (let i = 0; i < wn; i++) {
      const over = Math.abs(wp[i]);
      a[i] = over > 3e7 ? Math.min(63, Math.round(((Math.log10(over) - 7.48) / 3) * 63)) : 0;
    }
    return a;
  }

  /** 地表の線: 列ごとに下から上へたどり、岩に入ったあと密度が 2 点続けて下がった所（飛んでいる塊は含めない） */
  function measure(): void {
    surf.fill(-1e9);
    const lim = 0.35 * T.rho0 * dx * dx;
    for (let i = 0; i < nx; i++) {
      /* 天体の円の外の列に地面はない（飛んでいる塊を地面と間違えない） */
      if (Math.abs(-Rw / 2 + (i + 0.5) * dx) > 0.97 * R) continue;
      const col = pad + i;
      let j = pad + 2;
      while (j < NY - pad - 1 && gm[j * NX + col] < lim) j++;
      for (; j < NY - pad - 1; j++) {
        if (gm[j * NX + col] < lim && gm[(j + 1) * NX + col] < lim) {
          const m0 = gm[(j - 1) * NX + col],
            m1 = gm[j * NX + col];
          surf[i] = y0 + (j - 1) * dx + (dx * (m0 - lim)) / Math.max(m0 - m1, 1e-9);
          break;
        }
      }
    }
  }

  function pack(): SimFrame {
    const xy = new Int16Array(n * 2),
      heat = new Uint8Array(n),
      pr = new Uint8Array(n),
      jv = new Uint8Array(n),
      q16 = 16 / dx;
    for (let q = 0; q < n; q++) {
      if (state[q] !== 0) {
        xy[q * 2] = -32768;
        xy[q * 2 + 1] = -32768;
        continue;
      }
      const xq = Math.round(px[q] * q16),
        yq = Math.round(py[q] * q16);
      if (Math.abs(xq) > 32000 || Math.abs(yq) > 32000) {
        xy[q * 2] = -32768;
        continue;
      }
      xy[q * 2] = xq;
      xy[q * 2 + 1] = yq;
      /* 地面から飛び出している物は放出の速さの熱も持つ */
      heat[q] = J[q] > 1.5 ? Math.max(heatOf(q), speedHeat(vx[q] * vx[q] + vy[q] * vy[q])) : heatOf(q);
      const over = pOld[q] - P0[q],
        lv = over > 3e7 ? Math.min(63, Math.round(((Math.log10(over) - 7.48) / 3) * 63)) : 0;
      pr[q] = lv | ((J[q] > 2 ? 1 : 0) << 6);
      jv[q] = Math.min(255, J[q] * 64);
    }
    const f: SimFrame = { t, base: false, xy, heat, pr, jv, surf: Float32Array.from(surf), ...airList() };
    if (wave && t < waveEnd) f.wave = waveLevels();
    return f;
  }

  /** 格子の 1 ステップ */
  function oneStep(): void {
    const dt = (cfl * dx) / (cmax + vmax);
    gm.fill(0);
    gu.fill(0);
    gv.fill(0);
    if (therm && t >= softT) {
      /* 衝撃波が抜けたので熱の圧力を切る。切り替えの瞬間の圧力は差分で残す */
      therm = 0;
      cfl = 0.42;
      for (let q = 0; q < n; q++) {
        if (mat[q]) K[q] = T.A;
        if (state[q] !== 0) continue;
        const eta0 = 1 / J[q];
        Poff[q] = eta0 < 0.8 ? 0 : pOld[q] - K[q] * (eta0 - 1);
      }
    }
    moveBalls(dt);
    vsm = 0;
    /* 粒子から格子へ */
    for (let q = 0; q < n; q++) {
      if (state[q] !== 0) continue;
      const m = mat[q] && therm ? Q : T,
        x = px[q],
        y = py[q],
        Jq = J[q],
        eta = 1 / Jq,
        mu = eta - 1,
        rho = m.rho0 * eta,
        Vq = V0[q] * Jq,
        e = E[q],
        w = e / (m.E0 * eta * eta) + 1,
        Kq = K[q],
        Bq = (Kq * m.B) / m.A;
      let Pr: number;
      if (therm) {
        if (eta >= 1 || e <= m.Eiv) {
          Pr = (m.a + m.b / w) * rho * e + Kq * mu + (eta >= 1 ? Bq * mu * mu : 0);
        } else {
          const z = 1 / eta - 1,
            P2 = m.a * rho * e + ((m.b * rho * e) / w + Kq * mu * Math.exp(-m.beta * z)) * Math.exp(-m.alpha * z * z);
          if (e >= m.Ecv) Pr = P2;
          else {
            const P1 = (m.a + m.b / w) * rho * e + Kq * mu,
              f = (e - m.Eiv) / (m.Ecv - m.Eiv);
            Pr = P1 * (1 - f) + P2 * f;
          }
        }
        Pr += P0[q];
      } else {
        Pr = eta < 0.8 ? 0 : Kq * mu + Poff[q];
      }
      const divL = C00[q] + C11[q];
      let qv = 0;
      if (divL < 0) {
        const c2 = Math.max((Kq + 2 * Bq * Math.max(mu, 0)) / m.rho0 + therm * (m.a + m.b + 1) * Math.max(e, 0), 1);
        qv = rho * (cq2 * dx * dx * divL * divL - cq1 * Math.sqrt(c2) * dx * divL);
      }
      const lim = m.Pmin * (1 - dmg[q]);
      if (Pr < -lim) {
        Pr = -lim;
        if (m.Pmin > 0) dmg[q] = 1;
      }
      if (eta < 0.8 && Pr < 0) Pr = 0;
      pOld[q] = Pr;
      const Pt = Pr + qv,
        sa = sxx[q] - Pt,
        sb2 = syy[q] - Pt,
        sc = sxy[q];
      if (therm)
        E[q] = Math.max(
          e + (dt * (-Pt * divL + sxx[q] * C00[q] + syy[q] * C11[q] + sxy[q] * (C01[q] + C10[q]))) / rho,
          0,
        );
      const fx = (x - x0) * invdx,
        fy = (y - y0) * invdx,
        bi = Math.floor(fx - 0.5),
        bj = Math.floor(fy - 0.5);
      if (bi < 0 || bj < 0 || bi + 2 >= NX || bj + 2 >= NY - 1) {
        /* 地面より上なら飛び続ける */
        if (Math.hypot(x, y + R) > R) toBall(q);
        else state[q] = 1;
        continue;
      }
      if ((bi < pad + 3 || bi + 2 >= NX - pad - 3) && Math.hypot(x, y + R) > R + 2 * dx) {
        toBall(q);
        continue;
      }
      const ax = fx - bi,
        ay = fy - bj,
        w0 = 0.5 * (1.5 - ax) * (1.5 - ax),
        w1 = 0.75 - (ax - 1) * (ax - 1),
        w2 = 0.5 * (ax - 0.5) * (ax - 0.5),
        u0 = 0.5 * (1.5 - ay) * (1.5 - ay),
        u1 = 0.75 - (ay - 1) * (ay - 1),
        u2 = 0.5 * (ay - 0.5) * (ay - 0.5),
        mp = mass[q],
        k = dt * Vq * Dinv,
        A00 = mp * C00[q] - k * sa,
        A01 = mp * C01[q] - k * sc,
        A10 = mp * C10[q] - k * sc,
        A11 = mp * C11[q] - k * sb2,
        mvx = mp * vx[q],
        mvy = mp * vy[q];
      for (let b = 0; b < 3; b++) {
        const wy = b === 0 ? u0 : b === 1 ? u1 : u2,
          dy = (b - ay) * dx,
          row = (bj + b) * NX + bi;
        for (let a = 0; a < 3; a++) {
          const ww = (a === 0 ? w0 : a === 1 ? w1 : w2) * wy,
            dxx = (a - ax) * dx,
            id = row + a;
          gm[id] += ww * mp;
          gu[id] += ww * (mvx + A00 * dxx + A01 * dy);
          gv[id] += ww * (mvy + A10 * dxx + A11 * dy);
        }
      }
    }
    /* 格子 */
    for (let j = 0; j < NY; j++) {
      const row = j * NX;
      for (let i = 0; i < NX; i++) {
        const id = row + i,
          mg = gm[id];
        if (mg <= 0) continue;
        let u = gu[id] / mg + dt * gGx[id],
          w = gv[id] / mg + dt * gGy[id];
        if (i <= pad || i >= NX - pad) u = 0;
        if (j <= pad) {
          u = 0;
          w = 0;
        }
        const s = sponge[id];
        if (s > 0) {
          const f = 1 / (1 + dt * dampRate * s * s * s * 4);
          u *= f;
          w *= f;
        }
        gu[id] = u;
        gv[id] = w;
      }
    }
    /* 格子から粒子へ。粒子の状態を更新する */
    let cm = 1,
      vm = 1;
    for (let q = 0; q < n; q++) {
      if (state[q] !== 0) continue;
      const x = px[q],
        y = py[q],
        fx = (x - x0) * invdx,
        fy = (y - y0) * invdx,
        bi = Math.floor(fx - 0.5),
        bj = Math.floor(fy - 0.5),
        ax = fx - bi,
        ay = fy - bj,
        w0 = 0.5 * (1.5 - ax) * (1.5 - ax),
        w1 = 0.75 - (ax - 1) * (ax - 1),
        w2 = 0.5 * (ax - 0.5) * (ax - 0.5),
        u0 = 0.5 * (1.5 - ay) * (1.5 - ay),
        u1 = 0.75 - (ay - 1) * (ay - 1),
        u2 = 0.5 * (ay - 0.5) * (ay - 0.5);
      let nu = 0,
        nv = 0,
        c00 = 0,
        c01 = 0,
        c10 = 0,
        c11 = 0;
      for (let b = 0; b < 3; b++) {
        const wy = b === 0 ? u0 : b === 1 ? u1 : u2,
          dy = (b - ay) * dx,
          row = (bj + b) * NX + bi;
        for (let a = 0; a < 3; a++) {
          const ww = (a === 0 ? w0 : a === 1 ? w1 : w2) * wy,
            dxx = (a - ax) * dx,
            id = row + a,
            u = gu[id],
            w = gv[id];
          nu += ww * u;
          nv += ww * w;
          c00 += ww * u * dxx;
          c01 += ww * u * dy;
          c10 += ww * w * dxx;
          c11 += ww * w * dy;
        }
      }
      c00 *= Dinv;
      c01 *= Dinv;
      c10 *= Dinv;
      c11 *= Dinv;
      vx[q] = nu;
      vy[q] = nv;
      C00[q] = c00;
      C01[q] = c01;
      C10[q] = c10;
      C11[q] = c11;
      px[q] = x + dt * nu;
      py[q] = y + dt * nv;
      const div = c00 + c11;
      let Jn = J[q] * (1 + dt * div);
      Jn = Jn < 0.1 ? 0.1 : Jn > 20 ? 20 : Jn;
      J[q] = Jn;
      const m = mat[q] && therm ? Q : T;
      if (Jn > 3 && E[q] > m.Ecv) {
        state[q] = 4;
        continue;
      }
      const sp2 = nu * nu + nv * nv;
      if (sp2 > vm) vm = sp2;
      if (Jn < 1.4 && sp2 > vsm && Math.hypot(x, y + R) < R - dx) vsm = sp2;
      const eta = 1 / Jn,
        mu = eta - 1,
        e = E[q],
        Kq = K[q],
        c2 = therm
          ? eta < 0.7
            ? ((m.a + m.b + 1) * e) / (1 + e / m.E0) + 1e4
            : (Kq + (2 * Kq * m.B * Math.max(mu, 0)) / m.A) / m.rho0 + ((m.a + m.b + 1) * e) / (1 + e / m.E0)
          : (Kq / T.rho0) * 1.15;
      if (c2 > cm) cm = c2;
      if (hasStr || mat[q]) {
        const S = mat[q] && therm ? Q : T,
          G = 0.6 * Kq * Math.max(eta, 0.2),
          trD = div / 3,
          wr = 0.5 * (c01 - c10),
          a0 = sxx[q],
          b0 = syy[q],
          c0 = sxy[q],
          s00 = a0 + dt * (2 * G * (c00 - trD) + 2 * wr * c0),
          s11 = b0 + dt * (2 * G * (c11 - trD) - 2 * wr * c0),
          s01 = c0 + dt * (G * (c01 + c10) + wr * (b0 - a0)),
          s22 = szz[q] + dt * (2 * G * -trD),
          J2 = 0.5 * (s00 * s00 + s11 * s11 + s22 * s22) + s01 * s01,
          Pp = pOld[q];
        let Pe = Pp;
        if (cVib > 0) {
          /* 振動は衝撃波が通るときだけ与え、あとは減るだけ */
          let vv = vib[q];
          if (therm) {
            const cand = cVib * Math.sqrt(sp2);
            if (cand > vv) vv = cand;
          }
          vv *= Math.exp(-dt / tau);
          vib[q] = vv;
          Pe = Pp - S.rho0 * cRef * vv;
        }
        if (Pe < 0) Pe = 0;
        const Yi = S.Y0 + (S.mui * Pe) / (1 + (S.mui * Pe) / Math.max(S.Ylim - S.Y0, 1)),
          Yd = Math.min(S.Yd0 + S.mud * Pe, Yi),
          Dm = dmg[q],
          Tk = 293 + e / S.cv,
          Tm = S.Tm * Math.cbrt(Math.max(Pp, 0) / 6e9 + 1);
        let Y = (1 - Dm) * Yi + Dm * Yd;
        Y = Tk >= Tm ? 0 : Y * Math.tanh(1.2 * (Tm / Tk - 1));
        if (eta < 0.85) Y = 0;
        const sJ = Math.sqrt(J2);
        if (sJ > Y) {
          const f = sJ > 0 ? Y / sJ : 0;
          sxx[q] = s00 * f;
          syy[q] = s11 * f;
          sxy[q] = s01 * f;
          szz[q] = s22 * f;
          dmg[q] = Math.min(1, Dm + (sJ - Y) / (2 * G) / Math.SQRT1_2 / (0.04 * (1 + Math.max(Pp, 0) / 3e8)));
        } else {
          sxx[q] = s00;
          syy[q] = s11;
          sxy[q] = s01;
          szz[q] = s22;
        }
      }
    }
    cmax = Math.sqrt(cm);
    vmax = Math.sqrt(vm);
    if (t > 0.9 * Tg && Math.sqrt(vsm) < 0.025 * Math.sqrt(g * D)) quietN++;
    else quietN = 0;
    t += dt;
    step++;
    if (wave && t < waveEnd) {
      while (tw + dtw <= t) {
        waveStep();
        tw += dtw;
      }
    }
    if (step % 8 === 0) measure();
  }

  /** 岩の動きが止まったので格子を止める。地面の上にある物は飛んでいる物として追う */
  function startFall(): void {
    measure();
    for (let q = 0; q < n; q++) {
      if (state[q] !== 0) continue;
      const i = Math.floor((px[q] + Rw / 2) / dx),
        sf = i >= 0 && i < nx && surf[i] > -1e8 ? surf[i] : Infinity;
      if (py[q] > sf + 1.5 * dx || (J[q] > 2 && py[q] > sf - dx)) toBall(q);
    }
    top.set(surf);
    tFall = t;
    phase = 1;
    nextF = t * 1.02;
  }

  return {
    info: {
      n,
      nx,
      nyB,
      dx,
      Rw,
      D,
      Tg,
      bandH,
      R,
      band: band.slice(0, n),
      fragPar,
      coarse: coarse.slice(0, n),
      swW: sw * dx,
      swD: sb * dx,
      wave,
    },
    tick(ms, emit) {
      const end = performance.now() + ms;
      while (!ended && performance.now() < end) {
        if (phase === 0) {
          oneStep();
          if (t >= frameT(frameIdx)) {
            measure();
            emit(pack());
            frameIdx++;
          }
          if (!Number.isFinite(vmax) || t >= tMax || quietN > 150) {
            startFall();
            emit(pack());
          }
          continue;
        }
        for (let i = 0; i < 40 && !ended; i++) {
          const dt = Math.max(0.01 * Tg, Math.min(0.003 * t, orbit / 200));
          moveBalls(dt);
          t += dt;
          if (t >= nextF) {
            emit({ t, base: true, ...airList() });
            nextF = t * 1.04;
          }
          if (!tDone && launched >= NF && airBound <= peakAir * 0.01) tDone = t;
          if (t >= tEnd || (launched >= NF && airCount === 0)) {
            /* 残りは飛び去る物と軌道に残る物 */
            tDone ||= t;
            for (const id of active) {
              const r = Math.hypot(cxx[id], cyy[id]);
              if ((cvx[id] ** 2 + cvy[id] ** 2) / 2 - GM / r > 0) fragEsc++;
              else fragLeft++;
            }
            emit({ t, base: true, ...airList() });
            ended = true;
          }
        }
      }
      return ended;
    },
    result() {
      const far = fragDist.sort((a, b) => a - b)[Math.floor(fragDist.length * 0.99)] ?? 0;
      return {
        step,
        t,
        tFall,
        tDone,
        surf: Float32Array.from(top),
        farS: far,
        escFrac: fragEsc / NF,
        orbitFrac: fragLeft / NF,
      };
    },
  };
}
