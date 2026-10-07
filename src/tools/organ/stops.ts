/**
 * ストップのスケーリングと整音の初期値（DOM に依存しない）。鍵盤の音（MIDI の番号。8' の音の高さで数える）から、
 * 管 1 本ずつの設定（pipes.ts の FlueSpec・ReedSpec）と目標の周波数を作る。
 * 値の出典は各定数の注記に書く。文献から決められなかった値は「概数」、文献の範囲から選んだ推測は「推測」とする
 */
import { AIR, END_CORR, type FlueSpec, MOUTH, type ReedSpec } from './pipes';

/** 鍵盤（風箱）: 第 1 手鍵盤（主鍵盤）・第 2 手鍵盤・ペダル */
export type Div = 'I' | 'II' | 'P';
/** 鍵盤の名前と範囲（MIDI の番号。8' の高さ）と、風箱の圧力の第 1 手鍵盤に対する比 */
export const DIVS = [
  { v: 'I', name: '第 1 手鍵盤', short: 'I', lo: 36, hi: 96, chest: 'I', windK: 1 },
  { v: 'II', name: '第 2 手鍵盤', short: 'II', lo: 36, hi: 96, chest: 'II', windK: 0.9 },
  { v: 'P', name: 'ペダル', short: 'P', lo: 36, hi: 67, chest: 'P', windK: 1.15 },
] as const;
export const divOf = (v: Div) => DIVS.find((d) => d.v === v) ?? DIVS[0];

/**
 * 第 1 手鍵盤の風箱の圧力の初期値 [Pa]（約 82 mm 水柱）。手鍵盤 700〜800 Pa・ペダル 800〜1000 Pa の範囲と、
 * リードの boot 圧 800〜1000 Pa（Ritchie・Plitnik 1996 の約 1 kPa）から選んだ推測。Audsley (1905) の大オルガンの
 * 提案例はフルー 3〜4 in（約 750〜1000 Pa）、リード 4〜6 in（約 1.0〜1.5 kPa）。
 * 第 2 手鍵盤は 0.9 倍、ペダルは 1.15 倍とする（推測）
 */
export const WIND0 = 800;

/** 鍵盤の音の 8' の高さの周波数 [Hz]（平均律、A4 = 440 Hz） */
export const f8 = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

/** 8' の C（C2 = 65.406 Hz） */
const F_C2 = f8(36);

/**
 * Töpfer の標準スケール（Normalmensur）の内径 [m]: 8' C（65.4 Hz の開管）で 155.5 mm、16 半音（長 10 度）ごとに半分。
 * f は開管としての音の高さ [Hz]、dev は標準からの偏差 [半音]（正が太い）。Fletcher (1977) "Scaling rules for organ
 * flue pipe ranks"（Acustica 37(3), 131–138）と Wikipedia "Organ flue pipe scaling"（Adelung 1991 による）。
 * 実際の楽器は 15〜18 半音ごとに半分（Fletcher 1998）
 */
export function topfer(f: number, dev = 0): number {
  const n = 12 * Math.log2(f / F_C2);
  return 0.1555 * 2 ** ((dev - n) / 16);
}

/**
 * ジェットの無次元の速さ θ = U_j / (f W) の下限（Terrien・Vergez・Fabre (arXiv:1207.7136) の式 (8) の主レジーム
 * θ > 4 と、Castellengo 1999 の実測 θ ≈ 8〜13 から推測）。上限はストップごと（FlueStop.theta）。
 * 足の圧力 P_foot = min(P_chest, ρ(θ_max f W)²/2) で抑える（推測）。
 * 目安: Ising の数 I = √(2 P h / (ρ W³)) / f = θ √(h/W) は、プリンシパル（θ 10、h/W = 0.08）で 2.8、
 * フルート（θ 8、h/W = 0.05）で 1.8 になり、I ≈ 2 が最も効率がよく 2〜3 がプリンシパル寄り、3 を超えると過吹
 * という整音の目安（Ising 1971 を引く Liljencrants の解説、二次資料）に入る
 */
export const THETA_MIN = 8;
/**
 * 足の圧力の時定数 [s]（Nolle・Finch 1992（JASA 91(4), 2190–2202）の立ち上げ 2〜20 ms の範囲で、管が太いほど
 * 遅くする。概数）
 */
