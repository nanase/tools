/**
 * 4 オペレータの FM 音源（DOM に依存しない）。表示（client.ts）と音の AudioWorklet（worklet.ts）で同じ式を使う。
 * アルゴリズムと帰還量はヤマハの OPN 系（YM2203・YM2608・YM2612）にならう。
 * エンベロープ（ADSR）・強さ・デチューンの式は FMシンセサイザ（fm-synthesizer/engine.ts）と同じ。LFO は持たない
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

/** エンベロープ: アタック [s]・ディケイ [s]・サステイン（0〜1）・リリース [s] */
export interface Env {
  ar: number;
  dr: number;
  sl: number;
  rr: number;
}
/** エンベロープの初期値（今までの 5 ms のフェードに近い） */
export const ENV0: Env = { ar: 0.005, dr: 1, sl: 1, rr: 0.05 };
/** ディケイとリリースは、その時間で 60 dB 下がる */
const LN60 = Math.log(1000);
/** 鳴り終わったとみなす大きさ（−80 dB） */
const SILENT = 1e-4;

/** 強さの効き（FMシンセサイザの音色のベロシティの効きと同じ曲線） */
export const VEL_SENS = 0.7;
/** 強さ v（0〜1）で変調指数と振幅に掛ける値 */
export const velGain = (v: number): number => 1 - VEL_SENS * (1 - v * v);

/**
 * エンベロープの大きさ（0〜1）。t は鳴り始めからの時間 [s]、hold は離した時刻（押したままなら Infinity）。
 * 音の計算（Voice）と同じ式
 */
export function envAt(e: Env, t: number, hold = Number.POSITIVE_INFINITY): number {
  const at = (x: number): number => {
    if (x < e.ar) return e.ar > 0 ? x / e.ar : 1;
    return e.sl + (1 - e.sl) * Math.exp((-LN60 * (x - e.ar)) / Math.max(1e-4, e.dr));
  };
  if (t < hold) return Math.max(0, at(t));
  return Math.max(0, at(hold) * Math.exp((-LN60 * (t - hold)) / Math.max(1e-4, e.rr)));
}

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
  /** デチューン [Hz]（周波数比で決めた周波数に足す。省けば 0） */
  dt?: readonly number[];
  /** エンベロープ（省けば ENV0） */
  env?: readonly Env[];
}

/** 音量の調整で出力に掛ける値（調整しないか、合計が 1 以下なら 1） */
export function normGain(p: Patch): number {
  if (!p.norm) return 1;
  let sum = 0;
  for (const c of ALGS[p.alg].c) sum += Math.abs(p.a[c]);
  return 1 / Math.max(1, sum);
}

const ATTACK = 0,
  DECAY = 1,
  RELEASE = 2;

/**
 * 1 音ぶんの発音の状態（4 つのオペレータの位相と、OP1 の直近 2 標本）。
 * start で鳴らし始めるとエンベロープを掛ける。start しなければエンベロープなしで鳴らし続ける（表示と再生ボタンの音）
 */
export class Voice {
  private readonly ph = new Float64Array(4);
  private readonly s = new Float64Array(4);
  /** 今の出力の大きさ（glide で目標へ近づける） */
  private readonly a = new Float64Array(4);
  /** エンベロープの大きさと段、1 標本あたりの変化 */
  private readonly lv = new Float64Array([1, 1, 1, 1]);
  private readonly stage = new Uint8Array(4);
  private readonly up = new Float64Array(4);
  private readonly kd = new Float64Array(4);
  private readonly kr = new Float64Array(4);
  private h1 = 0;
  private h2 = 0;
  private p: Patch | null = null;
  /** オペレータごとの変調の元 */
  private src: number[][] = [[], [], [], []];
  /** エンベロープを掛ける標本化周波数（0 は掛けない） */
  private sr = 0;
  /** 強さで掛ける値 */
  private vg = 1;
  /** 離したか */
  released = false;

  /** 音色を変える。最初の 1 回は出力の大きさをすぐ目標にする */
  set(p: Patch): void {
    if (!this.p) for (let k = 0; k < 4; k++) this.a[k] = p.a[k] * this.vg;
    this.p = p;
    this.src = [[], [], [], []];
    for (const [j, k] of ALGS[p.alg].e) this.src[k].push(j);
    this.rates();
  }

  /** 位相と帰還を時刻 0 に戻す */
  reset(): void {
    this.ph.fill(0);
    this.h1 = this.h2 = 0;
  }

  /** エンベロープを掛けずに、強さ vel（0〜1）だけを変える（表示と再生ボタンの音） */
  setVel(vel: number): void {
    this.vg = velGain(Math.max(0, Math.min(1, vel)));
  }

  /** 標本化周波数 sr で、強さ vel（0〜1）で鳴らし始める（エンベロープをアタックから始める） */
  start(sr: number, vel = 1): void {
    this.sr = sr;
    this.vg = velGain(Math.max(0, Math.min(1, vel)));
    this.released = false;
    if (this.p) for (let k = 0; k < 4; k++) this.a[k] = this.p.a[k] * this.vg;
    this.rates();
    const env = this.p?.env;
    for (let k = 0; k < 4; k++) {
      const ar = env?.[k]?.ar ?? ENV0.ar;
      this.lv[k] = ar > 0 ? 0 : 1;
      this.stage[k] = ar > 0 ? ATTACK : DECAY;
    }
  }

