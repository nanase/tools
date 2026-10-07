/**
 * レンズの処方（出典の単位のまま）。面は物体側から順に、曲率半径 R（平面は 0）・次の面までの間隔 t・
 * 面の後ろの媒質（空気は null）。絞りは平面の 'stop' として並べる。最後の間隔（出典のバックフォーカス）は使わず、像面の位置はピントの計算で決める。焦点距離は使うときに相似拡大でそろえる
 */
import { glass, type Medium, model } from './glass';

export type LensId = 'single' | 'achro' | 'triplet' | 'tessar' | 'dgauss' | 'tele' | 'wide';

export type Row = readonly [r: number, t: number, m: Medium | null] | readonly ['stop', t: number];

export interface Rx {
  v: LensId;
  name: string;
  /** 選択肢の表記 */
  ab: string;
  /** 設計の開放 F 値 */
  fno: number;
  /** 設計の半画角 [°] */
  hfov: number;
  /** 選んだときに合わせる焦点距離 [mm]（35 mm 判で設計の画角に近いもの） */
  f0: number;
  rows: readonly Row[];
  /** 出典が示す有効径（直径、面ごと。絞りを含む）。なければ近軸の光線から決める */
  dia?: readonly number[];
  /** 出典（HTML） */
  src: string;
  /** 選択肢の title */
  sub: string;
}

const BK7 = glass('N-BK7'),
  BAK1 = glass('N-BAK1'),
  SF2 = glass('SF2'),
  SK16 = glass('N-SK16'),
  F2 = glass('F2'),
  SK15 = glass('N-SK15'),
  K10 = glass('K10'),
  BASF2 = glass('N-BASF2'),
  ZK7 = glass('N-ZK7'),
  LAF33 = glass('N-LAF33'),
  SF1 = glass('SF1'),
  SK4 = glass('N-SK4');

/** 単レンズの形: N-BK7 で、無限遠の物体に対して球面収差が最小になる形状係数 q = 2(n² − 1)/(n + 2) の両凸 */
function bestForm(f: number, n: number): [number, number] {
  const q = (2 * (n * n - 1)) / (n + 2),
    k = 2 * (n - 1) * f;
  return [k / (1 + q), k / (q - 1)];
}
const [R1, R2] = bestForm(100, BK7.nd);

/* ダブルガウス（Tronnier）の硝材は、特許の屈折率とアッベ数の模型の硝材にする */
const G1 = model(1.67, 47.1, 'N-BAF10'),
  G3 = model(1.699, 30.1, 'SF15'),
  G4 = model(1.603, 38.4, 'F5'),
  G5 = model(1.658, 57.0, 'N-SK16'),
  G6 = model(1.717, 48.1, 'N-LAF3');

const LAIKIN = 'M. Laikin, <i>Lens Design</i>, 4th ed., CRC Press, 2007';