const tFootOf = (d: number) => Math.min(0.02, 0.002 + (0.014 * d) / 0.1555);
/** 弁が開き切るまでの時間 [s]（概数） */
const T_PALLET = 0.004;

/** フルー管のストップ */
export interface FlueStop {
  kind: 'flue';
  id: string;
  name: string;
  div: Div;
  /** 説明（ボタンの title） */
  note: string;
  /** 列ごとの、鍵盤の 8' の音に対する周波数の比（鍵盤の音の関数。ミクスチュアは折り返す） */
  ranks: (midi: number) => number[];
  stopped: boolean;
  /**
   * Töpfer の標準スケールからの偏差 [半音]（正が太い）。閉管は、同じ長さの開管の音の高さ（鳴る音の 1 オクターブ上）で
   * 数える
   */
  scale: number;
  /** 口の幅 ÷ 円周 α、カットアップ ÷ 口の幅 β、ジェットの厚さ ÷ 口の幅 γ、唇のずれ ÷ ジェットの厚さ */
  alpha: number;
  beta: number;
  gamma: number;
  y0: number;
  /** 乱流の雑音（ジェットの変位の実効値 ÷ b） */
  noise: number;
  /** θ の上限（足の穴で足の圧力を下げて抑える） */
  theta: number;
  /** この鍵より下には管がない（高音だけのストップ） */
  from?: number;
  /** 列ごとに閉管か（省くと stopped。コルネットの 8' だけ閉管など） */
  stoppedRanks?: readonly boolean[];
  /** 目標の高さからのずれ [セント]（鍵盤の音の関数。セレストは少し高く調律して、対の列とうなりを作る） */
  cents?: (midi: number) => number;
  /** この範囲 [最低, 最高] の鍵は、倍の長さの開管を第 2 モードで鳴らす（ハーモニック・フルート） */
  harmonic?: readonly [number, number];
}

/** リード管のストップ */
export interface ReedStop {
  kind: 'reed';
  id: string;
  name: string;
  div: Div;
  /** 説明（ボタンの title） */
  note: string;
  /** 鍵盤の 8' の音に対する周波数の比（16' は 0.5） */
  ratio: number;
  bore: 'cone' | 'cyl';
  /** 寸法の表の最初の点の音の高さ（8' C = 65.4 Hz から数えた半音）。表は 1 オクターブ（C）ごと */
  n0: number;
  /** 共鳴管の先端の内径・リード側の内径・長さ [m]、舌の厚さ [m]（表の外は端の 2 点の傾きで延ばす） */
  d1: readonly number[];
  d0: readonly number[];
  L: readonly number[];
  e: readonly number[];
  /** 舌の幅の倍率（表の値に掛ける） */
  wK: number;
  /**
   * この鍵より上は、リード管の代わりにプリンシパルの唇管を置く（高い音のリード管は弱く不安定で、実際のオルガンでも
   * 最高音域を唇管で代えることがある）
   */
  top: number;
  /**
   * 流れの幅に足す、舌の両脇の隙間の分 ÷ 舌の長さ。曲げた舌は先だけでなく両脇もシャロットの開口から浮く。
   * 浮きが根元から先へ 2 乗で増え、開口が舌の先の 0.6 の長さにあるとすると、両脇の分は 2 × 0.312 ≈ 0.62 × 舌の長さ
   * の幅に当たる（推定）。開口の小さいシャロット（クルムホルン）は 0 とする（推測）
   */
  side: number;
}

/**
 * ミクスチュア III（1 1/3'）の列。C ごとに 1 オクターブずつ下がって折り返す（典型的なドイツのミクスチュアの形。概数）。
 * 比は 8' に対する周波数の比: 6 = 1 1/3'、8 = 1'、12 = 2/3'、4 = 2'、3 = 2 2/3'、2 = 4'
 */
function mixtureRanks(midi: number): number[] {
  if (midi < 48) return [6, 8, 12];
  if (midi < 60) return [4, 6, 8];
  if (midi < 72) return [3, 4, 6];
  return [2, 3, 4];
}

/**
 * プリンシパルの整音: 口の幅は円周の 1/4、カットアップは口の幅の 1/4（Fletcher 1977 のディアパソン）。
 * ジェットの厚さは口の幅の 0.02（実測 0.006〜0.025 の範囲から選んだ推測）、唇のずれはジェットの厚さの 0.3
 * （0.1〜0.3 h の上端。Fletcher 1998。ずらすほど偶数倍音が強くなり、立ち上がりが遅くなる。0.6 h を超えると
 * 低い管が鳴らなくなった）、乱流の雑音は概数（0.1 だと 8' C の音程が窓ごとに ±3 セント揺れた）。
 * θ の上限は 10（τ/T = 1/4）
 */