  /** 離す（リリースへ移る） */
  release(): void {
    this.released = true;
    this.stage.fill(RELEASE);
  }

  /** エンベロープの変化の速さを音色から求める */
  private rates(): void {
    const { sr, p } = this;
    if (!sr || !p) return;
    for (let k = 0; k < 4; k++) {
      const e = p.env?.[k] ?? ENV0;
      this.up[k] = e.ar > 0 ? 1 / (e.ar * sr) : 1;
      this.kd[k] = Math.exp(-LN60 / (Math.max(1e-4, e.dr) * sr));
      this.kr[k] = Math.exp(-LN60 / (Math.max(1e-4, e.rr) * sr));
    }
  }

  /** オペレータ k のエンベロープの大きさ（0〜1。エンベロープを掛けていなければ 1） */
  level(k: number): number {
    return this.lv[k];
  }

  /** 鳴り終わったか（どのキャリアも出力 0 か、十分小さく、離したあとかサステイン 0 のディケイ） */
  get done(): boolean {
    const p = this.p;
    if (!this.sr || !p) return false;
    for (const c of ALGS[p.alg].c) {
      const amp = Math.abs(this.a[c]);
      if (amp === 0) continue;
      if (amp * this.lv[c] > SILENT) return false;
      if (!this.released && (this.stage[c] !== DECAY || (p.env?.[c] ?? ENV0).sl > 0)) return false;
    }
    return true;
  }

  /**
   * len 標本を out に書く（上書き）。step は基本周波数 ÷ 標本化周波数、ts は 1 標本の時間 [s]（デチューンに使う。0 ならデチューンしない）。
   * glide は出力の大きさを目標へ近づける 1 標本あたりの割合（1 ならすぐ変える。音のぷつ音を防ぐ）
   */
  render(out: Float32Array | Float64Array, len: number, step: number, glide = 1, ts = 0): void {
    const { p, ph, s, a, src, lv, stage, up, kd, kr, vg } = this;
    if (!p) {
      out.fill(0, 0, len);
      return;
    }
    const beta = FB[p.fb] / 2,
      car = ALGS[p.alg].c,
      w = p.w,
      dt = p.dt,
      inc = [0, 1, 2, 3].map((k) => p.r[k] * step + (dt ? dt[k] * ts : 0)),
      tgt = [p.a[0] * vg, p.a[1] * vg, p.a[2] * vg, p.a[3] * vg],
      sl = [0, 1, 2, 3].map((k) => (p.env?.[k] ?? ENV0).sl),
      env = this.sr > 0;
    for (let i = 0; i < len; i++) {
      if (glide < 1) for (let k = 0; k < 4; k++) a[k] += (tgt[k] - a[k]) * glide;
      else for (let k = 0; k < 4; k++) a[k] = tgt[k];
      if (env)
        for (let k = 0; k < 4; k++) {
          const st = stage[k];
          if (st === ATTACK) {
            lv[k] += up[k];
            if (lv[k] >= 1) {
              lv[k] = 1;
              stage[k] = DECAY;
            }
          } else if (st === DECAY) lv[k] = sl[k] + (lv[k] - sl[k]) * kd[k];
          else lv[k] *= kr[k];
        }
      /* OP1: 直近 2 標本の平均を帰還する */
      const x = waveAt(w[0], TAU * ph[0] + beta * (this.h1 + this.h2));
      this.h2 = this.h1;
      this.h1 = x;
      s[0] = x;
      for (let k = 1; k < 4; k++) {
        let m = 0;
        for (const j of src[k]) m += a[j] * lv[j] * s[j];
        s[k] = waveAt(w[k], TAU * ph[k] + m);
      }
      let y = 0,
        sum = 0;
      for (const c of car) {
        y += a[c] * lv[c] * s[c];
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

/**
 * 表示用の波形: 時刻 0（全オペレータの位相 0）から periods 周期ぶん、1 周期を PTS 点で計算する。
 * エンベロープは掛けない。vel は強さ（0〜1）、f0 は基本周波数 [Hz]（デチューンに使う。0 ならデチューンしない）
 */
export function waveOf(p: Patch, periods: number, vel = 1, f0 = 0): Float64Array<ArrayBuffer> {
  const v = new Voice(),
    out = new Float64Array(periods * PTS);
  v.setVel(vel);
  v.set(p);
  v.render(out, out.length, 1 / PTS, 1, f0 > 0 ? 1 / (PTS * f0) : 0);
  return out;
}

/** 時間変化の表示用: 基本周波数 f0 [Hz] の音を、強さ vel で標本化周波数 sr で鳴らして hold [s] で離し、len 標本を返す */
export function noteOf(p: Patch, f0: number, sr: number, len: number, vel: number, hold: number): Float32Array {
  const v = new Voice(),
    out = new Float32Array(len),
    h = Math.max(0, Math.min(len, Math.round(hold * sr)));
  v.set(p);
  v.start(sr, vel);
  v.render(out.subarray(0, h), h, f0 / sr, 1, 1 / sr);
  v.release();
  v.render(out.subarray(h), len - h, f0 / sr, 1, 1 / sr);
  return out;
}
