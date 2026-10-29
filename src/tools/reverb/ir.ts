/**
 * インパルス応答（DOM に依存しない）: 鏡像法の反射を帯域ごとに並べ、閉じた部屋では鏡像を数えきった時刻から先を
 * 指数で減衰する雑音で延ばす（Polack の統計モデル）。減衰の速さは既定で Eyring の式（拡散音場を仮定）。
 * 鏡のような反射だけの直方体の部屋は拡散音場にならず、細長い部屋や吸音の多い部屋では減衰が Eyring より遅い。
 * 実際の部屋は面の凹凸の散乱で拡散に近づくので、延ばす部分は拡散音場の式に合わせる（仮）。
 * 帯域ごとの列は、和が 1 になる周波数の重みで分けて足す（帯域がすべて同じなら、元のインパルス列そのもの）。
 * 解析: Schroeder の逆向き積分で減衰曲線を出し、EDT・T20・T30・C80・D50 を求める（ISO 3382-1 の定義）
 */
import { Reverb } from '../../lib/reverb';
import { fft, type Plan, plan } from '../spectrum/fft';
import { type Images, images } from './image';
import { acoustics, BANDS, C0, dist, NB, type Room } from './room';

/* ---------- 帯域の重み ---------- */

/**
 * 周波数 f [Hz] での帯域 b の重み。隣り合う中心周波数の間を、対数周波数で cos² と sin² で受け渡す。
 * どの f でも帯域の重みの和は 1。最も低い帯域は 125 Hz より下、最も高い帯域は 4 kHz より上をすべて受け持つ
 */
export function bandWeight(b: number, f: number): number {
  if (f <= 0) return b === 0 ? 1 : 0;
  const x = Math.log2(f / BANDS[0]);
  if (b === 0 && x <= 0) return 1;
  if (b === NB - 1 && x >= NB - 1) return 1;
  const d = x - b;
  return Math.abs(d) >= 1 ? 0 : Math.cos((Math.PI / 2) * d) ** 2;
}

/** 実数の列 re の、その場の逆変換（実部だけを返す。入力のスペクトルはエルミートとする） */
function ifftReal(p: Plan): void {
  const { N, im, re } = p;
  for (let i = 0; i < N; i++) im[i] = -im[i];
  fft(p);
  for (let i = 0; i < N; i++) re[i] /= N;
}

const pow2 = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(2, n)));

/**
 * 帯域ごとの列 xs（NB 本・同じ長さ）を、帯域の重みで分けて 1 本にする。
 * 2 本ずつ複素数の実部・虚部に入れて変換し、Z[k] と Z[N−k] から分ける
 */
export function mixBands(xs: readonly Float64Array[], fs: number): Float64Array {
  const L = xs[0].length,
    /* 帯域の重みの応答は時間の前後に広がる（125 Hz の帯域で十数 ms）。前に回り込む分を後ろの 0 に逃がす */
    pad = Math.ceil(0.05 * fs),
    N = pow2(L + pad),
    p = plan(N),
    Yr = new Float64Array(N),
    Yi = new Float64Array(N),
    w = new Float64Array(N / 2 + 1);
  for (let b = 0; b < NB; b += 2) {
    p.re.fill(0);
    p.im.fill(0);
    p.re.set(xs[b]);
    if (b + 1 < NB) p.im.set(xs[b + 1]);
    fft(p);
    const wa = Float64Array.from(w, (_, k) => bandWeight(b, (k * fs) / N)),
      wb = Float64Array.from(w, (_, k) => (b + 1 < NB ? bandWeight(b + 1, (k * fs) / N) : 0));
    for (let k = 0; k < N; k++) {
      const j = (N - k) % N,
        kk = k <= N / 2 ? k : N - k,
        /* A = (Z[k] + conj Z[N−k]) / 2、B = (Z[k] − conj Z[N−k]) / 2j */
        ar = (p.re[k] + p.re[j]) / 2,
        ai = (p.im[k] - p.im[j]) / 2,
        br = (p.im[k] + p.im[j]) / 2,
        bi = -(p.re[k] - p.re[j]) / 2;
      Yr[k] += wa[kk] * ar + wb[kk] * br;
      Yi[k] += wa[kk] * ai + wb[kk] * bi;
    }
  }
  p.re.set(Yr);
  p.im.set(Yi);
  ifftReal(p);
  return p.re.slice(0, L);
}

