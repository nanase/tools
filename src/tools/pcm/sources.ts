/** サンプル音源（1 周の長さは 4 秒）。音楽の音は MP3 のページと共有する */
import { MUSIC, type MusicName, makeMusic } from './music';
import { decay, saw, sine, sweep } from './pcm';

export type SrcName = MusicName | 'saw' | 'sine' | 'decay' | 'sweep';
/** 周波数の行を使う音源 */
export const hasFreq = (s: SrcName): boolean => s === 'sine' || s === 'saw';

export const SOURCES: readonly (readonly [SrcName, string] | readonly [SrcName, string, string])[] = [
  ...MUSIC,
  ['saw', 'のこぎり波', '倍音の多い音'],
  ['sine', '正弦波'],
  ['decay', '減衰音', 'だんだん小さくなる音'],
  ['sweep', 'スイープ', '100 Hz から 20 kHz まで上がる音'],
];

export const TEST_FS = 44100;
export const TEST_DUR = 4;
/** くり返しのつなぎ目をならす長さ [s] */
const SEAM = 0.01;

/** 終わりの値を始まりの値へ寄せて、くり返しの切れ目で音が鳴らないようにする */
function seamless(ch: Float32Array[], F: number): void {
  const K = Math.round(F * SEAM);
  for (const c of ch) {
    const n = c.length,
      d = c[0] - c[n - 1];
    for (let i = 1; i <= K; i++) c[n - K - 1 + i] += d * (i / K) ** 2;
  }
}

/** 振幅の最大を 1 にそろえる（チャンネルの間の比は保つ） */
function peak1(ch: Float32Array[]): Float32Array[] {
  let m = 1e-9;
  for (const c of ch) for (let i = 0; i < c.length; i++) m = Math.max(m, Math.abs(c[i]));
  for (const c of ch) for (let i = 0; i < c.length; i++) c[i] /= m;
  return ch;
}

/** 振幅の最大を 1 にした音源（1 または 2 チャンネル） */
export function makeSource(name: SrcName, f: number, F = TEST_FS, dur = TEST_DUR): Float32Array[] {
  if (name === 'sine') return peak1([sine(f, F, dur)]);
  if (name === 'saw') return peak1([saw(f, F, dur)]);
  if (name === 'decay') return peak1([decay(F, dur)]);
  if (name === 'sweep') return peak1([sweep(F, dur)]);
  const ch = makeMusic(name, F, dur);
  seamless(ch, F);
  return peak1(ch);
}
