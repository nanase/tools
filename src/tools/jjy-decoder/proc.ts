/**
 * ライブ入力の 1 ブロックぶんの処理（DOM に依存しない）。AudioWorklet（worklet.ts）と、
 * AudioWorklet を使えない環境の ScriptProcessor（client.ts）で共用する
 */
import { Env } from './dsp';

/** 自動の搬送波の推定に集める点数と、送ったあと休む長さ（秒） */
export const RAW_N = 16384;
const RAW_REST = 1;

export interface ProcState {
  e: Env | null;
  /** 送る前の振幅・電力と、その数 */
  o: Float32Array;
  p: Float32Array;
  m: number;
  /** 送った振幅の通し番号（1 ms ごと） */
  k: number;
  /** 最初のブロックの文脈の時刻（秒） */
  c0: number;
  raw: Float32Array;
  ri: number;
  skip: number;
}

/** 周波数の推定用の生の音 */
export interface RawMsg {
  raw: Float32Array;
  fs: number;
}
/** 包絡線の続き。k0 は a[0] の通し番号 */
export interface EnvMsg {
  k0: number;
  a: Float32Array;
  p: Float32Array;
  c0: number;
  fs: number;
  lag: number;
}
export type ProcOut = RawMsg | EnvMsg;
/** 画面から送る指示: 検波の周波数 */
export interface ProcIn {
  f?: number;
}

export function procInit(): ProcState {
  return {
    e: null,
    o: new Float32Array(4096),
    p: new Float32Array(4096),
    m: 0,
    k: 0,
    c0: -1,
    raw: new Float32Array(RAW_N),
    ri: 0,
    skip: 0,
  };
}

export function procMsg(st: ProcState, fs: number, d: ProcIn): void {
  if (d.f && d.f > 0) {
    if (st.e) st.e.setF(d.f);
    else st.e = new Env(fs, d.f);
  }
}

/** x を処理する。time は文脈の時刻（秒）。検波の周波数が決まるまでは推定用の音だけを送る */
export function procStep(st: ProcState, x: Float32Array, fs: number, time: number, post: (d: ProcOut) => void): void {
  if (st.skip > 0) st.skip -= x.length;
  else {
    const n = Math.min(x.length, st.raw.length - st.ri);
    st.raw.set(x.subarray(0, n), st.ri);
    st.ri += n;
    if (st.ri >= st.raw.length) {
      post({ raw: st.raw.slice(), fs });
      st.ri = 0;
      st.skip = fs * RAW_REST;
    }
  }
  if (!st.e) return;
  if (st.c0 < 0) st.c0 = time;
  st.m = st.e.run(x, st.o, st.m, st.p);
  if (st.m >= 16) {
    post({ k0: st.k, a: st.o.slice(0, st.m), p: st.p.slice(0, st.m), c0: st.c0, fs, lag: st.e.lag });
    st.k += st.m;
    st.m = 0;
  }
}
