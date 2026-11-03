/**
 * PCM の計算（DOM に依存しない）: 入力のローパス → 標本化 → 量子化 → 再生。
 * 入力は F [Hz] の浮動小数の列で、1 周でつながるものとして扱う（端はくり返す）
 */
import { rng } from '../wavelet/signals';

export type Law = 'lin' | 'mu' | 'a';
export type Rc = 'smooth' | 'stair';

export interface PcmSet {
  /** 標本化周波数 [Hz] */
  fs: number;
  /** ビット数。null は量子化しない */
  bits: number | null;
  law: Law;
  /** TPDF のディザ（線形のときだけ） */
  dith: boolean;
  /** 入力のローパス */
  aa: boolean;
  /** 出力のローパス（smooth）か階段のままか（stair） */
  rc: Rc;
}

export interface Quant {
  y: Float64Array;
  /** 誤差（y − s） */
  e: Float64Array;
  /** 2 の補数の値（G.711 は符号語を符号付きに直した順位） */
  code: Int32Array;
  /** SN 比 [dB]（誤差がなければ Infinity） */
  snr: number;
}

const TAU = 2 * Math.PI;
export const mod = (a: number, n: number): number => ((a % n) + n) % n;
const sinc = (v: number) => (Math.abs(v) < 1e-9 ? 1 : Math.sin(Math.PI * v) / (Math.PI * v));

/* ---------- 窓付き sinc の表（u は標本の間隔を 1 とする距離。ハン窓で ±Z 標本） ---------- */
const Z = 12,
  TB = 4096;
/** 入力のローパスの −6 dB の点（標本化周波数に対する比。ナイキスト周波数の手前で落とす） */
export const AA_CUT = 0.46;
const tabA = new Float64Array(TB + 2),
  tabR = new Float64Array(TB + 2);
for (let i = 0; i <= TB + 1; i++) {
  const u = (i / TB) * Z,
    w = u >= Z ? 0 : 0.5 + 0.5 * Math.cos((Math.PI * u) / Z),
    c = 2 * AA_CUT;
  tabA[i] = sinc(c * u) * c * w;
  tabR[i] = sinc(u) * w;
}

/** 標本化。aa で入力のローパスを通す（fs ≥ F では通さず、線形補間で読む） */
export function sample(x: ArrayLike<number>, F: number, fs: number, aa: boolean): Float64Array {
  const N = x.length,
    Nf = Math.max(1, Math.round((N * fs) / F)),
    s = new Float64Array(Nf),
    r = N / Nf;
  if (!aa || fs >= F) {
    for (let n = 0; n < Nf; n++) {
      const c = n * r,
        j = Math.floor(c),
        a = c - j;
      s[n] = x[j % N] * (1 - a) + x[(j + 1) % N] * a;
    }
    return s;
  }
  const hw = Z * r,
    sc = TB / (r * Z),
    g = 1 / r;
  for (let n = 0; n < Nf; n++) {
    const c = n * r,
      j0 = Math.ceil(c - hw),
      j1 = Math.floor(c + hw);
    let v = 0;
    for (let j = j0; j <= j1; j++) {
      const jj = j < 0 ? j + N : j >= N ? j - N : j;
      v += x[jj] * tabA[(Math.abs(j - c) * sc) | 0];
    }
    s[n] = v * g;
  }
  return s;
}

/* ---------- G.711（8 bit の折れ線。16 ビットの線形との変換は Sun の参照実装 g711.c と同じ手順） ---------- */
const MU_BIAS = 0x84,
  MU_CLIP = 32635;