/** 1 本の列を帯域ごとに分ける（解析用） */
export function splitBands(x: ArrayLike<number>, fs: number): Float64Array[] {
  const L = x.length,
    pad = Math.ceil(0.05 * fs),
    N = pow2(L + pad),
    p = plan(N),
    out: Float64Array[] = [];
  p.re.fill(0);
  p.im.fill(0);
  for (let i = 0; i < L; i++) p.re[i] = x[i];
  fft(p);
  const Xr = p.re.slice(),
    Xi = p.im.slice();
  for (let b = 0; b < NB; b++) {
    for (let k = 0; k < N; k++) {
      const g = bandWeight(b, ((k <= N / 2 ? k : N - k) * fs) / N);
      p.re[k] = Xr[k] * g;
      p.im[k] = Xi[k] * g;
    }
    ifftReal(p);
    out.push(p.re.slice(0, L));
  }
  return out;
}

/* ---------- 乱数 ---------- */

/** 再現できる乱数（mulberry32）。正規分布は Box–Muller */
export function gauss(seed: number): () => number {
  let a = seed >>> 0;
  const u = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(u() + 1e-300)) * Math.cos(2 * Math.PI * u());
}

/* ---------- 合成 ---------- */

/** 後部残響の減衰の速さの決め方: 鏡像の反射に当てはめる・Eyring の式・Sabine の式 */
export type TailModel = 'fit' | 'eyring' | 'sabine';

export interface SynthOpts {
  fs: number;
  /** インパルス応答の長さ [s] */
  dur: number;
  /** 数える鏡像の数の上限（閉じた部屋だけ。開いた部屋はすべて数える） */
  nMax?: number;
  tail?: TailModel;
  seed?: number;
  c?: number;
}

export interface Synth {
  /** インパルス応答（1 m 先の直接音が 1） */
  h: Float32Array;
  fs: number;
  im: Images;
  /** 雑音で延ばし始めた時刻 [s]（延ばさないなら Infinity） */
  tTail: number;
  /** 後部残響の帯域ごとの残響時間 [s]（延ばさないなら空） */
  tailT60: number[];
  /** 直接音の届く時刻 [s] */
  t0: number;
}

/** 時間の区切り [s]（当てはめの区間） */
const BIN = 0.005;

/**
 * 帯域 b の鏡像の反射の強さ（区間 BIN ごとのエネルギー）を、指数 E(t) = K e^{−t/τ} に最小二乗で当てはめる。
 * 区間は [t1, t2)。返すのは [ln K, 1/τ]（1 標本あたりのエネルギー）
 */
function fitDecay(im: Images, b: number, t1: number, t2: number, fs: number): [number, number] | null {
  const nb = Math.floor((t2 - t1) / BIN);
  if (nb < 4) return null;
  const e = new Float64Array(nb);
  for (let i = 0; i < im.n; i++) {
    const k = Math.floor((im.t[i] - t1) / BIN);
    if (k >= 0 && k < nb) e[k] += im.amp[i * NB + b] ** 2;
  }
  let sx = 0,
    sy = 0,
    sxx = 0,
    sxy = 0,
    m = 0;
  for (let k = 0; k < nb; k++) {
    if (e[k] <= 0) continue;
    const x = t1 + (k + 0.5) * BIN,
      y = Math.log(e[k] / (BIN * fs));
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
    m++;
  }
  if (m < 4) return null;
  const sl = (m * sxy - sx * sy) / (m * sxx - sx * sx),
    ic = (sy - sl * sx) / m;
  return sl < 0 ? [ic, -sl] : null;
}

