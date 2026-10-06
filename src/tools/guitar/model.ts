/**
 * 弦と胴をつないだ振動モードと、撥弦の初期条件（DOM に依存しない）。
 * 弦のモードは両端を単純支持した硬い弦（Fletcher 1964）で、駒のアドミタンスによる周波数と減衰の変化は
 * ω = ω₀ + i (T/L) Y(ω) を解いて求める（Gough 1981・Woodhouse 2004 の駒での結合。e^{iωt} の表し方）
 */
import { admittance, type Body, C, type Cx, cabs } from './body';
import { etaString, fretX, type StringPhys } from './strings';

/** ギター 1 台の設定から求めた値 */
export interface Guitar {
  /** 弦長 [m]・フレットの数 */
  L: number;
  frets: number;
  /** 1 弦から順の弦の物理量 */
  str: StringPhys[];
  body: Body;
}

/** 弦 1 本・1 つの押さえ方の振動モード（表板に垂直 v と平行 h の 2 つの偏波を並べる） */
export interface Modes {
  /** 振動する長さ [m] */
  L: number;
  /** 偏波ごとのモードの数（v が先、h が後。モード番号は 1〜N） */
  N: number;
  /** 角周波数 [rad/s] と減衰率 [1/s]（長さ 2N） */
  w: Float64Array;
  s: Float64Array;
  /** 弦だけの減衰率 [1/s]（長さ N。胴の分を除いたもの） */
  s0: Float64Array;
}

/** 計算するモードの上限（数と周波数 [Hz]） */
const N_MAX = 160,
  F_MAX = 16000;
/** Newton 法で結合を解く上限の周波数 [Hz]（それより上は摂動の 1 次で十分） */
const F_NEWTON = 1500;

/** 駒で結合したモードの複素角周波数。ω₀ は弦だけのもの、k = T / L */
function couple(body: Body, w0: Cx, k: number, pol: 0 | 1): Cx {
  const g = (w: Cx): Cx => {
    const y = admittance(body, w, pol);
    /* ω − ω₀ − i k Y(ω) */
    return C.sub(C.sub(w, w0), C.cx(-k * y.im, k * y.re));
  };
  const y0 = admittance(body, C.cx(w0.re), pol),
    wp = C.add(w0, C.cx(-k * y0.im, k * y0.re));
  if (w0.re / (2 * Math.PI) > F_NEWTON) return wp;
  let w = wp;
  const h = 1e-6 * w0.re;
  for (let i = 0; i < 8; i++) {
    const gw = g(w),
      d = C.scl(C.sub(g(C.add(w, C.cx(h))), gw), 1 / h),
      dw = C.div(gw, d);
    w = C.sub(w, dw);
    if (!Number.isFinite(w.re) || !Number.isFinite(w.im)) return wp;
    if (cabs(dw) < 1e-10 * w0.re) break;
  }
  /* 胴のモードの側の根へ移ったら、摂動の値を使う */
  return cabs(C.sub(w, w0)) <= 2 * cabs(C.sub(wp, w0)) + 1e-9 && w.im > 0 ? w : wp;
}

/**
 * 弦 si（0 = 1 弦）をフレット fret で押さえたときのモード。fs はサンプリング周波数（ナイキストの手前まで）、
 * nMax はモードの数の上限。
 * 押さえた位置からナット側は指で止まるとし、駒側の長さだけが振動する
 */
export function modesOf(g: Guitar, si: number, fret: number, fs: number, nMax = N_MAX): Modes {
  const p = g.str[si],
    L = g.L - fretX(g.L, fret),
    k = p.T / L,
    c = Math.sqrt(p.T / p.mu),
    beta = (Math.PI ** 2 * p.B) / (p.T * L * L),
    fmax = Math.min(F_MAX, 0.45 * fs);
  let N = 0;
  while (N < nMax) {
    const n = N + 1;
    if (((n * c) / (2 * L)) * Math.sqrt(1 + beta * n * n) > fmax) break;
    N = n;
  }
  const w = new Float64Array(2 * N),
    s = new Float64Array(2 * N),
    s0 = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const n = i + 1,
      f = ((n * c) / (2 * L)) * Math.sqrt(1 + beta * n * n),
      wn = 2 * Math.PI * f,
      sg = (etaString(p, L, n, f) * wn) / 2;
    s0[i] = sg;
    for (const pol of [0, 1] as const) {
      const r = couple(g.body, C.cx(wn, sg), k, pol);
      w[pol * N + i] = r.re;
      s[pol * N + i] = Math.max(sg, r.im);
    }
  }
  return { L, N, w, s, s0 };
}

/**
 * 開放弦の第 1 部分音が、胴と結合したあとで f [Hz] になる張力（弦の T を 2 回直す）。
 * 胴の共振の近くでは結合で音程が少しずれるので、チューナーで合わせるのと同じように補う
 */
