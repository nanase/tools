/**
 * 機材の種類の定義（DOM に依存しない）: ペダル 12 種と、動かせない機材（ギター・アンプ・キャビネット）の
 * つまみ・選択肢・既定値。ペダルは 1 台 1 種類で、同じ種類を何台つないでもよい
 */
import type { Unit } from '../../lib/parse';

export type Kind =
  | 'comp'
  | 'wah'
  | 'od'
  | 'ds'
  | 'fuzz'
  | 'chorus'
  | 'phaser'
  | 'flanger'
  | 'trem'
  | 'dly'
  | 'spring'
  | 'room';
/** 動かせない機材 */
export type Fixed = 'pu' | 'amp' | 'cab';
export type Group = 'dyn' | 'flt' | 'drv' | 'mod' | 'amb';

/** つまみ: 設定の値 v（既定）と、行に出す値への倍率 scale（既定 10。0〜1 を 0〜10 で見せる） */
export interface KnobDef {
  k: string;
  name: string;
  sub: string;
  v: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: Unit;
  dig?: number;
  scale?: number;
}
/** 選択肢の行 */
export interface PickDef {
  k: string;
  name: string;
  sub: string;
  v: string;
  choices: readonly (readonly [string, string])[];
  layout?: 'seg' | 'chips';
}
export interface KindDef {
  name: string;
  /** 図の札 */
  short: string;
  g: Group;
  knobs: readonly KnobDef[];
  picks?: readonly PickDef[];
}

const LEVEL = { k: 'level', name: 'レベル', sub: '出口の大きさ', v: 0.5 } as const;
const drive = (name: string, sub: string, gain: number, level: number): KindDef => ({
  name,
  short: name,
  g: 'drv',
  knobs: [
    { k: 'gain', name: 'ゲイン', sub, v: gain },
    { k: 'tone', name: 'トーン', sub: '歪んだ後の高い音の量', v: 0.5 },
    { ...LEVEL, v: level },
  ],
});
const mod = (name: string, sub: string, rate: number, depth: number, mix = true): KindDef => ({
  name,
  short: name,
  g: 'mod',
  knobs: [
    { k: 'rate', name: 'レート', sub: '揺れの速さ · 0 で 0.08 Hz、10 で 4.8 Hz', v: rate },
    { k: 'depth', name: 'デプス', sub, v: depth },
    ...(mix ? [{ k: 'mix', name: 'ミックス', sub: '揺らした音を元の音に混ぜる量', v: 0.5 }] : []),
  ],
});
export const KINDS: Record<Kind, KindDef> = {
  comp: {
    name: 'コンプレッサー',
    short: 'コンプ',
    g: 'dyn',
    knobs: [
      { k: 'sus', name: 'サステイン', sub: '大きい音を抑えて小さい音を持ち上げる量 · 上げるほど音が長く続く', v: 0.5 },
      LEVEL,
    ],
  },
  wah: {
    name: 'ワウ',
    short: 'ワウ',
    g: 'flt',
    picks: [
      {
        k: 'mode',
        name: 'モード',
        sub: 'オートは弾く強さで山が動く · ペダルは踏む位置で決める',
        v: 'auto',
        choices: [
          ['auto', 'オート'],
          ['manual', 'ペダル'],
        ],
      },
    ],
    knobs: [
      { k: 'pedal', name: 'ペダル', sub: '山の周波数 · 0 で 380 Hz、10 で 2.3 kHz', v: 0.5 },
      { k: 'sens', name: 'センス', sub: 'オートで、弾く強さに対する山の動きの大きさ', v: 0.6 },
    ],
  },
  od: drive('オーバードライブ', '高い音を増幅して頭を丸め、元の音に足す', 0.5, 0.5),
  ds: drive('ディストーション', '大きく増幅して平らに切る', 0.6, 0.4),
  fuzz: drive('ファズ', '上下がそろわない形に歪ませる', 0.75, 0.2),
  chorus: mod('コーラス', '遅れの揺れの幅', 0.35, 0.45),
  phaser: mod('フェイザー', '谷の動く幅', 0.2, 0.6),
  flanger: mod('フランジャー', '遅れの揺れの幅', 0.25, 0.6),
  trem: mod('トレモロ', '大きさの揺れの幅', 0.6, 0.5, false),
  dly: {
    name: 'ディレイ',
    short: 'ディレイ',
    g: 'amb',
    knobs: [
      {
        k: 'time',
        name: 'タイム',
        sub: 'くり返す間隔',
        v: 0.38,
        min: 50,
        max: 1000,
        step: 10,
        unit: 'ms',
        dig: 0,
        scale: 1000,
      },
      { k: 'fb', name: 'リピート', sub: 'くり返す音を戻す量 · 上げるほど長く残る', v: 0.35, max: 9 },
      { k: 'mix', name: 'ミックス', sub: 'くり返す音の大きさ', v: 0.3 },
    ],
  },
  spring: {
    name: 'スプリングリバーブ',
    short: 'スプリング',
    g: 'amb',
    knobs: [
      { k: 'decay', name: 'ディケイ', sub: '残響の長さ', v: 0.5 },
      { k: 'mix', name: 'ミックス', sub: '残響の大きさ', v: 0.25 },
    ],
  },
  room: {
    name: 'ルームリバーブ',
    short: 'ルーム',
    g: 'amb',
    knobs: [
      { k: 'decay', name: 'ディケイ', sub: '残響の長さ', v: 0.5 },
      { k: 'mix', name: 'ミックス', sub: '残響の大きさ', v: 0.25 },
    ],
  },
};
export const KIND_LIST = Object.keys(KINDS) as Kind[];
export const GROUPS: readonly (readonly [Group, string])[] = [
  ['dyn', 'ダイナミクス'],
  ['flt', 'フィルタ'],
  ['drv', '歪み'],
  ['mod', 'モジュレーション'],
  ['amb', '空間系'],
];