/** μ-law の符号語（ビットは反転済み） */
export function muEncode(pcm16: number): number {
  let p = pcm16 | 0;
  const sign = p < 0 ? 0x80 : 0;
  if (sign) p = -p;
  if (p > MU_CLIP) p = MU_CLIP;
  p += MU_BIAS;
  let exp = 7;
  for (let m = 0x4000; exp > 0 && !(p & m); m >>= 1) exp--;
  const man = (p >> (exp + 3)) & 0x0f;
  return ~(sign | (exp << 4) | man) & 0xff;
}
export function muDecode(code: number): number {
  const u = ~code & 0xff,
    t = (((u & 0x0f) << 3) + MU_BIAS) << ((u & 0x70) >> 4);
  return u & 0x80 ? MU_BIAS - t : t - MU_BIAS;
}
const A_SEG = [0x1f, 0x3f, 0x7f, 0xff, 0x1ff, 0x3ff, 0x7ff, 0xfff];
/** A-law の符号語（偶数ビットは反転済み） */
export function aEncode(pcm16: number): number {
  let p = pcm16 >> 3;
  let mask = 0xd5;
  if (p < 0) {
    mask = 0x55;
    p = -p - 1;
  }
  let seg = 0;
  while (seg < 8 && p > A_SEG[seg]) seg++;
  if (seg >= 8) return 0x7f ^ mask;
  const v = (seg << 4) | ((seg < 2 ? p >> 1 : p >> seg) & 0x0f);
  return v ^ mask;
}
export function aDecode(code: number): number {
  const a = code ^ 0x55,
    seg = (a & 0x70) >> 4;
  let t = (a & 0x0f) << 4;
  if (seg === 0) t += 8;
  else t = (t + 0x108) << (seg - 1);
  return a & 0x80 ? t : -t;
}
/** G.711 の全レベル（FS = 1、昇順に 256 個） */
export function g711Levels(law: 'mu' | 'a'): Float64Array {
  const dec = law === 'mu' ? muDecode : aDecode,
    v = new Float64Array(256);
  for (let c = 0; c < 256; c++) v[c] = dec(c) / 32768;
  return v.sort();
}

const pcm16 = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v * 32768)));

/** ビット数 N の線形量子化のレベルの値（1 bit は ±0.5 の 2 値、2 bit 以上は 0 を含む 2 の補数） */
export const levelValue = (code: number, N: number): number =>
  N === 1 ? (code >= 0 ? 0.5 : -0.5) : code / 2 ** (N - 1);
/** 量子化ステップ（FS = 1） */
export const stepOf = (N: number): number => (N === 1 ? 1 : 2 ** (1 - N));

/** 量子化。G.711 はビット数によらず 8 bit */
export function quantize(s: ArrayLike<number>, bits: number, law: Law = 'lin', dith = false, seed = 7): Quant {
  const n = s.length,
    y = new Float64Array(n),
    e = new Float64Array(n),
    code = new Int32Array(n);
  let ps = 0,
    pe = 0;
  if (law !== 'lin') {
    const enc = law === 'mu' ? muEncode : aEncode,
      dec = law === 'mu' ? muDecode : aDecode;
    for (let i = 0; i < n; i++) {
      const v = s[i],
        c = enc(pcm16(v)),
        o = dec(c) / 32768;
      y[i] = o;
      e[i] = o - v;
      code[i] = c;
      ps += v * v;
      pe += (o - v) * (o - v);
    }
  } else {
    const L = 2 ** (bits - 1),
      r = rng(seed),
      d = dith && bits > 1;
    for (let i = 0; i < n; i++) {
      const v = s[i];
      let c: number, o: number;
      if (bits === 1) {
        c = v >= 0 ? 0 : -1;
        o = c === 0 ? 0.5 : -0.5;
      } else {
        c = Math.round(v * L + (d ? r() + r() - 1 : 0));
        if (c < -L) c = -L;
        else if (c > L - 1) c = L - 1;
        o = c / L;
      }
      y[i] = o;
      e[i] = o - v;
      code[i] = c;
      ps += v * v;
      pe += (o - v) * (o - v);
    }
  }
  return { y, e, code, snr: pe > 0 ? 10 * Math.log10(ps / pe) : Number.POSITIVE_INFINITY };
}

/** 再生（標本から F の列へ）。stair は階段のまま、smooth は窓付き sinc で補間する。fs ≥ F は間引くだけ */
export function restore(y: ArrayLike<number>, F: number, fs: number, N: number, rc: Rc): Float32Array {
  const o = new Float32Array(N),
    Nf = y.length,
    q = Nf / N;
  if (fs >= F || rc === 'stair') {
    for (let i = 0; i < N; i++) o[i] = y[Math.floor(i * q) % Nf];
    return o;
  }
  const sc = TB / Z;
  for (let i = 0; i < N; i++) {
    const c = i * q,
      n0 = Math.ceil(c - Z),
      n1 = Math.floor(c + Z);
    let v = 0;
    for (let n = n0; n <= n1; n++) {
      const nn = n < 0 ? n + Nf : n >= Nf ? n - Nf : n;
      v += y[nn] * tabR[(Math.abs(n - c) * sc) | 0];
    }
    o[i] = v;
  }
  return o;
}

/** 折り返したあとの周波数 [Hz] */
export const aliasOf = (f: number, fs: number): number => {
  const m = mod(f, fs);
  return m > fs / 2 ? fs - m : m;
};