export const LENSES: readonly Rx[] = [
  {
    v: 'single',
    name: '単レンズ',
    ab: '単レンズ',
    sub: 'N-BK7 の両凸レンズ 1 枚。絞りはレンズに接する',
    fno: 4,
    hfov: 20,
    f0: 50,
    rows: [
      ['stop', 0],
      [R1, 4, BK7],
      [R2, 96, null],
    ],
    src: '形はこのツールで決めた（N-BK7、無限遠の物体に対して球面収差が最小になる形状係数 <math><mi>q</mi><mo>=</mo><mn>2</mn><mo stretchy="false">(</mo><msup><mi>n</mi><mn>2</mn></msup><mo>−</mo><mn>1</mn><mo stretchy="false">)</mo><mo>/</mo><mo stretchy="false">(</mo><mi>n</mi><mo>+</mo><mn>2</mn><mo stretchy="false">)</mo></math>。W. T. Welford, <i>Aberrations of Optical Systems</i>, Adam Hilger, 1986, 7.5 節）',
  },
  {
    v: 'achro',
    name: 'アクロマート',
    ab: 'アクロマート',
    sub: 'クラウンとフリントを貼り合わせた色消しレンズ（望遠鏡の対物レンズの形）',
    fno: 6,
    hfov: 5,
    f0: 50,
    rows: [
      ['stop', 0],
      // biome-ignore lint/suspicious/noApproximativeNumericConstant: 出典の厚さ（log₁₀ e ではない）
      [12.38401, 0.434, BAK1],
      [-7.9414, 0.321, SF2],
      [-48.44396, 19.6059, null],
    ],
    src: `${LAIKIN}, p. 45（Cemented achromat、F/6）`,
  },
  {
    v: 'triplet',
    name: 'クック・トリプレット',
    ab: 'トリプレット',
    sub: '凸・凹・凸の 3 枚（H. D. Taylor、1893 年）',
    fno: 5,
    hfov: 20,
    f0: 50,
    rows: [
      [22.01359, 3.25896, SK16],
      [-435.76044, 6.00755, null],
      [-22.21328, 0.99997, F2],
      [20.29192, 0, null],
      ['stop', 4.75041],
      [79.6836, 2.95208, SK16],
      [-18.39533, 42.20778, null],
    ],
    src: 'Zemax（OpticStudio）の設計例の Cooke トリプレット（f = 50 mm、F/5、半画角 20°）。値はオープンソースの光学設計ライブラリ Optiland のサンプル CookeTriplet による',
  },
  {
    v: 'tessar',
    name: 'テッサー',
    ab: 'テッサー',
    sub: 'トリプレットの後ろの凸レンズを貼り合わせにした 4 枚（P. Rudolph、1902 年）',
    fno: 4.5,
    hfov: 20.5,
    f0: 50,
    rows: [
      [1.3329, 0.2791, SK15],
      [-9.9754, 0.2054, null],
      [-2.0917, 0.09, F2],
      [1.2123, 0.0709, null],
      ['stop', 0.1534],
      [-7.5205, 0.09, K10],
      [1.301, 0.3389, SK15],
      [-1.5218, 3.4025, null],
    ],
    src: `${LAIKIN}, p. 63（Tessar、F/4.5）。値は Optiland のサンプル TessarLens による`,
  },
  {
    v: 'dgauss',
    name: 'ダブルガウス',
    ab: 'ダブルガウス',
    sub: '絞りを挟んで凹面を向かい合わせた 6 枚。標準レンズの多くの形（W. Tronnier の特許）',
    fno: 2,
    hfov: 22,
    f0: 50,
    rows: [
      [58.95, 7.52, G1],
      [169.66, 0.24, null],
      [38.55, 8.05, G1],
      [81.54, 6.55, G3],
      [25.5, 11.41, null],
      ['stop', 9.0],
      [-28.99, 2.36, G4],
      [81.54, 12.13, G5],
      [-40.77, 0.38, null],
      [874.13, 6.44, G6],
      [-79.46, 0, null],
    ],
    dia: [50.4, 50.4, 46.0, 46.0, 36.0, 34.2, 34.0, 40.0, 40.0, 40.0, 40.0],
    src: 'W. J. Smith, <i>Modern Lens Design</i>, McGraw-Hill, 1992, p. 312（US 2,673,491、W. Tronnier、F/2、半画角 22°）。曲率半径・間隔・屈折率・有効径は C. Kolb, D. Mitchell, P. Hanrahan, “A Realistic Camera Model for Computer Graphics,” SIGGRAPH 1995 と pbrt の lenses/dgauss.dat による。アッベ数は特許の値',
  },
  {
    v: 'tele',
    name: '望遠レンズ',
    ab: '望遠',
    sub: '前の凸と後ろの凹で、焦点距離より短い全長にした形',
    fno: 5.6,
    hfov: 10,
    f0: 135,
    rows: [
      [0.8589, 0.2391, BK7],
      [-2.6902, 0.09, BASF2],
      [3.0318, 0.0481, null],
      ['stop', 1.0347],
      [-0.5715, 0.09, ZK7],
      [-0.7423, 0.1005, LAF33],
      [-1.1433, 0.0156, null],
      [-17.0388, 0.0793, SF1],
      [-2.7695, 2.4796, null],
    ],
    src: `${LAIKIN}, p. 91（Telephoto、F/5.6）。値は Optiland のサンプル Telephoto による`,
  },
  {
    v: 'wide',
    name: '超広角レンズ',
    ab: '超広角',
    sub: '前に強い凹レンズを置いたレトロフォーカスの形。全画角 100° で、樽型の歪曲を残している',
    fno: 4,
    hfov: 50,
    f0: 28,
    rows: [
      [8.0107, 0.25, SK4],
      [1.1856, 0.9613, null],
      [1.6747, 0.3578, SF1],
      [-7.5157, 0.2136, SK4],
      [0.9411, 0.4146, null],
      [-1.7688, 0.3333, SF1],
      [-1.5531, 0.3863, SK4],
      [-2.2281, 0.9842, null],
      ['stop', 0.1],
      [13.6803, 0.14, SK4],
      [-3.4279, 0.0605, null],
      [20.0257, 0.3332, SK4],
      [-0.9258, 0.4374, SF1],
      [-3.2233, 0.2679, null],
      [10.3847, 0.14, SF1],
      [2.4272, 0.2609, SK4],
      [-3.8828, 0.015, null],
      [3.365, 0.3167, SK4],
      [-14.7547, 1.5604, null],
    ],
    src: `${LAIKIN}, p. 108（Wide-angle lens, 100° FOV、F/4）。値は Optiland のサンプル WideAngle100FOV による`,
  },
];

export const lensOf = (v: string): Rx => LENSES.find((l) => l.v === v) ?? LENSES[4];
