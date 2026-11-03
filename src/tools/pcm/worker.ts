/**
 * 音の計算をメインスレッドの外で行う。音源は 1 度だけ受け取るか作って持っておき、
 * 条件ごとに「標本化だけ」「量子化だけ」「両方」の音と図の列を返す
 */
import { type PcmSet, quantize, restore, sample } from './pcm';
import { makeSource, type SrcName } from './sources';

export interface GenJob {
  kind: 'gen';
  name: SrcName;
  f: number;
}
export interface SrcJob {
  kind: 'src';
  x: Float32Array;
  F: number;
}
export interface RunJob {
  kind: 'run';
  id: number;
  /** 入力レベル [dB] */
  lv: number;
  set: PcmSet & { bits: number };
}
export type Job = GenJob | SrcJob | RunJob;

export interface Out {
  id: number;
  F: number;
  fs: number;
  bits: number;
  /** 入力（レベルを掛けたあと） */
  x: Float32Array;
  /** 標本化だけ: 標本と再生した音 */
  ss: Float32Array;
  so: Float32Array;
  /** 量子化だけ: 丸めた値（F のまま）と誤差 */
  qy: Float32Array;
  qe: Float32Array;
  /** 両方: 再生した音 */
  bo: Float32Array;
  snrQ: number;
}

let base: Float32Array = new Float32Array(0),
  F = 48000,
  ver = 0;
let xKey = '',
  x: Float32Array = new Float32Array(0);
let sKey = '',
  s: Float64Array = new Float64Array(0);

function input(lv: number): Float32Array {
  const k = `${ver}|${lv}`;
  if (k !== xKey) {
    const g = 10 ** (lv / 20);
    x = Float32Array.from(base, (v) => v * g);
    xKey = k;
  }
  return x;
}
function sampled(lv: number, fs: number, aa: boolean): Float64Array {
  const k = `${ver}|${lv}|${fs}|${aa}`;
  if (k !== sKey) {
    s = sample(input(lv), F, fs, aa);
    sKey = k;
  }
  return s;
}

self.onmessage = (e: MessageEvent<Job>) => {
  const j = e.data;
  if (j.kind === 'gen') {
    base = makeSource(j.name, j.f);
    F = 48000;
    ver++;
    return;
  }
  if (j.kind === 'src') {
    base = j.x;
    F = j.F;
    ver++;
    return;
  }
  const { fs, bits, law, dith, aa, rc } = j.set,
    xx = input(j.lv),
    N = xx.length,
    ss = sampled(j.lv, fs, aa),
    so = restore(ss, F, fs, N, rc),
    /* 量子化だけ: 標本化の影響を入れないよう、音源の標本化周波数のまま丸める */
    qq = quantize(xx, bits, law, dith),
    bq = quantize(ss, bits, law, dith),
    bo = restore(bq.y, F, fs, N, rc);
  const out: Out = {
    id: j.id,
    F,
    fs,
    bits,
    x: xx.slice(),
    ss: Float32Array.from(ss),
    so,
    qy: Float32Array.from(qq.y),
    qe: Float32Array.from(qq.e),
    bo,
    snrQ: qq.snr,
  };
  (self as unknown as Worker).postMessage(out, [
    out.x.buffer,
    out.ss.buffer,
    out.so.buffer,
    out.qy.buffer,
    out.qe.buffer,
    out.bo.buffer,
  ]);
};
