/** 音符: 開始と長さ（4 分音符を 1 とする拍）、音の高さ（MIDI のノート番号）、譜表・パート（h。0 が上） */
export interface ScoreNote {
  t: number;
  d: number;
  n: number;
  h: number;
}
