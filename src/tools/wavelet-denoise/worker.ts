/**
 * 処理とスカログラムをメインスレッドの外で計算する。音源は 1 度だけ受け取って持っておき、
 * 雑音除去・圧縮の条件ごとに、聴き比べる音・数値・スカログラム（dBFS）を返す
 */

import type { Wav } from '../wavelet/dwt';
import { freqs, ScaloBank } from '../wavelet/live';
import { addNoise } from './clips';
import { BASES, type Basis, compressAudio, denoiseAudio, diff, snr } from './run';
import type { DnSet } from './set';

/** スカログラムの行（50 Hz〜12 kHz、1 オクターブ 8 行）と列の間隔 [s] */
export const SC_F = freqs(50, 12000, 8);
export const SC_HOP = 0.01;

export interface SrcJob {
  kind: 'src';
  src: number;
  x: Float32Array;
  fs: number;
  /** 雑音だけの区間（標本の番号） */
  quiet: [number, number];
}
export interface DnJob {
  kind: 'dn';
  id: number;
  set: DnSet;
}
export interface CpJob {
  kind: 'cp';
  id: number;
  basis: Basis;
  keep: number;
  w: Wav;
}
export type Job = SrcJob | DnJob | CpJob;

export interface Scalo {
  cols: number;
  /** dBFS、[行 × 列]、行 0 が最も低い周波数 */
  d: Float32Array;
}
export interface DnOut {
  kind: 'dn';
  id: number;
  noisy: Float32Array;
  out: Float32Array;
  removed: Float32Array;
  snrIn: number;
  snrOut: number;
  kept: number;
  total: number;
  /** 段ごとの σ・λ・残した割合（0 が最も細かい段） */
  sig: Float64Array;
  lam: Float64Array;
  keptJ: Float64Array;
  scBefore: Scalo;
  scAfter: Scalo;
}
export interface CpRow {
  b: Basis;
  snr: number;
  snrKeep: number;
  kbps: number;
  pos: number;
  val: number;
}
export interface CpOut {
  kind: 'cp';
  id: number;
  out: Float32Array;
  diff: Float32Array;
  kept: number;
  total: number;
  rows: CpRow[];
  scBefore: Scalo;
  scAfter: Scalo;
}
export type Out = DnOut | CpOut;

let src: { id: number; x: Float32Array; fs: number; quiet: [number, number] } = {
  id: -1,
  x: new Float32Array(0),
  fs: 48000,
  quiet: [0, 0],
};
const banks = new Map<number, ScaloBank>();
const scMemo = new WeakMap<Float32Array, Scalo>();
/** 圧縮の結果（音源・残す割合・基底ごと） */
const cpMemo = new Map<string, ReturnType<typeof compressAudio>>();

function scalo(x: Float32Array): Scalo {
  const hit = scMemo.get(x);
  if (hit) return hit;
  let b = banks.get(src.fs);
  if (!b) {
    b = new ScaloBank(src.fs, SC_F, Math.round(src.fs * SC_HOP));
    banks.set(src.fs, b);
  }
  const hop = Math.round(src.fs * SC_HOP),
    cols = Math.floor(x.length / hop),
    R = SC_F.length,
    d = new Float32Array(R * cols),
    a = new Float32Array(R);
  for (let q = 0; q < cols; q++) {
    b.column(x, q * hop + (hop >> 1), a);
    for (let r = 0; r < R; r++) d[r * cols + q] = 20 * Math.log10(a[r] + 1e-9);
  }
  const s = { cols, d };
  scMemo.set(x, s);
  return s;
}

function dn(j: DnJob): DnOut {
  const s = j.set,
    x = src.x,
    noisy = s.noise === 'none' ? x : addNoise(x, s.noise, s.snrIn)[0],
    o = denoiseAudio(noisy, { ...s, quiet: src.quiet }),
    keptJ = Float64Array.from(o.c.d, (d, k) => {
      let n = 0;
      for (const v of d) if (Math.abs(v) > o.lam[k]) n++;
      return n / d.length;
    });
  return {
    kind: 'dn',
    id: j.id,
    noisy,
    out: o.y,
    removed: diff(noisy, o.y),
    snrIn: s.noise === 'none' ? Number.NaN : snr(x, noisy),
    snrOut: s.noise === 'none' ? Number.NaN : snr(x, o.y),
    kept: o.kept,
    total: o.total,
    sig: o.sig,
    lam: o.lam,
    keptJ,
    scBefore: scalo(noisy),
    scAfter: scalo(o.y),
  };
}

function cpOf(b: Basis, keep: number, w: Wav) {
  const k = `${src.id}|${b}|${keep}|${b === 'wav' ? w : ''}`;
  let r = cpMemo.get(k);
  if (!r) {
    r = compressAudio(src.x, b, keep, w);
    if (cpMemo.size > 24) cpMemo.clear();
    cpMemo.set(k, r);
  }
  return r;
}
function cp(j: CpJob): CpOut {
  const x = src.x,
    dur = x.length / src.fs,
    o = cpOf(j.basis, j.keep, j.w),
    rows = BASES.map(([b]) => {
      const r = cpOf(b, j.keep, j.w);
      return { b, snr: snr(x, r.y), snrKeep: snr(x, r.yk), kbps: (r.pos + r.val) / dur / 1000, pos: r.pos, val: r.val };
    });
  return {
    kind: 'cp',
    id: j.id,
    out: o.y,
    diff: diff(x, o.y),
    kept: o.kept,
    total: o.total,
    rows,
    scBefore: scalo(x),
    scAfter: scalo(o.y),
  };
}

self.onmessage = (e: MessageEvent<Job>) => {
  const j = e.data;
  if (j.kind === 'src') {
    src = { id: j.src, x: j.x, fs: j.fs, quiet: j.quiet };
    cpMemo.clear();
    return;
  }
  (self as unknown as Worker).postMessage(j.kind === 'dn' ? dn(j) : cp(j));
};
