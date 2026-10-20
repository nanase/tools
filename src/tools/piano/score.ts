/**
 * 演奏する曲（著作権の切れた曲の電子楽譜から変換したもの）と、ベロシティとペダルの付け方（DOM に依存しない）。
 * 音符のデータは scores/ にあり、曲を選んだときに読み込む
 */
import { rng } from '../guitar/body';
import type { ScoreNote } from './scores/types';

export type { ScoreNote };

/** 曲のデータ */
export interface PieceData {
  notes: ScoreNote[];
  /** MIDI のテンポの変化 [拍, 標準のテンポに対する比]（変化のない MIDI では空） */
  tempo: readonly (readonly [number, number])[];
  /** 拍子の変化 [拍, 1 小節の拍の数]（拍子の変わる曲だけ。なければ Piece.bar） */
  meter?: readonly (readonly [number, number])[];
  /** 演奏の記録のダンパーペダル [拍, 1 = 踏む・0 = 離す]（記録のある曲だけ） */
  pedal?: readonly (readonly [number, number])[];
}
const data = (m: {
  notes: () => ScoreNote[];
  TEMPO: readonly (readonly [number, number])[];
  METER?: readonly (readonly [number, number])[];
  PEDAL?: readonly (readonly [number, number])[];
}): PieceData => ({
  notes: m.notes(),
  tempo: m.TEMPO,
  meter: m.METER,
  pedal: m.PEDAL,
});

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
  /** 強弱の目安（mf のハンマーの速さに掛ける。1 が mf） */
  lv: number;
  /**
   * テンポの変化 [拍, 標準のテンポに対する比]（最初の項より前は 1）。このツールで付けたもので、
   * MIDI にテンポの変化がある曲では使わない（tempoOf）
   */
  tempoMap: readonly (readonly [number, number])[];
  load: () => Promise<PieceData>;
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
    load: () => import('./scores/bwv846').then(data),
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
    load: () => import('./scores/gymnopedie1').then(data),
  },
  {
    v: 'gymno2',
    name: 'ジムノペディ 第 2 番',
    by: 'E. サティ（3 つのジムノペディ）',
    bpm: 69,
    tempo: 'Lent et triste（♩ = 69）',
    bar: 3,
    pickup: 0,
    lv: 0.55,
    tempoMap: [],
    load: () => import('./scores/gymnopedie2').then(data),
  },
  {
    v: 'gymno3',
    name: 'ジムノペディ 第 3 番',
    by: 'E. サティ（3 つのジムノペディ）',
    bpm: 66,
    tempo: 'Lent et grave（♩ = 66）',
    bar: 3,
    pickup: 0,
    lv: 0.55,
    tempoMap: [],
    load: () => import('./scores/gymnopedie3').then(data),
  },
  /* グノシエンヌの楽譜に小節線はない。小節は、楽譜のデータが音符を並べるのに使う拍子（4/4・12/8）で数える */
  {
    v: 'gnoss1',
    name: 'グノシエンヌ 第 1 番',
    by: 'E. サティ（3 つのグノシエンヌ）',
    bpm: 84,
    tempo: 'Lent（♩ = 84）',
    bar: 4,
    pickup: 0,
    lv: 0.65,
    tempoMap: [],
    load: () => import('./scores/gnossienne1').then(data),
  },
  {
    v: 'gnoss2',
    name: 'グノシエンヌ 第 2 番',
    by: 'E. サティ（3 つのグノシエンヌ）',
    bpm: 80,
    tempo: 'Avec étonnement（♩ = 80）',
    bar: 6,
    pickup: 0,
    lv: 0.65,
    tempoMap: [],
    load: () => import('./scores/gnossienne2').then(data),
  },
  {
    v: 'gnoss3',
    name: 'グノシエンヌ 第 3 番',
    by: 'E. サティ（3 つのグノシエンヌ）',
    bpm: 72,
    tempo: 'Lent（♩ = 72）',
    bar: 4,
    pickup: 0,
    lv: 0.65,
    tempoMap: [],
    load: () => import('./scores/gnossienne3').then(data),
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
    load: () => import('./scores/moonlight1').then(data),
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
    load: () => import('./scores/moonlight2').then(data),
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
    /* 反復を展開した小節 251 のカデンツァ（♩ = 92.4）、252〜253 の Adagio（♩ = 58.8）は MIDI のテンポにある */
    tempoMap: [],
    load: () => import('./scores/moonlight3').then(data),
  },
  /* MuseScore の楽譜の MIDI。投稿者が付けたテンポの変化とベロシティで弾く */
  {
    v: 'fantaisie',
    name: '幻想即興曲',
    by: 'F. ショパン（幻想即興曲 嬰ハ短調 Op. 66）',
    bpm: 162,
    tempo: 'Allegro agitato（♩ = 162。楽譜のデータのテンポの変化に従う）',
    bar: 4,
    pickup: 0,
    lv: 0.9,
    tempoMap: [],
    load: () => import('./scores/fantaisie').then(data),
  },
  {
    v: 'campanella',
    name: 'ラ・カンパネラ',
    by: 'F. リスト（パガニーニによる大練習曲 第 3 番 嬰ト短調）',
    bpm: 108,
    tempo: 'Allegretto（♩ = 108。楽譜のデータのテンポの変化に従う）',
    bar: 3,
    pickup: 0,
    lv: 0.85,
    tempoMap: [],
    load: () => import('./scores/campanella').then(data),
  },
  {
    v: 'jeux',
    name: '水の戯れ',
    by: 'M. ラヴェル',
    bpm: 72,
    tempo: 'Très doux（♩ = 72。楽譜のデータのテンポの変化に従う）',
    bar: 4,
    pickup: 0,
    lv: 0.6,
    tempoMap: [],
    load: () => import('./scores/jeuxdeau').then(data),
  },
  /*
   * ブゾーニの演奏を記録したピアノロールの MIDI。時刻は演奏のとおりで、拍と小節は楽譜と合わない（♩ = 120 で 1 小節 2 秒）。
   * ペダルもロールの記録のとおりに踏む
   */
  {
    v: 'chaconne',
    name: 'シャコンヌ（ブゾーニ編）',
    by: 'J. S. バッハ（無伴奏ヴァイオリンのためのパルティータ 第 2 番 ニ短調 BWV 1004）、F. ブゾーニ編曲',
    bpm: 120,
    tempo: 'ブゾーニの演奏のとおり（ピアノロールの記録。小節は楽譜と合わない）',
    bar: 4,
    pickup: 0,
    lv: 0.9,
    tempoMap: [],
    load: () => import('./scores/busoni-chaconne').then(data),
  },
];
export const pieceOf = (v: string): Piece => PIECES.find((p) => p.v === v) ?? PIECES[0];
/** 演奏に使うテンポの変化: MIDI に変化があればそれを、なければこのツールで付けたものを使う */
export const tempoOf = (pc: Piece, d: PieceData): readonly (readonly [number, number])[] =>
  d.tempo.length ? d.tempo : pc.tempoMap;

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

