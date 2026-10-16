/**
 * 音の高さと音名（DOM に依存しない）。音番号は MIDI と同じ（A4 = 69、C4 = 60）で、小数も使う。
 * 楽器の調弦は弦の音番号の並び（低い弦から。ウクレレと 5 弦バンジョーは弦番号の大きい順）
 */

/** 周波数 f [Hz] の音番号（基準ピッチ a4 [Hz]、小数） */
export const midiOf = (f: number, a4: number): number => 69 + 12 * Math.log2(f / a4);
/** 音番号 n の周波数 [Hz]。dev は平均律からのずれ [セント] */
export const hzOf = (n: number, a4: number, dev = 0): number => a4 * 2 ** ((n - 69) / 12 + dev / 1200);
/** 2 つの周波数の差 [セント] */
export const centsOf = (f: number, ref: number): number => 1200 * Math.log2(f / ref);

/**
 * 最も近い音（整数の音番号）。前の音 prev から離れるのは、半音の半分を hyst [半音] 越えたときだけにする
 * （境目の音で表示が行き来しないように）
 */
export function nearestNote(n: number, prev: number | null, hyst = 0.15): number {
  if (prev != null && Math.abs(n - prev) < 0.5 + hyst) return prev;
  return Math.round(n);
}

/** 最も近い弦の番号（strs の添字）。前の弦 prev から離れるのは、ほかの弦が hyst [半音] より近いときだけ */
export function nearestString(n: number, strs: readonly number[], prev: number, hyst = 0.3): number {
  let b = 0;
  for (let i = 1; i < strs.length; i++) if (Math.abs(n - strs[i]) < Math.abs(n - strs[b])) b = i;
  if (prev >= 0 && prev < strs.length && Math.abs(n - strs[prev]) < Math.abs(n - strs[b]) + hyst) return prev;
  return b;
}

/** 音名の書き方: 英米式・ドイツ式・イタリア式（ドレミ）・日本式（ハニホ） */
export type Naming = 'en' | 'de' | 'do' | 'ja';
const SHARP: Record<Naming, readonly string[]> = {
  en: ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'],
  de: ['C', 'Cis', 'D', 'Dis', 'E', 'F', 'Fis', 'G', 'Gis', 'A', 'Ais', 'H'],
  do: ['ド', 'ド♯', 'レ', 'レ♯', 'ミ', 'ファ', 'ファ♯', 'ソ', 'ソ♯', 'ラ', 'ラ♯', 'シ'],
  ja: ['ハ', '嬰ハ', 'ニ', '嬰ニ', 'ホ', 'ヘ', '嬰ヘ', 'ト', '嬰ト', 'イ', '嬰イ', 'ロ'],
};
const FLAT: Record<Naming, readonly string[]> = {
  en: ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'],
  de: ['C', 'Des', 'D', 'Es', 'E', 'F', 'Ges', 'G', 'As', 'A', 'B', 'H'],
  do: ['ド', 'レ♭', 'レ', 'ミ♭', 'ミ', 'ファ', 'ソ♭', 'ソ', 'ラ♭', 'ラ', 'シ♭', 'シ'],
  ja: ['ハ', '変ニ', 'ニ', '変ホ', 'ホ', 'ヘ', '変ト', 'ト', '変イ', 'イ', '変ロ', 'ロ'],
};
/** 日本式のオクターブ（C0 から。一点ハ = C4） */
const JA_OCT = ['下二点', '下一点', '大字', '小字', '一点', '二点', '三点', '四点', '五点'];

export interface NameOpts {
  nm: Naming;
  /** 黒鍵を ♭ で書くか */
  flat: boolean;
  /** 中央のド（MIDI 60）を C3 と書くか（ヤマハなど）。既定は C4 */
  c3: boolean;
}
export interface NoteLabel {
  /** オクターブの前置き（日本式の「一点」など） */
  pre: string;
  /** 音名 */
  name: string;
  /** オクターブの番号（日本式では空） */
  oct: string;
}

