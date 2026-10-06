/**
 * ピアノ 1 台の模型と、打鍵 1 回の振動モード（DOM に依存しない）。
 * 弦は硬い弦のモード、ハンマーとの衝突は hammer.ts、駒での結合は eig.ts（同じ鍵のユニゾンの弦と、
 * ダンパーが上がっていて部分音の近い他の鍵の弦）、響板は soundboard.ts
 */
import { C } from '../guitar/body';
import { type CVec, coupled, csqrt, cvec, project } from './eig';
import { type Contact, type HammerSpec, type StruckString, strike } from './hammer';
import { admittance, type Board, type BoardSpec, makeBoard } from './soundboard';
import { etaOf, inharm, KEY_HI, KEY_LO, KEYS, type KeyString, keyString, type PianoType, tuning } from './strings';

/** 計算する弦のモードの上限（数と周波数 [Hz]） */
const N_MAX = 260,
  F_MAX = 12000;
/** 水平の偏波: 駒のアドミタンスの比、ハンマーが与える振幅の比、響板へ伝わる力の比、ダンパーの効きの比（概数） */
const YH = 0.3,
  HZ_AMP = 0.12,
  HZ_RAD = 0.3,
  HZ_DAMP = 0.3;
/** ハンマーの当たり方のむら（弦ごとの振幅のばらつきの幅） */
const IRREG = 0.1;
/** 共鳴する弦を探す幅 [Hz]、部分音ごとの数の上限、ほかの鍵の弦との結合の弱まり（転送アドミタンスの比） */
const SYM_BW = 2.5,
  SYM_N = 3,
  SYM_RHO = 0.35;
/** 共鳴を調べる部分音の上限 [Hz] */
const SYM_FMAX = 5000;
/** 鍵盤の音: ハンマーの速さ 1 m/s あたりの力の最大 [N·s/m] と、パルスの長さ [s] */
const THUMP = 0.5,
  THUMP_S = 1.5e-3;
/** ダンパーのない鍵の下限（これより上はダンパーがない） */
export const NO_DAMPER = 90;

export interface PianoSpec {
  type: PianoType;
  board: BoardSpec;
  /** A4 の周波数 [Hz]・ストレッチ調律・ユニゾンの調律のずれの幅 [セント] */
  a4: number;
  stretch: boolean;
  unison: number;
  /** ハンマーの硬さの倍率（整音） */
  hard: number;
}

/** 鍵 1 つぶんの、ユニゾンの弦ごとの部分音（弦だけ） */
export interface KeyModes {
  s: KeyString;
  /** 弦ごとの f1 のずれ [セント] */
  cents: number[];
  /** 部分音の数 */
  N: number;
  /** 弦 j の部分音 n の角周波数 [rad/s]（w[j][n − 1]）と減衰率 [1/s] */
  w: Float64Array[];
  sg: Float64Array[];
  /** 部分音ごとの駒のアドミタンス（実部・虚部） [s/kg] */
  yr: Float64Array;
  yi: Float64Array;
  /** 打つ点（端から） [m] */
  x0: number;
  /** 駒の位置による響板への伝わりやすさ（駆動点アドミタンスは e² 倍、響板へ入る力は e 倍） */
  e: number;
}

export interface Piano {
  spec: PianoSpec;
  f1: Float64Array;
  keys: KeyModes[];
  board: Board;
  /** 共鳴を探す表: 部分音の周波数で並べた (周波数, 鍵, 弦, 部分音) */
  sym: { f: Float64Array; key: Int16Array; j: Int8Array; n: Int16Array };
}

/**
 * 駒の位置による駆動点アドミタンスの比 e²。高音の駒の端と低音の駒の端は響板の縁（リム）に近く、動きにくい。
 * 高音は E4 から C8 へ 0.12 倍まで、低音は A1 から A0 へ 0.6 倍まで下げる（概数）
 */
export const bridgeEnv = (key: number): number =>
  key > 64 ? 0.12 ** ((key - 64) / (KEY_HI - 64)) : key < 33 ? 0.6 + (0.4 * (key - KEY_LO)) / 12 : 1;

