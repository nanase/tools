/**
 * 演奏する曲（著作権の切れた曲の電子楽譜から変換したもの）の一覧（DOM に依存しない）。
 * 音符のデータは scores/ にあり、曲を選んだときに主スレッドが読み込んで（scores/load.ts）、計算用の Worker へ渡す。
 * 音の高さは実音。テンポと、強弱の記号のない曲の強弱は、このツールで決めた目安（よくある演奏から選んだ仮定）
 */
import type { ScoreNote } from './scores/types';

/** 曲のデータ */
export interface PieceData {
  voices: ScoreNote[][];
  /** 小節線の時刻 [拍]（曲の終わりは含まない。弱起があれば 0 を含み、弱起を 1 小節目と数える） */
  bars: number[];
}

export interface Piece {
  v: string;
  /** 音符のデータ（scores/ の名前。scores/load.ts が読み込む） */
  file: string;
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
  /** 調号（実音。♭ の数、負なら ♯） */
  flats: number;
  /** 強弱の予定 [拍, dB（mf = 0）]。楽譜の記号を使う曲では省く */
  plan?: readonly (readonly [number, number])[];
  /** 楽譜の強弱の記号と松葉を使う */
  marks?: boolean;
  /** 楽譜のライセンスと、Mutopia Project の番号（Mutopia の楽譜でなければ省く） */
  license: 'pd' | 'cc-by-3.0';
  mutopia?: number;
}

const MOHAMED = 'S. Mohamed';

export const PIECES: readonly Piece[] = [
  {
    v: 'rejouissance',
    file: 'hwv351',
    name: 'ラ・レジュイサンス 変ロ長調',
    by: 'G. F. ヘンデル（王宮の花火の音楽 HWV 351。C. Lecourt のトランペットとオルガンの編曲）',
    /* 楽譜の MIDI のテンポ */
    qpm: 100,
    tempo: '♩ = 100',
    meter: 4,
    phraseBars: 4,
    flats: 2,
    /* 楽譜に強弱の記号はない。祝典の曲なので f（仮定） */
    plan: [[0, 5]],
    license: 'pd',
    mutopia: 1864,
  },
  {
    v: 'minuet',
    file: 'bwv-anh114',
    name: 'メヌエット ト長調 BWV Anh. 114',
    by: `C. ペツォルト（伝 J. S. バッハ。${MOHAMED} の 2 本のトランペットの編曲の第 1 声部）`,
    /* 楽譜の Allegro と MIDI のテンポ */
    qpm: 132,
    tempo: '♩ = 132',
    meter: 3,
    phraseBars: 4,
    flats: -1,
    marks: true,
    license: 'pd',
    mutopia: 258,
  },
  {
    v: 'ave-maria',
    file: 'ave-maria',
    name: 'アヴェ・マリア ヘ長調（グノー）',
    by: `C. グノー（バッハの前奏曲 第 1 番による瞑想曲。${MOHAMED} のトランペットの編曲）`,
    /* 楽譜の MIDI は ♩ = 100 だが、歌のよくある演奏に合わせて遅くした */
    qpm: 60,
    tempo: '♩ = 60',
    meter: 4,
    phraseBars: 2,
    flats: 1,
    marks: true,
    license: 'pd',
    mutopia: 256,
  },
  {
    v: 'bist-du-bei-mir',
    file: 'bwv508',
    name: '御身がともにあるならば BWV 508',
    by: `G. H. シュテルツェル（伝 J. S. バッハ。${MOHAMED} のトランペットの編曲）`,
    /* 楽譜は Moderato、MIDI は ♩ = 108。歌のよくある演奏に合わせて遅くした */
    qpm: 72,
    tempo: '♩ = 72',
    meter: 3,
    phraseBars: 4,
    flats: 0,
    marks: true,
    license: 'pd',
    mutopia: 257,
  },
  {
    v: 'napolitaine',
    file: 'napolitaine',
    name: 'ナポリの踊り 変ホ長調（白鳥の湖）',
    by: 'P. I. チャイコフスキー（バレエ「白鳥の湖」作品 20。L. Sardain のトランペット・タンバリン・ピアノの編曲）',
    /* 楽譜の Comodo と MIDI のテンポ */
    qpm: 72,
    tempo: '♩ = 72',
    meter: 2,
    phraseBars: 4,
    flats: 3,
    marks: true,
    license: 'pd',
    mutopia: 896,
  },
  {
    v: 'trumpet-shall-sound',
    file: 'hwv56',
    name: 'ラッパは鳴り響き ニ長調（メサイア）',
    by: 'G. F. ヘンデル（オラトリオ「メサイア」HWV 56 のバスのアリアのトランペットの声部）',
    /*
     * 楽譜の Pomposo, ma non allegro と MIDI のテンポ。楽譜の Adagio（歌の終止）はトランペットが休む小節なので、
     * 終わりの前奏も同じテンポで弾く
     */
    qpm: 108,
    tempo: '♩ = 108',
    meter: 3,
    phraseBars: 4,
    flats: -2,
    /* トランペットの声部に強弱の記号はない。f（仮定） */
    plan: [[0, 5]],
    license: 'cc-by-3.0',
    mutopia: 1732,
  },
  {
    v: 'taps',
    file: 'taps',
    name: '消灯ラッパ（Taps）',
    by: '米軍のビューグルの号令',
    /* 元の楽譜のテンポ */
    qpm: 40,
    tempo: '♩ = 40',
    meter: 4,
    phraseBars: 2,
    flats: 2,
    /* 楽譜に強弱の記号はない。mf（仮定） */
    plan: [[0, 0]],
    license: 'pd',
  },
];

export const pieceOf = (v: string): Piece => PIECES.find((p) => p.v === v) ?? PIECES[0];