/** 鏡像法と雑音の延長で、インパルス応答を作る */
export function synth(room: Room, o: SynthOpts): Synth {
  const { fs, dur } = o,
    c = o.c ?? C0,
    L = Math.ceil(dur * fs),
    ac = acoustics(room),
    im = images(room, { tMax: dur, nMax: ac.closed ? (o.nMax ?? 20000) : undefined, c }),
    xs = Array.from({ length: NB }, () => new Float64Array(L));
  /* 鏡像: 届く時刻を 2 つの標本に線形に分ける */
  for (let i = 0; i < im.n; i++) {
    const u = im.t[i] * fs,
      k = Math.floor(u),
      fr = u - k;
    if (k + 1 >= L) continue;
    for (let b = 0; b < NB; b++) {
      const a = im.amp[i * NB + b];
      xs[b][k] += (1 - fr) * a;
      xs[b][k + 1] += fr * a;
    }
  }
  const t0 = im.n ? im.t[0] : 0;
  let tTail = Infinity;
  const tailT60: number[] = [];
  /* 閉じた部屋で、鏡像を数えきった時刻が長さより前なら、その先を雑音で延ばす */
  if (ac.closed && im.tEnd < dur) {
    tTail = im.tEnd;
    const rnd = gauss(o.seed ?? 1),
      k0 = Math.floor(tTail * fs),
      /* 雑音の入り口を 5 ms でなめらかに */
      kf = Math.max(1, Math.round(0.005 * fs)),
      model = o.tail ?? 'eyring',
      noise = new Float64Array(L - k0);
    for (let k = 0; k < noise.length; k++) noise[k] = rnd();
    for (let b = 0; b < NB; b++) {
      /* 当てはめの区間: 混合時間（直接音から）か、数えきった時刻の半分の、遅い方から */
      const t1 = Math.max(t0 + ac.tMix, tTail / 2),
        fit = fitDecay(im, b, t1, tTail, fs);
      let lnK: number, rate: number;
      if (model === 'fit' && fit) [lnK, rate] = fit;
      else {
        const T = model === 'sabine' ? ac.sab[b] : ac.eyr[b];
        rate = (6 * Math.LN10) / T;
        /* 強さは、数えきる直前の区間の鏡像のエネルギーにつなぐ。鏡像が足りなければ拡散音場の式 4πc / V */
        const tw = Math.min(0.05, tTail / 4);
        let e = 0;
        for (let i = 0; i < im.n; i++) if (im.t[i] >= tTail - tw && im.t[i] < tTail) e += im.amp[i * NB + b] ** 2;
        lnK = e > 0 ? Math.log(e / (tw * fs)) + rate * (tTail - tw / 2) : Math.log((4 * Math.PI * c) / (ac.V * fs));
      }
      tailT60.push((6 * Math.LN10) / rate);
      const x = xs[b];
      for (let k = 0; k < noise.length; k++) {
        const t = (k0 + k) / fs,
          g = Math.exp(0.5 * (lnK - rate * t)) * Math.min(1, (k + 1) / kf);
        x[k0 + k] += g * noise[k];
      }
    }
  }
  const h = mixBands(xs, fs);
  return { h: Float32Array.from(h), fs, im, tTail, tailT60, t0 };
}

/* ---------- 解析 ---------- */

/** Schroeder の逆向き積分 E(t) = ∫_t^∞ h²(τ) dτ を dB（E(0) が 0 dB）で */
export function edc(h: ArrayLike<number>): Float64Array {
  const n = h.length,
    e = new Float64Array(n);
  let s = 0;
  for (let i = n - 1; i >= 0; i--) {
    s += h[i] * h[i];
    e[i] = s;
  }
  const e0 = e[0] || 1;
  for (let i = 0; i < n; i++) e[i] = 10 * Math.log10(Math.max(e[i] / e0, 1e-30));
  return e;
}

/**
 * 減衰曲線の [hi, lo] dB の区間（例: −5〜−25 dB）を直線で当てはめ、60 dB 減る時間 [s] にする。
 * 区間に届かなければ NaN
 */
export function decayTime(e: ArrayLike<number>, fs: number, hi: number, lo: number): number {
  let i1 = -1,
    i2 = -1;
  for (let i = 0; i < e.length; i++) {
    if (i1 < 0 && e[i] <= hi) i1 = i;
    if (e[i] <= lo) {
      i2 = i;
      break;
    }
  }
  if (i1 < 0 || i2 <= i1) return NaN;
  let sx = 0,
    sy = 0,
    sxx = 0,
    sxy = 0;
  const m = i2 - i1 + 1;
  for (let i = i1; i <= i2; i++) {
    const x = i / fs;
    sx += x;
    sy += e[i];
    sxx += x * x;
    sxy += x * e[i];
  }
  const sl = (m * sxy - sx * sy) / (m * sxx - sx * sx);
  return sl < 0 ? -60 / sl : NaN;
}

/** 室内音響の指標（ISO 3382-1）。帯域ごと */
export interface Params {
  edt: number[];
  t20: number[];
  t30: number[];
  /** 明瞭度 C80 [dB]・音声の明瞭さ D50（0〜1） */
  c80: number[];
  d50: number[];
}

/** 直接音の届く標本 k0 から測った、[k0 + a, k0 + b) のエネルギー */
function energy(h: ArrayLike<number>, k1: number, k2: number): number {
  let s = 0;
  for (let i = Math.max(0, k1); i < Math.min(h.length, k2); i++) s += h[i] * h[i];
  return s;
}

