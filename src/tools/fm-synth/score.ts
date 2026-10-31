/**
 * 演奏する曲（著作権の切れた曲の電子楽譜から変換したもの。DOM に依存しない）。
 * 音符のデータは scores/ にあり、曲を選んだときに読み込む。どのパートもページの音色で弾く
 */
import type { ScoreNote } from './scores/types';

export type { ScoreNote };

/** 曲のデータ */
export interface PieceData {
  notes: ScoreNote[];
  /** MIDI のテンポの変化 [拍, 標準のテンポに対する比]（変化のない MIDI では空） */
  tempo: readonly (readonly [number, number])[];
}
const data = (m: { notes: () => ScoreNote[]; TEMPO: readonly (readonly [number, number])[] }): PieceData => ({
  notes: m.notes(),
  tempo: m.TEMPO,
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
  load: () => Promise<PieceData>;
}

export const PIECES: readonly Piece[] = [
  {
    v: 'kv331',
    name: 'トルコ行進曲',
    by: 'W. A. モーツァルト（ピアノ・ソナタ 第 11 番 イ長調 K. 331 第 3 楽章）',
    bpm: 120,
    tempo: 'Allegretto（♩ = 120）',
    bar: 2,
    pickup: 1,
    load: () => import('./scores/kv331').then(data),
  },
  {
    v: 'entertainer',
    name: 'ジ・エンターテイナー',
    by: 'S. ジョプリン',
    bpm: 72,
    tempo: 'Not fast（♩ = 72）',
    bar: 2,
    pickup: 0,
    load: () => import('./scores/entertainer').then(data),
  },
  {
    v: 'maple',
    name: 'メイプル・リーフ・ラグ',
    by: 'S. ジョプリン',
    bpm: 96,
    tempo: 'Tempo di marcia（♩ = 96）',
    bar: 2,
    pickup: 0.5,
    load: () => import('./scores/maple').then(data),
  },
  {
    v: 'mountain-king',
    name: '山の魔王の宮殿にて',
    by: 'E. グリーグ（ペール・ギュント 第 1 組曲 作品 46 第 4 曲、作曲者によるピアノ独奏版）',
    bpm: 138,
    tempo: 'Alla marcia molto marcato（♩ = 138。Più vivo から ♩ = 154）',
    bar: 4,
    pickup: 0,
    load: () => import('./scores/mountain-king').then(data),
  },
  {
    v: 'bwv779',
    name: 'インヴェンション 第 8 番 ヘ長調 BWV 779',
    by: 'J. S. バッハ（2 声のインヴェンション）',
    bpm: 100,
    tempo: '♩ = 100',
    bar: 3,
    pickup: 0,
    load: () => import('./scores/bwv779').then(data),
  },
  {
    v: 'kv525',
    name: 'アイネ・クライネ・ナハトムジーク 第 1 楽章',
    by: 'W. A. モーツァルト（セレナード 第 13 番 ト長調 K. 525、弦楽四重奏の版）',
    bpm: 144,
    tempo: 'Allegro（♩ = 144）',
    bar: 4,
    pickup: 0,
    load: () => import('./scores/kv525').then(data),
  },
  {
    v: 'fur-elise',
    name: 'エリーゼのために',
    by: 'L. v. ベートーヴェン（WoO 59）',
    bpm: 72,
    tempo: 'Poco moto（♩ = 72）',
    bar: 1.5,
    pickup: 0.5,
    load: () => import('./scores/fur-elise').then(data),
  },
];
export const pieceOf = (v: string): Piece => PIECES.find((p) => p.v === v) ?? PIECES[0];
