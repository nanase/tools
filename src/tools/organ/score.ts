/**
 * 演奏する曲（著作権の切れた曲の電子楽譜から変換したもの）と、曲ごとのレジストレーション（DOM に依存しない）。
 * 音符のデータは scores/ にあり、曲を選んだときに読み込む。譜表 h は 0 = 右手、1 = 左手、2 = ペダル
 */
import type { ScoreNote } from './scores/types';

export type { ScoreNote };

/** 鍵盤（風箱）: 第 1 手鍵盤・第 2 手鍵盤・ペダル */
export type Div = 'I' | 'II' | 'P';

export interface Piece {
  v: string;
  name: string;
  by: string;
  /** 1 分あたりの 4 分音符の数（標準のテンポ） */
  bpm: number;
  /** 速さの表記（出典の枠に出す） */
  tempo: string;
  /** 1 小節の拍（4 分音符）の数・弱起の拍 */
  bar: number;
  pickup: number;
  /** 譜表ごとに弾く鍵盤（右手・左手・ペダル） */
  hands: readonly [Div, Div, Div];
  /** 使うストップ（ストップの id）とカプラー */
  stops: readonly string[];
  couplers: readonly ('II/I' | 'I/P' | 'II/P')[];
  /** テンポの変化 [拍, 標準のテンポに対する比]（曲のデータの TEMPO より先に使う。空ならデータのもの） */
  tempoMap: readonly (readonly [number, number])[];
  load: () => Promise<{ notes: ScoreNote[]; tempo: readonly (readonly [number, number])[] }>;
}

/** オルガノ・プレノ: 第 1 手鍵盤のプリンシパルの合唱（16' から ミクスチュアまで）と、ペダルの 16'・8'・4' とポザウネ */
const PLENUM = ['bd16', 'p8', 'p4', 'q3', 'p2', 'mix', 'pb16', 'sb16', 'ob8', 'cb4', 'po16'];

export const PIECES: readonly Piece[] = [
  {
    v: 'bwv565',
    name: 'トッカータとフーガ ニ短調 BWV 565',
    by: 'J. S. バッハ（伝）',
    bpm: 80,
    tempo: '♩ = 80（区間ごとに変える）',
    bar: 4,
    pickup: 0,
    hands: ['I', 'I', 'P'],
    stops: PLENUM,
    couplers: [],
    /* 小節 1 Adagio、4 Prestissimo、30 フーガ、127 Recitativo、130 Adagissimo、133 Presto、136 の 4 拍目 Adagio、141 Molto Adagio */
    tempoMap: [
      [0, 0.6],
      [12, 1],
      [116, 0.95],
      [504, 0.7],
      [516, 0.4],
      [528, 1.15],
      [543, 0.6],
      [560, 0.4],
    ],
    load: () => import('./scores/bwv565').then((m) => ({ notes: m.notes(), tempo: m.TEMPO })),
  },
  {
    v: 'bwv645',
    name: '目覚めよと呼ぶ声あり BWV 645',
    by: 'J. S. バッハ（シューブラー・コラール集）',
    bpm: 66,
    tempo: '♩ = 66',
    bar: 4,
    pickup: 0.5,
    hands: ['II', 'I', 'P'],
    stops: ['g8', 'f4', 'tr8', 'sb16', 'ob8'],
    couplers: [],
    tempoMap: [],
    load: () => import('./scores/bwv645').then((m) => ({ notes: m.notes(), tempo: m.TEMPO })),
  },
  {
    v: 'bwv582',
    name: 'パッサカリアとフーガ ハ短調 BWV 582',
    by: 'J. S. バッハ',
    bpm: 66,
    tempo: '♩ = 66（終わりは MIDI のテンポの変化に従う）',
    bar: 3,
    pickup: 1,
    hands: ['I', 'I', 'P'],
    stops: PLENUM,
    couplers: [],
    tempoMap: [],
    load: () => import('./scores/bwv582').then((m) => ({ notes: m.notes(), tempo: m.TEMPO })),
  },
  {
    v: 'bwv578',
    name: 'フーガ ト短調 BWV 578（小フーガ）',
    by: 'J. S. バッハ',
    bpm: 88,
    tempo: '♩ = 88（終わりは MIDI のテンポの変化に従う）',
    bar: 4,
    pickup: 0,
    /* 両手は 1 つのトラックなので、どちらも第 1 手鍵盤で弾く */
    hands: ['I', 'I', 'P'],
    /* プリンシパルの合唱（8'・4'・2'・ミクスチュア）と、ペダルの 16'・8' */
    stops: ['p8', 'p4', 'p2', 'mix', 'sb16', 'ob8'],
    couplers: [],
    tempoMap: [],
    load: () => import('./scores/bwv578').then((m) => ({ notes: m.notes(), tempo: m.TEMPO })),
  },
];
export const pieceOf = (v: string): Piece => PIECES.find((p) => p.v === v) ?? PIECES[0];

/**
 * テンポの比の表から、拍 b までの「標準のテンポでの拍の長さに直した時間」τ(b) = ∫ db / 比 を求める。
 * 演奏の時刻は τ に 1 拍の秒数を掛けたもの
 */
export class TempoMap {
  private readonly b: number[];
  private readonly r: number[];
  private readonly t: number[];
  constructor(pts: readonly (readonly [number, number])[]) {
    /* 拍 0 の比（表になければ 1）から始める */
    const r0 = pts.find(([b]) => b <= 0)?.[1] ?? 1,
      p = [[0, r0], ...pts.filter(([b]) => b > 0)].sort((x, y) => x[0] - y[0]);
    this.b = p.map((x) => x[0]);
    this.r = p.map((x) => x[1]);
    this.t = [0];
    for (let i = 1; i < p.length; i++) this.t.push(this.t[i - 1] + (this.b[i] - this.b[i - 1]) / this.r[i - 1]);
  }
  tau(b: number): number {
    let i = this.b.length - 1;
    while (i > 0 && this.b[i] > b) i--;
    return this.t[i] + (b - this.b[i]) / this.r[i];
  }
  /** τ から拍へ戻す */
  beat(tau: number): number {
    let i = this.t.length - 1;
    while (i > 0 && this.t[i] > tau) i--;
    return this.b[i] + (tau - this.t[i]) * this.r[i];
  }
}
