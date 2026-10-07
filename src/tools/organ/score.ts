/**
 * 演奏する曲（著作権の切れた曲の電子楽譜から変換したもの）と、曲ごとのレジストレーション（DOM に依存しない）。
 * 音符のデータは scores/ にあり、曲を選んだときに読み込む。譜表 h は 0 = 右手、1 = 左手、2 = ペダル
 */
import type { ScoreNote } from './scores/types';

export type { ScoreNote };

/** 鍵盤（風箱）: 第 1 手鍵盤・第 2 手鍵盤・ペダル */
export type Div = 'I' | 'II' | 'P';
export type Coupler = 'II/I' | 'I/P' | 'II/P';

/** レジストレーション: 入れるストップ（ストップの id）とカプラー */
export interface Registration {
  stops: readonly string[];
  couplers: readonly Coupler[];
}

/** 曲のデータ */
export interface PieceData {
  notes: ScoreNote[];
  /** テンポの変化 [拍, 基本のテンポに対する比] */
  tempo: readonly (readonly [number, number])[];
  /** 拍子の変化 [拍, 1 小節の拍の数]（なければ Piece.bar） */
  meter?: readonly (readonly [number, number])[];
  /** レジストレーションの切り替え [拍, 番号]（番号は Piece.regs） */
  reg?: readonly (readonly [number, number])[];
}

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
  /** 使うストップ（ストップの id）とカプラー（演奏の始めのレジストレーション） */
  stops: readonly string[];
  couplers: readonly Coupler[];
  /** 演奏中に切り替えるレジストレーション（曲のデータの REG の番号ごと） */
  regs?: Readonly<Record<number, Registration>>;
  /** テンポの変化 [拍, 標準のテンポに対する比]（曲のデータの TEMPO より先に使う。空ならデータのもの） */
  tempoMap: readonly (readonly [number, number])[];
  load: () => Promise<PieceData>;
}

/** オルガノ・プレノ: 第 1 手鍵盤のプリンシパルの合唱（16' から ミクスチュアまで）と、ペダルの 16'・8'・4' とポザウネ */
const PLENUM = ['bd16', 'p8', 'p4', 'q3', 'p2', 'mix', 'pb16', 'sb16', 'ob8', 'cb4', 'po16'];

/**
 * BWV 565 の演奏の MIDI の Main Piston（ジェネラル・ピストン）の 5 つの番号に当てるレジストレーション。番号が大きいほど強い
 * 並びで、区間の音楽から決めた（MIDI には中身がない）。
 * 3: エコーの区間とフーガの始め（第 2 手鍵盤の弱い合唱と、第 1 手鍵盤の 8'・4'）
 * 4: ペダルの入る区間とフーガの中ほど（2' までの合唱）
 * 6: プレノ（16' からミクスチュアまで。第 2 手鍵盤も合唱）
 * 8: プレノにリード（トランペット・オーボエ）。トッカータとフーガの終わりの区間
 * 9: 最後の和音のトゥッティ（第 1 手鍵盤の全部）
 */
const SWELL_CHORUS = ['gp8', 'g8', 'f4', 'n3', 'fl2'],
  PLENO565 = [...PLENUM, ...SWELL_CHORUS],
  REED565 = [...PLENO565, 'tr8', 'hb8', 'ptr8'],
  REGS565: Record<number, Registration> = {
    3: { stops: ['p8', 'p4', 'gp8', 'g8', 'f4', 'sb16', 'ob8'], couplers: [] },
    4: { stops: ['p8', 'p4', 'p2', 'gp8', 'g8', 'f4', 'fl2', 'sb16', 'ob8', 'cb4'], couplers: [] },
    6: { stops: PLENO565, couplers: [] },
    8: { stops: REED565, couplers: [] },
    9: { stops: [...REED565, 'hf8', 'wf4', 'cor'], couplers: [] },
  };

export const PIECES: readonly Piece[] = [
  {
    v: 'bwv565',
    name: 'トッカータとフーガ ニ短調 BWV 565',
    by: 'J. S. バッハ（伝）',
    bpm: 50,
    tempo: '♩ = 50（演奏のテンポの変化に従う。♩ = 18〜115）',
    bar: 4,
    pickup: 0,
    /* 演奏の MIDI の Great・Swell・Pedal を、第 1 手鍵盤・第 2 手鍵盤・ペダルで弾く */
    hands: ['I', 'II', 'P'],
    stops: PLENO565,
    couplers: [],
    regs: REGS565,
    tempoMap: [],
    load: () =>
      import('./scores/bwv565').then((m) => ({ notes: m.notes(), tempo: m.TEMPO, meter: m.METER, reg: m.REG })),
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

/** 拍子の変化の列で、拍 b の小節の番号（1 から。弱起は 0）。meter は [拍, 1 小節の拍の数] */
export function barOf(meter: readonly (readonly [number, number])[], pickup: number, b: number): number {
  if (b < pickup) return 0;
  let k = 0;
  for (let i = 0; i < meter.length; i++) {
    const s0 = Math.max(meter[i][0], pickup),
      len = meter[i][1],
      e0 = i + 1 < meter.length ? meter[i + 1][0] : Infinity;
    if (b < e0) return k + Math.floor((b - s0) / len) + 1;
    k += Math.round(Math.max(0, e0 - s0) / len);
  }
  return k;
}

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
