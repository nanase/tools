/** 音符: 開始と長さ（4 分音符を 1 とする拍）、音の高さ（MIDI のノート番号）、鍵盤（h） */
export interface ScoreNote {
  t: number;
  d: number;
  n: number;
  /** 0 = 第 1 手鍵盤（右手の譜表）、1 = 第 2 手鍵盤（左手の譜表）、2 = ペダル */
  h: number;
}
