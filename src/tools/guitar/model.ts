/**
 * 弦と胴をつないだ振動モードと、撥弦の初期条件（DOM に依存しない）。
 * 弦のモードは両端を単純支持した硬い弦（Fletcher 1964）で、駒のアドミタンスによる周波数と減衰の変化は
 * ω = ω₀ + i (T/L) Y(ω) を解いて求める（Gough 1981・Woodhouse 2004 の駒での結合。e^{iωt} の表し方）
 */
import { coupled, csqrt, cvec, project } from '../piano/eig';
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
  /** 弦だけの角周波数 [rad/s] と減衰率 [1/s]（長さ N。胴の分を除いたもの） */
  w0: Float64Array;
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
    w0 = new Float64Array(N),
    s0 = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const n = i + 1,
      f = ((n * c) / (2 * L)) * Math.sqrt(1 + beta * n * n),
      wn = 2 * Math.PI * f,
      sg = (etaString(p, L, n, f) * wn) / 2;
    w0[i] = wn;
    s0[i] = sg;
    for (const pol of [0, 1] as const) {
      const r = couple(g.body, C.cx(wn, sg), k, pol);
      w[pol * N + i] = r.re;
      s[pol * N + i] = Math.max(sg, r.im);
    }
  }
  return { L, N, w, s, w0, s0 };
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
 * 弾くもの: 弦に触れる幅 w [m] と、指先の柔らかさで角をならす幅 soft [m]。どちらも高い倍音を弱める。
 * 指の soft は Woodhouse ら (2012) の 7.5 mm。爪とピックの soft は、触れる幅に合わせた目安
 */