const PRINCIPAL = { alpha: 0.25, beta: 0.25, gamma: 0.02, y0: 0.3, noise: 0.05, stopped: false, theta: 10 } as const;
/**
 * 太いフルート（閉管）の整音: 口の幅は円周の 0.2、カットアップは口の幅の 0.4（Fletcher 1977）。
 * θ の上限は 8: τ/T = 2.5/θ が 1/4 だと第 5 モードも位相がそろって 16' の C で第 5 モードで鳴ったので、
 * τ/T ≈ 0.31 にして第 3・第 5 モードの位相をずらす（試作で決めた推測）
 */
const FLUTE = { alpha: 0.2, beta: 0.4, gamma: 0.02, y0: 0.2, noise: 0.05, stopped: true, theta: 8 } as const;
/** 開いたフルート（4'・2 2/3'）の整音: 口とカットアップは太いフルートと同じ、開管（推測） */
const OPEN_FLUTE = { ...FLUTE, stopped: false } as const;
/**
 * 弦（サリツィオナール・セレスト）の整音: 口の幅は円周の 1/4、カットアップは口の幅の 0.3（Fletcher 1977 の、静かな弦の
 * 音のストップの比）。管は標準より 10 半音細くし（推測）、θ の上限は 13 にする（10 ではプリンシパルより 12 dB 小さく、
 * 13 で 10 dB 小さい。低いカットアップ 0.2 では 14 を超えると低音が第 2 モードの倍音へ寄り、18 で 1 オクターブ上へ跳んだ）。
 * 実際のガンバの鋭い音（多くの高い倍音）は、ひげ（Bart）などの働きによるもので、この模型では出ないので、
 * 柔らかい弦のストップ（サリツィオナール）にとどめる
 */
const STRING = { alpha: 0.25, beta: 0.3, gamma: 0.02, y0: 0.2, noise: 0.05, stopped: false, theta: 13 } as const;

export type Stop = FlueStop | ReedStop;