/**
 * 打つ点の比（弦長に対する）。Engelbrecht・Mägi・Stulov (1999) の中型グランドの表の L/a（低音から F4 まで約 8.1、
 * そこから A4 で 9.0、C6 で 14.05、C7 で 18.4、C8 で 22.7）を補間する
 */
const STRIKE_LA: readonly [number, number][] = [
  [21, 8.05],
  [65, 8.17],
  [69, 9.01],
  [72, 9.65],
  [84, 14.05],
  [96, 18.37],
  [108, 22.73],
];
export function strikeRatio(key: number): number {
  let i = 0;
  while (i < STRIKE_LA.length - 2 && key > STRIKE_LA[i + 1][0]) i++;
  const [k0, a0] = STRIKE_LA[i],
    [k1, a1] = STRIKE_LA[i + 1];
  return 1 / (a0 + ((a1 - a0) * (key - k0)) / (k1 - k0));
}

/** 決まった乱数（鍵と弦ごと） */
const hash = (a: number, b: number) => {
  let x = Math.imul(a * 73856093 + b * 19349663, 0x9e3779b1) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x85ebca6b) >>> 0;
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
};

/** ユニゾンの弦ごとの f1 のずれ [セント]（幅 u の中に、決まった乱数で置く。平均は 0） */
function unisonCents(key: number, ns: number, u: number): number[] {
  if (ns === 1) return [0];
  const c = Array.from({ length: ns }, (_, j) => (j / (ns - 1) - 0.5) * u * (0.6 + 0.8 * hash(key, j)));
  const m = c.reduce((a, b) => a + b, 0) / ns;
  return c.map((x) => x - m);
}

export function makePiano(spec: PianoSpec, fs: number): Piano {
  const f1 = tuning(spec.type, spec.a4, spec.stretch),
    board = makeBoard(spec.board),
    fmax = Math.min(F_MAX, 0.45 * fs),
    keys: KeyModes[] = [];
  for (let k = KEY_LO; k <= KEY_HI; k++) {
    const s = keyString(k, spec.type, f1[k - KEY_LO]),
      B = inharm(s),
      f0 = Math.sqrt(s.T / s.mu) / (2 * s.L),
      cents = unisonCents(k, s.ns, spec.unison);
    let N = 0;
    while (N < N_MAX && (N + 1) * f0 * Math.sqrt(1 + B * (N + 1) ** 2) < fmax) N++;
    const w: Float64Array[] = [],
      sg: Float64Array[] = [];
    for (let j = 0; j < s.ns; j++) {
      const r = 2 ** (cents[j] / 1200),
        wj = new Float64Array(N),
        sj = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        const n = i + 1,
          f = n * f0 * r * Math.sqrt(1 + B * n * n);
        wj[i] = 2 * Math.PI * f;
        sj[i] = (etaOf(s, n, f) * wj[i]) / 2;
      }
      w.push(wj);
      sg.push(sj);
    }
    const yr = new Float64Array(N),
      yi = new Float64Array(N),
      e2 = bridgeEnv(k);
    for (let i = 0; i < N; i++) {
      const y = admittance(board, C.cx(w[0][i]));
      yr[i] = e2 * y.re;
      yi[i] = e2 * y.im;
    }
    keys.push({ s, cents, N, w, sg, yr, yi, x0: strikeRatio(k) * s.L, e: Math.sqrt(e2) });
  }
  /* 共鳴を探す表 */
  const items: [number, number, number, number][] = [];
  keys.forEach((km, ki) => {
    for (let j = 0; j < km.s.ns; j++)
      for (let i = 0; i < km.N; i++) {
        const f = km.w[j][i] / (2 * Math.PI);
        if (f > SYM_FMAX + SYM_BW) break;
        items.push([f, ki + KEY_LO, j, i + 1]);
      }
  });
  items.sort((a, b) => a[0] - b[0]);
  const sym = {
    f: Float64Array.from(items, (x) => x[0]),
    key: Int16Array.from(items, (x) => x[1]),
    j: Int8Array.from(items, (x) => x[2]),
    n: Int16Array.from(items, (x) => x[3]),
  };
  return { spec, f1, keys, board, sym };
}

