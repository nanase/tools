/**
 * 音の計算をメインスレッドの外で行う。音源は 1 度だけ受け取るか作って持っておき、
 * 条件ごとに「同じビット数の PCM」「ADPCM」「原音との差」の音をチャンネルごとに返す。図の列は先頭のチャンネルだけ返す
 */
import { quantize, restore, sample } from '../pcm/pcm';
import { makeSource, type SrcName, TEST_FS } from '../pcm/sources';
import { type AdpSet, encode, type Marks, marks } from './adpcm';

export interface GenJob {
  kind: 'gen';
  name: SrcName;
  f: number;
}
export interface SrcJob {
  kind: 'src';
  x: Float32Array[];
  F: number;
}
export interface RunJob {
  kind: 'run';
  id: number;
  /** 入力レベル [dB] */
  lv: number;
  fs: number;
  set: AdpSet;
}
export type Job = GenJob | SrcJob | RunJob;

export interface Out {
  id: number;
  F: number;
  fs: number;
  bits: number;
  /** 入力（レベルを掛けたあと） */
  x: Float32Array[];
  /** 同じビット数の PCM の音 */
  po: Float32Array[];
  /** ADPCM の音 */
  yo: Float32Array[];
  /** ADPCM と原音（標本から戻した波）の差の音 */
  df: Float32Array[];
  /** 図の列（先頭のチャンネル）: 標本から戻した波（F）、標本・再生した値・予測値・間隔・誤差・PCM の誤差（fs） */
  so: Float32Array;
  ss: Float32Array;
  y: Float32Array;
  p: Float32Array;
  st: Float32Array;
  e: Float32Array;
  qe: Float32Array;
  /** 全チャンネルの SN 比 [dB] */
  snrQ: number;
  snrA: number;
  marks: Marks;
}

let base: Float32Array[] = [],
  F = TEST_FS,
  ver = 0;
let xKey = '',
  x: Float32Array[] = [];
let sKey = '',
  s: Float64Array[] = [],
  so: Float32Array[] = [];

function input(lv: number): Float32Array[] {
  const k = `${ver}|${lv}`;
  if (k !== xKey) {
    const g = 10 ** (lv / 20);
    x = base.map((c) => Float32Array.from(c, (v) => v * g));
    xKey = k;
  }
  return x;
}
function sampled(lv: number, fs: number): void {
  const k = `${ver}|${lv}|${fs}`;
  if (k === sKey) return;
  const xx = input(lv);
  s = xx.map((c) => sample(c, F, fs, true));
  so = s.map((c, i) => restore(c, F, fs, xx[i].length, 'smooth'));
  sKey = k;
}
const snrOf = (ps: number, pe: number) => (pe > 0 ? 10 * Math.log10(ps / pe) : Number.POSITIVE_INFINITY);

self.onmessage = (e: MessageEvent<Job>) => {
  const j = e.data;
  if (j.kind === 'gen') {
    base = makeSource(j.name, j.f);
    F = TEST_FS;
    ver++;
    return;
  }
  if (j.kind === 'src') {
    base = j.x;
    F = j.F;
    ver++;
    return;
  }
  const { fs, set } = j,
    xx = input(j.lv);
  sampled(j.lv, fs);
  const po: Float32Array[] = [],
    yo: Float32Array[] = [],
    df: Float32Array[] = [];
  let ps = 0,
    pQ = 0,
    pA = 0;
  const first = s.map((c, i) => {
    const N = xx[i].length,
      a = encode(c, set),
      q = quantize(c, set.bits),
      o = restore(a.y, F, fs, N, 'smooth');
    po.push(restore(q.y, F, fs, N, 'smooth'));
    yo.push(o);
    df.push(Float32Array.from(o, (v, n) => v - so[i][n]));
    for (let n = 0; n < c.length; n++) {
      ps += c[n] * c[n];
      pQ += q.e[n] * q.e[n];
      pA += a.e[n] * a.e[n];
    }
    return { a, q };
  })[0];
  const out: Out = {
    id: j.id,
    F,
    fs,
    bits: set.bits,
    x: xx.map((c) => c.slice()),
    po,
    yo,
    df,
    so: so[0].slice(),
    ss: Float32Array.from(s[0]),
    y: Float32Array.from(first.a.y),
    p: Float32Array.from(first.a.p),
    st: Float32Array.from(first.a.st),
    e: Float32Array.from(first.a.e),
    qe: Float32Array.from(first.q.e),
    snrQ: snrOf(ps, pQ),
    snrA: snrOf(ps, pA),
    marks: marks(s[0], first.a.e, fs),
  };
  (self as unknown as Worker).postMessage(
    out,
    [...out.x, ...out.po, ...out.yo, ...out.df, out.so, out.ss, out.y, out.p, out.st, out.e, out.qe].map(
      (c) => c.buffer as ArrayBuffer,
    ),
  );
};
