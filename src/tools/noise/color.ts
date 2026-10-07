/**
 * 色のノイズのフィルタ（DOM に依存しない）: 白色雑音（分散 1）を通して、ピンク・ブラウン・ブルー・バイオレット・グレーにする。
 * 周波数応答 |H|² と、インパルス応答のエネルギー Σh²（実効値をそろえる割り算に使う）も求める
 */

export type Filtered = 'pink' | 'brown' | 'blue' | 'violet' | 'gray';

/**
 * ピンク: Kellett の精密版（44.1 kHz で設計）。6 つの 1 次の低域通過の和と直達の項
 * H(z) = Σ w_k / (1 − p_k z⁻¹) + K0 + K1 z⁻¹
 */
export const KP = [0.99886, 0.99332, 0.969, 0.8665, 0.55, -0.7616] as const;
export const KW = [0.0555179, 0.0750759, 0.153852, 0.3104856, 0.5329522, -0.016898] as const;
export const K0 = 0.5362,
  K1 = 0.115926;

/** ブラウン: 漏れのある積分の極の周波数（Hz） */
export const FC_BROWN = 5;
/**
 * 1 次差分 1 − z⁻¹ と積分 1 / (1 − z⁻¹) の高域のずれ（fs/4 より上で ω から離れる）を補う極・零の位置 −c。
 * 48 kHz で 20 Hz〜20 kHz のずれが最も小さくなる値（このツールで求めた）
 */
export const COMP = 0.166;

/** A 特性の極の周波数（IEC 61672-1:2013）: f1（重根）・f2・f3・f4（重根） */
export const FA = [20.598997, 107.65265, 737.86223, 12194.217] as const;
/** グレーで A 特性の逆数に掛ける 4 次バターワースの高域通過の遮断周波数（Hz） */
export const FHP = 20;
/**
 * グレーの 12.2 kHz の 2 つの零を近似する双 2 次（零 z1・z2、極 p1・p2、実数）。
 * 標本化周波数ごとに、20 Hz〜20 kHz の目標とのずれが最も小さくなるよう、このツールで当てはめた
 */
const GRAY_HF: Record<number, readonly [number, number, number, number]> = {
  44100: [-0.6522265, 0.2741876, -0.6861343, -0.3367361],
  48000: [0.3045706, 0.1271075, -0.3752189, 0.1134546],
};

/** 双 2 次の節 [b0, b1, b2, a1, a2]（H = (b0 + b1 z⁻¹ + b2 z⁻²) / (1 + a1 z⁻¹ + a2 z⁻²)） */
export type Sec = readonly [number, number, number, number, number];

const TAU = 2 * Math.PI;
/** 整合 z 変換: s = −2πf の実の極・零 → z = e^{−2πf/fs} */
const mz = (f: number, fs: number) => Math.exp((-TAU * f) / fs);

/**
 * グレーの節: A 特性の逆数（f1・f1・f2・f3 の零、整合 z 変換）× 4 次バターワースの高域通過の極（整合 z 変換）、
 * 12.2 kHz の零の組は当てはめた双 2 次
 */
export function graySecs(fs: number): Sec[] {
  const [f1, f2, f3] = FA,
    z1 = mz(f1, fs),
    z2 = mz(f2, fs),
    z3 = mz(f3, fs),
    pole = (th: number): [number, number] => {
      const r = Math.exp((TAU * FHP * Math.cos(th)) / fs),
        a = (TAU * FHP * Math.sin(th)) / fs;
      return [-2 * r * Math.cos(a), r * r];
    },
    [a1, a2] = pole((5 * Math.PI) / 8),
    [c1, c2] = pole((7 * Math.PI) / 8),
    key = Object.keys(GRAY_HF)
      .map(Number)
      .reduce((b, k) => (Math.abs(k - fs) < Math.abs(b - fs) ? k : b)),
    [hz1, hz2, hp1, hp2] = GRAY_HF[key];
  return [
    [1, -2 * z1, z1 * z1, a1, a2],
    [1, -(z2 + z3), z2 * z3, c1, c2],
    [1, -(hz1 + hz2), hz1 * hz2, -(hp1 + hp2), hp1 * hp2],
  ];
}

/** 1 標本ずつ通すフィルタ */
export interface Filt {
  step(x: number): number;
}

class Kellett implements Filt {
  private readonly b = new Float64Array(6);
  private x1 = 0;
  step(x: number): number {
    const b = this.b;
    let y = K0 * x + K1 * this.x1;
    for (let k = 0; k < 6; k++) {
      b[k] = KP[k] * b[k] + KW[k] * x;
      y += b[k];
    }
    this.x1 = x;
    return y;
  }
}

/** (1 − z⁻¹) / (1 + c z⁻¹)（バイオレット、ブルーの後段） */
class Diff implements Filt {
  private x1 = 0;
  private y1 = 0;
  step(x: number): number {
    const y = x - this.x1 - COMP * this.y1;
    this.x1 = x;
    this.y1 = y;
    return y;
  }
}

/** (1 + c z⁻¹) / (1 − a z⁻¹)（ブラウン）。w は積分器の状態 */
export class Brown implements Filt {
  w = 0;
  constructor(readonly a: number) {}
  step(x: number): number {
    const w1 = this.w;
    this.w = this.a * w1 + x;
    return this.w + COMP * w1;
  }
}