/* ---------- ハンマー ---------- */
/**
 * 鍵ごとのハンマー（Stulov の鍵盤全体の近似式。n は鍵の番号 1〜88）: 質量 m = 11.074 − 0.074n + 0.0001n² [g]、
 * 指数 p = 3.7 + 0.015n、硬さ Q₀ = 183 e^{0.045n} [N/mm^p]、ヒステリシス α = 248 + 1.83n − 0.055n² [µs]
 * （高音で負になるので 30 µs を下限とする）。hard は硬さに掛ける倍率（整音）。幅は概数
 */
export function hammerOf(key: number, hard = 1): Omit<HammerSpec, 'v'> {
  const n = key - KEY_LO + 1,
    p = 3.7 + 0.015 * n;
  return {
    m: (11.074 - 0.074 * n + 0.0001 * n * n) * 1e-3,
    p,
    K: 183 * Math.exp(0.045 * n) * hard * 1000 ** p,
    alpha: Math.max(30, 248 + 1.83 * n - 0.055 * n * n) * 1e-6,
    w: (10 - (6 * (n - 1)) / 87) * 1e-3,
  };
}

/** 打鍵の指定 */
export interface StrikeSpec {
  key: number;
  /** ハンマーの速さ [m/s] */
  v: number;
  /** ソフトペダル（ユニゾンの 1 本を打たない） */
  soft: boolean;
  /** ダンパーが上がっている鍵（共鳴できる弦） */
  free: (key: number) => boolean;
  /** 鍵盤の音の大きさ（1 が標準、0 でなし） */
  thump?: number;
}

/** 打鍵 1 回の結果（AudioWorklet へ送れる形） */
export interface StrikeMsg {
  key: number;
  /** モードの数 */
  N: number;
  /** 角周波数 [rad/s]・減衰率 [1/s]・駒の力の複素振幅（打った時刻での値） [N] */
  w: Float64Array;
  s: Float64Array;
  fr: Float64Array;
  fi: Float64Array;
  /** モードの持ち主の鍵（ダンパーで止める相手）と、ダンパーが触れたときに増える減衰率 [1/s] */
  own: Int16Array;
  sd: Float64Array;
  /** 衝突の間の、自由振動からのずれの力 [N]（打った時刻から） */
  att: Float32Array;
}

/** 表示用: 打った鍵の弦（1 本目）の変位の部分音ごとの成分（固有モードの和） */
export interface StringView {
  key: number;
  L: number;
  x0: number;
  /** 部分音 n の成分: 固有モードごとの複素振幅 [m] と複素角周波数 */
  parts: { n: number; ar: number[]; ai: number[]; lr: number[]; li: number[] }[];
}

export interface Strike {
  msg: StrikeMsg;
  view: StringView;
  contact: Contact;
  hammer: HammerSpec;
}

/**
 * ダンパーが触れたときに増える減衰率 [1/s]（部分音 n）。第 1 部分音の T60 は A0 で 1.5 s、G2 で 0.75 s、
 * G3 で 0.45 s、C6 で 0.25 s（Lehtonen・Askenfelt・Välimäki 2009 の G2・G3 の実測から延ばした概数）。
 * フェルトは弦長の 0.12〜0.18 の区間を押さえるとし、その区間での sin²(nπx/L) の平均で重みを付ける
 * （区間の中に節がある部分音は止まりにくい。Bank 2000 の 7 次ごとの部分音）。高い部分音ほど速く止まる。
 * pol は偏波の重み（ダンパーは主に垂直の振動を止める）
 */
export function damperRate(km: KeyModes, n: number, pol = 1): number {
  const key = km.s.key;
  if (key >= NO_DAMPER) return 0;
  const t60 = Math.exp(
      key <= 43
        ? Math.log(1.5) + ((Math.log(0.75) - Math.log(1.5)) * (key - 21)) / 22
        : key <= 55
          ? Math.log(0.75) + ((Math.log(0.45) - Math.log(0.75)) * (key - 43)) / 12
          : Math.log(0.45) + (Math.log(0.25) - Math.log(0.45)) * Math.min(1, (key - 55) / 29),
    ),
    a = 0.12,
    b = 0.18,
    k = 2 * n * Math.PI,
    w = 0.5 - (Math.sin(k * b) - Math.sin(k * a)) / (2 * k * (b - a));
  return pol * (Math.log(1000) / t60) * (0.15 + 1.7 * w) * (1 + (n / 10) ** 2);
}

