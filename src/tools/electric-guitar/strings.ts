/**
 * 弦の振動（DOM に依存しない）: 両端を止めた硬い弦のモードを、複素数の回転で 1 サンプルずつ進める（モード合成）。
 * 撥弦の初期の形は弾く点が角になった三角形で、ピックの幅でガウスに丸める。
 * 弦の上の磁石（ピックアップ）は、その位置の弦の変位と速さを、拾う幅のガウスの重みで読む（Paiva ほか 2012）。
 * チョーキングとビブラートは、すべてのモードの周波数を同じ比で動かす（張力が変わると全体の高さが変わる）
 */
import { clamp, TAU } from './filters';

/** 1 弦から順の開放弦の周波数 [Hz]（標準の調弦 E2 A2 D3 G3 B3 E4） */
export const TUNING = [329.63, 246.94, 196.0, 146.83, 110.0, 82.41] as const;
/** 弦長 [m] */
export const SCALE = 0.648;
/** フレットの数 */
export const FRETS = 24;
/**
 * 開放弦の非調和性係数 B（10〜46 のセット。プレーン弦は π³Ed⁴/(64TL²)、巻弦は芯線の径から概算）。
 * 押さえると振動する長さの 2 乗に反比例して大きくなる
 */
const STR_B = [1.3e-5, 4e-5, 1.07e-4, 3e-5, 5e-5, 8e-5];
/** 減衰率 σ = s0 + s2 f² [1/s]。ソリッドボディで胴へ逃げる損失が小さい。巻弦（4〜6 弦）は高い音ほど早く消える */
const STR_S0 = [1.1, 0.95, 0.85, 0.65, 0.5, 0.42];
const STR_S2 = [3.6e-7, 3.6e-7, 4.2e-7, 1.5e-6, 1.6e-6, 1.7e-6];
/** 計算する部分音の上限 [Hz]（ピックアップのコイルの共振より上は、ほとんど出ない） */
const F_TOP = 8000;
/** 1 回の撥弦の弦の引き量 [m]（強さ 1 のとき） */
export const PLUCK_M = 1.1e-3;
/** フィードバックで弦を揺らす点（駒からの距離 [m]）。スピーカーの音が胴と駒を通して弦を押す */
const FB_X = 0.03;

/** 弦の上で磁石が拾う所: 駒からの距離 x [m]、拾う幅 w [m]、2 つのコイルの間隔 gap [m]（ハムバッカー） */
export interface Sense {
  x: number;
  w: number;
  gap: number;
}

/** 撥弦 1 回のぶんの弦の振動 */
export interface Voice {
  /** 弦（0 = 1 弦）とフレット */
  si: number;
  fret: number;
  /** モードの数 */
  n: number;
  /** モードの状態（実部が変位 [m]） */
  re: Float64Array;
  im: Float64Array;
  /** 1 サンプルの回転（e^{(−σ+iω)/fs}） */
  c: Float64Array;
  s: Float64Array;
  /** 1 サンプルの角度 ω/fs と減衰 e^{−σ/fs}（高さを変えたときに回転を作り直す） */
  w: Float64Array;
  e: Float64Array;
  /** 2 つのピックアップの、変位と速さの重み */
  wu0: Float64Array;
  wv0: Float64Array;
  wu1: Float64Array;
  wv1: Float64Array;
  /** フィードバックの力を受ける重み */
  wb: Float64Array;
  f0: number;
  /** 振動する長さ [m] */
  Lf: number;
  /** 止めた（弾き直した・指で押さえた）か */
  dead: boolean;
  age: number;
  /** 高さの比（2^{半音/12}）と、チョーキング・ビブラート */
  ratio: number;
  bend: number;
  bendTo: number;
  /** チョーキングの速さ [半音/サンプル] */
  bendRate: number;
  vib: number;
  vibHz: number;
  vibPh: number;
}

export interface PluckOpt {
  /** 強さ（1 で PLUCK_M） */
  amp?: number;
  /** 弾く位置（駒からの距離 [m]） */
  pos?: number;
  /** ピックの幅 [m] */
  hw?: number;
  /** ブリッジミュート（手のひらで駒の近くを押さえる） */
  mute?: boolean;
  /** 左手で弦に触れただけのカッティング（音程のない音） */
  ghost?: boolean;
  /** ハーモニクス: 弦長の 1/harm の節に触れる（harm の倍数の倍音だけが残る） */
  harm?: number;
  /** 調弦を下げる量 [半音]（移調で下げるとき） */
  tune?: number;
  /** 弾き始めのチョーキングとビブラート（MIDI のホイール） */
  bend?: number;
  vib?: number;
}

