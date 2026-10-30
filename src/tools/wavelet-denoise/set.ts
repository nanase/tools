/** 雑音除去の条件（画面と計算の受け渡しに使う） */
import type { Shrink, Wav } from '../wavelet/dwt';
import type { Noise } from './clips';
import type { Rule, SigmaMode } from './thresh';

export interface DnSet {
  /** 足す雑音と、その SN 比 [dB] */
  noise: Noise | 'none';
  snrIn: number;
  w: Wav;
  J: number;
  rule: Rule;
  sm: SigmaMode;
  m: Shrink;
  /** λ に掛ける倍率 */
  k: number;
  /** ずらして平均する回数 */
  spin: number;
}