export const STOPS: readonly Stop[] = [
  /*
   * 2 段の手鍵盤とペダルの折衷型（ドイツのバロックの合唱に、フランスのロマン派の色を足したもの）。並びと名前は、
   * Mühleisen のテュービンゲンのオルガン（2004、II/P 25 ストップ）とモンタバウアーのオルガン（2014、III/P 40 ストップ）の
   * 仕様を参考にした。第 1 手鍵盤（Hauptwerk）・第 2 手鍵盤（Schwellwerk、箱に入る）・ペダルの順に、高さの順に並べる
   */
  /* 手鍵盤の 16' の閉管（ゲダクトより 2 半音細い。推測） */
  {
    kind: 'flue',
    id: 'bd16',
    name: "Bourdon 16'",
    div: 'I',
    note: '蓋で閉じた管の 16 フィート。鍵盤の音の 1 オクターブ下で、和音に重さを足す',
    ranks: () => [0.5],
    scale: 4,
    ...FLUTE,
  },
  {
    kind: 'flue',
    id: 'p8',
    name: "Prinzipal 8'",
    div: 'I',
    note: '開いた金属管の基本のストップ。8 フィートは鍵盤の音の高さで鳴る',
    ranks: () => [1],
    scale: 0,
    ...PRINCIPAL,
  },
  /* 開いた太いフルート（フルートの 4' と同じ整音の 8'） */
  {
    kind: 'flue',
    id: 'hf8',
    name: "Hohlflöte 8'",
    div: 'I',
    note: '太い開いた管の 8 フィート。高い倍音の少ない、丸く大きなフルートの音',
    ranks: () => [1],
    scale: 6,
    ...OPEN_FLUTE,
  },
  {
    kind: 'flue',
    id: 'p4',
    name: "Oktave 4'",
    div: 'I',
    note: 'プリンシパルの 1 オクターブ上',
    ranks: () => [2],
    scale: 0,
    ...PRINCIPAL,
  },
  {
    kind: 'flue',
    id: 'wf4',
    name: "Waldflöte 4'",
    div: 'I',
    note: '開いたフルートの 4 フィート。第 1 手鍵盤のフルートの合唱に',
    ranks: () => [2],
    scale: 4,
    ...OPEN_FLUTE,
  },
  /* 合唱のクイントはプリンシパルより 1 半音細い（推測） */
  {
    kind: 'flue',
    id: 'q3',
    name: "Quinte 2 2/3'",
    div: 'I',
    note: 'プリンシパルの第 3 倍音（1 オクターブと 5 度上）。プレヌムの輪郭を足す',
    ranks: () => [3],
    scale: -1,
    ...PRINCIPAL,
  },
  {
    kind: 'flue',
    id: 'p2',
    name: "Superoktave 2'",
    div: 'I',
    note: 'プリンシパルの 2 オクターブ上',
    ranks: () => [4],
    scale: 0,
    ...PRINCIPAL,
  },
  /* ミクスチュアは標準より 2 半音細い（プリンシパルの −2〜+1 半音の範囲。推測） */
  {
    kind: 'flue',
    id: 'mix',
    name: 'Mixtur III',
    div: 'I',
    note: '高い倍音の高さの細い管 3 列。C ごとに 1 オクターブ下へ折り返す',
    ranks: mixtureRanks,
    scale: -2,
    ...PRINCIPAL,
  },
  /*
   * コルネット: 8'（閉管）・4'・2 2/3'・2'・1 3/5' の 5 列の太いフルートで、c' から上だけにある（フランスの古典のオルガンの
   * Cornet V と同じ）。C6 から上は、高すぎて鳴らない 1 3/5' を 1 オクターブ下げ、2' を除く
   */
  {
    kind: 'flue',
    id: 'cor',
    name: 'Cornet V',
    div: 'I',
    note: "c' から上の 5 列（8'・4'・2 2/3'・2'・1 3/5'）。倍音を重ねた独奏用の音",
    ranks: (midi) => (midi < 84 ? [1, 2, 3, 4, 5] : [1, 2, 3, 2.5]),
    scale: 4,
    ...OPEN_FLUTE,
    from: 60,
    stoppedRanks: [true],
  },
  /*
   * トランペットとポザウネの共鳴管と舌の厚さは Pasi Organs の公開資料 "Reed Pipes"（pasiorgans.com/pdfs/reeds.pdf、
   * Hauptwerk の Trumpet 8'（German shallots）と Pedal の Posaune 16'。楽器名と単位の記載がなく、値から mm と推定）
   */
  {
    kind: 'reed',
    id: 'tr8',
    name: "Trompete 8'",
    div: 'I',
    note: '円錐の共鳴管のリード管。全部の倍音が強い、輝かしい音',
    top: 93,
    ratio: 1,
    bore: 'cone',
    n0: 0,
    d1: [0.12, 0.093, 0.07, 0.058, 0.048, 0.04],
    d0: [0.021, 0.0155, 0.011, 0.008, 0.007, 0.007],
    L: [2.15, 1.05, 0.54, 0.26, 0.12, 0.043],
    e: [0.5e-3, 0.35e-3, 0.25e-3, 0.14e-3, 0.1e-3],
    wK: 1,
    side: 0.62,
  },
  /* 弦に近いプリンシパル（標準より 3 半音細い。推測） */
  {
    kind: 'flue',
    id: 'gp8',
    name: "Geigenprincipal 8'",
    div: 'II',
    note: '細めのプリンシパル。第 2 手鍵盤の合唱の土台で、やや弦の音に近い',
    ranks: () => [1],
    scale: -3,
    ...PRINCIPAL,
  },
  /* フルートは +4〜+9 半音（Wikipedia "Organ flue pipe scaling" の範囲から +6 を選んだ推測） */
  {
    kind: 'flue',
    id: 'g8',
    name: "Gedackt 8'",
    div: 'II',
    note: '上を蓋で閉じた太い管。管の長さの 4 倍の波長で鳴り、奇数次の倍音が中心の柔らかい音',
    ranks: () => [1],
    scale: 6,
    ...FLUTE,
  },
  {
    kind: 'flue',
    id: 'sal8',
    name: "Salicional 8'",
    div: 'II',
    note: '細い管の、柔らかい弦の音のストップ。ゆっくり立ち上がる',
    ranks: () => [1],
    scale: -10,
    ...STRING,
  },
  /*
   * ヴォア・セレスト: サリツィオナールと同じ管を少し高く調律し、対で鳴らしてうなりを作る（c から上）。ずれは C で 19 セント、
   * 5 オクターブ上で 4 セントへ直線で減らし、うなりの速さを 1〜5 Hz にそろえる（調律師の例。Hauptwerk のフォーラム）
   */
  {
    kind: 'flue',
    id: 'vc8',
    name: "Voix céleste 8'",
    div: 'II',
    note: 'サリツィオナールを少し高く調律した列。いっしょに入れると、ゆっくりうねる音になる',
    ranks: () => [1],
    scale: -10,
    ...STRING,
    from: 48,
    cents: (midi) => 19 - (15 * (midi - 36)) / 60,
  },
  /*
   * ハーモニック・フルート: c' から b'' は倍の長さの開管を第 2 モードで鳴らす（Cavaillé-Coll の Flûte harmonique。実際の管は
   * 中ほどの小さな穴で第 1 モードを抑えるが、模型には穴がなく、ジェットの走行時間を鳴らす高さに合わせて第 2 モードを選ぶ）。
   * それより上では第 1 モードへ落ちたので、低音と同じく普通の開管にする。口とカットアップはプリンシパルと同じ（太くすると
   * 第 2 モードが保てなかった）で、唇のずれを小さくして偶数次の倍音を弱め、フルートらしくする（推測）
   */
  {
    kind: 'flue',
    id: 'fh8',
    name: "Flûte harmonique 8'",
    div: 'II',
    note: "c' から b'' は倍の長さの管を 1 オクターブ上（第 2 モード）で鳴らす。基音の強い、澄んで力のあるフルート",
    ranks: () => [1],
    scale: 1,
    ...PRINCIPAL,
    y0: 0.1,
    harmonic: [60, 83],
  },
  {
    kind: 'flue',
    id: 'f4',
    name: "Flöte 4'",
    div: 'II',
    note: '太い開いた管の 1 オクターブ上。高い倍音の少ない澄んだ音',
    ranks: () => [2],
    scale: 6,
    ...OPEN_FLUTE,
  },
  {
    kind: 'flue',
    id: 'n3',
    name: "Nasat 2 2/3'",
    div: 'II',
    note: '鍵盤の音の 1 オクターブと 5 度上（第 3 倍音）で鳴るフルート。ほかのストップと重ねて音色を作る',
    ranks: () => [3],
    scale: 4,
    ...OPEN_FLUTE,
  },
  {
    kind: 'flue',
    id: 'fl2',
    name: "Flageolett 2'",
    div: 'II',
    note: '開いたフルートの 2 フィート。明るい高い音を足す',
    ranks: () => [4],
    scale: 2,
    ...OPEN_FLUTE,
  },
  /* テルツは C6 から上を 1 オクターブ下げる（高すぎる管は鳴らなかった） */
  {
    kind: 'flue',
    id: 't135',
    name: "Terz 1 3/5'",
    div: 'II',
    note: '第 5 倍音（2 オクターブと長 3 度上）のフルート。ナザルトと重ねてコルネットの色を作る',
    ranks: (midi) => (midi < 84 ? [5] : [2.5]),
    scale: 4,
    ...OPEN_FLUTE,
  },
  /*
   * オーボエ: トランペットより細い円錐の共鳴管と細い舌（推測。実際の管の先のベル（漏斗）と蓋は模型にない）
   */
  {
    kind: 'reed',
    id: 'hb8',
    name: "Oboe 8'",
    div: 'II',
    note: '細い円錐の共鳴管のリード管。鼻にかかった、柔らかいオーボエの音',
    top: 88,
    ratio: 1,
    bore: 'cone',
    n0: 0,
    d1: [0.065, 0.05, 0.038, 0.03, 0.024, 0.02],
    d0: [0.012, 0.009, 0.0075, 0.0065, 0.006, 0.006],
    L: [2.05, 1.02, 0.5, 0.25, 0.12, 0.06],
    e: [0.35e-3, 0.25e-3, 0.18e-3, 0.12e-3, 0.09e-3],
    wK: 0.7,
    side: 0.62,
  },
  /*
   * クルムホルンは、Audsley (1905) の Clarinet 8'（円筒、約半分の長さ）の内径と長さで代える（CC〜c3）。
   * 舌の厚さはトランペットと同じとした（概数）
   */
  {
    kind: 'reed',
    id: 'kr8',
    name: "Krummhorn 8'",
    div: 'II',
    note: '細い円筒の共鳴管のリード管。奇数次の倍音が強い、鼻にかかった音',
    top: 88,
    ratio: 1,
    bore: 'cyl',
    n0: 0,
    d1: [0.0445, 0.0318, 0.0286, 0.0238, 0.0206],
    d0: [0.0445, 0.0318, 0.0286, 0.0238, 0.0206],
    L: [1.31, 0.648, 0.337, 0.168, 0.09],
    e: [0.5e-3, 0.35e-3, 0.25e-3, 0.14e-3, 0.1e-3],
    wK: 0.8,
    side: 0,
  },
  /* ペダルの開いたプリンシパルの 16'（標準より 2 半音太い。推測） */
  {
    kind: 'flue',
    id: 'pb16',
    name: "Principalbass 16'",
    div: 'P',
    note: 'ペダルの開いたプリンシパルの 16 フィート。サブバスより輪郭のはっきりした低音',
    ranks: () => [0.5],
    scale: 2,
    ...PRINCIPAL,
  },
  /* 木管のサブバスは円の等価な内径で表す（+8 半音で C1 は 220 mm。概数） */
  {
    kind: 'flue',
    id: 'sb16',
    name: "Subbass 16'",
    div: 'P',
    note: '蓋で閉じた太い木管。鍵盤の音の 1 オクターブ下の柔らかい低音',
    ranks: () => [0.5],
    scale: 8,
    ...FLUTE,
    alpha: 0.25,
  },
  /* ペダルのプリンシパルは標準より 2 半音太い（推測） */
  {
    kind: 'flue',
    id: 'ob8',
    name: "Oktavbass 8'",
    div: 'P',
    note: 'ペダルのプリンシパル。鍵盤の音の高さで低音の輪郭を出す',
    ranks: () => [1],
    scale: 2,
    ...PRINCIPAL,
  },
  {
    kind: 'flue',
    id: 'gb8',
    name: "Gedecktbass 8'",
    div: 'P',
    note: 'ペダルの蓋で閉じた 8 フィート。柔らかい低音',
    ranks: () => [1],
    scale: 6,
    ...FLUTE,
  },
  {
    kind: 'flue',
    id: 'cb4',
    name: "Choralbass 4'",
    div: 'P',
    note: 'ペダルのプリンシパルの 4 フィート。ペダルでコラールの旋律を弾くときに',
    ranks: () => [2],
    scale: 0,
    ...PRINCIPAL,
  },
  {
    kind: 'reed',
    id: 'po16',
    name: "Posaune 16'",
    div: 'P',
    note: 'ペダルの円錐の共鳴管のリード管。鍵盤の音の 1 オクターブ下の力強い低音',
    top: 127,
    ratio: 0.5,
    bore: 'cone',
    n0: -12,
    d1: [0.22, 0.146, 0.11, 0.08],
    d0: [0.033, 0.022, 0.018, 0.014],
    L: [4.48, 2.23, 1.065, 0.52],
    e: [1.05e-3, 0.63e-3, 0.46e-3],
    wK: 1,
    side: 0.62,
  },
  {
    kind: 'reed',
    id: 'ptr8',
    name: "Trompete 8'",
    div: 'P',
    note: 'ペダルのトランペット。第 1 手鍵盤のトランペットと同じ寸法の管で、低音に輝きを足す',
    top: 93,
    ratio: 1,
    bore: 'cone',
    n0: 0,
    d1: [0.12, 0.093, 0.07, 0.058, 0.048, 0.04],
    d0: [0.021, 0.0155, 0.011, 0.008, 0.007, 0.007],
    L: [2.15, 1.05, 0.54, 0.26, 0.12, 0.043],
    e: [0.5e-3, 0.35e-3, 0.25e-3, 0.14e-3, 0.1e-3],
    wK: 1,
    side: 0.62,
  },
];

