/**
 * 4 オペレータの FM 音源（DOM に依存しない）。表示（client.ts）と音の AudioWorklet（worklet.ts）で同じ式を使う。
 * アルゴリズムと帰還量はヤマハの OPN 系（YM2203・YM2608・YM2612）にならう。エンベロープと LFO は持たない
 */

/** アルゴリズム: 変調の結線 [元, 先]（オペレータの番号は 0 始まり、元は先より小さい）と、出力へ足すオペレータ（キャリア） */
export interface Alg {
  e: readonly (readonly [number, number])[];
  c: readonly number[];
}
export const ALGS: readonly Alg[] = [
  {
    e: [
      [0, 1],
      [1, 2],
      [2, 3],
    ],
    c: [3],
  },
  {
    e: [
      [0, 2],
      [1, 2],
      [2, 3],
    ],
    c: [3],
  },
  {
    e: [
      [0, 3],
      [1, 2],
      [2, 3],
    ],
    c: [3],
  },
  {
    e: [
      [0, 1],
      [1, 3],
      [2, 3],
    ],
    c: [3],
  },
  {
    e: [
      [0, 1],
      [2, 3],
    ],
    c: [1, 3],
  },
  {
    e: [
      [0, 1],
      [0, 2],
      [0, 3],
    ],
    c: [1, 2, 3],
  },
  { e: [[0, 1]], c: [1, 2, 3] },
  { e: [], c: [0, 1, 2, 3] },
];

/** 帰還量 FB 0〜7 の、OP1 の位相のずれの最大値（rad） */
export const FB = [0, Math.PI / 16, Math.PI / 8, Math.PI / 4, Math.PI / 2, Math.PI, 2 * Math.PI, 4 * Math.PI] as const;
/** 帰還量の表記（π の分数） */
export const FB_LABEL = ['0', 'π/16', 'π/8', 'π/4', 'π/2', 'π', '2π', '4π'] as const;

const TAU = 2 * Math.PI;

/** オペレータ k（0 始まり）がアルゴリズム alg でキャリアか */
export const isCarrier = (alg: number, k: number): boolean => ALGS[alg].c.includes(k);

/**
 * オペレータの波形: [値, 表示, 式の関数名]。半波整流・全波整流・四分波はヤマハの OPL2（YM3812）の波形選択にならう。
 * どれも位相 0 で 0 から始まり、のこぎり波は上がる向き
 */
export const WAVES = [
  ['sin', '正弦波', 'sin'],
  ['tri', '三角波', 'tri'],
  ['saw', 'のこぎり波', 'saw'],
  ['sq', '矩形波', 'sq'],
  ['half', '半波整流', 'hsin'],
  ['abs', '全波整流', 'asin'],
  ['qtr', '四分波', 'qsin'],
] as const;
export type Wave = (typeof WAVES)[number][0];
const WAVE_IDS: readonly Wave[] = WAVES.map((w) => w[0]);

/** 波形 w の、位相 x（rad）での値（−1〜1） */
export function waveAt(w: number, x: number): number {
  if (w === 0) return Math.sin(x);
  const u = x / TAU - Math.floor(x / TAU);
  switch (w) {
    case 1:
      return u < 0.25 ? 4 * u : u < 0.75 ? 2 - 4 * u : 4 * u - 4;
    case 2:
      return u < 0.5 ? 2 * u : 2 * u - 2;
    case 3:
      return u < 0.5 ? 1 : -1;
    case 4:
      return u < 0.5 ? Math.sin(x) : 0;
    case 5:
      return Math.abs(Math.sin(x));
    default:
      return u % 0.5 < 0.25 ? Math.abs(Math.sin(x)) : 0;
  }
}
/** 波形の番号（WAVES の並び）。知らない値は正弦波 */
export const waveIndex = (w: string): number => Math.max(0, WAVE_IDS.indexOf(w as Wave));