/** 帯域ごとの指標。t0 は直接音の届く時刻 [s]（C80・D50 の時刻の起点） */
export function params(h: ArrayLike<number>, fs: number, t0: number): Params {
  const bands = splitBands(h, fs),
    k0 = Math.max(0, Math.floor(t0 * fs) - Math.round(0.002 * fs)),
    k50 = Math.floor(t0 * fs) + Math.round(0.05 * fs),
    k80 = Math.floor(t0 * fs) + Math.round(0.08 * fs),
    out: Params = { edt: [], t20: [], t30: [], c80: [], d50: [] };
  for (const x of bands) {
    const e = edc(x.subarray(k0));
    out.edt.push(decayTime(e, fs, 0, -10));
    out.t20.push(decayTime(e, fs, -5, -25));
    out.t30.push(decayTime(e, fs, -5, -35));
    const all = energy(x, k0, x.length),
      e50 = energy(x, k0, k50),
      e80 = energy(x, k0, k80);
    out.c80.push(10 * Math.log10(e80 / Math.max(all - e80, 1e-30)));
    out.d50.push(e50 / Math.max(all, 1e-30));
  }
  return out;
}

/* ---------- 直接音・初期反射・後部残響 ---------- */

/** 初期反射と後部残響の境目（直接音から） [s]。仮: C80 と同じ 80 ms */
export const EARLY_S = 0.08;

export type Part = 'direct' | 'early' | 'late';
/** 届く時刻 t の反射の区分（t0 は直接音の時刻） */
export const partOf = (t: number, t0: number): Part =>
  t <= t0 + 1e-9 ? 'direct' : t - t0 <= EARLY_S ? 'early' : 'late';

/* ---------- エコー ---------- */

/**
 * エコーの基準（Dietsch・Kraak 1986。値は Martín-Castizo ほか 2025 の表 1 で確かめた）: 重みの指数 n、
 * 差分の窓 Δτ_E [s]、閾（聞き手の 50 % が気づく値）、応答を絞る帯域 [Hz]
 */
export const EK = {
  speech: { n: 2 / 3, win: 0.009, crit: 1.0, lo: 700, hi: 1400 },
  music: { n: 1, win: 0.014, crit: 1.8, lo: 700, hi: 2800 },
} as const;

/** 帯域 [lo, hi] Hz に絞る（FFT。端は 1/6 オクターブで cos² になめらかに落とす） */
export function bandLimit(x: ArrayLike<number>, fs: number, lo: number, hi: number): Float64Array {
  const L = x.length,
    N = pow2(L + Math.ceil(0.05 * fs)),
    p = plan(N),
    e = 2 ** (1 / 6);
  p.re.fill(0);
  p.im.fill(0);
  for (let i = 0; i < L; i++) p.re[i] = x[i];
  fft(p);
  const g = (f: number) => {
    if (f <= lo / e || f >= hi * e) return 0;
    if (f >= lo && f <= hi) return 1;
    const d = f < lo ? Math.log(lo / f) : Math.log(f / hi);
    return Math.cos(((Math.PI / 2) * d) / Math.log(e)) ** 2;
  };
  for (let k = 0; k < N; k++) {
    const w = g(((k <= N / 2 ? k : N - k) * fs) / N);
    p.re[k] *= w;
    p.im[k] *= w;
  }
  ifftReal(p);
  return p.re.slice(0, L);
}
export type EkKind = keyof typeof EK;

/**
 * エコーの基準の曲線 EK(τ) = (t_s(τ) − t_s(τ − Δτ_E)) / Δτ_E（差分の形は原著で未確認）。応答は EK の帯域に絞ってから使う。
 * t_s(τ) = ∫₀^τ t |h|ⁿ dt / ∫₀^τ |h|ⁿ dt は、τ までの応答の重心の時刻。遅れて強い反射が来ると重心が跳ぶ
 */