export const stopOf = (id: string): Stop => STOPS.find((x) => x.id === id) ?? STOPS[0];
export const stopName = (id: string): string => stopOf(id).name;

/** 管 1 本の設定と目標の周波数 */
export type PipeDef = { kind: 'flue'; spec: FlueSpec; f: number } | { kind: 'reed'; spec: ReedSpec; f: number };

/**
 * 半音 n での値。v は n0 から 1 オクターブごとの値で、対数で区分的に線形に補間する（外は端の 2 点の傾きで延ばす）
 */
function octave(n: number, n0: number, v: readonly number[]): number {
  const t = (n - n0) / 12,
    k = Math.max(0, Math.min(v.length - 2, Math.floor(t))),
    a = Math.log(v[k]),
    b = Math.log(v[k + 1]);
  return Math.exp(a + (b - a) * (t - k));
}

/**
 * リード管の整音の値（推測。調査のまとめの推奨値）: 舌の固有振動数は鳴る音の 1.02 倍から始めて調律で直す。
 * Q は 50〜200 の範囲から 100、閉じる圧力 p_c = μ ω_r² y0 は足の圧力の 1.5 倍（1.2〜2 倍）。
 * 先の開き y0 の上限は C2 で 0.6 mm・C4 で 0.35 mm・C6 で 0.15 mm、舌の幅は C2 で 14 mm・C4 で 9 mm・C6 で 5 mm。
 * 共鳴管の長さは、第 1 共鳴が鳴る音の 1.045 倍（1.03〜1.06 倍）になるように決める（内径は資料の値）。
 * 鳴る音は舌の共振と管の共鳴の両方の少し下になる（Fletcher 1979）。資料の長さ（ReedStop.L）は比べるために残す
 */