export function tuneCoupled(g: Guitar, si: number, f: number): number {
  const p = g.str[si];
  let T = p.T;
  for (let k = 0; k < 2; k++) {
    const str = g.str.slice();
    str[si] = { ...p, T };
    const m = modesOf({ ...g, str }, si, 0, 1e9, 1),
      f1 = m.w[0] / (2 * Math.PI);
    T *= (f / f1) ** 2;
  }
  return T;
}

/**
 * 弾くもの: 弦に触れる幅 [m] と、弦が離れていく時間 [s]（指の腹は柔らかく、ゆっくり離れる。
 * 指先の丸みと柔らかさが高い倍音を弱める: Woodhouse 2004）
 */
export const TOOLS = [
  { v: 'finger', name: '指', w: 12e-3, rel: 8e-5 },
  { v: 'nail', name: '爪', w: 3e-3, rel: 3e-5 },
  { v: 'pick', name: 'ピック', w: 1e-3, rel: 1.5e-5 },
] as const;
export type Tool = (typeof TOOLS)[number]['v'];
export const toolOf = (v: string) => TOOLS.find((t) => t.v === v) ?? TOOLS[0];

/** 撥弦の指定 */
export interface PluckSpec {
  /** 弾く位置（駒からの距離） [m] */
  pos: number;
  /** 弦を引く量（弾く位置での変位） [m] */
  amp: number;
  /** 弦に触れる幅 [m] */
  width: number;
  /** 弦が離れていく時間 [s] */
  rel: number;
  /** 弾く向き（表板からの角度。0 は表板に平行、π/2 は垂直） [rad] */
  angle: number;
}

/** 撥弦の初期条件: 各モードの変位の振幅 [m] と、駒にかかる力の振幅 [N]（Modes と同じ並び） */
export interface Pluck {
  modes: Modes;
  a: Float64Array;
  f: Float64Array;
  /** 離した瞬間に駒にかかっている力（垂直・平行） [N] */
  f0: [number, number];
}

/**
 * 弾く位置を頂点とする三角形に弦を引き、静かに離す。指の幅 w で角を丸め（sinc を掛ける）、
 * 離れていく時間 τ で高い周波数を弱める（exp(−(ωτ)²/2) を掛ける）。
 * a_n = 2 A L² / (n² π² x (L − x)) · sin(nπx/L) · sinc(nπw / 2L)、駒の力 F_n = T (nπ/L) (−1)^{n+1} a_n
 */
export function pluckOf(g: Guitar, si: number, m: Modes, sp: PluckSpec): Pluck {
  const { L, N } = m,
    T = g.str[si].T,
    x = Math.min(L - 1e-3, Math.max(1e-3, L - sp.pos)),
    a = new Float64Array(2 * N),
    f = new Float64Array(2 * N),
    cv = Math.sin(sp.angle),
    ch = Math.cos(sp.angle),
    f0: [number, number] = [0, 0];
  for (let i = 0; i < N; i++) {
    const n = i + 1,
      k = (n * Math.PI) / L,
      u = (k * sp.width) / 2,
      sinc = u < 1e-9 ? 1 : Math.sin(u) / u,
      wt = m.w[i] * sp.rel,
      an =
        ((2 * sp.amp * L * L) / (n * n * Math.PI * Math.PI * x * (L - x))) *
        Math.sin(k * x) *
        sinc *
        Math.exp((-wt * wt) / 2),
      fn = T * k * (n % 2 ? 1 : -1) * an;
    a[i] = an * cv;
    a[N + i] = an * ch;
    f[i] = fn * cv;
    f[N + i] = fn * ch;
    f0[0] += f[i];
    f0[1] += f[N + i];
  }
  return { modes: m, a, f, f0 };
}

/**
 * 表示用: 弦の変位を sin(nπx/L) で展開した係数 [m]（弾く向きへの成分）。to は振動の位相を進める時刻、
 * td は減衰に使う時刻 [s]（スローで見るときは to を遅らせる）。nMax までのモード
 */
export function coefAt(p: Pluck, to: number, td: number, dir: number, nMax = 60): Float64Array {
  const { N, w, s } = p.modes,
    cv = Math.sin(dir),
    ch = Math.cos(dir),
    n1 = Math.min(N, nMax),
    c = new Float64Array(n1);
  for (let i = 0; i < n1; i++)
    c[i] =
      cv * p.a[i] * Math.exp(-s[i] * td) * Math.cos(w[i] * to) +
      ch * p.a[N + i] * Math.exp(-s[N + i] * td) * Math.cos(w[N + i] * to);
  return c;
}

/** 係数 c から、振動する長さ L の弦の、駒から xb [m] の点の変位 [m] */
export function shapeOf(c: Float64Array, L: number, xb: number): number {
  const x = L - xb;
  let y = 0;
  for (let i = 0; i < c.length; i++) y += c[i] * Math.sin(((i + 1) * Math.PI * x) / L);
  return y;
}

/** 減衰時間 T60 [s]（振幅が 1/1000 になるまで） */
export const t60 = (sigma: number): number => Math.log(1000) / sigma;
