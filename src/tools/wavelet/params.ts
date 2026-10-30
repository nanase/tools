/** ウェーブレット変換のページの選択肢 */
import type { Wav } from './dwt';
import { SIGS, type Sig } from './signals';

/** 信号の選択肢（並べる順に） */
export const sigs = (...v: Sig[]) => v.map((s) => [s, SIGS.find((x) => x[0] === s)?.[1] ?? s] as const);
export const WAV3: readonly (readonly [Wav, string])[] = [
  ['haar', 'Haar'],
  ['db2', 'db2'],
  ['db4', 'db4'],
];