export const REED = { frK: 1.02, Q: 100, pcK: 1.5, resK: 1.045 } as const;
/**
 * 真鍮の舌の単位面積あたりの等価質量 ÷ 厚さ [kg/m³]: 片持ち梁の第 1 モードの先端の等価質量（全質量の 1/4。
 * Tarnopolsky・Fletcher・Lai 2000 の式 (A3)）を、一様な圧力に対する等価な面積（全面積の約 0.39。モードの形の
 * 平均からの推定）で割ったもの × 真鍮の密度 8500 kg/m³
 */
const MU_BRASS = (0.25 / 0.39) * 8500;
/**
 * 舌の長さ [m]（C2 で 75 mm、2 オクターブで半分。動きで押しのける面積 S_r = 0.4 × 幅 × 長さと両脇の隙間に使う。
 * 概数。Audsley 1905 の Orchestral Horn の tenor C の舌 55.6 mm に、C3 の 53 mm が近い）
 */
const tongueLen = (n: number) => 0.075 * 2 ** (-n / 24);

/**
 * 第 1 共鳴が fRes [Hz] になる共鳴管の長さ [m]。円筒はリード側を閉じた閉管 c / 4(L + 0.6133 a1)、円錐は頂点まで
 * 延ばした長さ Λ = L + x0（x0 = L d0 / (d1 − d0)）の開管 c / 2(Λ + 0.6133 a1)
 */
