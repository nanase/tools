/**
 * 音高の追跡（DOM に依存しない）。入力の末尾の窓から音高の候補を求め（estimate）、
 * 直近の値の中央値で外れ値（倍音を基音と取り違えたフレーム）を除き、目標の音（最も近い音・最も近い弦）と
 * そこからのずれ [セント] を出す（Tracker）
 */
import { mpm, partial } from './mpm';
import { midiOf, nearestNote, nearestString } from './notes';

const pow2 = (n: number) => 2 ** Math.ceil(Math.log2(n));
/** MPM の窓の長さ: 探す最低音の 2.5 周期が入る 2 の累乗（2048 以上） */
export const mpmWin = (fs: number, fmin: number): number => Math.max(2048, pow2((2.5 * fs) / fmin));
/** 周波数を詰める窓の長さ: 音の 12 周期（前半・後半にそれぞれ 6 周期）が入る 2 の累乗 */
export const refWin = (fs: number, f: number): number => pow2((12 * fs) / f);

export interface EstOpts {
  fs: number;
  /** 探す周波数の範囲 [Hz] */
  fmin: number;
  fmax: number;
  /** 周波数を詰める窓の上限（標本）。これより長い窓が要る低い音は、MPM の値のまま */
  maxW: number;
  /** MPM のピークの選び方（いちばん高い山に対する比） */
  k?: number;
}
export interface Est {
  /** MPM の周波数 [Hz] */
  f: number;
  /** 明瞭度（0〜1） */
  clarity: number;
  /** 第 1〜3 部分音の周波数 [Hz] と振幅（位相で詰めたもの）。詰める窓が maxW を超える音では null */
  ps: { f: number; a: number }[] | null;
  /** 表示に使えるか。詰められる音なのに、出だしからまだ窓の長さが経っていない間は false */
  ready: boolean;
}

/**
 * 音が続いている間に、この半音数だけ跳んだ値は、倍音を基音と取り違えたものとして折り返す
 * （オクターブ・オクターブ＋5 度・2 オクターブ。低い弦の基音が減衰すると、上のオクターブに読みやすい）
 */
const JUMPS = [12, -12, 19, -19, 24, -24];
/** 1 オクターブ下の奇数倍の部分音が、偶数倍（MPM の周期の倍音）のこの比以上あれば、1 オクターブ下を基音とする */
const SUB = 0.2;
/** 半音数 d だけずれた周波数 f を、ref の近くへ折り返す（JUMPS のどれかに当たるとき） */
function fold(f: number, ref: number): number {
  const d = 12 * Math.log2(f / ref);
  if (Math.abs(d) <= 0.5) return f;
  for (const j of JUMPS) if (Math.abs(d - j) < 0.5) return f * 2 ** (-j / 12);
  return f;
}

/**
 * x の since 以降、end より前の標本から音高の候補を求める（since は音の出だしの直後。出だしより前の音や無音を窓に入れない）。
 * MPM で周期（オクターブ）を決め、その 1〜3 倍の部分音の周波数を位相の差で詰める。
 * hint は追っている音の周波数（Tracker.hint）。MPM が倍音に跳んだら hint の近くへ折り返してから詰める
 */
export function estimate(
  x: Float32Array | Float64Array,
  end: number,
  o: EstOpts,
  since = 0,
  hint: number | null = null,
): Est | null {
  const Wm = mpmWin(o.fs, o.fmin);
  if (end - since < Wm) return null;
  const r = mpm(x.subarray(end - Wm, end), o);
  if (!r) return null;
  let f = hint ? fold(r.f, hint) : r.f;
  /*
   * 追っている音がないときは、1 オクターブ下を確かめる: f/2 の奇数倍（f/2・3f/2）に部分音があれば、
   * MPM は基音の弱い音の第 2 倍音を周期に選んでいる（減衰した低い弦や、基音の弱いマイク）
   */
  if (!hint && f / 2 >= o.fmin) {
    const W2 = refWin(o.fs, f / 2);
    if (W2 <= o.maxW) {
      /* 確かめられる長さが経つまでは出さない（先に上のオクターブで出し始めないように） */
      if (W2 > end - since) return { f, clarity: r.clarity, ps: null, ready: false };
      const x2 = x.subarray(end - W2, end),
        odd = Math.max(partial(x2, f / 2, 1, o.fs).a, partial(x2, f / 2, 3, o.fs).a),
        even = Math.max(partial(x2, f / 2, 2, o.fs).a, partial(x2, f / 2, 4, o.fs).a);
      if (odd >= SUB * even) f /= 2;
    }
  }
  const Wr = refWin(o.fs, f);
  if (Wr > o.maxW) return { f, clarity: r.clarity, ps: null, ready: true };
  if (Wr > end - since) return { f, clarity: r.clarity, ps: null, ready: false };
  const xr = x.subarray(end - Wr, end);
  return { f, clarity: r.clarity, ps: [1, 2, 3].map((h) => partial(xr, f, h, o.fs)), ready: true };
}

