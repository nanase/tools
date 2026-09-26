/**
 * テスト信号（DOM に依存しない）: JJY シミュレータと同じ規則で、正弦波の振幅を 100 %・10 % に切り替えた音。
 * 振幅は時定数 4 ms で変える（シミュレータの audio.ts と同じ）
 */
import type { Signal } from '../jjy/code';

export const TEST_F = 440,
  TEST_A = 0.5;
const TC = 0.004;

/** 続けて作るときに引き継ぐもの: 包絡線の値と、正弦波の通し番号 */
export interface SynthState {
  g: number | null;
  i: number;
}

/** x に、端末の時計 w0（UTC のミリ秒）から始まる信号を書く */
export function synth(
  sig: Signal,
  x: Float32Array,
  fs: number,
  w0: number,
  st: SynthState,
  f = TEST_F,
  amp = TEST_A,
): void {
  const n = x.length,
    lv = new Float32Array(Math.ceil((n * 1000) / fs) + 1);
  for (let k = 0; k < lv.length; k++) lv[k] = sig.level(w0 + k);
  const a = 1 - Math.exp(-1 / (fs * TC)),
    w = (2 * Math.PI * f) / fs;
  let g = st.g ?? lv[0];
  for (let i = 0; i < n; i++) {
    g += (lv[Math.floor((i * 1000) / fs)] - g) * a;
    x[i] = amp * g * Math.sin(w * (st.i + i));
  }
  st.g = g;
  st.i += n;
}

/** 16 bit・モノラルの WAV */
export function wav(x: Float32Array, fs: number): ArrayBuffer {
  const n = x.length,
    buf = new ArrayBuffer(44 + n * 2),
    dv = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  dv.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, fs, true);
  dv.setUint32(28, fs * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  str(36, 'data');
  dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.round(32767 * Math.max(-1, Math.min(1, x[i]))), true);
  return buf;
}

/** 時刻 t0（UTC のミリ秒）から sec 秒ぶんのテスト信号の WAV（8 kHz） */
export function testWav(sig: Signal, t0: number, sec: number): ArrayBuffer {
  const fs = 8000,
    x = new Float32Array(fs * sec);
  synth(sig, x, fs, t0, { g: null, i: 0 });
  return wav(x, fs);
}