/**
 * 鍵を打つ。ハンマーの衝突を解き、離れたあとの弦のモードを、駒で結合したモードに分ける。
 * 垂直の偏波は、ダンパーが上がっていて部分音が近いほかの弦も含めて結合を解く（共鳴）。
 * known は、同じ鍵・速さ・ソフトペダルで前に解いた衝突（あれば解き直さない）
 */
export function strikeKey(P: Piano, sp: StrikeSpec, fs: number, known?: Contact): Strike {
  const ki = sp.key - KEY_LO,
    km = P.keys[ki],
    s = km.s,
    N = km.N,
    hs: HammerSpec = { ...hammerOf(sp.key, P.spec.hard * (sp.soft ? 0.75 : 1)), v: sp.v },
    /* 打つ弦（ソフトペダルなら 3 本弦は 2 本、2 本弦は 1 本） */
    struck = Array.from({ length: s.ns }, (_, j) => !(sp.soft && s.ns > 1 && j === s.ns - 1)),
    nStruck = struck.filter(Boolean).length,
    st: StruckString = { L: s.L, mu: s.mu, T: s.T, ns: nStruck, x0: km.x0, w: km.w[0], s: km.sg[0] },
    ct = known ?? strike(st, hs, fs),
    g = s.T / s.L,
    T1 = ct.n1 / fs;
  const out: Modes = { W: [], S: [], FR: [], FI: [], OWN: [], SD: [] },
    { W, S, FR, FI, OWN, SD } = out;
  const view: StringView = { key: sp.key, L: s.L, x0: km.x0, parts: [] };
  /* 打った弦の部分音の、ハンマーが離れた時刻の駒の力の複素振幅 F = T (nπ/L) (−1)^{n+1} A */
  for (let i = 0; i < N; i++) {
    const n = i + 1,
      wn = km.w[0][i],
      sgn = km.sg[0][i],
      /* 変位の解析信号 A: q = Re A、q̇ = Re(A (iω − σ)) */
      Ar = ct.q[i],
      Ai = -(ct.dq[i] + sgn * ct.q[i]) / wn,
      kb = ((s.T * n * Math.PI) / s.L) * (n % 2 ? 1 : -1),
      Fr = kb * Ar,
      Fi = kb * Ai;
    if (Math.hypot(Fr, Fi) < 1e-9) continue;
    const yR = km.yr[i],
      yI = km.yi[i];
    /* 結合する弦: ユニゾンの弦と、共鳴する弦 */
    const osc: Osc[] = [];
    for (let j = 0; j < s.ns; j++)
      osc.push({ key: sp.key, j, n, w: km.w[j][i], sg: km.sg[j][i], g, yr: yR, yi: yI, rho: 1, e: km.e });
    const f = wn / (2 * Math.PI);
    if (f < SYM_FMAX) {
      const near = symNear(P, f, sp.key, sp.free);
      for (const x of near) {
        const o = P.keys[x.key - KEY_LO];
        osc.push({
          key: x.key,
          j: x.j,
          n: x.n,
          w: o.w[x.j][x.n - 1],
          sg: o.sg[x.j][x.n - 1],
          g: o.s.T / o.s.L,
          yr: o.yr[x.n - 1],
          yi: o.yi[x.n - 1],
          rho: SYM_RHO,
          e: o.e,
        });
      }
    }
    /* 垂直の偏波 */
    const amps = osc.map((o, k) => (k < s.ns && struck[k] ? 1 + IRREG * (2 * hash(sp.key * 7 + o.j, n) - 1) : 0));
    const vc = addCoupled(osc, 1, amps, Fr, Fi, T1, out, P);
    /* 水平の偏波（ユニゾンの弦だけ。ハンマーのむらで少しだけ揺れる） */
    const oh = osc.slice(0, s.ns),
      ah = oh.map((o, k) => (struck[k] ? HZ_AMP * (2 * hash(sp.key * 11 + o.j, n + 1000) - 1) : 0));
    addCoupled(oh, YH, ah, Fr, Fi, T1, out, P, HZ_RAD, HZ_DAMP);
    /* 表示: 1 本目の弦の垂直の変位の成分は、駒の力 ÷ (T nπ/L (−1)^{n+1}) */
    if (n <= 40) {
      const part = { n, ar: [] as number[], ai: [] as number[], lr: [] as number[], li: [] as number[] };
      view.parts.push(part);
      vc.forEach((c) => {
        part.ar.push(c.ar / kb);
        part.ai.push(c.ai / kb);
        part.lr.push(c.lr);
        part.li.push(c.li);
      });
    }
  }
  /* 衝突の間の力と、自由振動を打った時刻まで戻した力の差（自由振動は 1 標本ずつ複素数を掛けて回す） */
  const att = new Float32Array(ct.n1),
    M = W.length,
    zr = Float64Array.from(FR),
    zi = Float64Array.from(FI),
    mr = new Float64Array(M),
    mi = new Float64Array(M);
  for (let m = 0; m < M; m++) {
    const e = Math.exp(-S[m] / fs);
    mr[m] = e * Math.cos(W[m] / fs);
    mi[m] = e * Math.sin(W[m] / fs);
  }
  for (let t = 0; t < ct.n1; t++) {
    let free = 0;
    for (let m = 0; m < M; m++) {
      const r = zr[m],
        i = zi[m];
      free += r;
      zr[m] = r * mr[m] - i * mi[m];
      zi[m] = r * mi[m] + i * mr[m];
    }
    att[t] = ct.fb[t] * nStruck * km.e - free;
  }
  /* 鍵盤の音: 鍵が底に当たる衝撃が棚板と枠を通して響板へ伝わる。半周期の正弦の 2 乗の力のパルス */
  const nTh = Math.min(att.length, Math.round(THUMP_S * fs)),
    aTh = THUMP * (sp.thump ?? 1) * sp.v;
  for (let t = 0; t < nTh; t++) att[t] += aTh * Math.sin((Math.PI * t) / nTh) ** 2;
  const msg: StrikeMsg = {
    key: sp.key,
    N: M,
    w: Float64Array.from(W),
    s: Float64Array.from(S),
    fr: Float64Array.from(FR),
    fi: Float64Array.from(FI),
    own: Int16Array.from(OWN),
    sd: Float64Array.from(SD),
    att,
  };
  return { msg, view, contact: ct, hammer: hs };
}

