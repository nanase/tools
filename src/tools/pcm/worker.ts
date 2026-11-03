/**
 * 音の計算をメインスレッドの外で行う。音源は 1 度だけ受け取るか作って持っておき、
 * 条件ごとに「標本化だけ」「量子化だけ」「両方」の音をチャンネルごとに返す。図の列は先頭のチャンネルだけ返す
 */
import { type PcmSet, quantize, restore, sample } from './pcm';
import { makeSource, type SrcName, TEST_FS } from './sources';

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
  set: PcmSet & { bits: number };
}
export type Job = GenJob | SrcJob | RunJob;

export interface Out {
  id: number;
  F: number;
  fs: number;
  bits: number;
  /** 入力（レベルを掛けたあと） */
  x: Float32Array[];
  /** 標本化だけ: 再生した音 */
  so: Float32Array[];
  /** 量子化だけ: 丸めた値（F のまま） */
  qy: Float32Array[];
  /** 両方: 再生した音 */
  bo: Float32Array[];
  /** 図の列（先頭のチャンネル）: 標本と量子化の誤差 */
  ss: Float32Array;
  qe: Float32Array;
  /** 全チャンネルの量子化の SN 比 [dB] */
  snrQ: number;
}

let base: Float32Array[] = [],
  F = TEST_FS,
  ver = 0;
let xKey = '',
  x: Float32Array[] = [];
let sKey = '',
  s: Float64Array[] = [];

function input(lv: number): Float32Array[] {
  const k = `${ver}|${lv}`;
  if (k !== xKey) {
    const g = 10 ** (lv / 20);
    x = base.map((c) => Float32Array.from(c, (v) => v * g));
    xKey = k;
  }
  return x;
}
function sampled(lv: number, fs: number, aa: boolean): Float64Array[] {
  const k = `${ver}|${lv}|${fs}|${aa}`;
  if (k !== sKey) {
    s = input(lv).map((c) => sample(c, F, fs, aa));
    sKey = k;
  }
  return s;
}

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
  const { fs, bits, law, dith, aa, rc } = j.set,
    xx = input(j.lv),
    ss = sampled(j.lv, fs, aa),
    so: Float32Array[] = [],
    qy: Float32Array[] = [],
    bo: Float32Array[] = [];
  let qe = new Float32Array(0),
    ps = 0,
    pe = 0;
  xx.forEach((c, i) => {
    const N = c.length,
      /* 量子化だけ: 標本化の影響を入れないよう、音源の標本化周波数のまま丸める */
      qq = quantize(c, bits, law, dith),
      bq = quantize(ss[i], bits, law, dith);
    so.push(restore(ss[i], F, fs, N, rc));
    qy.push(Float32Array.from(qq.y));
    bo.push(restore(bq.y, F, fs, N, rc));
    if (i === 0) qe = Float32Array.from(qq.e);
    for (let n = 0; n < N; n++) {
      ps += c[n] * c[n];
      pe += qq.e[n] * qq.e[n];
    }
  });
  const out: Out = {
    id: j.id,
    F,
    fs,
    bits,
    x: xx.map((c) => c.slice()),
    so,
    qy,
    bo,
    ss: Float32Array.from(ss[0]),
    qe,
    snrQ: pe > 0 ? 10 * Math.log10(ps / pe) : Number.POSITIVE_INFINITY,
  };
  (self as unknown as Worker).postMessage(
    out,
    [...out.x, ...out.so, ...out.qy, ...out.bo, out.ss, out.qe].map((c) => c.buffer as ArrayBuffer),
  );
};