/** 楽譜のベロシティの比を、ハンマーの速さの比にするときの指数 */
const DYN_EXP = 1.5;

/**
 * 楽譜の強弱: 音符のベロシティ（LilyPond が強弱記号と松葉から付けた値か、MIDI を編集して付けた値）を、曲の中央の値に対する比にして、
 * ハンマーの速さの倍率にする。LilyPond の松葉は幅が一律に大きい（pp から mf を超える）ので、強弱記号を
 * そのまま pp〜ff の速さに当てはめず、比の DYN_EXP 乗に縮める。ベロシティのない曲は null
 */
export function dynamics(notes: readonly ScoreNote[]): Float64Array | null {
  const vs = notes.map((x) => x.v ?? 0);
  if (vs.some((v) => v <= 0)) return null;
  const mid = [...vs].sort((a, b) => a - b)[vs.length >> 1];
  return Float64Array.from(vs, (v) => (v / mid) ** DYN_EXP);
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

/** 演奏の出来事。時刻は拍で持ち、予約するときに今のテンポで秒に直す。打鍵の i は音符の番号 */
export type PlayEv =
  | { b: number; type: 'on'; key: number; v: number; jit: number; i: number }
  | { b: number; type: 'off'; key: number }
  | { b: number; type: 'pedal'; on: boolean };

/**
 * 曲の出来事: 音符の打鍵と離鍵（同じ鍵を続けて打つときは、離鍵を打鍵の少し前に）とペダル。vel は mf の
 * ハンマーの速さ [m/s]、pedal はダンパーペダル（自動・踏む・踏まない）。自動は、曲に演奏の記録のペダル rec があればそのとおりに、
 * なければ低音の変わるところで踏みかえる。同じ拍なら 離鍵・ペダル → 打鍵 の順。
 * 打鍵の v は自動のベロシティ（ハンマーの速さ [m/s]）: 曲の強弱の目安 × 楽譜の強弱 × 声部の強さ × 小さなばらつき
 */
export function playEvents(
  pc: Piece,
  notes: readonly ScoreNote[],
  vel: number,
  pedal: 'auto' | 'on' | 'off',
  rec?: readonly (readonly [number, number])[],
): PlayEv[] {
  const r = rng(5),
    vo = voicing(notes),
    dy = dynamics(notes),
    ev: PlayEv[] = [];
  notes.forEach((x, i) => {
    const v = Math.min(7, vel * pc.lv * (dy?.[i] ?? 1) * vo[i] * (0.92 + 0.16 * r())),
      jit = (r() - 0.5) * 0.008;
    ev.push({ b: x.t, type: 'on', key: x.n, v, jit, i });
    ev.push({ b: x.t + x.d * 0.97, type: 'off', key: x.n });
  });
  const end = Math.max(...notes.map((x) => x.t + x.d));
  if (pedal === 'auto' && rec) {
    for (const [b, on] of rec) ev.push({ b, type: 'pedal', on: on === 1 });
    if (rec[rec.length - 1]?.[1] === 1) ev.push({ b: end + 2, type: 'pedal', on: false });
  } else if (pedal !== 'off') {
    const pts = pedal === 'on' ? [0] : pedalPoints(notes);
    for (const t of pts) {
      if (t > 0) ev.push({ b: t - 0.02, type: 'pedal', on: false });
      ev.push({ b: t + 0.12, type: 'pedal', on: true });
    }
    ev.push({ b: end + 2, type: 'pedal', on: false });
  }
  const rank = (e: PlayEv) => (e.type === 'off' ? 0 : e.type === 'pedal' ? 1 : 2);
  return ev.sort((a, b) => a.b - b.b || rank(a) - rank(b));
}

export { TempoMap } from '../../lib/tempo';
