/**
 * 標本化定理のページの計算: 入力の信号・成分・折り返し・判定と、止めた図のための復元。
 * 信号はすべて時刻 t [s] の関数なので、どこから描いても音を作ってもつながる
 */
import type { MusicName } from '../pcm/music';
import { ker, L } from './kernel';
import { musicAt } from './music';

export { ker, L };

const TAU = 2 * Math.PI;

export type SrcId = 'sine' | 'square' | 'saw' | 'tri' | 'chord' | 'sweep' | MusicName;
export interface Sig {
  src: SrcId;
  /** 正弦波・矩形波・のこぎり波・三角波の周波数、和音の根音 [Hz]（スイープと音楽では使わない） */
  f: number;
}
const MUSICS: readonly string[] = ['mix', 'drums', 'pluck', 'pad'];
/** サンプル音源（音楽）か */
export const isMusic = (src: SrcId): src is MusicName => MUSICS.includes(src);
/** 周波数の行を使う入力か */
export const hasF = (src: SrcId): boolean => src !== 'sweep' && !isMusic(src);
export interface Comp {
  f: number;
  /** 振幅 */
  a: number;
}

/** 正弦波の振幅（スペクトルの 0 dB） */
export const AMP = 0.7;
/** 矩形波・のこぎり波・三角波の振幅 */
const SQ = 0.45,
  SAW = 0.5,
  TRI = 0.65;
/** スイープの 1 周 [s] と周波数の範囲 [Hz] */
export const SWD = 8,
  SW0 = 50,
  SW1 = 16000;
/** スイープを入力のローパスで消すときの、遮断の手前の幅 [Hz] */
const SW_EDGE = 300;
/** 矩形波・のこぎり波・三角波の倍音の上限（数と周波数） */
const SQ_MAX = 400,
  SQ_TOP = 96000;
/** 和音: 根音に対する比と重み、倍音の数 */
const CHORD: readonly [number, number][] = [
  [1, 1],
  [5 / 4, 0.8],
  [3 / 2, 0.8],
];
const CHORD_H = 8;

const mod = (a: number, n: number): number => ((a % n) + n) % n;
/** スイープの今の周波数 */
export const swF = (t: number): number => SW0 + ((SW1 - SW0) * mod(t, SWD)) / SWD;
const swPh = (t: number): number => {
  const u = mod(t, SWD);
  return TAU * (SW0 * u + ((SW1 - SW0) * u * u) / (2 * SWD));
};

/** 入力の成分（t はスイープの今の周波数のため）。並びの先頭が主な成分（基本の音） */
export function comps(sig: Sig, t = 0): Comp[] {
  const f = sig.f;
  if (sig.src === 'sine') return [{ f, a: AMP }];
  if (sig.src === 'sweep') return [{ f: swF(t), a: AMP }];
  const c: Comp[] = [];
  if (isMusic(sig.src)) return c;
  if (sig.src === 'square') {
    for (let k = 1; k * f <= SQ_TOP && k < SQ_MAX; k += 2) c.push({ f: k * f, a: (SQ * 4) / Math.PI / k });
    return c;
  }
  if (sig.src === 'saw') {
    for (let k = 1; k * f <= SQ_TOP && k < SQ_MAX; k++) c.push({ f: k * f, a: (SAW * 2) / Math.PI / k });
    return c;
  }
  if (sig.src === 'tri') {
    for (let k = 1; k * f <= SQ_TOP && k < SQ_MAX; k += 2) c.push({ f: k * f, a: (TRI * 8) / Math.PI ** 2 / k ** 2 });
    return c;
  }
  for (const [r, w] of CHORD) for (let h = 1; h <= CHORD_H; h++) c.push({ f: f * r * h, a: (0.17 * w) / h ** 1.1 });
  return c;
}

/**
 * 入力の値を返す関数を作る。fc より上の成分は除く（入力のローパス。Infinity なら除かない）。
 * 矩形波は fc が Infinity なら理想の矩形（倍音は限りなく続く）で、そうでなければ fc より下の倍音の和
 */
