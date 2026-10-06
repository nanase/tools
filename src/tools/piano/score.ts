/**
 * 演奏する曲（著作権の切れた曲の電子楽譜から変換したもの）と、強さとペダルの付け方（DOM に依存しない）。
 * 音符のデータは scores/ にあり、曲を選んだときに読み込む
 */
import type { ScoreNote } from './scores/types';

export type { ScoreNote };

export interface Piece {
  v: string;
  name: string;
  /** 作曲者・出典 */
  by: string;
  /** 1 分あたりの 4 分音符の数（標準のテンポ） */
  bpm: number;
  /** 速さの表記（出典の枠に出す） */
  tempo: string;
  /** 1 小節の拍（4 分音符）の数・最初の小節の前の拍（弱起） */
  bar: number;
  pickup: number;
  /** 強さの目安（打鍵の強さに掛ける。1 が mf） */
  lv: number;
  /** テンポの変化 [拍, 標準のテンポに対する比]（最初の項より前は 1） */
  tempoMap: readonly (readonly [number, number])[];
  load: () => Promise<ScoreNote[]>;
}

export const PIECES: readonly Piece[] = [
  {
    v: 'bwv846',
    name: '前奏曲 ハ長調 BWV 846',
    by: 'J. S. バッハ（平均律クラヴィーア曲集 第 1 巻）',
    bpm: 66,
    tempo: '♩ = 66',
    bar: 4,
    pickup: 0,
    lv: 0.75,
    /* 終わりの 2 小節で少し遅く */
    tempoMap: [
      [132, 0.9],
      [136, 0.75],
    ],
    load: () => import('./scores/bwv846').then((m) => m.notes()),
  },
  {
    v: 'gymno1',
    name: 'ジムノペディ 第 1 番',
    by: 'E. サティ（3 つのジムノペディ）',
    bpm: 72,
    tempo: 'Lent et douloureux（♩ = 72）',
    bar: 3,
    pickup: 0,
    lv: 0.55,
    tempoMap: [],
    load: () => import('./scores/gymnopedie1').then((m) => m.notes()),
  },
  {
    v: 'moon1',
    name: '月光 第 1 楽章',
    by: 'L. v. ベートーヴェン（ピアノ・ソナタ第 14 番 嬰ハ短調 Op. 27 No. 2）',
    bpm: 54,
    tempo: 'Adagio sostenuto（𝅗𝅥 = 27）',
    bar: 4,
    pickup: 0,
    lv: 0.45,
    tempoMap: [[268, 0.8]],
    load: () => import('./scores/moonlight1').then((m) => m.notes()),
  },
  {
    v: 'moon2',
    name: '月光 第 2 楽章',
    by: 'L. v. ベートーヴェン（ピアノ・ソナタ第 14 番 嬰ハ短調 Op. 27 No. 2）',
    bpm: 150,
    tempo: 'Allegretto（♩ = 150）',
    bar: 3,
    pickup: 1,
    lv: 0.8,
    tempoMap: [],
    load: () => import('./scores/moonlight2').then((m) => m.notes()),
  },
  {
    v: 'moon3',
    name: '月光 第 3 楽章',
    by: 'L. v. ベートーヴェン（ピアノ・ソナタ第 14 番 嬰ハ短調 Op. 27 No. 2）',
    bpm: 168,
    tempo: 'Presto agitato（♩ = 168）',
    bar: 4,
    pickup: 0,
    lv: 1.1,
    /* 反復を展開した小節 251 のカデンツァはゆっくり、252〜253 は Adagio、254 から Tempo I */
    tempoMap: [
      [1000, 0.55],
      [1004, 0.35],
      [1012, 1],
    ],
    load: () => import('./scores/moonlight3').then((m) => m.notes()),
  },
];
export const pieceOf = (v: string): Piece => PIECES.find((p) => p.v === v) ?? PIECES[0];

/**
 * 声部の強さ: 同時に始まる音のうち、右手の最も高い音（旋律）を強く、左手の最も低い音（低音）を少し強く、
 * 間の音を弱くする。返すのは音符ごとの倍率
 */
export function voicing(notes: readonly ScoreNote[]): Float64Array {
  const k = new Float64Array(notes.length).fill(1),
    by = new Map<number, number[]>();
  notes.forEach((x, i) => {
    const t = Math.round(x.t * 480);
    const l = by.get(t) ?? [];
    l.push(i);
    by.set(t, l);
  });
  for (const g of by.values()) {
    if (g.length < 2) continue;
    const hi = g.reduce((a, b) => (notes[b].n > notes[a].n ? b : a)),
      lo = g.reduce((a, b) => (notes[b].n < notes[a].n ? b : a));
    for (const i of g) k[i] = i === hi && notes[i].h === 0 ? 1.15 : i === lo ? 1.05 : 0.88;
  }
  return k;
}

/**
 * 自動のペダル: 低音（その時刻に鳴っている最も低い音）の音名が変わる拍で踏みかえる。
 * 踏みかえは、新しい低音を打つ直前に離し、打った直後に踏む（後踏み）。返すのは踏みかえる拍の列
 */
export function pedalPoints(notes: readonly ScoreNote[], minGap = 0.9): number[] {
  const byT = [...notes].sort((a, b) => a.t - b.t),
    pts: number[] = [],
    act: ScoreNote[] = [];
  let pc = -1,
    last = -Infinity,
    i = 0;
  while (i < byT.length) {
    const t = byT[i].t;
    /* 終わった音を外し、この時刻に始まる音を足す */
    for (let k = act.length - 1; k >= 0; k--) if (act[k].t + act[k].d <= t + 1e-6) act.splice(k, 1);
    const start: ScoreNote[] = [];
    while (i < byT.length && byT[i].t <= t + 1e-6) start.push(byT[i++]);
    act.push(...start);
    const low = act.reduce((a, b) => (b.n < a.n ? b : a));
    /* 新しく打った低音だけを見る */
    if (!start.includes(low)) continue;
    const c = low.n % 12;
    if (c !== pc && t - last >= minGap) {
      pts.push(t);
      pc = c;
      last = t;
    }
  }
  return pts;
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
  private seg(b: number): number {
    let i = this.b.length - 1;
    while (i > 0 && this.b[i] > b) i--;
    return i;
  }
  tau(b: number): number {
    const i = this.seg(b);
    return this.t[i] + (b - this.b[i]) / this.r[i];
  }
  /** τ から拍へ戻す */
  beat(tau: number): number {
    let i = this.t.length - 1;
    while (i > 0 && this.t[i] > tau) i--;
    return this.b[i] + (tau - this.t[i]) * this.r[i];
  }
}