/** 音色 */
export interface Patch {
  /** アルゴリズム 0〜7 */
  alg: number;
  /** 帰還量 FB 0〜7 */
  fb: number;
  /** 波形（WAVES の番号） */
  w: readonly number[];
  /** 周波数比（基本周波数に掛ける） */
  r: readonly number[];
  /** 出力の大きさ。モジュレータは変調指数（rad）、キャリアは振幅（フルスケールを 1 とする） */
  a: readonly number[];
  /** 音量の調整: キャリアの振幅の合計が 1 を超えたら、出力を合計で割る（ピークをフルスケール以内に収める） */
  norm: boolean;
}

/** 音量の調整で出力に掛ける値（調整しないか、合計が 1 以下なら 1） */
export function normGain(p: Patch): number {
  if (!p.norm) return 1;
  let sum = 0;
  for (const c of ALGS[p.alg].c) sum += Math.abs(p.a[c]);
  return 1 / Math.max(1, sum);
}

/** 1 音ぶんの発音の状態（4 つのオペレータの位相と、OP1 の直近 2 標本） */
export class Voice {
  private readonly ph = new Float64Array(4);
  private readonly s = new Float64Array(4);
  /** 今の出力の大きさ（glide で目標へ近づける） */
  private readonly a = new Float64Array(4);
  private h1 = 0;
  private h2 = 0;
  private p: Patch | null = null;
  /** オペレータごとの変調の元 */
  private src: number[][] = [[], [], [], []];

  /** 音色を変える。最初の 1 回は出力の大きさをすぐ目標にする */
  set(p: Patch): void {
    if (!this.p) for (let k = 0; k < 4; k++) this.a[k] = p.a[k];
    this.p = p;
    this.src = [[], [], [], []];
    for (const [j, k] of ALGS[p.alg].e) this.src[k].push(j);
  }

  /** 位相と帰還を時刻 0 に戻す */
  reset(): void {
    this.ph.fill(0);
    this.h1 = this.h2 = 0;
  }

  /**
   * len 標本を out に書く（上書き）。step は基本周波数 ÷ 標本化周波数。
   * glide は出力の大きさを目標へ近づける 1 標本あたりの割合（1 ならすぐ変える。音のぷつ音を防ぐ）
   */
  render(out: Float32Array | Float64Array, len: number, step: number, glide = 1): void {
    const { p, ph, s, a, src } = this;
    if (!p) {
      out.fill(0, 0, len);
      return;
    }
    const beta = FB[p.fb] / 2,
      car = ALGS[p.alg].c,
      w = p.w,
      inc = [p.r[0] * step, p.r[1] * step, p.r[2] * step, p.r[3] * step];
    for (let i = 0; i < len; i++) {
      if (glide < 1) for (let k = 0; k < 4; k++) a[k] += (p.a[k] - a[k]) * glide;
      else for (let k = 0; k < 4; k++) a[k] = p.a[k];
      /* OP1: 直近 2 標本の平均を帰還する */
      const x = waveAt(w[0], TAU * ph[0] + beta * (this.h1 + this.h2));
      this.h2 = this.h1;
      this.h1 = x;
      s[0] = x;
      for (let k = 1; k < 4; k++) {
        let m = 0;
        for (const j of src[k]) m += a[j] * s[j];
        s[k] = waveAt(w[k], TAU * ph[k] + m);
      }
      let y = 0,
        sum = 0;
      for (const c of car) {
        y += a[c] * s[c];
        sum += Math.abs(a[c]);
      }
      out[i] = p.norm && sum > 1 ? y / sum : y;
      for (let k = 0; k < 4; k++) {
        const q = ph[k] + inc[k];
        ph[k] = q - Math.floor(q);
      }
    }
  }
}

/** 表示で 1 周期（基本周波数の）を分ける点の数 */
export const PTS = 512;

/** 表示用の波形: 時刻 0（全オペレータの位相 0）から periods 周期ぶん、1 周期を PTS 点で計算する */
export function waveOf(p: Patch, periods: number): Float64Array<ArrayBuffer> {
  const v = new Voice(),
    out = new Float64Array(periods * PTS);
  v.set(p);
  v.render(out, out.length, 1 / PTS);
  return out;
}
