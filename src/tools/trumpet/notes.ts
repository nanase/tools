/**
 * B♭ トランペットの音名と指使い（DOM に依存しない）。音は実音の MIDI 番号（記譜は全音高い）。
 * 弁なしの倍音列は B♭2（MIDI 46）の n 倍。ふつうの指使いは、その音を下げる半音の数が最も少ない倍音を選ぶ
 * （第 7 倍音は平均律より約 31 セント低いので使わない）
 */

/** 押す弁（第 1・第 2・第 3）と、下げる半音の数（0〜6）。並びは はしご の列の順 */
export const FINGERS: readonly { v: readonly [boolean, boolean, boolean]; semi: number; name: string }[] = [
  { v: [false, false, false], semi: 0, name: '弁なし' },
  { v: [false, true, false], semi: 1, name: '2' },
  { v: [true, false, false], semi: 2, name: '1' },
  { v: [true, true, false], semi: 3, name: '1+2' },
  { v: [false, true, true], semi: 4, name: '2+3' },
  { v: [true, false, true], semi: 5, name: '1+3' },
  { v: [true, true, true], semi: 6, name: '1+2+3' },
];

/** 弁の組から下げる半音の数（3 は 1+2 とみなす） */
export const semiOf = (v: readonly boolean[]): number => (v[1] ? 1 : 0) + (v[0] ? 2 : 0) + (v[2] ? 3 : 0);

/** 弁なしの第 n 倍音の音（平均律に丸めた MIDI 番号） */
export const openNote = (n: number): number => Math.round(46 + 12 * Math.log2(n));

/** 吹く倍音（はしご の段） */
export const PARTIALS = [2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

/** 実音 m のふつうの指使い: 倍音 n と下げる半音の数 */
export function fingering(m: number): { n: number; semi: number } {
  for (const n of [2, 3, 4, 5, 6, 8, 9, 10]) {
    const s = openNote(n) - m;
    if (s >= 0 && s <= 6) return { n, semi: s };
  }
  return m < 52 ? { n: 2, semi: 6 } : { n: 10, semi: 0 };
}

/** 平均律の周波数 [Hz]（A4 = 440 Hz） */
export const mtof = (m: number): number => 440 * 2 ** ((m - 69) / 12);

const PC = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
/** 音名（例 B♭4） */
export const nameOf = (m: number): string => {
  const r = Math.round(m);
  return `${PC[((r % 12) + 12) % 12]}${Math.floor(r / 12) - 1}`;
};

/** 吹ける音の範囲（実音）: E3〜D6 */
export const LOW = 52,
  HIGH = 86;
