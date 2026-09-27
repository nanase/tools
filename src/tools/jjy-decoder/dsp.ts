/**
 * 音声から包絡線を取り出す（DOM に依存しない）: 直交検波と、搬送波の周波数の推定。
 * AudioWorklet・Worker・メインスレッドで共用する
 */

/** 直交検波: 搬送波の整数周期（5 ms 以上）で平均し、1 ms ごとに振幅を出す */
export class Env {
  /** 検波に使っている周波数（Hz） */
  f = 0;
  /** 平均する点数（窓の長さ） */
  N = 2;
  private readonly step: number;
  private n = 0;
  private next: number;
  private s2 = 0;
  private c2 = 0;
  private dph = 0;
  private ph = 0;
  private ri = new Float64Array(2);
  private rq = new Float64Array(2);
  private k = 0;
  private si = 0;
  private sq = 0;

  constructor(
    readonly fs: number,
    f: number,
  ) {
    this.step = fs / 1000;
    this.next = this.step;
    this.setF(f);
  }

  /** 検波の周波数を変える（窓を作り直す） */
  setF(f: number): void {
    const g = Math.min(Math.max(f, 1), this.fs * 0.49),
      p = Math.max(1, Math.ceil(0.005 * g));
    this.f = g;
    this.dph = (2 * Math.PI * g) / this.fs;
    this.ph = 0;
    this.N = Math.max(2, Math.round((p * this.fs) / g));
    this.ri = new Float64Array(this.N);
    this.rq = new Float64Array(this.N);
    this.k = 0;
    this.si = 0;
    this.sq = 0;
  }

  /** 窓の半分の遅れ（ms） */
  get lag(): number {
    return (this.N / 2 / this.fs) * 1000;
  }

  /** x を読み、振幅を out[o…]、平均電力を pw[o…] に書く。書き終えた次の位置を返す */
  run(x: ArrayLike<number>, out: Float32Array, o: number, pw: Float32Array): number {
    const { dph, ri, rq, N } = this,
      T = 2 * Math.PI;
    let { ph, k, si, sq, n, next, s2, c2 } = this;
    for (let j = 0; j < x.length; j++) {
      const v = x[j],
        i = v * Math.cos(ph),
        q = v * Math.sin(ph);
      ph += dph;
      if (ph >= T) ph -= T;
      si += i - ri[k];
      sq += q - rq[k];
      ri[k] = i;
      rq[k] = q;
      if (++k === N) k = 0;
      s2 += v * v;
      c2++;
      if (++n >= next) {
        out[o] = (2 * Math.sqrt(si * si + sq * sq)) / N;
        pw[o++] = s2 / c2;
        s2 = 0;
        c2 = 0;
        next += this.step;
      }
    }
    Object.assign(this, { ph, k, si, sq, n, next, s2, c2 });
    return o;
  }
}

export interface Peak {
  /** 周波数（Hz） */
  f: number;
  /** FFT の振幅 */
  a: number;
}

/** 最も振幅の大きい周波数（20 Hz 以上）: ハン窓の FFT と、対数振幅の 3 点の放物線補間。短すぎれば null */
export function peakF(x: ArrayLike<number>, fs: number, N: number): Peak | null {
  let n = N;
  while (n > x.length) n >>= 1;
  if (n < 1024) return null;
  const re = new Float64Array(n),
    im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  for (let i = 1, j = 0; i < n; i++) {
    let b = n >> 1;
    for (; j & b; b >>= 1) j ^= b;
    j ^= b;
    if (i < j) {
      const t = re[i];
      re[i] = re[j];
      re[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len,
      wr = Math.cos(a),
      wi = Math.sin(a),
      h = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1,
        ci = 0;
      for (let k = 0; k < h; k++) {
        const u = i + k,
          v = u + h,
          tr = re[v] * cr - im[v] * ci,
          ti = re[v] * ci + im[v] * cr;
        re[v] = re[u] - tr;
        im[v] = im[u] - ti;
        re[u] += tr;
        im[u] += ti;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
  const k0 = Math.max(2, Math.ceil((20 * n) / fs)),
    k1 = (n >> 1) - 2;
  let kb = k0,
    mb = -1;
  for (let k = k0; k <= k1; k++) {
    const m = re[k] * re[k] + im[k] * im[k];
    if (m > mb) {
      mb = m;
      kb = k;
    }
  }
  const L = (k: number) => 0.5 * Math.log(re[k] * re[k] + im[k] * im[k] + 1e-30);
  const al = L(kb - 1),
    be = L(kb),
    ga = L(kb + 1),
    dn = al - 2 * be + ga;
  const dl = dn < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (al - ga)) / dn)) : 0;
  return { f: ((kb + dl) * fs) / n, a: Math.sqrt(mb) };
}

/** ファイル全体の包絡線 */
export interface FileEnv {
  /** 検波に使った周波数（Hz）と、それを自動で決めたか */
  f: number;
  auto: boolean;
  /** 1 ms ごとの振幅と平均電力 */
  env: Float32Array;
  pw: Float32Array;
  /** 窓の半分の遅れ（ms） */
  lag: number;
  /** 全体の平均電力（dBFS） */
  lvl: number;
}

/**
 * ファイル: 搬送波を決め（fman が 0 なら自動。4 か所で探して最も強いもの）、全体の包絡線を求める。
 * 短すぎて周波数を探せなければ null
 */
export function analyzeFile(x: Float32Array, fs: number, fman: number): FileEnv | null {
  let f = fman;
  const auto = !(fman > 0);
  if (auto) {
    let best: Peak | null = null;
    const N = 32768;
    for (let i = 0; i < 4; i++) {
      const o = Math.floor((Math.max(0, x.length - N) * (i + 0.5)) / 4),
        r = peakF(x.subarray(o, o + N), fs, N);
      if (r && (!best || r.a > best.a)) best = r;
    }
    if (!best) return null;
    f = best.f;
  }
  const n = Math.ceil((x.length * 1000) / fs) + 2,
    env = new Float32Array(n),
    pw = new Float32Array(n),
    E = new Env(fs, f);
  const m = E.run(x, env, 0, pw);
  let s = 0;
  for (let i = 0; i < m; i++) s += pw[i];
  return {
    f: E.f,
    auto,
    env: env.subarray(0, m),
    pw: pw.subarray(0, m),
    lag: E.lag,
    lvl: 10 * Math.log10(s / Math.max(1, m) + 1e-12),
  };
}