/**
 * 2 次の Butterworth の高域通過（RBJ の式）。直流と、マイクや録音の低い揺れを除く
 * （直流が残ると NSDF が負にならず、MPM が周期の山を探し始められない）
 */
export class HighPass {
  private b0: number;
  private b1: number;
  private a1: number;
  private a2: number;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  constructor(fs: number, fc = 20) {
    const w = (2 * Math.PI * fc) / fs,
      al = Math.sin(w) / Math.SQRT2,
      c = Math.cos(w),
      a0 = 1 + al;
    this.b0 = (1 + c) / 2 / a0;
    this.b1 = -(1 + c) / a0;
    this.a1 = (-2 * c) / a0;
    this.a2 = (1 - al) / a0;
  }
  /** x[off, off + len) をその場で通す */
  process(x: Float32Array | Float64Array, off = 0, len = x.length - off): void {
    const { b0, b1, a1, a2 } = this;
    let { x1, x2, y1, y2 } = this;
    for (let i = off; i < off + len; i++) {
      const v = x[i],
        y = b0 * (v + x2) + b1 * x1 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = v;
      y2 = y1;
      y1 = y;
      x[i] = y;
    }
    Object.assign(this, { x1, x2, y1, y2 });
  }
}

/**
 * 音の出だしを見つける。5 ms ごとの平均の 2 乗が、直前 50 ms の最大の 4 倍（6 dB）を超え、gate を超えたら出だしとし、
 * その skip 秒後からを since（標本の番号）にする（撥弦の出だしの打撃音を窓に入れない）
 */
export class Onset {
  /** 使ってよい最初の標本の番号 */
  since = 0;
  private n = 0;
  private acc = 0;
  private cnt = 0;
  private hist: number[] = [];
  private readonly blk: number;
  private readonly skip: number;
  constructor(
    fs: number,
    /** 平均の 2 乗の下限（既定は実効値 −60 dBFS） */
    private gate = 1e-6,
    skip = 0.03,
  ) {
    this.blk = Math.round(0.005 * fs);
    this.skip = Math.round(skip * fs);
  }
  /** since が今から何標本前か（出だしの直後で、まだ使えない間は負） */
  get ago(): number {
    return this.n - this.since;
  }
  push(x: ArrayLike<number>, off = 0, len = x.length - off): void {
    for (let i = off; i < off + len; i++) {
      this.acc += x[i] * x[i];
      this.n++;
      if (++this.cnt < this.blk) continue;
      const e = this.acc / this.blk,
        prev = this.hist.length ? Math.max(...this.hist) : 0;
      if (e > this.gate && e > 4 * prev) this.since = this.n + this.skip;
      this.hist.push(e);
      if (this.hist.length > 10) this.hist.shift();
      this.acc = 0;
      this.cnt = 0;
    }
  }
}

export interface TrackOpts {
  /** 基準ピッチ（A4）[Hz] */
  a4: number;
  /** 弦の音番号（楽器を選んだとき）。null はクロマチック（12 音の最も近い音） */
  strs: readonly number[] | null;
  /** 弦を固定するときの添字（−1 は自動） */
  fix: number;
  /** 音律: ピッチクラスごとの平均律からのずれ [セント]（A を 0 にそろえる）。null は平均律 */
  dev: readonly number[] | null;
  /** 明瞭度がこれを下回るフレームは使わない */
  minClarity: number;
}
export interface Reading {
  /** 目標の音番号（整数） */
  tgt: number;
  /** 目標の弦の添字（クロマチックは −1） */
  si: number;
  /** 測った周波数 [Hz]（中央値） */
  f: number;
  /** 目標の周波数 [Hz]（基準ピッチと音律を含む） */
  ft: number;
  /** ずれ [セント] */
  cents: number;
  clarity: number;
  /** 周波数を詰めた部分音の番号（0 は MPM の値のまま） */
  h: number;
}

