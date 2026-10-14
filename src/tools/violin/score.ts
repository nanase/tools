/**
 * 演奏する曲（著作権の切れた曲の電子楽譜から変換したもの）と、演奏の設定（DOM に依存しない）。
 * 音符のデータは scores/ にあり、曲を選んだときに主スレッドが読み込んで（scores/load.ts）、計算用の Worker へ渡す。
 * バッハの曲の原典には強弱の記号がないので、強弱とテンポはこのツールで決めた目安（よくある演奏から選んだ仮定）
 */
import { type PolyOpt, type PolyPerf, performPoly, planFromMarks } from './perform';
import type { ScoreNote } from './scores/types';

/** 曲のデータ */
export interface PieceData {
  voices: ScoreNote[][];
  /** 小節線の時刻 [拍] */
  bars: number[];
}

export interface Piece {
  v: string;
  name: string;
  /** 作曲者と曲集 */
  by: string;
  /** 標準のテンポ（4 分音符 / 分）と、出典の枠に出す表記 */
  qpm: number;
  tempo: string;
  /** 1 小節の拍（4 分音符）の数 */
  meter: number;
  /** 楽句の小節数 */
  phraseBars: number;
  /** 強弱の予定 [拍, dB（mf = 0）]。楽譜の記号を使う曲では省く */
  plan?: readonly (readonly [number, number])[];
  /** 楽譜の強弱の記号と松葉を使う */
  marks?: boolean;
  /** テンポを変えるところ [拍, 4 分音符 / 分] */
  qpmMap?: readonly (readonly [number, number])[];
  /** 調号（♭ の数。負なら ♯）と、変わるところ [拍, ♭ の数] */
  flats: number;
  flatMap?: readonly (readonly [number, number])[];
  arp?: readonly (readonly [number, number])[];
  sectionEnds?: readonly number[];
  /** 音符のデータ（scores/ の名前。scores/load.ts が読み込む） */
  file: string;
}

/** シャコンヌの小節 n の始まりの拍（最初の小節は 2 拍の弱起） */
const barT = (n: number) => (n <= 1 ? 0 : 2 + 3 * (n - 2));
const BACH = 'J. S. バッハ（無伴奏ヴァイオリンのための';

