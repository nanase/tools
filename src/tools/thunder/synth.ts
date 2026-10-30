/**
 * 雷鳴のページの音（DOM に依存しない）: 要素ごとの N 波を届く時刻に足し、区間ごとに距離の分の空気の吸収を掛ける。
 * 区間の中の N 波を線形に足すので、区間の向きによる指向性（横から聞くと鋭く、端から聞くとなまる）は足し合わせから出る。
 * 要素の N 波は、隣の要素との届く時刻の差の幅にならして足す（放電路を点の列でなく、つながった線として聞く）
 */
import { AIR_N, type Air, AirFilter, airPole } from '../../lib/air';
import { fft } from '../biquad/filter';
import type { Elements } from './path';
import { addNWaveBox } from './shock';

export interface Wave {
  /** 音圧 [Pa] */
  y: Float32Array;
  fs: number;
  /** y[0] の時刻 [s]（光った時刻が 0） */
  t0: number;
  /** 音圧の最大の絶対値 [Pa] */
  peak: number;
}

/** 最初の衝撃の前に置く余白 [s] */
const PRE = 0.05;
/** 吸収の低域通過の尾を、時定数の何倍まで計算するか */
const TAIL_TAU = 12;

/** 経路を選んで波形を作る（via の集合を省くとすべて） */
export function render(el: Elements, air: Air, fs: number, vias?: ReadonlySet<number>): Wave {
  let tMin = Number.POSITIVE_INFINITY,
    tMax = 0;
  for (let k = 0; k < el.nSeg; k++) {
    if (vias && !vias.has(el.segVia[k])) continue;
    for (let i = el.segStart[k]; i < el.segEnd[k]; i++) {
      tMin = Math.min(tMin, el.t[i]);
      tMax = Math.max(tMax, el.t[i] + el.segT[k] * 2);
    }
  }
  if (!Number.isFinite(tMin)) return { y: new Float32Array(1), fs, t0: 0, peak: 0 };
  const t0 = tMin - PRE,
    poles = new Map<number, number>(),
    f = new AirFilter();
  /* 尾の長さは最も遠い区間の時定数で見積もる */
  let maxTail = 0;
  const pole = (r: number) => {
    /* 同じくらいの距離は同じ係数を使う（距離を 1 % 刻みに丸める） */
    const key = Math.round(Math.log(Math.max(r, 1)) * 100);
    let p = poles.get(key);
    if (p === undefined) {
      p = airPole(Math.exp(key / 100), fs, air);
      poles.set(key, p);
    }
    return p;
  };
  for (let k = 0; k < el.nSeg; k++) maxTail = Math.max(maxTail, (TAIL_TAU * AIR_N) / (1 - pole(el.segR[k])));
  const out = new Float64Array(Math.ceil((tMax - t0) * fs + maxTail) + 1);
  let buf = new Float64Array(1024),
    wb = new Float64Array(64);
  for (let k = 0; k < el.nSeg; k++) {
    if (vias && !vias.has(el.segVia[k])) continue;
    const a = el.segStart[k],
      b = el.segEnd[k],
      T = el.segT[k] * fs;
    /* 要素が受け持つ時間の幅 [標本]: 隣の要素との届く時刻の差（両隣があれば小さい方） */
    if (wb.length < b - a) wb = new Float64Array(2 * (b - a));
    let lo = Number.POSITIVE_INFINITY,
      hi = 0,
      wmax = 0;
    for (let i = a; i < b; i++) {
      lo = Math.min(lo, el.t[i]);
      hi = Math.max(hi, el.t[i]);
      const dp = i > a ? Math.abs(el.t[i] - el.t[i - 1]) : Number.POSITIVE_INFINITY,
        dn = i + 1 < b ? Math.abs(el.t[i + 1] - el.t[i]) : Number.POSITIVE_INFINITY,
        W = Math.min(dp, dn);
      wb[i - a] = Number.isFinite(W) ? W * fs : 0;
      wmax = Math.max(wmax, wb[i - a]);
    }
    const p = pole(el.segR[k]),
      /* 前に箱の半分、後ろに N 波と箱の半分の余白 */
      n0 = Math.floor((lo - t0) * fs - wmax / 2) - 1,
      len = Math.ceil((hi - lo) * fs + T + wmax + (TAIL_TAU * AIR_N) / (1 - p)) + 3;
    if (buf.length < len) buf = new Float64Array(len * 2);
    buf.fill(0, 0, len);
    const local = buf.subarray(0, len);
    for (let i = a; i < b; i++) addNWaveBox(local, (el.t[i] - t0) * fs - n0, T, el.p[i], wb[i - a]);
    f.reset();
    f.p = p;
    for (let n = 0; n < len && n0 + n < out.length; n++) {
      const v = f.step(local[n]);
      if (n0 + n >= 0) out[n0 + n] += v;
    }
  }
  let peak = 0;
  const y = new Float32Array(out.length);
  for (let n = 0; n < out.length; n++) {
    y[n] = out[n];
    peak = Math.max(peak, Math.abs(out[n]));
  }
  return { y, fs, t0, peak };
}

/** 音圧 [Pa] の音圧レベル [dB]（20 µPa が 0 dB） */
export const spl = (p: number): number => 20 * Math.log10(Math.max(p, 1e-12) / 2e-5);

/**
 * パワースペクトル（Hann の窓で半分ずつ重ねて平均）。戻り値は周波数 [Hz] とレベル [dB re 20 µPa²/Hz]
 */
export function spectrum(y: Float32Array, fs: number, N = 8192): { f: Float64Array; db: Float64Array } {
  const re = new Float64Array(N),
    im = new Float64Array(N),
    acc = new Float64Array(N / 2 + 1),
    w = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  let wp = 0;
  for (const v of w) wp += v * v;
  let count = 0;
  for (let s = 0; s === 0 || s + N <= y.length; s += N / 2) {
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < N && s + i < y.length; i++) re[i] = y[s + i] * w[i];
    fft(re, im);
    for (let k = 0; k <= N / 2; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
    count++;
  }
  const f = new Float64Array(N / 2 + 1),
    db = new Float64Array(N / 2 + 1);
  for (let k = 0; k <= N / 2; k++) {
    f[k] = (k * fs) / N;
    /* 片側の密度: 2|X|²/(fs Σw²)。端の 2 本は 2 倍しない */
    const d = ((k === 0 || k === N / 2 ? 1 : 2) * acc[k]) / count / (fs * wp);
    db[k] = 10 * Math.log10(Math.max(d, 1e-30) / 4e-10);
  }
  return { f, db };
}

/**
 * 包絡線（区間 dt [s] ごとの RMS [Pa]）。波形の図の下書きと、近い雷と遠い雷の比べに使う
 */
export function envelope(w: Wave, dt: number): Float64Array {
  const m = Math.max(1, Math.round(dt * w.fs)),
    nb = Math.ceil(w.y.length / m),
    e = new Float64Array(nb);
  for (let k = 0; k < nb; k++) {
    let s = 0,
      c = 0;
    for (let i = k * m; i < Math.min(w.y.length, (k + 1) * m); i++, c++) s += w.y[i] * w.y[i];
    e[k] = Math.sqrt(s / Math.max(c, 1));
  }
  return e;
}