/** 動かせない機材 */
export const FIXED: Record<Fixed, KindDef> = {
  pu: {
    name: 'ギター',
    short: 'ギター',
    g: 'dyn',
    picks: [
      {
        k: 'coil',
        name: 'ピックアップ',
        sub: 'シングルコイルは細く明るい音、ハムバッカーは 2 つのコイルで太い音',
        v: 'single',
        choices: [
          ['single', 'シングルコイル'],
          ['hum', 'ハムバッカー'],
        ],
      },
      {
        k: 'sel',
        name: 'セレクター',
        sub: '鳴らすピックアップ · 2 つ選ぶと足し合わせる',
        v: 'bridge',
        choices: [
          ['neck', 'ネック'],
          ['nm', 'ネック＋センター'],
          ['mid', 'センター'],
          ['bridge', 'ブリッジ'],
          ['nb', 'ネック＋ブリッジ'],
        ],
        layout: 'chips',
      },
    ],
    knobs: [
      { k: 'vol', name: 'ボリューム', sub: 'ギターのボリューム · 下げると小さく、少しこもる', v: 1 },
      { k: 'tone', name: 'トーン', sub: 'コンデンサで高い音を逃がす量 · 下げるほど丸い音', v: 1 },
      {
        k: 'cable',
        name: 'ケーブル',
        sub: 'ギターからアンプまでの長さ · 長いほど容量が増え、共振が下がる',
        v: 3,
        min: 1,
        max: 10,
        step: 1,
        unit: 'm',
        dig: 0,
        scale: 1,
      },
    ],
  },
  amp: {
    name: 'アンプ',
    short: 'アンプ',
    g: 'dyn',
    picks: [
      {
        k: 'type',
        name: '種類',
        sub: '増幅の段の数とゲインの範囲',
        v: 'clean',
        choices: [
          ['clean', 'クリーン'],
          ['crunch', 'クランチ'],
          ['high', 'ハイゲイン'],
        ],
      },
    ],
    knobs: [
      { k: 'gain', name: 'ゲイン', sub: '増幅の段に入れる大きさ · 上げるほど歪む', v: 0.35 },
      { k: 'bass', name: 'ベース', sub: 'トーンの回路の低い音', v: 0.5 },
      { k: 'mid', name: 'ミドル', sub: 'トーンの回路の中ほどの音 · 下げると谷が深くなる', v: 0.5 },
      { k: 'treble', name: 'トレブル', sub: 'トーンの回路の高い音', v: 0.6 },
      { k: 'master', name: 'マスター', sub: '出力段に入れる大きさ · 上げると出力段も歪む', v: 0.5 },
    ],
  },
  cab: {
    name: 'キャビネット',
    short: 'キャビ',
    g: 'dyn',
    picks: [
      {
        k: 'type',
        name: 'スピーカー',
        sub: 'なしはアンプの出力をそのまま聴く',
        v: '1x12',
        choices: [
          ['off', 'なし'],
          ['1x12', '1×12 オープンバック'],
          ['4x12', '4×12 クローズドバック'],
        ],
      },
      {
        k: 'mic',
        name: 'マイク',
        sub: 'センターは高い音が多く、エッジは少ない',
        v: 'center',
        choices: [
          ['center', 'センター'],
          ['edge', 'エッジ'],
        ],
      },
    ],
    knobs: [
      {
        k: 'level',
        name: 'レベル',
        sub: 'マイクの音量 · 音色のプリセットは、どれも同じくらいの大きさになる値',
        v: 0.5,
      },
      {
        k: 'fb',
        name: 'フィードバック',
        sub: 'スピーカーの音が弦を揺らす強さ · 歪んだ大きな音で、弦が鳴り続ける',
        v: 0,
      },
    ],
  },
};

/** 種類の既定の設定 */
export function defaults(d: KindDef): Record<string, number | string> {
  const o: Record<string, number | string> = {};
  for (const k of d.knobs) o[k.k] = k.v;
  for (const p of d.picks ?? []) o[p.k] = p.v;
  return o;
}
