/**
 * エレキギターの音の部品（DOM に依存しない）: 双一次変換・IIR・双 2 次（RBJ の式）・1 次の低域通過・
 * 状態変数フィルタ（TPT）・遅延線・記憶のない非線形と 1 次の原始関数による折り返しの抑え（ADAA）
 */
export const TAU = 2 * Math.PI;
export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const dbToG = (d: number): number => 10 ** (d / 20);

/** 係数（昇べき）。b が分子、a が分母 */
export interface Poly {
  b: number[];
  a: number[];
}

const conv = (p: readonly number[], q: readonly number[]): number[] => {
  const r = new Array<number>(p.length + q.length - 1).fill(0);
  for (let i = 0; i < p.length; i++) for (let j = 0; j < q.length; j++) r[i + j] += p[i] * q[j];
  return r;
};
const pow = (p: readonly number[], k: number): number[] => {
  let r = [1];
  for (let i = 0; i < k; i++) r = conv(r, p);
  return r;
};

/** s の多項式（昇べき）を双一次変換 s = 2fs (1 − z⁻¹)/(1 + z⁻¹) で z⁻¹ の多項式に（a[0] = 1 にそろえる） */
export function bilinear({ b, a }: Poly, fs: number): Poly {
  const N = Math.max(b.length, a.length) - 1,
    K = 2 * fs;
  const tr = (p: readonly number[]): number[] => {
    const r = new Array<number>(N + 1).fill(0);
    for (let k = 0; k <= N; k++) {
      const c = (p[k] ?? 0) * K ** k;
      if (!c) continue;
      const t = conv(pow([1, -1], k), pow([1, 1], N - k));
      for (let i = 0; i <= N; i++) r[i] += c * t[i];
    }
    return r;
  };
  const B = tr(b),
    A = tr(a),
    a0 = A[0];
  return { b: B.map((x) => x / a0), a: A.map((x) => x / a0) };
}

/** 直接形 II 転置の IIR（次数 n） */
export class IIR {
  private readonly b: Float64Array;
  private readonly a: Float64Array;
  private readonly z: Float64Array;
  constructor(private readonly n = 2) {
    this.b = new Float64Array(n + 1);
    this.a = new Float64Array(n + 1);
    this.z = new Float64Array(n + 1);
    this.b[0] = 1;
    this.a[0] = 1;
  }
  set({ b, a }: Poly): this {
    for (let i = 0; i <= this.n; i++) {
      this.b[i] = b[i] ?? 0;
      this.a[i] = a[i] ?? 0;
    }
    return this;
  }
  reset(): void {
    this.z.fill(0);
  }
  run(x: number): number {
    const { b, a, z, n } = this,
      y = b[0] * x + z[0];
    for (let i = 1; i < n; i++) z[i - 1] = b[i] * x - a[i] * y + z[i];
    z[n - 1] = b[n] * x - a[n] * y;
    return y;
  }
}

export type BiqType = 'lp' | 'hp' | 'bp' | 'pk' | 'hs';
/** 双 2 次の係数（RBJ Audio EQ Cookbook）。db は山・棚の高さ */
export function rbj(type: BiqType, f: number, Q: number, fs: number, db = 0): Poly {
  const w = (TAU * clamp(f, 5, fs * 0.45)) / fs,
    cs = Math.cos(w),
    al = Math.sin(w) / (2 * Q),
    A = 10 ** (db / 40);
  let b: number[], a: number[];
  if (type === 'lp') {
    b = [(1 - cs) / 2, 1 - cs, (1 - cs) / 2];
    a = [1 + al, -2 * cs, 1 - al];
  } else if (type === 'hp') {
    b = [(1 + cs) / 2, -(1 + cs), (1 + cs) / 2];
    a = [1 + al, -2 * cs, 1 - al];
  } else if (type === 'bp') {
    b = [al, 0, -al];
    a = [1 + al, -2 * cs, 1 - al];
  } else if (type === 'pk') {
    b = [1 + al * A, -2 * cs, 1 - al * A];
    a = [1 + al / A, -2 * cs, 1 - al / A];
  } else {
    const sq = 2 * Math.sqrt(A) * al;
    b = [A * (A + 1 + (A - 1) * cs + sq), -2 * A * (A - 1 + (A + 1) * cs), A * (A + 1 + (A - 1) * cs - sq)];
    a = [A + 1 - (A - 1) * cs + sq, 2 * (A - 1 - (A + 1) * cs), A + 1 - (A - 1) * cs - sq];
  }
  const a0 = a[0];
  return { b: b.map((x) => x / a0), a: a.map((x) => x / a0) };
}

/** 1 次の低域通過 */
export class OnePole {
  private k = 0;
  private y = 0;
  lp(f: number, fs: number): this {
    this.k = Math.exp((-TAU * f) / fs);
    return this;
  }
  run(x: number): number {
    this.y = x + this.k * (this.y - x);
    return this.y;
  }
}

