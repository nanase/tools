/**
 * ノイズの生成器（DOM に依存しない。AudioWorklet とメインスレッドで共用）。
 * design() が設定から生成の条件（Spec。実効値をそろえる倍率など、重い計算はここ）を作り、
 * Gen が Spec と乱数の種から 1 標本ずつ作る。どのノイズも実効値を LEVEL_DB（AES17 の dBFS）にそろえる
 */
import { Brown, energy, type Filtered, grayTarget, makeFilt, resp, settle } from './color';
import { type LfsrCfg, periodOf, stepper } from './lfsr';
import { Rng } from './rng';

export type Kind = 'wu' | 'wg' | 'pink' | 'brown' | 'blue' | 'violet' | 'gray' | 'velvet' | 'lfsr';
export type PinkM = 'kellett' | 'voss';

/** ノイズの種類: [値, 表示, 補足] */
export const KINDS: readonly (readonly [Kind, string, string])[] = [
  ['wu', 'ホワイト（一様）', '白色雑音。振幅は一様分布'],
  ['wg', 'ホワイト（ガウス）', '白色雑音。振幅は正規分布'],
  ['pink', 'ピンク', '−3 dB/oct（1/f）'],
  ['brown', 'ブラウン', '−6 dB/oct（1/f²）。赤色雑音とも'],
  ['blue', 'ブルー', '+3 dB/oct（f）'],
  ['violet', 'バイオレット', '+6 dB/oct（f²）'],
  ['gray', 'グレー', 'A 特性の逆数。聴感上どの高さも同じ大きさ'],
  ['velvet', 'ベルベット', '疎な ±1 のパルス'],
  ['lfsr', 'LFSR', '線形帰還シフトレジスタの出力'],
];

export interface Cfg {
  kind: Kind;
  /** ピンクの作り方 */
  pm: PinkM;
  /** ベルベットのパルスの密度（1 秒あたり） */
  den: number;
  lfsr: LfsrCfg;
  /** LFSR のクロック周波数（Hz） */
  clk: number;
}

/** そろえる実効値（AES17 の dBFS）と、そのときの実効値（フルスケール 1） */
export const LEVEL_DB = -20;
export const RMS = 10 ** (LEVEL_DB / 20) / Math.SQRT2;
/** Voss–McCartney の行の数 */
export const VOSS_ROWS = 12;
/** LFSR の実効値を測る長さ（標本） */
const LFSR_MEASURE = 1 << 16;

/** 生成の条件 */
export interface Spec {
  kind: Kind;
  pm: PinkM;
  fs: number;
  /** 出力に掛ける倍率（実効値をそろえる） */
  g: number;
  /** 作り始めに捨てる標本の数（フィルタの状態を定常にする） */
  warm: number;
  /** ベルベット: パルスの間隔の平均（標本） */
  td: number;
  lf: LfsrCfg;
  /** LFSR: 1 標本あたりのクロックの数 */
  step: number;
  /** LFSR: 1 周期の出力の平均（引いて直流をなくす） */
  mu: number;
  /** LFSR: 周期（クロックの回数）。分からなければ null */
  period: number | null;
  /** LFSR: 原始多項式か・止まった状態から始めたか */
  prim: boolean;
  locked: boolean;
}

const isFiltered = (k: Kind, pm: PinkM): k is Filtered =>
  k === 'brown' || k === 'blue' || k === 'violet' || k === 'gray' || (k === 'pink' && pm === 'kellett');

/** 設定から生成の条件を作る（LFSR は周期と実効値を求めるので重いことがある） */
export function design(c: Cfg, fs: number): Spec {
  const sp: Spec = {
    kind: c.kind,
    pm: c.pm,
    fs,
    g: RMS,
    warm: 0,
    td: fs / c.den,
    lf: { ...c.lfsr },
    step: c.clk / fs,
    mu: 0,
    period: null,
    prim: false,
    locked: false,
  };
  if (c.kind === 'wu') sp.g = RMS * Math.sqrt(3);
  else if (c.kind === 'pink' && c.pm === 'voss') {
    sp.g = RMS / Math.sqrt(VOSS_ROWS + 1);
  } else if (isFiltered(c.kind, c.pm)) {
    sp.g = RMS / Math.sqrt(energy(c.kind, fs));
    sp.warm = settle(c.kind, fs);
  } else if (c.kind === 'velvet') {
    /* 実効値は g √(1/td)。ピークがフルスケールを超えないよう 1 で抑える */
    sp.g = Math.min(1, RMS * Math.sqrt(sp.td));
  } else if (c.kind === 'lfsr') {
    const p = periodOf(c.lfsr);
    Object.assign(sp, { period: p.period, mu: p.mean, prim: p.prim, locked: p.locked, g: 1 });
    /* 標本ごとの平均で小さくなる分も含めて、実際の出力の実効値を測ってそろえる */
    const x = new Float32Array(LFSR_MEASURE);
    new Gen(sp, 0).fill(x);
    let s2 = 0;
    for (const v of x) s2 += v * v;
    const r = Math.sqrt(s2 / x.length);
    sp.g = r > 1e-9 ? RMS / r : 0;
  }
  return sp;
}

/** 実際の実効値（ベルベットはピークを抑えると小さくなる） */
export const rmsOf = (sp: Spec): number =>
  sp.kind === 'velvet' ? sp.g / Math.sqrt(sp.td) : sp.kind === 'lfsr' && !sp.g ? 0 : RMS;

export class Gen {
  private readonly next: () => number;