/** 双 2 次の縦続（直接形 I） */
class Cascade implements Filt {
  private readonly st: Float64Array;
  constructor(private readonly secs: readonly Sec[]) {
    this.st = new Float64Array(secs.length * 4);
  }
  step(x: number): number {
    const st = this.st;
    let v = x;
    for (let i = 0; i < this.secs.length; i++) {
      const [b0, b1, b2, a1, a2] = this.secs[i],
        o = i * 4,
        y = b0 * v + b1 * st[o] + b2 * st[o + 1] - a1 * st[o + 2] - a2 * st[o + 3];
      st[o + 1] = st[o];
      st[o] = v;
      st[o + 3] = st[o + 2];
      st[o + 2] = y;
      v = y;
    }
    return v;
  }
}

class Chain implements Filt {
  constructor(
    private readonly a: Filt,
    private readonly b: Filt,
  ) {}
  step(x: number): number {
    return this.b.step(this.a.step(x));
  }
}

export const brownA = (fs: number): number => mz(FC_BROWN, fs);

/** 色のフィルタを作る（状態は 0） */
export function makeFilt(kind: Filtered, fs: number): Filt {
  switch (kind) {
    case 'pink':
      return new Kellett();
    case 'blue':
      return new Chain(new Kellett(), new Diff());
    case 'violet':
      return new Diff();
    case 'brown':
      return new Brown(brownA(fs));
    default:
      return new Cascade(graySecs(fs));
  }
}

/* ---------- 周波数応答 ---------- */
type Cx = [number, number];
/** e^{−jkω} */
const ej = (w: number, k: number): Cx => [Math.cos(k * w), -Math.sin(k * w)];
const cmul = (a: Cx, b: Cx): Cx => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cdiv = (a: Cx, b: Cx): Cx => {
  const m = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / m, (a[1] * b[0] - a[0] * b[1]) / m];
};
const abs2 = (a: Cx) => a[0] * a[0] + a[1] * a[1];

function kellettH(w: number): Cx {
  const z1 = ej(w, 1);
  let h: Cx = [K0 + K1 * z1[0], K1 * z1[1]];
  for (let k = 0; k < 6; k++) {
    const t = cdiv([KW[k], 0], [1 - KP[k] * z1[0], -KP[k] * z1[1]]);
    h = [h[0] + t[0], h[1] + t[1]];
  }
  return h;
}
const diffH = (w: number): Cx => {
  const z1 = ej(w, 1);
  return cdiv([1 - z1[0], -z1[1]], [1 + COMP * z1[0], COMP * z1[1]]);
};
function secH(s: Sec, w: number): Cx {
  const z1 = ej(w, 1),
    z2 = ej(w, 2);
  return cdiv(
    [s[0] + s[1] * z1[0] + s[2] * z2[0], s[1] * z1[1] + s[2] * z2[1]],
    [1 + s[3] * z1[0] + s[4] * z2[0], s[3] * z1[1] + s[4] * z2[1]],
  );
}

/** |H(e^{jω})|²（f は Hz） */
export function resp(kind: Filtered, f: number, fs: number): number {
  const w = (TAU * f) / fs;
  switch (kind) {
    case 'pink':
      return abs2(kellettH(w));
    case 'blue':
      return abs2(cmul(kellettH(w), diffH(w)));
    case 'violet':
      return abs2(diffH(w));
    case 'brown': {
      const a = brownA(fs),
        z1 = ej(w, 1);
      return abs2(cdiv([1 + COMP * z1[0], COMP * z1[1]], [1 - a * z1[0], -a * z1[1]]));
    }
    default:
      return graySecs(fs).reduce((p, s) => p * abs2(secH(s, w)), 1);
  }
}

/** A 特性の振幅（1 kHz で約 −2 dB。IEC 61672-1 の正規化の +2 dB を足す前） */
export function aWeight(f: number): number {
  const [f1, f2, f3, f4] = FA,
    f2s = f * f;
  return (f4 * f4 * f2s * f2s) / ((f2s + f1 * f1) * Math.sqrt((f2s + f2 * f2) * (f2s + f3 * f3)) * (f2s + f4 * f4));
}
/** グレーの目標の振幅: A 特性の逆数 × 4 次バターワースの高域通過（FHP） */
export const grayTarget = (f: number): number => (1 / aWeight(f)) * (f ** 4 / Math.sqrt(f ** 8 + FHP ** 8));

/* ---------- エネルギー ---------- */
const eCache = new Map<string, number>();
/** インパルス応答のエネルギー Σh²（白色雑音（分散 1）を通したときの出力の分散） */
export function energy(kind: Filtered, fs: number): number {
  const key = `${kind}${fs}`,
    hit = eCache.get(key);
  if (hit !== undefined) return hit;
  const f = makeFilt(kind, fs);
  let e = 0,
    tail = 0;
  /* 直近 4096 点の寄与が全体の 1e−13 を下回るまで */
  for (let n = 0; n < 1 << 22; n++) {
    const h = f.step(n === 0 ? 1 : 0),
      h2 = h * h;
    e += h2;
    tail += h2;
    if ((n & 4095) === 4095) {
      if (n > 8192 && tail < e * 1e-13) break;
      tail = 0;
    }
  }
  eCache.set(key, e);
  return e;
}

/** 状態が定常になるまでの標本数（最も遅い極の時定数の 12 倍） */
export function settle(kind: Filtered, fs: number): number {
  const tau = (p: number) => -1 / Math.log(Math.abs(p));
  switch (kind) {
    case 'pink':
    case 'blue':
      return Math.ceil(12 * tau(KP[0]));
    case 'violet':
      return 64;
    case 'brown':
      return 0;
    default:
      /* バターワースの極のうち減衰の遅いほう（偏角 5π/8） */
      return Math.ceil(12 * tau(Math.exp((TAU * FHP * Math.cos((5 * Math.PI) / 8)) / fs)));
  }
}