/** z 変換の応答の大きさ |H(e^{jω})| */
export function zmag({ b, a }: Poly, f: number, fs: number): number {
  const w = (TAU * f) / fs;
  let br = 0,
    bi = 0,
    ar = 0,
    ai = 0;
  for (let i = 0; i < b.length; i++) {
    br += b[i] * Math.cos(w * i);
    bi -= b[i] * Math.sin(w * i);
  }
  for (let i = 0; i < a.length; i++) {
    ar += a[i] * Math.cos(w * i);
    ai -= a[i] * Math.sin(w * i);
  }
  return Math.hypot(br, bi) / Math.hypot(ar, ai);
}
/** s の多項式の応答の大きさ |H(jω)| */
export function smag({ b, a }: Poly, f: number): number {
  const w = TAU * f;
  const ev = (p: readonly number[]): number => {
    let re = 0,
      im = 0;
    for (let k = 0; k < p.length; k++) {
      const m = p[k] * w ** k;
      if (k % 4 === 0) re += m;
      else if (k % 4 === 1) im += m;
      else if (k % 4 === 2) re -= m;
      else im -= m;
    }
    return Math.hypot(re, im);
  };
  return ev(b) / ev(a);
}

/** 遅延線（小数の遅れは線形補間） */
export class Delay {
  private readonly buf: Float32Array;
  private i = 0;
  constructor(n: number) {
    this.buf = new Float32Array(Math.max(2, Math.ceil(n)));
  }
  push(x: number): void {
    this.buf[this.i] = x;
    this.i = (this.i + 1) % this.buf.length;
  }
  clear(): void {
    this.buf.fill(0);
  }
  /** d サンプル前の値 */
  read(d: number): number {
    const n = this.buf.length,
      p = this.i - 1 - d,
      i0 = Math.floor(p),
      fr = p - i0,
      a = this.buf[((i0 % n) + n) % n],
      b = this.buf[(((i0 + 1) % n) + n) % n];
    return a + (b - a) * fr;
  }
}

/** 状態変数フィルタ（Zavalishin の TPT。係数を毎サンプル変えても安定）。低域と帯域の出力を返す */
export class Svf {
  private s1 = 0;
  private s2 = 0;
  lp = 0;
  bp = 0;
  run(x: number, f: number, Q: number, fs: number): void {
    const g = Math.tan((Math.PI * f) / fs),
      k = 1 / Q,
      hp = (x - this.s1 * (g + k) - this.s2) / (1 + g * (g + k)),
      bp = g * hp + this.s1;
    this.s1 = g * hp + bp;
    const lp = g * bp + this.s2;
    this.s2 = g * bp + lp;
    this.lp = lp;
    this.bp = bp;
  }
}

/* ---------- 記憶のない非線形 ---------- */
const logcosh = (x: number): number => {
  const a = Math.abs(x);
  return a + Math.log1p(Math.exp(-2 * a)) - Math.LN2;
};
/** 非線形 f と、その原始関数 F */
export interface Nl {
  f(x: number): number;
  F(x: number): number;
}
/** 真空管の段のバイアス（正と負の飽和がずれる）とファズの強い非対称 */
const TUBE_B = 0.35,
  FUZZ_B = 0.8;
export const NL = {
  soft: { f: Math.tanh, F: logcosh },
  hard: { f: (x: number) => clamp(x, -1, 1), F: (x: number) => (Math.abs(x) < 1 ? 0.5 * x * x : Math.abs(x) - 0.5) },
  tube: {
    f: (x: number) => Math.tanh(x + TUBE_B) - Math.tanh(TUBE_B),
    F: (x: number) => logcosh(x + TUBE_B) - Math.tanh(TUBE_B) * x,
  },
  fuzz: {
    f: (x: number) => Math.tanh(x + FUZZ_B) - Math.tanh(FUZZ_B),
    F: (x: number) => logcosh(x + FUZZ_B) - Math.tanh(FUZZ_B) * x,
  },
} satisfies Record<string, Nl>;
export type NlKind = keyof typeof NL;

/** 1 次の原始関数で折り返しを抑えた非線形（Bilbao ほか 2017）。y = (F(x) − F(x₋₁)) / (x − x₋₁) */
export class Shaper {
  private readonly k: Nl;
  private x1 = 0;
  private F1: number;
  constructor(kind: NlKind) {
    this.k = NL[kind];
    this.F1 = this.k.F(0);
  }
  run(x: number): number {
    const d = x - this.x1,
      Fx = this.k.F(x),
      y = Math.abs(d) < 1e-6 ? this.k.f(0.5 * (x + this.x1)) : (Fx - this.F1) / d;
    this.x1 = x;
    this.F1 = Fx;
    return y;
  }
}
