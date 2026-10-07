/**
 * 音の高さと調律法（DOM に依存しない）。5 度の連鎖で各音の高さを決め、平均律からのずれ [セント] を求める。
 * ヴェルクマイスター III は C–G–D–A と B–F♯ をピタゴラス・コンマの 1/4 ずつ狭め、ほかは純正の 5 度
 * （A. Werckmeister, Musicalische Temperatur, 1691）。ヴァロッティは F–C–G–D–A–E–B を 1/6 ずつ狭め、
 * ほかは純正（F. A. Vallotti）
 */

/** 純正の 5 度とピタゴラス・コンマ [セント] */
const FIFTH = 1200 * Math.log2(3 / 2),
  PC = 12 * FIFTH - 7 * 1200;

export interface Temperament {
  v: string;
  name: string;
  /** C から 5 度ずつ上へ 11 回進むときの、各 5 度を狭める量（ピタゴラス・コンマに対する比） */
  narrow: readonly number[];
}

/** 5 度の連鎖の並び C G D A E B F♯ C♯ G♯ D♯ A♯ F（ピッチクラス） */
const CHAIN = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];

export const TEMPERAMENTS: readonly Temperament[] = [
  { v: 'equal', name: '平均律', narrow: Array(11).fill(1 / 12) },
  /* C–G・G–D・D–A・B–F♯ を 1/4 */
  { v: 'werck3', name: 'ヴェルクマイスター III', narrow: [0.25, 0.25, 0.25, 0, 0, 0.25, 0, 0, 0, 0, 0] },
  /* C–G・G–D・D–A・A–E・E–B を 1/6（F–C も 1/6 で、残りの 1/6 が閉じる） */
  { v: 'vallotti', name: 'ヴァロッティ', narrow: [1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6, 0, 0, 0, 0, 0, 0] },
];
export const temperamentOf = (v: string): Temperament => TEMPERAMENTS.find((t) => t.v === v) ?? TEMPERAMENTS[0];

/** ピッチクラスごとの平均律からのずれ [セント]（A を 0 にそろえる） */
export function deviations(t: Temperament): number[] {
  const pos = new Array(12).fill(0);
  let c = 0;
  for (let i = 1; i < 12; i++) {
    c += FIFTH - t.narrow[i - 1] * PC;
    pos[CHAIN[i]] = ((c % 1200) + 1200) % 1200;
  }
  const dev = pos.map((p, pc) => p - 100 * pc),
    a = dev[9];
  return dev.map((d) => d - a);
}

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
/** 音名（C4 = 60） */
export const noteName = (n: number): string => `${NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
/** 黒鍵か */
export const isBlack = (n: number): boolean => [1, 3, 6, 8, 10].includes(((n % 12) + 12) % 12);

/** 鍵盤の音 midi（8' の高さ）の周波数 [Hz]。調律法のずれ dev（ピッチクラスごと [セント]）と A4 の周波数 a4 */
export const pitchHz = (midi: number, a4: number, dev: readonly number[]): number =>
  a4 * 2 ** ((midi - 69 + dev[((midi % 12) + 12) % 12] / 100) / 12);