  constructor(
    readonly sp: Spec,
    seed: number,
  ) {
    const r = new Rng(seed),
      g = sp.g;
    switch (sp.kind) {
      case 'wu':
        this.next = () => g * (2 * r.uni() - 1);
        break;
      case 'wg':
        this.next = () => g * r.gauss();
        break;
      case 'velvet':
        this.next = velvet(r, sp.td, g);
        break;
      case 'lfsr':
        this.next = lfsr(sp);
        break;
      default:
        if (sp.kind === 'pink' && sp.pm === 'voss') this.next = voss(r, g);
        else {
          const f = makeFilt(sp.kind as Filtered, sp.fs);
          /* ブラウンは積分器の状態を定常の分布から取る */
          if (f instanceof Brown) f.w = r.gauss() / Math.sqrt(1 - f.a * f.a);
          this.next = () => g * f.step(r.gauss());
        }
    }
    for (let i = 0; i < sp.warm; i++) this.next();
  }

  fill(out: Float32Array, off = 0, cnt = out.length - off): void {
    for (let i = 0; i < cnt; i++) out[off + i] = this.next();
  }
}

/** Voss–McCartney: 行 k は標本の番号の末尾の 0 の数が k のとき（2^(k+1) 標本ごと）に引き直す。白色の 1 行を足す */
function voss(r: Rng, g: number): () => number {
  const rows = new Float64Array(VOSS_ROWS).map(() => r.gauss());
  let n = 0;
  return () => {
    n = (n + 1) >>> 0;
    if (n) {
      const tz = 31 - Math.clz32(n & -n);
      if (tz < VOSS_ROWS) rows[tz] = r.gauss();
    }
    let s = r.gauss();
    for (let k = 0; k < VOSS_ROWS; k++) s += rows[k];
    return g * s;
  };
}

/** ベルベットノイズ（Karjalainen・Järveläinen 2007、Välimäki ら 2013）: 間隔 td の区間ごとに 1 つの ±1 のパルス */
function velvet(r: Rng, td: number, g: number): () => number {
  let n = 0,
    m = 0,
    k = Math.round(r.uni() * (td - 1)),
    sg = r.uni() < 0.5 ? -1 : 1;
  return () => {
    let y = 0;
    if (n === k) {
      y = sg * g;
      m++;
      k = Math.round(m * td + r.uni() * (td - 1));
      sg = r.uni() < 0.5 ? -1 : 1;
    }
    n++;
    return y;
  };
}

/**
 * LFSR: クロックごとにビット 0 を ±1（0 が +1）にして保持し、標本の間隔で平均する（区間の積分）。
 * 1 周期の平均 mu を引き、倍率 g を掛ける
 */
function lfsr(sp: Spec): () => number {
  const f = stepper(sp.lf),
    st = sp.step,
    { g, mu } = sp;
  let s = sp.lf.init >>> 0,
    o = s & 1 ? -1 : 1,
    ph = 0;
  return () => {
    let acc = 0,
      left = st;
    while (ph + left >= 1) {
      const d = 1 - ph;
      acc += o * d;
      left -= d;
      ph = 0;
      s = f(s);
      o = s & 1 ? -1 : 1;
    }
    acc += o * left;
    ph += left;
    return g * (acc / st - mu);
  };
}

/* ---------- 理論のスペクトル ---------- */
const OCT = 10 * Math.log10(2);
/** 目標の傾き（dB/oct）。一定でないもの（グレー・LFSR）は null */
export function slopeOf(k: Kind): number | null {
  return { wu: 0, wg: 0, velvet: 0, pink: -OCT, brown: -2 * OCT, blue: OCT, violet: 2 * OCT, gray: null, lfsr: null }[
    k
  ];
}

const sinc2 = (x: number) => (x === 0 ? 1 : (Math.sin(Math.PI * x) / (Math.PI * x)) ** 2);
/** Voss–McCartney の |H|²（行と白色の 1 行それぞれの分散を 1 とする） */
export function vossResp(f: number, fs: number): number {
  const w = (2 * Math.PI * f) / fs,
    s2 = Math.sin(w / 2) ** 2;
  let s = 1;
  for (let k = 0; k < VOSS_ROWS; k++) {
    const L = 2 ** (k + 1);
    s += Math.sin((L * w) / 2) ** 2 / s2 / L;
  }
  return s;
}

/**
 * 生成器が出す信号の片側のパワースペクトル密度の期待値を、AES17 の dBFS/Hz で（10 log₁₀ 2G(f)）。
 * LFSR は乱数の 2 値の列とみなした包絡（クロックの整数倍で零）
 */
export function psdDb(sp: Spec, f: number): number {
  const k = 4 / sp.fs;
  let v: number;
  if (sp.kind === 'wu' || sp.kind === 'wg') v = k * RMS * RMS;
  else if (sp.kind === 'velvet') v = (k * sp.g * sp.g) / sp.td;
  else if (sp.kind === 'lfsr')
    v = ((4 * sp.g * sp.g) / (sp.step * sp.fs)) * sinc2(f / (sp.step * sp.fs)) * sinc2(f / sp.fs);
  else if (sp.kind === 'pink' && sp.pm === 'voss') v = k * sp.g * sp.g * vossResp(f, sp.fs);
  else v = k * sp.g * sp.g * resp(sp.kind as Filtered, f, sp.fs);
  return 10 * Math.log10(v + 1e-30);
}

/** 参照線（理想の形）: 色は 1 kHz で生成器の値に合わせた直線（グレーは A 特性の逆数）、ほかは psdDb */
export function idealDb(sp: Spec, f: number): number {
  const s = slopeOf(sp.kind);
  if (sp.kind === 'gray') return psdDb(sp, 1000) + 20 * Math.log10(grayTarget(f) / grayTarget(1000));
  if (s === null || sp.kind === 'velvet' || sp.kind === 'wu' || sp.kind === 'wg') return psdDb(sp, f);
  return psdDb(sp, 1000) + s * Math.log2(f / 1000);
}