export function resLength(bore: 'cone' | 'cyl', fRes: number, d0: number, d1: number): number {
  const e = END_CORR * (d1 / 2);
  if (bore === 'cyl') return AIR.c / (4 * fRes) - e;
  return ((AIR.c / (2 * fRes) - e) * (d1 - d0)) / d1;
}

/** 資料の長さの共鳴管の第 1 共鳴 ÷ 鳴る音（比べるため） */
export function dataResRatio(s: ReedStop, midi: number): number {
  /* 資料の寸法は平均律の高さで比べる */
  const f = f8(midi) * s.ratio,
    n = 12 * Math.log2(f / F_C2),
    d0 = octave(n, s.n0, s.d0),
    d1 = octave(n, s.n0, s.d1),
    L = octave(n, s.n0, s.L),
    e = END_CORR * (d1 / 2);
  return (s.bore === 'cyl' ? AIR.c / (4 * (L + e)) : AIR.c / (2 * ((L * d1) / (d1 - d0) + e))) / f;
}

/** 管を作る条件 */
export interface PipeOpt {
  /** 第 1 手鍵盤の風箱の圧力 [Pa]（ほかの鍵盤は DIVS の比を掛ける） */
  wind: number;
  /** 鍵盤の音の目標の周波数 [Hz]（8' の高さ。調律法と A4 で決まる） */
  hz: (midi: number) => number;
  /** 整音の上書き: スケールの偏差 [半音]・カットアップ ÷ 口の幅 */
  scale?: number;
  cut?: number;
  /** リードの整音の値の差し替え（検証用） */
  reed?: Partial<{ frK: number; Q: number; pcK: number; resK: number }>;
}

/** 調律法と A4 を変えない既定の条件 */
export const OPT0: PipeOpt = { wind: WIND0, hz: f8 };