/** 足していくモードの列 */
interface Modes {
  W: number[];
  S: number[];
  FR: number[];
  FI: number[];
  OWN: number[];
  SD: number[];
}

/**
 * 結合した部分音を解いて、モードを out に足す。osc は結合する弦の部分音（先頭がユニゾンの弦）、
 * yk は駒のアドミタンスに掛ける比（水平の偏波）、amps は弦ごとの打つ強さ、(Fr, Fi) は打った弦 1 本の駒の力、
 * rad は響板へ伝わる力の比、damp はダンパーの効きの比。時刻は、ハンマーが離れた時刻 T1 から打った時刻へ戻して出す。
 * 返すのは、固有モードごとの 1 本目の弦の駒の力の成分（表示用）
 */
function addCoupled(
  osc: Osc[],
  yk: number,
  amps: number[],
  Fr: number,
  Fi: number,
  T1: number,
  out: Modes,
  P: Piano,
  rad = 1,
  damp = 1,
): { ar: number; ai: number; lr: number; li: number }[] {
  const n = osc.length,
    d = cvec(n),
    v = cvec(n),
    w0 = cvec(n),
    sqg: number[] = [];
  osc.forEach((o, j) => {
    const yr = yk * o.yr,
      yi = yk * o.yi,
      r2 = o.rho * o.rho;
    /* 弦だけ + 階数 1 で表せない分の駒の損失（ほかの鍵の弦） */
    d.re[j] = o.w - (1 - r2) * o.g * yi + 1e-7 * o.w * (j + 1);
    d.im[j] = o.sg + (1 - r2) * o.g * yr;
    const [a, b] = csqrt(o.g * yr * r2, o.g * yi * r2);
    v.re[j] = a;
    v.im[j] = b;
    sqg.push(Math.sqrt(o.g));
    /* w = F / √g */
    w0.re[j] = (amps[j] * Fr) / sqg[j];
    w0.im[j] = (amps[j] * Fi) / sqg[j];
  });
  const c = coupled(d, v),
    cc = project(c, w0),
    view: { ar: number; ai: number; lr: number; li: number }[] = [];
  for (let m = 0; m < n; m++) {
    const u = c.u[m];
    /* 響板へ入る力 Σ_j e_j √g_j u_mj c_m と、持ち主（成分の最も大きい弦の鍵） */
    let sr = 0,
      si = 0,
      best = 0,
      own = osc[0].key,
      on = osc[0].n;
    for (let j = 0; j < n; j++) {
      sr += osc[j].e * sqg[j] * u.re[j];
      si += osc[j].e * sqg[j] * u.im[j];
      const a = Math.hypot(u.re[j], u.im[j]);
      if (a > best) {
        best = a;
        own = osc[j].key;
        on = osc[j].n;
      }
    }
    const lr = c.lam.re[m],
      li = c.lam.im[m],
      /* T1 から 0 へ戻す: × e^{−iλ T1} */
      e = Math.exp(li * T1),
      cs = Math.cos(lr * T1),
      sn = Math.sin(lr * T1),
      back = (xr: number, xi: number): [number, number] => [e * (xr * cs + xi * sn), e * (xi * cs - xr * sn)],
      [fr, fi] = back(sr * cc.re[m] - si * cc.im[m], sr * cc.im[m] + si * cc.re[m]),
      /* 1 本目の弦の成分（表示用）: F_1 = √g_1 u_m1 c_m */
      [vr, vi] = back(
        sqg[0] * (u.re[0] * cc.re[m] - u.im[0] * cc.im[m]),
        sqg[0] * (u.re[0] * cc.im[m] + u.im[0] * cc.re[m]),
      );
    view.push({ ar: vr, ai: vi, lr, li });
    if (Math.hypot(fr, fi) < 1e-9) continue;
    out.W.push(lr);
    out.S.push(Math.max(1e-3, li));
    out.FR.push(fr * rad);
    out.FI.push(fi * rad);
    out.OWN.push(own);
    out.SD.push(damperRate(P.keys[own - KEY_LO], on, damp));
  }
  return view;
}