/** 弦 si をフレット fret で弾いたときのモード。pu は 2 つまでのピックアップ */
export function makeVoice(fs: number, si: number, fret: number, o: PluckOpt, pu: readonly Sense[]): Voice {
  const Lf = SCALE * 2 ** (-fret / 12),
    f0 = TUNING[si] * 2 ** ((fret + (o.tune ?? 0)) / 12),
    B = STR_B[si] * 2 ** (fret / 6),
    xp = clamp(o.pos ?? 0.1, 0.01, Lf * 0.5),
    u0 = xp / Lf,
    hw = o.hw ?? 0.0015,
    A = (o.amp ?? 1) * PLUCK_M;
  /* ブリッジミュートは低い音を少し、高い音を大きく削る。カッティングは指で触れてすぐ止める */
  const x0 = o.ghost ? 160 : o.mute ? 22 : 0,
    x2 = o.ghost ? 8e-5 : o.mute ? 2.4e-5 : 0;
  const L: number[][] = Array.from({ length: 11 }, () => []);
  for (let n = 1; n <= 200; n++) {
    const f = n * f0 * Math.sqrt(1 + B * n * n);
    if (f > F_TOP) break;
    if (o.harm && n % o.harm) continue;
    const k = (n * Math.PI) / Lf,
      /* 三角形の初期変位のモードの振幅（ピックの幅でガウスに丸める） */
      a =
        ((A * 2) / (n * n * Math.PI * Math.PI * u0 * (1 - u0))) *
        Math.sin(n * Math.PI * u0) *
        Math.exp(-0.5 * (k * hw) ** 2),
      sg = STR_S0[si] + STR_S2[si] * f * f + x0 + x2 * f * f,
      w = (TAU * f) / fs,
      e = Math.exp(-sg / fs);
    L[0].push(a);
    L[1].push(w);
    L[2].push(e);
    for (let p = 0; p < 2; p++) {
      const P = pu[p];
      let ph = 0;
      if (P) {
        /* 拾う幅のガウスの重み。ハムバッカーは 2 つのコイルの平均 */
        const ap = Math.exp(-0.5 * (k * P.w) ** 2);
        ph =
          (P.gap ? 0.5 * (Math.sin(k * (P.x - P.gap / 2)) + Math.sin(k * (P.x + P.gap / 2))) : Math.sin(k * P.x)) * ap;
      }
      L[3 + 2 * p].push(ph);
      L[4 + 2 * p].push(-TAU * f * ph);
    }
    L[7].push(Math.sin(k * FB_X));
  }
  const F = (a: number[]) => Float64Array.from(a),
    n = L[0].length,
    v: Voice = {
      si,
      fret,
      n,
      re: F(L[0]),
      im: new Float64Array(n),
      c: new Float64Array(n),
      s: new Float64Array(n),
      w: F(L[1]),
      e: F(L[2]),
      wu0: F(L[3]),
      wv0: F(L[4]),
      wu1: F(L[5]),
      wv1: F(L[6]),
      wb: F(L[7]),
      f0,
      Lf,
      dead: false,
      age: 0,
      ratio: 0,
      bend: o.bend ?? 0,
      bendTo: o.bend ?? 0,
      bendRate: 0,
      vib: o.vib ?? 0,
      vibHz: 5.5,
      vibPh: 0,
    };
  retune(v, 2 ** (v.bend / 12));
  return v;
}

/** 高さの比を r にして、1 サンプルの回転を作り直す */
export function retune(v: Voice, r: number): void {
  v.ratio = r;
  for (let i = 0; i < v.n; i++) {
    v.c[i] = v.e[i] * Math.cos(v.w[i] * r);
    v.s[i] = v.e[i] * Math.sin(v.w[i] * r);
  }
}

/** 弦を止める（指で押さえた・弾き直した）: 減衰率に sg [1/s] を足す */
export function damp(v: Voice, fs: number, sg: number): void {
  const k = Math.exp(-sg / fs);
  for (let i = 0; i < v.n; i++) v.e[i] *= k;
  retune(v, v.ratio);
}

/** 高さを変える間隔 [サンプル] */
export const PITCH_STEP = 32;
/** チョーキングとビブラートを PITCH_STEP サンプルぶん進める */
export function stepPitch(v: Voice, fs: number): void {
  if (v.bend !== v.bendTo) {
    const d = v.bendTo - v.bend,
      m = v.bendRate * PITCH_STEP;
    v.bend = Math.abs(d) <= m ? v.bendTo : v.bend + Math.sign(d) * m;
  }
  let semi = v.bend;
  if (v.vib) {
    v.vibPh = (v.vibPh + (v.vibHz * PITCH_STEP) / fs) % 1;
    semi += v.vib * Math.sin(TAU * v.vibPh);
  }
  const r = 2 ** (semi / 12);
  if (Math.abs(r - v.ratio) > 1e-7) retune(v, r);
}

/**
 * 1 サンプル進める。force はフィードバックで弦を押す力（モードの変位へ足す量）。
 * out に 2 つのピックアップでの変位 [m] と速さ [m/s] を入れる
 */
export function stepVoice(v: Voice, force: number, out: Float64Array): void {
  const { re, im, c, s, wu0, wv0, wu1, wv1, wb, n } = v;
  let u0 = 0,
    v0 = 0,
    u1 = 0,
    v1 = 0;
  for (let i = 0; i < n; i++) {
    const r = re[i] + force * wb[i],
      m = im[i],
      nr = r * c[i] - m * s[i],
      ni = r * s[i] + m * c[i];
    re[i] = nr;
    im[i] = ni;
    u0 += wu0[i] * nr;
    v0 += wv0[i] * ni;
    u1 += wu1[i] * nr;
    v1 += wv1[i] * ni;
  }
  out[0] = u0;
  out[1] = v0 * v.ratio;
  out[2] = u1;
  out[3] = v1 * v.ratio;
}

/** 弦の全体の振れ（モードの振幅の和 [m]）。描画と、消えた声を外すのに使う */
export function swing(v: Voice): number {
  let m = 0;
  for (let i = 0; i < v.n; i++) m += Math.hypot(v.re[i], v.im[i]);
  return m;
}