/**
 * ストップ s の、鍵盤の音 midi の管（ミクスチュアは列の数だけ）。寸法（内径・口・舌）は平均律の高さで決め、
 * 管の長さと舌の固有振動数は目標の周波数に合わせる
 */
export function pipesOf(s: Stop, midi: number, o: PipeOpt = OPT0): PipeDef[] {
  const P = o.wind * divOf(s.div).windK,
    R = { ...REED, ...o.reed },
    fT = o.hz(midi);
  if (s.kind === 'reed' && midi > s.top)
    return pipesOf({ ...s, kind: 'flue', ranks: () => [s.ratio], scale: 0, ...PRINCIPAL }, midi, o);
  if (s.kind === 'reed') {
    const fE = f8(midi) * s.ratio,
      f = fT * s.ratio,
      n = 12 * Math.log2(fE / F_C2),
      d1 = octave(n, s.n0, s.d1),
      d0 = octave(n, s.n0, s.d0),
      w = s.wK * octave(n, 0, [14e-3, 11.2e-3, 9e-3, 6.7e-3, 5e-3]),
      fr = R.frK * f,
      wr = 2 * Math.PI * fr,
      /* 単位面積あたりの等価質量: 推奨の先の開きの上限から求めた値と、舌の厚さから求めた値の大きいほう */
      y0max = octave(n, 0, [0.6e-3, 0.46e-3, 0.35e-3, 0.23e-3, 0.15e-3]),
      mu = Math.max((R.pcK * P) / (wr * wr * y0max), MU_BRASS * octave(n, s.n0, s.e)),
      y0 = (R.pcK * P) / (wr * wr * mu),
      L = resLength(s.bore, R.resK * f, d0, d1),
      /* 円錐は切り取った頂点の容積をシャロットの容積とする（倍音がそろう。Fletcher 1998） */
      Vs = s.bore === 'cone' ? (Math.PI * (d0 / 2) ** 2 * ((L * d0) / (d1 - d0))) / 3 : 0;
    const spec: ReedSpec = {
      fr,
      Q: R.Q,
      mu,
      y0,
      w: w + s.side * tongueLen(n),
      Sr: 0.4 * w * tongueLen(n),
      bore: s.bore,
      L,
      d0,
      d1,
      Vs,
      toe: 1,
      tPallet: T_PALLET,
      tFoot: 0.008,
    };
    return [{ kind: 'reed', spec, f }];
  }
  if (s.from !== undefined && midi < s.from) return [];
  const fC = fT * 2 ** ((s.cents?.(midi) ?? 0) / 1200),
    md = s.harmonic && midi >= s.harmonic[0] && midi <= s.harmonic[1] ? 2 : 1;
  return s.ranks(midi).map((r, k) => {
    const stopped = s.stoppedRanks?.[k] ?? s.stopped,
      fE = f8(midi) * r,
      f = fC * r,
      d = topfer(stopped ? 2 * fE : fE, o.scale ?? s.scale),
      H = s.alpha * Math.PI * d,
      h = s.gamma * H,
      M = (MOUTH * d * d) / H,
      /* ハーモニックは倍の長さ（第 2 モードが f になる長さ） */
      l = (md * AIR.c) / ((stopped ? 4 : 2) * f) - M - (stopped ? 0 : END_CORR * (d / 2)),
      /* 足の穴で θ を上限に抑える。風箱の圧力でも θ が下限に届かない高い管は、カットアップを下げる */
      Ufull = Math.sqrt((2 * P) / AIR.rho),
      /* ハーモニックは θ を上限ちょうどにする（遅いジェットでは第 1 モードへ落ちる） */
      W = Math.min((o.cut ?? s.beta) * H, Ufull / ((md > 1 ? s.theta : THETA_MIN) * f)),
      pMax = (AIR.rho * (s.theta * f * W) ** 2) / 2,
      toe = Math.min(1, pMax / P),
      Uj = Math.sqrt((2 * P * toe) / AIR.rho);
    const spec: FlueSpec = {
      l,
      d,
      stopped,
      H,
      W,
      h,
      y0: s.y0 * h,
      noise: s.noise,
      fNoise: (0.5 * Uj) / W,
      toe,
      tPallet: T_PALLET,
      tFoot: tFootOf(d),
      seed: midi * 7 + k * 101 + 1,
      ...(md > 1 ? { mode: md } : {}),
    };
    return { kind: 'flue', spec, f };
  });
}