export const TOOLS = [
  { v: 'finger', name: '指', w: 12e-3, soft: 7.5e-3 },
  { v: 'nail', name: '爪', w: 3e-3, soft: 3e-3 },
  { v: 'pick', name: 'ピック', w: 1e-3, soft: 1.5e-3 },
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
  /** 指先の柔らかさで角をならす幅 [m] */
  soft: number;
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
 * 指先の柔らかさの幅 w_s で高い倍音を弱める（exp(−(k_n w_s)²) を掛ける: Woodhouse ら 2012）。
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
      ks = k * sp.soft,
      an =
        ((2 * sp.amp * L * L) / (n * n * Math.PI * Math.PI * x * (L - x))) *
        Math.sin(k * x) *
        sinc *
        Math.exp(-ks * ks),
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

/** ほかの弦の共鳴を探す幅 [Hz]・部分音ごとの相手の数の上限・調べる部分音の上限 [Hz]（ピアノ音響モデルと同じ値） */
const SYM_BW = 2.5,
  SYM_N = 3,
  SYM_FMAX = 5000;

/** 共鳴の相手: 弾いていない弦（0 = 1 弦）と、今の押さえ方のモード */
export interface Partner {
  si: number;
  m: Modes;
}

/** 結合したモードの並び: 複素角周波数（実部 [rad/s]・減衰率 [1/s]）、駒の力の複素振幅 [N]、偏波（0 が垂直） */
export interface ModeSet {
  w: number[];
  s: number[];
  fr: number[];
  fi: number[];
  pol: number[];
}
const modeSet = (): ModeSet => ({ w: [], s: [], fr: [], fi: [], pol: [] });

/**
 * 撥弦の部分音を、部分音の近いほかの弦（partners）と駒で結合したモードに分ける（共鳴）。
 * 同じ駒の点につながる弦の部分音は、行列 D + i v vᵀ の固有値のモードになる（Gough 1981、piano/eig.ts）。
 * d_j は弦だけの複素角周波数、v_j² は 1 本ずつ胴と結合したときの移り −i (λ_j − d_j)（= (T_j / L_j) Y_j）で、
 * 相手がなければ今までのモードと同じになる。結合したモードは成分の最も大きい弦が持ち、
 * main は弾いた弦、sym はほかの弦が持つモード（弦ごと）
 */
export function symOf(
  g: Guitar,
  si: number,
  pl: Pluck,
  partners: readonly Partner[],
): { main: ModeSet; sym: Map<number, ModeSet> } {
  const m = pl.modes,
    N = m.N,
    main = modeSet(),
    sym = new Map<number, ModeSet>(),
    push = (o: ModeSet, w: number, s: number, fr: number, fi: number, pol: number) => {
      o.w.push(w);
      o.s.push(s);
      o.fr.push(fr);
      o.fi.push(fi);
      o.pol.push(pol);
    };
  for (const pol of [0, 1]) {
    for (let i = 0; i < N; i++) {
      const k0 = pol * N + i,
        F = pl.f[k0],
        lw = m.w[k0],
        ls = m.s[k0],
        f = lw / (2 * Math.PI);
      /* 部分音の近いほかの弦の部分音（近い順に SYM_N 個まで） */
      const near: { p: Partner; k: number; df: number }[] = [];
      if (f < SYM_FMAX && F !== 0)
        for (const p of partners) {
          const pm = p.m,
            f1 = pm.w[pol * pm.N] / (2 * Math.PI),
            c = Math.round(f / f1) - 1;
          for (let k = Math.max(0, c - 2); k <= Math.min(pm.N - 1, c + 2); k++) {
            const df = Math.abs(pm.w[pol * pm.N + k] / (2 * Math.PI) - f);
            if (df <= SYM_BW) near.push({ p, k, df });
          }
        }
      if (!near.length) {
        push(main, lw, ls, F, 0, pol);
        continue;
      }
      near.sort((a, b) => a.df - b.df);
      const osc = [
          { si, w: lw, s: ls, w0: m.w0[i], s0: m.s0[i], g: g.str[si].T / m.L },
          ...near.slice(0, SYM_N).map(({ p, k }) => ({
            si: p.si,
            w: p.m.w[pol * p.m.N + k],
            s: p.m.s[pol * p.m.N + k],
            w0: p.m.w0[k],
            s0: p.m.s0[k],
            g: g.str[p.si].T / p.m.L,
          })),
        ],
        n = osc.length,
        d = cvec(n),
        v = cvec(n),
        x0 = cvec(n);
      osc.forEach((o, j) => {
        /* 重なると固有ベクトルが求まらないので、ごくわずかにずらす */
        d.re[j] = o.w0 + 1e-7 * o.w0 * (j + 1);
        d.im[j] = o.s0;
        /* i v² = λ − d */
        [v.re[j], v.im[j]] = csqrt(o.s - o.s0, -(o.w - o.w0));
      });
      /* 初めは弾いた弦だけが力を持つ: F_j = √g_j x_j */
      x0.re[0] = F / Math.sqrt(osc[0].g);
      const c = coupled(d, v),
        cc = project(c, x0);
      for (let q = 0; q < n; q++) {
        const u = c.u[q];
        let fr = 0,
          fi = 0,
          best = 0,
          own = 0;
        for (let j = 0; j < n; j++) {
          const sg = Math.sqrt(osc[j].g),
            ur = u.re[j] * cc.re[q] - u.im[j] * cc.im[q],
            ui = u.re[j] * cc.im[q] + u.im[j] * cc.re[q];
          fr += sg * ur;
          fi += sg * ui;
          const a = Math.hypot(u.re[j], u.im[j]);
          if (a > best) {
            best = a;
            own = j;
          }
        }
        const o = own ? (sym.get(osc[own].si) ?? sym.set(osc[own].si, modeSet()).get(osc[own].si)) : main;
        if (o) push(o, c.lam.re[q], Math.max(1e-3, c.lam.im[q]), fr, fi, pol);
      }
    }
  }
  return { main, sym };
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

/**
 * 左手で弦を動かしたときの音の高さの比（ビブラート・チョーキング）。弦 p をフレット fret で押さえ、
 * 押さえた点で弦を横へ delta [m] 押し上げ、弦の向きへナット側に u [m] 引く（負なら駒の側へ押す）。
 * 押し上げると弦全体が δ²/2 (1/x_f + 1/L_v) だけ伸び、弦はフレットの上をすべって張力が全体でそろう
 * （Grimes 2014）。弦の向きの動きは指先が弦をつかむとして、振動する側（長さ L_v）だけを u / L_v 伸ばす。
 * ΔT = EA × ひずみ（A は芯線の断面）、f ∝ √T / 振動する長さ
 */
export function bendRatio(p: StringPhys, L: number, fret: number, delta: number, u: number): number {
  const xf = fretX(L, fret),
    Lv = L - xf;
  if (fret <= 0) return 1;
  const EA = (p.mat.Eax * Math.PI * p.dc * p.dc) / 4,
    dT = EA * ((delta * delta * (1 / xf + 1 / Lv)) / 2 / L + u / Lv),
    T = Math.max(0.1 * p.T, p.T + dT);
  return Math.sqrt(T / p.T) / Math.sqrt(1 + (delta * delta) / (Lv * Lv));
}