/** 結合する弦の部分音 */
interface Osc {
  key: number;
  j: number;
  n: number;
  w: number;
  sg: number;
  /** T / L [N/m] */
  g: number;
  /** 駒のアドミタンス（駒の位置の比を掛けたもの） */
  yr: number;
  yi: number;
  /** 打った鍵の弦との結合の比（ほかの鍵の弦は弱める） */
  rho: number;
  /** 駒の位置による響板への伝わりやすさ */
  e: number;
}

/** 部分音 f [Hz] の近くの、ダンパーが上がっているほかの鍵の弦の部分音（近い順に SYM_N 個まで） */
function symNear(
  P: Piano,
  f: number,
  key: number,
  free: (k: number) => boolean,
): { key: number; j: number; n: number }[] {
  const { sym } = P,
    lo = f - SYM_BW;
  /* 二分探索 */
  let a = 0,
    b = sym.f.length;
  while (a < b) {
    const m = (a + b) >> 1;
    if (sym.f[m] < lo) a = m + 1;
    else b = m;
  }
  const cand: { key: number; j: number; n: number; df: number }[] = [];
  for (let i = a; i < sym.f.length && sym.f[i] <= f + SYM_BW; i++) {
    const k = sym.key[i];
    if (k === key || !free(k)) continue;
    cand.push({ key: k, j: sym.j[i], n: sym.n[i], df: Math.abs(sym.f[i] - f) });
  }
  cand.sort((x, y) => x.df - y.df);
  return cand.slice(0, SYM_N);
}

export type { CVec };
export { KEYS };
