/** サンプル音源（1 周の長さは 4 秒。打楽器と撥弦はそのままくり返せる） */
import { type Clip, clip } from '../wavelet-denoise/clips';
import { decay, normalize, saw, sine, sweep } from './pcm';

export type SrcName = Clip | 'decay' | 'sine' | 'saw' | 'sweep';
/** 周波数の行を使う音源 */
export const hasFreq = (s: SrcName): boolean => s === 'sine' || s === 'saw';

export const SOURCES: readonly (readonly [SrcName, string] | readonly [SrcName, string, string])[] = [
  ['saw', 'のこぎり波', '倍音の多い音'],
  ['sine', '正弦波'],
  ['organ', '持続音'],
  ['pluck', '撥弦'],
  ['drums', '打楽器'],
  ['decay', '減衰音', 'だんだん小さくなる音'],
  ['sweep', 'スイープ', '100 Hz から 20 kHz まで上がる音'],
];

export const TEST_FS = 48000;
export const TEST_DUR = 4;

/** 振幅の最大を 1 にした音源 */
export function makeSource(name: SrcName, f: number, F = TEST_FS, dur = TEST_DUR): Float32Array {
  if (name === 'sine') return sine(f, F, dur);
  if (name === 'saw') return saw(f, F, dur);
  if (name === 'decay') return normalize(decay(F, dur));
  if (name === 'sweep') return sweep(F, dur);
  return normalize(clip(name, F, dur));
}