export const PIECES: readonly Piece[] = [
  {
    v: 'chaconne',
    file: 'bwv1004-5',
    name: 'シャコンヌ ニ短調 BWV 1004',
    by: `${BACH}パルティータ 第 2 番）`,
    qpm: 60,
    tempo: '♩ = 60（ニ長調の節は 54）',
    meter: 3,
    phraseBars: 4,
    /* 節ごとの強弱（仮定）[小節, dB] */
    plan: (
      [
        [1, 4],
        [8.9, 4],
        [9, 0],
        [32.9, 2],
        [33, -3],
        [56.9, 4],
        [57, 0],
        [76, 0],
        [88.9, -2],
        [89, -6],
        [120.9, 5],
        [121, 3],
        [132.9, 4],
        [133, -7],
        [152.9, -5],
        [153, -4],
        [176.9, 0],
        [177, 2],
        [200.9, 4],
        [201, -2],
        [207.9, 5],
        [208, 2],
        [209, -3],
        [228.9, -2],
        [229, -1],
        [248.9, 4],
        [249, 6],
        [258, 6],
      ] as const
    ).map(([bar, db]) => [barT(bar), db] as const),
    qpmMap: [
      [barT(133), 54],
      [barT(209), 60],
    ],
    flats: 1,
    flatMap: [
      [barT(133), -2],
      [barT(209), 1],
    ],
    arp: [
      [barT(89) + 1, barT(121)],
      [barT(201), barT(208)],
    ],
    sectionEnds: [barT(133), barT(209)],
  },
  {
    v: 'allemanda',
    file: 'bwv1004-1',
    name: 'アルマンド ニ短調 BWV 1004',
    by: `${BACH}パルティータ 第 2 番）`,
    qpm: 60,
    tempo: '♩ = 60',
    meter: 4,
    phraseBars: 2,
    plan: [[0, 0]],
    flats: 1,
  },
  {
    v: 'corrente',
    file: 'bwv1004-2',
    name: 'クーラント ニ短調 BWV 1004',
    by: `${BACH}パルティータ 第 2 番）`,
    qpm: 96,
    tempo: '♩ = 96',
    meter: 3,
    phraseBars: 4,
    plan: [[0, 1]],
    flats: 1,
  },
  {
    v: 'sarabanda',
    file: 'bwv1004-3',
    name: 'サラバンド ニ短調 BWV 1004',
    by: `${BACH}パルティータ 第 2 番）`,
    qpm: 54,
    tempo: '♩ = 54',
    meter: 3,
    phraseBars: 4,
    plan: [[0, -1]],
    flats: 1,
  },
  {
    v: 'giga',
    file: 'bwv1004-4',
    name: 'ジーグ ニ短調 BWV 1004',
    by: `${BACH}パルティータ 第 2 番）`,
    qpm: 99,
    tempo: '♩ = 99',
    meter: 6,
    phraseBars: 2,
    plan: [[0, 1]],
    flats: 1,
  },
  {
    v: 'preludio',
    file: 'bwv1006-1',
    name: '前奏曲 ホ長調 BWV 1006',
    by: `${BACH}パルティータ 第 3 番）`,
    qpm: 112,
    tempo: '♩ = 112',
    meter: 3,
    phraseBars: 4,
    plan: [[0, 2]],
    flats: -4,
  },
  {
    v: 'adagio',
    file: 'bwv1001-1',
    name: 'アダージョ ト短調 BWV 1001',
    by: `${BACH}ソナタ 第 1 番）`,
    qpm: 24,
    tempo: '♪ = 48',
    meter: 4,
    phraseBars: 2,
    plan: [[0, 0]],
    flats: 1,
  },
  {
    v: 'eccles-grave',
    file: 'eccles-1',
    name: 'グラーヴェ ト短調（エクルズ）',
    by: 'H. エクルズ（ソナタ ト短調。J. Salmon の 1914 年の編曲）',
    qpm: 34.5,
    tempo: '♪ = 69',
    meter: 4,
    phraseBars: 2,
    marks: true,
    flats: 2,
  },
  {
    v: 'eccles-adagio',
    file: 'eccles-3',
    name: 'アダージョ ト短調（エクルズ）',
    by: 'H. エクルズ（ソナタ ト短調。J. Salmon の 1914 年の編曲）',
    qpm: 84,
    tempo: '𝅗𝅥 = 42',
    meter: 6,
    phraseBars: 2,
    marks: true,
    flats: 2,
  },
];

export const pieceOf = (v: string): Piece => PIECES.find((p) => p.v === v) ?? PIECES[0];

/** 区切られた値の表 [拍, 値] から、拍 b の値（最初の区切りより前は v0） */
const stepAt = (v0: number, map: readonly (readonly [number, number])[] | undefined, b: number): number => {
  let v = v0;
  for (const [b0, x] of map ?? []) if (b >= b0) v = x;
  return v;
};

/** 表情: 楽譜どおり（強弱の目安とテンポだけ）か、楽句の弧と揺らぎを付けるか */
export type Expr = 'plain' | 'phrase';

/** 曲を演奏の音符の列にする。tempo は標準のテンポに対する比 */
export function performPiece(p: Piece, d: PieceData, expr: Expr, tempo: number): PolyPerf {
  const plain = expr === 'plain',
    opt: PolyOpt = {
      qpm: (b) => stepAt(p.qpm, p.qpmMap, b) * tempo,
      phraseLen: p.meter * p.phraseBars,
      phraseOff: 0,
      plan: p.marks ? planFromMarks(d.voices[0]) : plain ? [[0, p.plan?.[0]?.[1] ?? 0]] : (p.plan ?? [[0, 0]]),
      arp: p.arp ?? [],
      flats: (b) => stepAt(p.flats, p.flatMap, b),
      sectionEnds: plain ? [] : p.sectionEnds,
      ...(plain ? { archDb: 0, archTempo: 0, phraseEnd: 0, finalRit: 0, swellDb: 0, highLoud: 0, jitter: 0 } : {}),
    };
  return performPoly(d.voices, opt);
}

/** 拍 b の小節の番号（1 から） */
export function barOf(d: PieceData, b: number): number {
  let lo = 0,
    hi = d.bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (d.bars[mid] <= b + 1e-6) lo = mid + 1;
    else hi = mid;
  }
  return lo + 1;
}