/** 正弦波をフルスケールで量子化したときの SN 比の理論値 [dB] */
export const idealSnr = (bits: number): number => 6.02 * bits + 1.76;

/* ---------- 音源（どれも振幅の最大が 1。周期の音は長さに周期が整数回入るように周波数を丸める） ---------- */
const roundF = (f: number, dur: number) => Math.max(1, Math.round(f * dur)) / dur;
export function sine(f: number, F: number, dur: number): Float32Array {
  const n = Math.round(F * dur),
    w = (TAU * roundF(f, dur)) / F,
    x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.sin(w * i);
  return x;
}
/** のこぎり波（20 kHz までの倍音の和） */
export function saw(f: number, F: number, dur: number): Float32Array {
  const n = Math.round(F * dur),
    q = roundF(f, dur),
    H = Math.max(1, Math.floor(Math.min(20000, F / 2 - 1) / q)),
    x = new Float64Array(n);
  for (let h = 1; h <= H; h++) {
    const w = (TAU * q * h) / F,
      a = 1 / h,
      /* 漸化式で正弦を進める（倍音ごとに Math.sin を呼ぶと重い） */
      k = 2 * Math.cos(w);
    let s1 = 0,
      s2 = -Math.sin(w);
    for (let i = 0; i < n; i++) {
      const v = s1;
      x[i] += a * v;
      s1 = k * s1 - s2;
      s2 = v;
    }
  }
  return peak1(x);
}
/** 減衰音（440 Hz。1 秒で 20 dB 下がる） */
export function decay(F: number, dur: number): Float32Array {
  const n = Math.round(F * dur),
    x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / F;
    x[i] = Math.sin(TAU * 440 * t) * 10 ** -t * Math.min(1, t / 0.002);
  }
  return x;
}
/** スイープ（100 Hz〜20 kHz の対数掃引） */
export function sweep(F: number, dur: number): Float32Array {
  const n = Math.round(F * dur),
    f0 = 100,
    f1 = Math.min(20000, F / 2 - 1),
    k = Math.log(f1 / f0) / dur,
    x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / F;
    x[i] = Math.sin(TAU * (f0 / k) * (Math.exp(k * t) - 1)) * Math.min(1, t / 0.01, (dur - t) / 0.01);
  }
  return x;
}
function peak1(x: ArrayLike<number>): Float32Array {
  let m = 1e-9;
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
  const o = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) o[i] = x[i] / m;
  return o;
}
export const normalize = peak1;

/* ---------- スペクトル ---------- */
/** 基数 2 の FFT（その場で） */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let b = n >> 1;
    for (; j & b; b >>= 1) j ^= b;
    j ^= b;
    if (i < j) {
      const a = re[i];
      re[i] = re[j];
      re[j] = a;
      const c = im[i];
      im[i] = im[j];
      im[j] = c;
    }
  }
  for (let l = 2; l <= n; l <<= 1) {
    const h = l >> 1,
      w = -TAU / l,
      c1 = Math.cos(w),
      s1 = Math.sin(w);
    for (let i = 0; i < n; i += l) {
      let c = 1,
        s = 0;
      for (let j = 0; j < h; j++) {
        const a = i + j,
          b = a + h,
          rv = re[b] * c - im[b] * s,
          iv = re[b] * s + im[b] * c;
        re[b] = re[a] - rv;
        im[b] = im[a] - iv;
        re[a] += rv;
        im[a] += iv;
        const t = c * c1 - s * s1;
        s = c * s1 + s * c1;
        c = t;
      }
    }
  }
}
/** 中心 c（標本の番号）の M 点の振幅スペクトル [dB]（ハン窓。振幅 1 の正弦波が 0 dB） */
export function specAt(x: ArrayLike<number>, c: number, M: number): Float64Array {
  const re = new Float64Array(M),
    im = new Float64Array(M),
    n = x.length,
    c0 = Math.floor(c - M / 2);
  let sw = 0;
  for (let i = 0; i < M; i++) {
    const w = 0.5 - 0.5 * Math.cos((TAU * i) / M);
    sw += w;
    re[i] = x[mod(c0 + i, n)] * w;
  }
  fft(re, im);
  const out = new Float64Array(M / 2 + 1);
  for (let k = 0; k <= M / 2; k++) out[k] = 10 * Math.log10(((re[k] * re[k] + im[k] * im[k]) * 4) / (sw * sw) + 1e-16);
  return out;
}
