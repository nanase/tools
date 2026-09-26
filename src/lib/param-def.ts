import type { Series } from './eseries';
import type { Unit } from './parse';

/** 一様な刻み。Shift・PgUp/PgDn で big ずつ。目盛りは minor（省略時 big）ごと、major ごとに大目盛り */
export interface Lin {
  step: number;
  big: number;
  major: number;
  minor?: number;
}

/** 表記の差し替え。省略した項目は notation に従う */
export interface ParamFormat {
  /** 入力欄に出す値（単位なし） */
  input?: (v: number) => string;
  /** ▲▼ の下に出す短い値（単位なし） */
  step?: (v: number) => string;
  /** メッセージ・読み上げ・範囲の表記（単位つき） */
  text?: (v: number) => string;
}

/**
 * 数値入力 1 項目の定義。.astro での描画とブラウザでの動作の両方で使う。
 *
 * 値の並び（スライダーと ▲▼ の行き先）は次のどれか 1 つ:
 * - lin: 一様な刻み
 * - list: 並びを直接与える（2 の累乗など）
 * - どちらもなければ E 系列。series を省略するとグループの E 系列の切替（SeriesSwitch）に従う
 */
export interface ParamDef {
  k: string;
  /** 読み上げ・ラベル用の短い名前（R1） */
  nm: string;
  /** 記号の HTML（<i>R</i><sub>1</sub>）。'' なら空欄 */
  sym: string;
  name: string;
  sub: string;
  unit: Unit;
  min: number;
  max: number;
  /** 初期値 */
  v: number;
  ph: string;
  /** プリセット [値, 表示]（小さい順）。空ならプリセットの列を出さない */
  pre: [number, string][];
  /** スライダーの目盛りラベル [値, 表示]。範囲外のものは出さない */
  tk: [number, string][];

  /* ---------- 値の並び ---------- */
  lin?: Lin;
  /** 並びを直接与える（小さい順）。min〜max の外の値は使わない。関数なら並びを作り直すたびに呼ぶ */
  list?: readonly number[] | (() => readonly number[]);
  /** list の近さ・スライダー位置を対数で見るか */
  log?: boolean;
  /** list で Shift・PgUp/PgDn のとき動く個数（省略時 1） */
  jump?: number;
  /** list にない値を、確定時に最も近い並びの値にする */
  snap?: boolean;
  /** E 系列を固定する（lin・list がなければ E 系列の行になる） */
  series?: Series;
  /** E 系列の行で min を 0 にするとき、0 の次に来る最小の値（並びは 0, floor 以上の E 系列） */
  floor?: number;
  /** E 系列の行で、並びの端に min・max がなければ足す（スライダーと ▲▼ で min・max まで届く） */
  ends?: boolean;

  /* ---------- 受け付ける値と表記 ---------- */
  /** 受け付ける値。pos: 正（既定）、nonneg: 0 以上、any: 負も可（入力の符号を読む） */
  sign?: 'pos' | 'nonneg' | 'any';
  /** 表記。si: SI 接頭辞つき（既定）、plain: 接頭辞なし */
  notation?: 'si' | 'plain';
  /** 入力欄の有効数字（si の E 系列・対数の並びは既定 4、一様な並びは 4、plain は 6） */
  sig?: number;
  format?: ParamFormat;
  /**
   * 確定する値の補正。[確定する値, 理由（「〜にしました」で終わる。空なら何も出さない）] を返す。
   * null・undefined なら既定（範囲への丸め、snap）に任せる
   */
  fix?: (v: number) => readonly [number, string] | null | undefined;
  /** 読めないときのメッセージ（既定は「読めない値です（例 4.7k・4k7・100n・1e3）」） */
  bad?: string;
  /** 入力欄の title のうち、範囲より後ろ（操作の説明）を差し替える */
  hint?: string;
  /** ▲▼ の読み上げ「R1 を{stepLabel}1 つ上の …」。既定は E 系列「E12 で」、一様「0.1 V」、list なし */
  stepLabel?: string;

  /* ---------- 描画 ---------- */
  /** スライダーを出すか（既定 true） */
  slider?: boolean;
  /** 入力欄の inputmode（既定 text） */
  inputmode?: 'text' | 'decimal';
}

/** ParamGroup.update で変えられる項目 */
export type ParamPatch = Partial<Omit<ParamDef, 'k' | 'pre' | 'slider' | 'inputmode'>>;
