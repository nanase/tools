/** 録音をくり返せる形にする（DOM に依存しない）。自然の音は終わりと初めを重ねてつなぎ、声は終わりに無音を足す */
import { VOICE_GAP } from './model';
import type { Clip } from './render';

/** 録音の大きさをそろえる実効値（フルスケールに対する比） */
const REF_RMS = 0.07;
/** 自然の音のつなぎ目を重ねる時間 [s] */
const XFADE = 0.6;

export function prepareClip(x: Float32Array, fs: number, voice: boolean): Clip {
  const N = x.length;
  let y: Float32Array;
  if (voice) {
    y = new Float32Array(N + Math.round(VOICE_GAP * fs));
    y.set(x);
    const f = Math.round(0.03 * fs),
      g = Math.round(0.01 * fs);
    for (let k = 0; k < f && k < N; k++) y[N - 1 - k] *= k / f;
    for (let k = 0; k < g && k < N; k++) y[k] *= k / g;
  } else {
    const C = Math.min(Math.round(XFADE * fs), N >> 2);
    y = x.slice(0, N - C);
    for (let k = 0; k < C; k++) {
      const w = k / C;
      y[k] = x[k] * Math.sqrt(w) + x[N - C + k] * Math.sqrt(1 - w);
    }
  }
  /* 50 ms ごとの強さのうち、最大から 30 dB 以内の区間だけで実効値を求める（声の間を数えない） */
  const F = Math.max(1, Math.round(0.05 * fs)),
    rs: number[] = [];
  for (let s = 0; s + F <= y.length; s += F) {
    let e = 0;
    for (let k = s; k < s + F; k++) e += y[k] * y[k];
    rs.push(e / F);
  }
  const peak = Math.max(0, ...rs),
    act = rs.filter((e) => e > peak * 1e-3),
    rms = act.length ? Math.sqrt(act.reduce((a, b) => a + b, 0) / act.length) : 0;
  return { data: y, gain: rms > 1e-6 ? REF_RMS / rms : 0 };
}