/** 直近 MED フレームの中央値を使う。音が途切れたら捨てる */
const MED = 5;
/** 音を出し始めるのに要るフレーム数。出し始めは、直近のその数のフレームが中央値から半音の半分以内にそろうのを待つ */
const MIN_N = 3;
/** 使えないフレームがこの数だけ続いたら、音が途切れたとする（減衰の終わりに明瞭度が一瞬下がっても、音を保つ） */
const GRACE = 4;
/**
 * 詰める部分音: 出し始めに、第 1〜3 部分音のうち、いちばん強いものの 1/10（−20 dB）以上ある最も低いものを選び、
 * 音が途切れるまで変えない（弦の非調和性や胴との結合で、部分音ごとに k 倍からのずれが違う。途中で替えると値が跳ぶ）。
 * 選んだ部分音がそれより弱くなったら、表示を止める（音は保つ）
 */
const WEAK = 0.1;

export class Tracker {
  private ns: number[] = [];
  /** 音を出しているか（出し始めの条件を満たしてから、途切れるまで） */
  private on = false;
  /** 続けて使えなかったフレームの数 */
  private miss = 0;
  /** 詰める部分音の番号（0 は未定、または MPM の値を使う） */
  private h = 0;
  /** 途切れる前の音（音番号、小数）。次の出だしで消す */
  private prev: number | null = null;
  private tgt: number | null = null;
  private si = -1;
  constructor(public o: TrackOpts) {}

  /**
   * 音が途切れた（無音・明瞭度が低い）。新しい音の出だし（Onset）では、前の音の名残（最も近い音・弦のヒステリシス）も消す
   * （前の音を鳴らしたまま次の音を弾いたとき、境目のヒステリシスで前の音に引き留めない）
   */
  reset(onset = false): void {
    if (this.on) this.prev = this.med();
    this.ns = [];
    this.on = false;
    this.h = 0;
    if (onset) {
      this.tgt = null;
      this.si = -1;
      this.prev = null;
    }
  }

  private med(): number {
    const s = [...this.ns].sort((a, b) => a - b);
    return s[s.length >> 1];
  }

  /**
   * 追っている音の周波数 [Hz]（estimate に渡す）。音が途切れても、次の出だしまでは途切れる前の音を返す
   * （減衰の終わりに一度途切れたあと、上のオクターブで読み直さないように）
   */
  hint(): number | null {
    const n = this.on ? this.med() : this.prev;
    return n == null ? null : this.o.a4 * 2 ** ((n - 69) / 12);
  }

  /** 1 フレーム進める。表示する値がなければ null */
  push(e: Est | null): Reading | null {
    const o = this.o;
    if (!e || e.clarity < o.minClarity) {
      if (++this.miss >= GRACE) this.reset();
      return null;
    }
    this.miss = 0;
    if (!e.ready) return null;
    let f = e.f;
    if (e.ps) {
      const top = Math.max(e.ps[0].a, e.ps[1].a, e.ps[2].a);
      if (!this.on || !this.h) this.h = e.ps.findIndex((p) => p.a >= WEAK * top) + 1;
      const p = e.ps[this.h - 1];
      if (p.a < WEAK * top) return null;
      f = p.f / this.h;
    }
    const h = this.hint();
    this.ns.push(midiOf(h ? fold(f, h) : f, o.a4));
    if (this.ns.length > MED) this.ns.shift();
    if (this.ns.length < MIN_N) return null;
    const n = this.med();
    if (!this.on) {
      if (this.ns.slice(-MIN_N).some((x) => Math.abs(x - n) > 0.5)) return null;
      this.on = true;
    }
    if (o.strs) {
      this.si = o.fix >= 0 && o.fix < o.strs.length ? o.fix : nearestString(n, o.strs, this.si);
      this.tgt = o.strs[this.si];
    } else {
      this.si = -1;
      this.tgt = nearestNote(n, this.tgt);
    }
    const tgt = this.tgt,
      dev = o.dev ? o.dev[((tgt % 12) + 12) % 12] : 0;
    return {
      tgt,
      si: this.si,
      f: o.a4 * 2 ** ((n - 69) / 12),
      ft: o.a4 * 2 ** ((tgt - 69) / 12 + dev / 1200),
      cents: 100 * (n - tgt) - dev,
      clarity: e.clarity,
      h: e.ps ? this.h : 0,
    };
  }
}