export function source(sig: Sig): (t: number, fc: number) => number {
  const f = sig.f;
  if (sig.src === 'sine') return (t, fc) => (f < fc ? AMP * Math.sin(TAU * f * t) : 0);
  if (sig.src === 'sweep')
    return (t, fc) => {
      const k = Math.max(0, Math.min(1, (fc - swF(t)) / SW_EDGE));
      return k ? AMP * k * Math.sin(swPh(t)) : 0;
    };
  if (sig.src === 'square')
    return (t, fc) => {
      const w = TAU * mod(t * f, 1);
      if (fc === Number.POSITIVE_INFINITY) {
        const s = Math.sin(w);
        return s > 0 ? SQ : s < 0 ? -SQ : 0;
      }
      /* sin(k w) を k = 1, 3, 5… と漸化式で進める */
      const c2 = 2 * Math.cos(2 * w);
      let prev = -Math.sin(w),
        cur = Math.sin(w),
        v = 0;
      for (let k = 1; k * f < fc && k < SQ_MAX; k += 2) {
        v += cur / k;
        const nx = c2 * cur - prev;
        prev = cur;
        cur = nx;
      }
      return (SQ * 4 * v) / Math.PI;
    };
  if (sig.src === 'saw')
    return (t, fc) => {
      /* 位相 0 で 0 から上がり、半周期で −1 へ戻る */
      const w = TAU * mod(t * f, 1);
      if (fc === Number.POSITIVE_INFINITY) return SAW * (w < Math.PI ? w / Math.PI : w / Math.PI - 2);
      const c1 = 2 * Math.cos(w);
      let prev = 0,
        cur = Math.sin(w),
        v = 0;
      for (let k = 1; k * f < fc && k < SQ_MAX; k++) {
        v += (k & 1 ? cur : -cur) / k;
        const nx = c1 * cur - prev;
        prev = cur;
        cur = nx;
      }
      return (SAW * 2 * v) / Math.PI;
    };
  if (sig.src === 'tri')
    return (t, fc) => {
      const w = TAU * mod(t * f, 1);
      if (fc === Number.POSITIVE_INFINITY) return (TRI * 2 * Math.asin(Math.sin(w))) / Math.PI;
      const c2 = 2 * Math.cos(2 * w);
      let prev = -Math.sin(w),
        cur = Math.sin(w),
        v = 0;
      for (let k = 1; k * f < fc && k < SQ_MAX; k += 2) {
        v += ((k & 3) === 1 ? cur : -cur) / (k * k);
        const nx = c2 * cur - prev;
        prev = cur;
        cur = nx;
      }
      return (TRI * 8 * v) / Math.PI ** 2;
    };
  const src = sig.src;
  if (isMusic(src)) return (t, fc) => musicAt(src, t, fc);
  const cs = comps(sig);
  return (t, fc) => {
    let v = 0;
    for (const c of cs) if (c.f < fc) v += c.a * Math.sin(TAU * c.f * t);
    return v;
  };
}

/** 標本化したあと復元される周波数（0 にいちばん近い複製） */
export const fold = (f: number, fs: number): number => Math.abs(f - fs * Math.round(f / fs));

/** 復元される複製の名前（fs − f、2fs − f、f − fs など） */
export function copyName(f: number, fs: number): string {
  const k = Math.round(f / fs);
  if (k === 0) return 'f';
  const kf = k === 1 ? 'fs' : `${k}fs`;
  return f < k * fs ? `${kf} − f` : `f − ${kf}`;
}

export interface Judge {
  c: Comp[];
  main: Comp;
  /** 主な成分の復元される周波数 */
  fa: number;
  /** 1 周期の標本の数（fs / f） */
  spp: number;
  /** 折り返す成分（標本化周波数の半分以上で、ローパスで除かれないもの） */
  over: Comp[];
  /** ローパスで除かれる成分 */
  cut: Comp[];
}
/** 小さすぎて数えない成分の振幅 */
const TINY = 0.003;
export function judge(sig: Sig, fs: number, aa: boolean, t = 0): Judge {
  const c = comps(sig, t),
    /* 音楽は成分の列を持たない（判定は music.ts の overDb） */
    main = c[0] ?? { f: 0, a: 0 },
    hi = c.filter((x) => 2 * x.f >= fs && x.a > TINY);
  return { c, main, fa: fold(main.f, fs), spp: fs / main.f, over: aa ? [] : hi, cut: aa ? hi : [] };
}

/** 止めた図: 時刻 0 から n / fs で標本化した値 */
export function samplesAt(sig: Sig, fs: number, aa: boolean, n0: number, n1: number): Float64Array {
  const v = source(sig),
    fc = aa ? fs / 2 : Number.POSITIVE_INFINITY,
    x = new Float64Array(Math.max(0, n1 - n0 + 1));
  for (let n = n0; n <= n1; n++) x[n - n0] = v(n / fs, fc);
  return x;
}
/** 止めた図: 時刻の列 ts で復元した波 */
export function reconAt(sig: Sig, fs: number, aa: boolean, ts: ArrayLike<number>): Float64Array {
  const y = new Float64Array(ts.length);
  if (!ts.length) return y;
  const n0 = Math.floor(ts[0] * fs) - L,
    x = samplesAt(sig, fs, aa, n0, Math.floor(ts[ts.length - 1] * fs) + L + 1);
  for (let i = 0; i < ts.length; i++) {
    const p = ts[i] * fs,
      m = Math.floor(p);
    let v = 0;
    for (let n = m - L + 1; n <= m + L; n++) v += x[n - n0] * ker(p - n);
    y[i] = v;
  }
  return y;
}

/* ---------- 自動で下げる: 16 kHz から 700 Hz まで 8 秒で下げる、の 10 秒のくり返し ---------- */
export const CYC = 10,
  FS_HI = 16000,
  FS_LO = 700;
const HOLD = 0.6,
  DOWN = 8;
export function autoFs(t: number): number {
  const u = mod(t, CYC);
  if (u < HOLD) return FS_HI;
  if (u < HOLD + DOWN) return FS_HI * (FS_LO / FS_HI) ** ((u - HOLD) / DOWN);
  return FS_LO;
}
