/** 音符: 開始と長さ（4 分音符を 1 とする拍）、音の高さ（MIDI のノート番号）、譜表（h） */
export interface ScoreNote {
  t: number;
  d: number;
  n: number;
  /** 0 = 右手の譜表（上）、1 = 左手の譜表（下） */
  h: number;
}