export function ekCurve(h0: ArrayLike<number>, fs: number, t0 = 0, kind: EkKind = 'speech'): Float64Array {
  const { n, win, lo, hi } = EK[kind],
    h = bandLimit(h0, fs, lo, hi),
    L = h.length,
    /* 直接音より前（帯域の重みで前に広がった分）は数えない */
    k0 = Math.max(0, Math.round((t0 - 0.001) * fs)),
    ts = new Float64Array(L),
    out = new Float64Array(L),
    d = Math.max(1, Math.round(win * fs));
  let num = 0,
    den = 0;
  for (let i = k0; i < L; i++) {
    const w = Math.abs(h[i]) ** n;
    num += (i / fs) * w;
    den += w;
    ts[i] = den > 0 ? num / den : 0;
  }
  /* 直接音が入って重心が 0 から跳ぶ所は除く */
  for (let i = k0 + 2 * d; i < L; i++) out[i] = (ts[i] - ts[i - d]) / win;
  return out;
}

/** これより早い反射はエコーとして数えない [s]（直接音から。EK の閾は 50 ms より後で使う） */
export const ECHO_MIN_S = 0.05;

/** エコーとして聞こえる反射: EK が閾を超えた区間ごとに、その頂点の時刻 [s]（直接音から）と EK の値 */
export interface Echo {
  dt: number;
  ek: number;
}

export function echoes(h: ArrayLike<number>, fs: number, t0: number, kind: EkKind = 'speech'): Echo[] {
  const ek = ekCurve(h, fs, t0, kind),
    { crit, win } = EK[kind],
    out: Echo[] = [];
  let top = -1;
  for (let i = 0; i <= ek.length; i++) {
    const v = i < ek.length ? ek[i] : 0;
    if (v >= crit) {
      if (top < 0 || v > ek[top]) top = i;
    } else if (top >= 0) {
      /* 重心は反射が入ると跳び、窓の半分ほど遅れて頂点になる */
      const dt = top / fs - win / 2 - t0,
        last = out[out.length - 1];
      /* 直接音から 50 ms までは数えない。窓の 2 倍より近い頂点は 1 つにまとめる */
      if (dt >= ECHO_MIN_S) {
        if (last && dt - last.dt < 2 * win) {
          if (ek[top] > last.ek) out[out.length - 1] = { dt, ek: ek[top] };
        } else out.push({ dt, ek: ek[top] });
      }
      top = -1;
    }
  }
  return out;
}

/** 2 つの列の畳み込み（FFT。長さは x + h − 1） */
export function convolve(x: ArrayLike<number>, h: ArrayLike<number>): Float64Array {
  const L = x.length + h.length - 1,
    N = pow2(L),
    p = plan(N);
  p.re.fill(0);
  p.im.fill(0);
  for (let i = 0; i < x.length; i++) p.re[i] = x[i];
  for (let i = 0; i < h.length; i++) p.im[i] = h[i];
  fft(p);
  /* X·H を、Z = X + jH の Z[k] と Z[N−k] から */
  const Yr = new Float64Array(N),
    Yi = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    const j = (N - k) % N,
      xr = (p.re[k] + p.re[j]) / 2,
      xi = (p.im[k] - p.im[j]) / 2,
      hr = (p.im[k] + p.im[j]) / 2,
      hi = -(p.re[k] - p.re[j]) / 2;
    Yr[k] = xr * hr - xi * hi;
    Yi[k] = xr * hi + xi * hr;
  }
  p.re.set(Yr);
  p.im.set(Yi);
  ifftReal(p);
  return p.re.slice(0, L);
}

/* ---------- 楽器のページの残響 ---------- */

/**
 * 同じ部屋の値で、楽器のページの残響（lib/reverb.ts のフィードバック遅延網）のインパルス応答を作る（左右）。
 * 残響時間は 500 Hz と 4 kHz の Eyring、直接音と残響音の比は聞き手の距離 ÷ 臨界距離、初期反射までは平均自由行程の半分。
 * 部屋の形も音源と聞き手の位置も使わないので、初期反射は出ない。直接音は時刻 0
 */
export function fdnIR(room: Room, fs: number, dur: number, c = C0): [Float32Array, Float32Array] {
  const ac = acoustics(room),
    L = Math.ceil(dur * fs),
    l = new Float32Array(L),
    r = new Float32Array(L),
    rv = new Reverb(fs),
    wet = dist(room.src, room.rcv) / ac.rc[2];
  l[0] = r[0] = 1;
  rv.set({
    off: !ac.closed,
    t60: ac.eyr[2],
    t60Hi: ac.eyr[5],
    wet,
    norm: 1 / Math.sqrt(1 + wet * wet),
    pre: ac.mfp / 2 / c,
    mfpT: ac.mfp / c,
  });
  for (let i = 0; i < L; i += 128) rv.process(l, r, i, Math.min(128, L - i));
  return [l, r];
}