/** 整数の音番号 N の音名 */
export function noteLabel(N: number, o: NameOpts): NoteLabel {
  const pc = ((N % 12) + 12) % 12,
    o4 = Math.floor(N / 12) - 1,
    name = (o.flat ? FLAT : SHARP)[o.nm][pc];
  if (o.nm === 'ja') return { pre: JA_OCT[o4] ?? '', name, oct: '' };
  return { pre: '', name, oct: String(o.c3 ? o4 - 1 : o4) };
}
/** 音名を 1 つの文字列にする（A4・一点イ など） */
export const noteText = (N: number, o: NameOpts): string => {
  const l = noteLabel(N, o);
  return l.pre + l.name + l.oct;
};

export interface Tuning {
  v: string;
  name: string;
  /** 弦の音番号（低い弦から。ウクレレと 5 弦バンジョーは弦番号の大きい順） */
  notes: readonly number[];
}
export interface Instrument {
  v: string;
  name: string;
  /** 弦を番号で呼ぶか（ギターなど）。呼ばない楽器（ヴァイオリン族）は音名で「A 線」と呼ぶ */
  numbered: boolean;
  tunings: readonly Tuning[];
}

/** 楽器と調弦（12 平均律。Wikipedia の List of guitar tunings・Stringed instrument tunings・Ukulele・Double bass・Banjo） */
export const INSTRUMENTS: readonly Instrument[] = [
  {
    v: 'guitar',
    name: 'ギター',
    numbered: true,
    tunings: [
      { v: 'std', name: '標準', notes: [40, 45, 50, 55, 59, 64] },
      { v: 'dropd', name: 'ドロップ D', notes: [38, 45, 50, 55, 59, 64] },
      { v: 'dadgad', name: 'DADGAD', notes: [38, 45, 50, 55, 57, 62] },
      { v: 'openg', name: 'オープン G', notes: [38, 43, 50, 55, 59, 62] },
      { v: 'opend', name: 'オープン D', notes: [38, 45, 50, 54, 57, 62] },
      { v: 'half', name: '半音下げ', notes: [39, 44, 49, 54, 58, 63] },
      { v: '7str', name: '7 弦', notes: [35, 40, 45, 50, 55, 59, 64] },
    ],
  },
  {
    v: 'bass',
    name: 'ベース',
    numbered: true,
    tunings: [
      { v: '4', name: '4 弦', notes: [28, 33, 38, 43] },
      { v: '5', name: '5 弦', notes: [23, 28, 33, 38, 43] },
      { v: '6', name: '6 弦', notes: [23, 28, 33, 38, 43, 48] },
    ],
  },
  {
    v: 'ukulele',
    name: 'ウクレレ',
    numbered: true,
    tunings: [
      { v: 'high', name: '標準（High G）', notes: [67, 60, 64, 69] },
      { v: 'low', name: 'Low G', notes: [55, 60, 64, 69] },
    ],
  },
  {
    v: 'violin',
    name: 'ヴァイオリン',
    numbered: false,
    tunings: [{ v: 'std', name: '標準', notes: [55, 62, 69, 76] }],
  },
  { v: 'viola', name: 'ヴィオラ', numbered: false, tunings: [{ v: 'std', name: '標準', notes: [48, 55, 62, 69] }] },
  { v: 'cello', name: 'チェロ', numbered: false, tunings: [{ v: 'std', name: '標準', notes: [36, 43, 50, 57] }] },
  {
    v: 'contrabass',
    name: 'コントラバス',
    numbered: false,
    tunings: [
      { v: 'orch', name: 'オーケストラ', notes: [28, 33, 38, 43] },
      { v: 'solo', name: 'ソロ', notes: [30, 35, 40, 45] },
    ],
  },
  {
    v: 'mandolin',
    name: 'マンドリン',
    numbered: false,
    tunings: [{ v: 'std', name: '標準', notes: [55, 62, 69, 76] }],
  },
  {
    v: 'banjo',
    name: 'バンジョー',
    numbered: true,
    tunings: [{ v: 'openg', name: 'オープン G', notes: [67, 50, 55, 59, 62] }],
  },
];
export const instrumentOf = (v: string): Instrument | undefined => INSTRUMENTS.find((i) => i.v === v);
