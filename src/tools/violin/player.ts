/**
 * ヴァイオリンを鳴らす（DOM に依存しない）。弓は 1 本で、4 本の弦を同時に擦れる。音は続きから少しずつ作る。
 *  - 曲（perform.ts の音符の列）: 弓速と向きは全部の弦で共通。弓圧は、弓が触れている弦ごとに、その弦の Z0 と β から
 *    決める（Schelleng の上限の一定の割合）。β は、いちばん高い触れている弦で決め、ほかの弦は同じ弓速と音量の目安から
 *    その弦の範囲に収める。弓が触れる弦は、音符の出だしと終わりで 12 ms かけて移る（弦の移り）。弓を当てて始める音は
 *    15 ms 前から。弓を弦に付けたまま返すところは、弓速を 8 ms で下げて 10 ms で上げる。ビブラートは最も高い音の
 *    流れで決め、押さえている弦すべてに同じだけ掛ける（左手は 1 つ）
 *  - 曲の弓の使い方は前もって決める（Piece.plan）: 休み・和音の前・楽句の終わりで弓を離し、弓を離さずに続く
 *    ひと弾きの列が毛の長さに収まるよう、ひと弾きごとの弓速の倍率と始まりの位置を決める
 *  - 手で弾く: 選んだ弦を、決めた弓速・弓圧・β で擦る。弓の端に来たら返す
 *  - 摩擦は熱の模型（Woodhouse 2003）。曲では、二重の滑り（駒の力の第 2 倍音が基音を上回る）が続いたら、D・G 線は
 *    まず弓圧を最大 2 倍まで上げ、それでも直らなければ、その音の残りを摩擦曲線で鳴らす。音が乱れたら（周期的で
 *    なくなったら）弓圧を少し緩める
 *  - 弓速・弓圧・β には、ゆっくりした揺らぎ（時定数 0.05・0.3・1.5 s の和）を足す
 */
import { type BodySpec, makeBody, R_MIC, rng, stringDir } from './body';
import { BodyBank, BowedString } from './engine';
import { OPEN, type PolyPerf, type RNote } from './perform';
import { L0, noteHz, STRINGS, stringModes, z0Of } from './strings';

/** 弓の毛の長さ [m] */
export const HAIR = 0.65;

/**
 * 弦ごと（0 = E 線）の β の範囲と弓速の範囲 [m/s]。揺らぎ・松脂のむら・弓の返しを含めて走査し、
 * どの弓速でも乱れにくかった β を中心に選んだ（A 線 0.07〜0.1、D 線 0.1 前後、G 線 0.1〜0.13）
 */
const BETA_MIN = [0.12, 0.07, 0.09, 0.1],
  BETA_MAX = [0.135, 0.1, 0.11, 0.13],
  V_MIN = 0.22,
  V_MAX = 0.5,
  /* 開放弦（同じ走査を開放弦で。G 線は弓速 0.4 m/s 以上で乱れやすい） */
  OPEN_BMIN = [0.12, 0.07, 0.1, 0.115],
  OPEN_BMAX = [0.13, 0.1, 0.115, 0.13],
  OPEN_VMAX = [0.5, 0.5, 0.5, 0.35];
/**
 * 曲の弓の基準: 弓速 [m/s]・β・弓圧 ÷ Schelleng の上限（熱の模型・摩擦曲線へ移ったとき）、弦ごとの β の倍率・
 * 弓を当てて始めるときに弓速を上げる時間 [s]・弓速が遅い間の弓圧の下限（割合）。
 * 弓圧は初め 0.7・0.49 倍だったが、利用者の試聴でその 55 % にしたとき、シャコンヌを通して雑音が気にならなくなった
 */
const V0 = 0.33,
  B0 = 0.1,
  KT = 0.385,
  KC = 0.27,
  BETA_F = [1.3, 1, 1, 1.3],
  ACC = [0.08, 0.12, 0.12, 0.12],
  FLOOR = 0.2;
/** 二重の滑りの見張り: 弓圧を上げる上限の倍率と、摩擦曲線へ移るまでの時間 [s]（弦ごと） */
const DS_GAIN = [0, 0, 2, 2],
  DS_HOLD = [0.04, 0.04, 0.25, 0.25];
/** 曲の弓の揺らぎ（相対の標準偏差）: 弓速・弓圧・β、ひと弾きごとの弓圧・弓を上げる時間・弓速のばらつき */
const SV = 0.04,
  SF = 0.06,
  SB = 0.05,
  JF = 0.08,
  JA = 0.15,
  JV = 0.05;
/** 制御の値を変える刻み [標本] */
const CTL = 32;
/**
 * 乱れの見張り: 1 周期前との差の 2 乗の平均 ÷ 2 乗の平均がこれを超えたら乱れとみなし（−9 dB）、弓圧を下げる
 * （奏者が耳で聞いて弓圧を緩める代わり）。下げる倍率の下限・下げる時定数 [s]・戻す時定数 [s]・駒の力を覚えておく長さ [標本]。
 * シャコンヌの終わりの ff の和音で、乱れた音の雑音のエネルギーが 1.5〜2 dB 減った
 */
const RAUC = 0.12,
  RG_MIN = 0.75,
  RG_DOWN = 0.05,
  RG_UP = 0.3,
  RING = 4096;

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * x));
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

/** 時定数 0.05・0.3・1.5 s の OU 過程の和（分散 1）を、続きから作る */
class Fluct {
  private st = [0, 0, 0];
  private a: number[];
  private r: () => number;
  constructor(seed: number, fs: number) {
    this.r = rng(seed);
    this.a = [0.05, 0.3, 1.5].map((tau) => Math.exp(-1 / (tau * fs)));
  }
  fill(x: Float64Array, n: number): void {
    const { st, a, r } = this;
    for (let i = 0; i < n; i++) {
      let s2 = 0;
      for (let j = 0; j < 3; j++) {
        st[j] = a[j] * st[j] + Math.sqrt(1 - a[j] * a[j]) * gauss(r);
        s2 += st[j];
      }
      x[i] = s2 / Math.sqrt(3);
    }
  }
}

/** 左手のビブラートの設定 */
export interface Vib {
  on: boolean;
  /** 幅 [cent]（上下の全幅） */
  cent: number;
  hz: number;
}

/**
 * 曲のビブラート: 最も高い音の流れから続きで作る。長い音（0.3 s 以上）の、少し遅れてから掛け、終わりで弱める。
 * 値は音の高さのずれ [半音]
 */
class PieceVib {
  private ph = 0;
  private k = -1;
  private prm: { rate: number; width: number; delay: number }[];
  constructor(
    private notes: RNote[],
    private level: (t: number) => number,
    vib: Vib,
    seed: number,
    private fs: number,
  ) {
    const r = rng(seed + 7);
    this.prm = notes.map(() => ({
      rate: vib.hz * (1 + 0.04 * gauss(r)),
      width: (vib.on ? vib.cent : 0) * (0.9 + 0.2 * r()),
      delay: 0.08 + 0.1 * r(),
    }));
  }
  fill(out: Float64Array, i0: number, n: number): void {
    const notes = this.notes;
    for (let i = 0; i < n; i++) {
      const t = (i0 + i) / this.fs;
      while (this.k + 1 < notes.length && notes[this.k + 1].t <= t) {
        this.k++;
        if (!notes[this.k].slur) this.ph = Math.PI;
      }
      const k = this.k;
      if (k < 0) {
        out[i] = 0;
        continue;
      }
      const nt = notes[k],
        prev = k > 0 ? notes[k - 1] : null,
        next = k + 1 < notes.length ? notes[k + 1] : null,
        tn = t - nt.t,
        d = nt.d,
        slurIn = !!nt.slur && !!prev,
        slurOut = !!next?.slur && Math.abs(next.t - (nt.t + nt.d)) < 1e-3,
        open = Math.abs(nt.n - OPEN[nt.si]) < 0.01;
      let amp = 0,
        rate = this.prm[k].rate;
      if ((nt.vib ?? 1) > 0 && d >= 0.3 && !open && tn < d + 0.1) {
        const contIn = slurIn && prev && (prev.vib ?? 1) > 0 && prev.d >= 0.3,
          aIn = contIn ? 0.65 + 0.35 * smooth(tn / 0.15) : smooth((tn - this.prm[k].delay) / 0.3),
          te = Math.min(0.35, 0.4 * d),
          endQ = smooth((tn - (d - te)) / te),
          aOut = slurOut && !nt.end ? 1 - 0.35 * smooth((tn - (d - 0.12)) / 0.12) : 1 - 0.65 * endQ,
          rIn = contIn ? 1 : 0.88 + 0.12 * smooth(tn / 0.4),
          rOut = slurOut && !nt.end ? 1 : 1 - 0.12 * endQ;
        amp = (nt.vib ?? 1) * this.prm[k].width * 10 ** (this.level(t) / 60) * aIn * aOut;
        rate *= rIn * rOut * (1 + 0.05 * Math.min(1, tn / 2));
      }
      this.ph += (2 * Math.PI * rate) / this.fs;
      out[i] = (amp / 200) * Math.sin(this.ph);
    }
  }
}

/** ひと弾き: 弓を返す音（slur でない音）で始まり、同じ時刻に始まる音はまとめる */
interface Stroke {
  t0: number;
  t1: number;
  si: number;
  dir: number;
  g: number;
  a: number;
  v: number;
  /** 3 音以上の和音で始まる */
  chord: boolean;
  /** この前で弓を弦から離す（弓の位置を直せる） */
  lift: boolean;
  /** 弓速の倍率と、弓の位置の計画 [m]（毛の元から）: 始まり・終わり */
  k: number;
  p0: number;
  p1: number;
  /** 弓の動いた割合（始まり 0 → 終わり 1）の見積もり。PROF_DT ごと */
  prof: Float32Array;
  /** 前のひと弾きから・次のひと弾きへ、弓を弦に付けたまま返す */
  jin: boolean;
  jout: boolean;
  /** 弓速の下限 [m/s]（ふつうは V_MIN。弓の長さに収まらないひと弾きは V_LONG まで遅くして、1 回の弓で弾き切る） */
  vmin: number;
}

const bMin = (q: number, open: boolean) => (open ? OPEN_BMIN[q] : BETA_MIN[q]),
  bMax = (q: number, open: boolean) => (open ? OPEN_BMAX[q] : BETA_MAX[q]);
/**
 * ひと弾き s の、時刻 t の弓速の素 [m/s]（揺らぎと倍率を除く）と、弓速 ÷ β の目安（音量で決まる）。
 * cs はいちばん高い触れている弦、oc はその弦が開放弦か
 */
function strokeSpeed(s: Stroke, t: number, cs: number, oc: boolean, level: (t: number) => number) {
  const lv = level(Math.min(Math.max(t, s.t0), s.t1)),
    ratio = (V0 / B0) * 10 ** (lv / 20) * s.v,
    bPref = Math.min(bMax(cs, oc), Math.max(bMin(cs, oc), B0 * 10 ** (-lv / 40) * BETA_F[cs]));
  return { vs: Math.max(V_MIN, Math.min(oc ? OPEN_VMAX[cs] : V_MAX, ratio * bPref)), ratio };
}
/**
 * ひと弾き s の、時刻 t の弓速の形（0〜1）。弓を当てて始めるときはゆっくり上げ、弓を返すところでは短く下げて上げる。
 * 弓を離して終わるときは、動いたまま弦から離れる（弦は鳴り残る）
 */
function strokeShape(s: Stroke, t: number): number {
  const T = s.t1 - s.t0,
    up = smooth((t - s.t0) / Math.min(s.jin ? ACC_J : ACC[s.si] * s.a, 0.25 * T));
  if (t > s.t1) return 0;
  return s.jout ? up * smooth((s.t1 - t) / Math.min(DEC_J, 0.3 * T)) : up;
}

/**
 * 弓の位置の計画: 毛の両端に残す余裕 [m]・弓速を変えてよい倍率の範囲（乱れにくい弓速の範囲の内で）・
 * 弓を離して位置を直す時間の範囲 [s]・弓の動きの見積もりの刻み [s]
 */
const MARGIN = 0.03,
  KMIN = 0.7,
  KMAX = 1.15,
  LIFT_MIN = 0.04,
  LIFT_MAX = 0.1,
  PROF_DT = 0.01;
/**
 * 弓の長さに収まらないひと弾き（ロングトーン・長いスラー）の、弓速の下限 [m/s] と β の下限の倍率。
 * 途中で弓を返さずに 1 回の弓で弾き切るため、弓速をふつうの下限 V_MIN より遅くし、弓を駒へ寄せる（奏者と同じ）。
 * 弓圧は弓速 ÷ β に比例するので下がり、音は小さくなる。シャコンヌの最後の音（5.45 s）では、弓を返す弾き方
 * （0.39 m/s・β 0.1）より約 9.5 dB 小さい。駒へ寄せない（倍率 1）と雑音/全体が約 −23 dB、0.6 で約 −26 dB
 * （エクルズとアダージョの長い音も同じ傾向。scratchpad の測り方は p7-noise.ts と同じ）
 */
const V_LONG = 0.08,
  LONG_B = 0.6;
/**
 * 弓を返すところで、弓速を上げる時間・下げる時間 [s]。弓を離すときに弓圧を抜く時間 [s]。
 * 返すところの音の落ち込み（±40 ms の平均）は、25・20 ms では −2〜−3 dB（ロングトーンの最も深いところで
 * −12〜−24 dB）、10・8 ms で −1〜−1.8 dB（同じく −6〜−10 dB）。乱れた 20 ms の窓は 2.3 % から 2.6 % に増えた
 */
const ACC_J = 0.01,
  DEC_J = 0.008,
  LIFT_FADE = 0.04;
/**
 * 弓が弦に触れる・離れる時間 [s]: スラーで弦を移るとき（音の始まりを挟んで）、弓を返す・当てるとき（音の始まりの前）、
 * 音の終わり（終わりを挟んで）
 */
const SLUR_R = 0.012,
  ON_R = 0.015,
  OFF_R = 0.012;

/** 曲の音に、弓が触れ始める時刻 c0 と離れる時刻 c1 [s] を足したもの（ふつうは音の始まりと終わり） */
export type PNote = RNote & { c0: number; c1: number };
/** 弓が音 x の弦に触れている時間 [s]（触れ始めてから離れきるまで） */
export const touchSpan = (x: PNote): [number, number] => [x.c0 - (x.slur ? SLUR_R / 2 : ON_R), x.c1 + OFF_R / 2];
/**
 * 隣り合わない弦へ移るときは、前の弦から弓が離れきってから次の弦に触れるようにする（弓はまっすぐなので、
 * D 線と E 線のように間の弦をとばして 2 本に同時には触れない）。前の音の触れる時間を詰め、
 * 詰めきれなければ（前の音の半分まで）次の音の触れ始めを遅らせる。notes は始まりの順
 */
export function untangle(notes: PNote[]): void {
  for (let j = 1; j < notes.length; j++) {
    const x = notes[j];
    for (let i = j - 1; i >= Math.max(0, j - 64); i--) {
      const y = notes[i];
      if (Math.abs(y.si - x.si) < 2 || y.t >= x.t - 1e-6) continue;
      const ov = touchSpan(y)[1] - touchSpan(x)[0];
      if (ov <= 0) continue;
      const dy = Math.min(ov, Math.max(0, y.c1 - (y.c0 + y.t + y.d) / 2));
      y.c1 -= dy;
      x.c0 += ov - dy;
    }
  }
}

/** 曲の演奏の状態（時刻は曲の頭からの秒） */
class Piece {
  strokes: Stroke[] = [];
  readonly byS: PNote[][];
  readonly starts: number[][];
  readonly vib: PieceVib;
  readonly ptr = [0, 0, 0, 0];
  readonly lastPitch: number[] = [...OPEN];
  sj = 0;
  /** 弓の位置の表示で見ている、ひと弾きの番号 */
  pj = 0;
  constructor(
    readonly perf: PolyPerf,
    vib: Vib,
    seed: number,
    fs: number,
    fk: number,
  ) {
    const r = rng(seed),
      /* 弓を離す時間を作るために音を短くするので、写してから使う */
      notes: PNote[] = perf.notes.map((x) => ({ ...x, c0: 0, c1: 0 })).sort((a, b) => a.t - b.t);
    for (const nt of notes) {
      const cur = this.strokes[this.strokes.length - 1];
      if (!nt.slur && !(cur && Math.abs(cur.t0 - nt.t) < 1e-4)) {
        this.strokes.push({
          t0: nt.t,
          t1: nt.t + nt.d,
          si: nt.si,
          dir: 1,
          g: 1 + fk * JF * gauss(r),
          a: 1 + fk * JA * gauss(r),
          v: 1 + fk * JV * gauss(r),
          chord: !!nt.chord,
          lift: false,
          k: 1,
          p0: HAIR / 2,
          p1: HAIR / 2,
          prof: new Float32Array(0),
          jin: false,
          jout: false,
          vmin: V_MIN,
        });
      } else if (cur) {
        cur.t1 = Math.max(cur.t1, nt.t + nt.d);
        /* 同時に始まる音（重音・和音）は、高い弦をそのひと弾きの弦とする */
        if (!nt.slur) {
          cur.si = Math.min(cur.si, nt.si);
          if (nt.chord) cur.chord = true;
        }
      }
    }
    for (let j = 0; j + 1 < this.strokes.length; j++)
      this.strokes[j].t1 = Math.min(this.strokes[j].t1, this.strokes[j + 1].t0);
    this.byS = [0, 1, 2, 3].map((q) => notes.filter((x) => x.si === q));
    this.starts = this.byS.map((ns) => ns.map((x) => x.t));
    this.plan(notes, perf.level);
    for (const x of notes) {
      x.c0 = x.t;
      x.c1 = x.t + x.d;
    }
    untangle(notes);
    this.vib = new PieceVib(
      notes.filter((x) => x.lead),
      perf.level,
      vib,
      seed,
      fs,
    );
  }

  /**
   * 弓の使い方を決める（奏者が前もって考える弓の配分の代わり）。
   *  1. 弓を離すところ: 休み（前の音との間が空く）、3 音以上の和音の前、0.3 s 以上のひと弾きで終わる楽句の終わり。
   *     間が空いていなければ、前の音の終わりを縮めて離す時間（音の 1/4、0.04〜0.1 s）を作る
   *  2. 弓の長さに収まらないひと弾き（弓速を 0.7 倍にしても収まらない長い音・長いスラー）は、弓速を V_LONG まで落とし、
   *     弓を駒へ寄せて 1 回の弓で弾き切る。それでも収まらなければ、途中で弓を返して分ける
   *  3. 弓の向き: 下げ弓と上げ弓を交互に。弓を離して始める和音は下げ弓（続けて下げ弓なら弓を元へ戻す）
   *  4. 弓の位置: 弓を離さずに続くひと弾きの列が、毛の両端の余裕の内に収まるように、各ひと弾きの弓速の倍率
   *     （0.7〜1.15）と始まりの位置を決める（後ろから収まる位置の範囲を求め、前から選ぶ）。どうしても収まらなければ、
   *     そこで弓を離して位置を直す
   */
  private plan(notes: RNote[], level: (t: number) => number): void {
    const H1 = HAIR - MARGIN;
    /* いちばん高い触れている弦と、それが開放弦か（弓速の見積もり用） */
    const top = (t: number, s: Stroke): [number, boolean] => {
      for (let q = 0; q < 4; q++) {
        const ns = this.byS[q];
        let lo = 0,
          hi = ns.length - 1,
          k = -1;
        while (lo <= hi) {
          const m = (lo + hi) >> 1;
          if (ns[m].t - 0.015 <= t) {
            k = m;
            lo = m + 1;
          } else hi = m - 1;
        }
        if (k >= 0 && t < ns[k].t + ns[k].d + 0.007) return [q, Math.abs(ns[k].n - OPEN[q]) < 0.05];
      }
      return [s.si, false];
    };
    /*
     * ひと弾きの弓の長さの見積もり [m]（倍率 1、揺らぎなし）と、乱れにくい弓速の範囲に収まる長さの最小・最大
     * （倍率 KMIN〜KMAX のうち）。動いた割合も記録する
     */
    const est = (s: Stroke) => {
      const n = Math.max(1, Math.ceil((s.t1 - s.t0) / PROF_DT)),
        dt = (s.t1 - s.t0) / n,
        prof = new Float32Array(n + 1);
      let len = 0,
        kLo = s.vmin < V_MIN ? 0 : KMIN,
        kHi = KMAX;
      for (let i = 0; i < n; i++) {
        const t = s.t0 + (i + 0.5) * dt,
          [cs, oc] = top(t, s),
          v = strokeSpeed(s, t, cs, oc, level).vs;
        len += v * strokeShape(s, t) * dt;
        prof[i + 1] = len;
        kLo = Math.max(kLo, s.vmin / v);
        kHi = Math.min(kHi, (oc ? OPEN_VMAX[cs] : V_MAX) / v);
      }
      for (let i = 1; i <= n; i++) prof[i] = len > 0 ? prof[i] / len : i / n;
      s.prof = prof;
      return { len, lmin: len * Math.min(1, kLo), lmax: len * Math.max(1, kHi) };
    };
    /* 時刻 tb に終わる音（tb をまたいで続く音があれば null） */
    const endingAt = (tb: number): RNote[] | null => {
      let lo = 0,
        hi = notes.length;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (notes[m].t < tb - 1e-6) lo = m + 1;
        else hi = m;
      }
      const out: RNote[] = [];
      for (let i = lo - 1; i >= Math.max(0, lo - 64); i--) {
        const x = notes[i],
          e = x.t + x.d;
        if (Math.abs(e - tb) < 1e-6) out.push(x);
        else if (e > tb) return null;
      }
      return out;
    };
    /* ひと弾き s の終わりを縮めて、次のひと弾き nx との間に弓を離す時間を作る */
    const steal = (s: Stroke, nx: Stroke): boolean => {
      const ns = endingAt(nx.t0);
      if (!ns?.length) return false;
      const last = Math.max(...ns.map((x) => x.d)),
        tl = Math.min(0.5 * last, Math.max(LIFT_MIN, Math.min(LIFT_MAX, 0.25 * last)));
      for (const x of ns) x.d -= tl;
      s.t1 = nx.t0 - tl;
      nx.lift = true;
      s.jout = false;
      nx.jin = false;
      return true;
    };
    /* 1. 弓を離すところ */
    let S = this.strokes;
    if (!S.length) return;
    S[0].lift = true;
    for (let j = 1; j < S.length; j++) {
      const s = S[j],
        pv = S[j - 1];
      if (s.t0 - pv.t1 > 1e-6) s.lift = true;
      else if (s.chord || (pv.t1 - pv.t0 >= 0.3 && endingAt(s.t0)?.some((x) => x.end))) steal(pv, s);
    }
    /*
     * 2. 弓の長さに収まらないひと弾きは、まず弓速を V_LONG まで落として 1 回の弓に収める。それでも収まらなければ、
     *    途中で弓を返して分ける（分け目は近くの音の境目に寄せる）
     */
    const U = H1 - MARGIN,
      split: Stroke[] = [];
    for (const s of S) {
      if (est(s).lmin > 0.95 * U) s.vmin = V_LONG;
      const np = Math.ceil(est(s).lmin / (0.95 * U));
      if (np <= 1) {
        split.push(s);
        continue;
      }
      const T = s.t1 - s.t0;
      let t0 = s.t0;
      for (let q = 1; q <= np; q++) {
        let t1 = s.t1;
        if (q < np) {
          const ideal = s.t0 + (T * q) / np;
          let bd = (0.2 * T) / np;
          t1 = ideal;
          for (const x of notes)
            if (x.t > t0 + 0.1 && x.t < s.t1 - 0.1 && Math.abs(x.t - ideal) < bd) {
              bd = Math.abs(x.t - ideal);
              t1 = x.t;
            }
        }
        split.push({ ...s, t0, t1, chord: q === 1 && s.chord, lift: q === 1 && s.lift });
        t0 = t1;
      }
    }
    S = split;
    this.strokes = S;
    S.forEach((s, j) => {
      s.jin = j > 0 && !s.lift;
      s.jout = j + 1 < S.length && !S[j + 1].lift;
    });
    /* 3. 弓の向き */
    let d = -1;
    for (const s of S) {
      d = s.lift && s.chord ? 1 : -d;
      s.dir = d;
    }
    /* 4. 弓の位置: 後ろから、始まりの位置が取れる範囲 [lo, hi] を求める */
    const n = S.length,
      len = new Float64Array(n),
      lmin = new Float64Array(n),
      lmax = new Float64Array(n),
      lo = new Float64Array(n),
      hi = new Float64Array(n);
    const setLen = (k: number) => {
      const e = est(S[k]);
      len[k] = e.len;
      lmin[k] = e.lmin;
      lmax[k] = e.lmax;
    };
    const own = (k: number): [number, number] =>
      S[k].dir > 0 ? [MARGIN, Math.max(MARGIN, H1 - lmin[k])] : [Math.min(H1, MARGIN + lmin[k]), H1];
    for (let k = 0; k < n; k++) setLen(k);
    for (let k = n - 1; k >= 0; k--) {
      let [a, b] = own(k);
      if (k + 1 < n && !S[k + 1].lift) {
        const ca = Math.max(MARGIN, S[k].dir > 0 ? lo[k + 1] - lmax[k] : lo[k + 1] + lmin[k]),
          cb = Math.min(H1, S[k].dir > 0 ? hi[k + 1] - lmin[k] : hi[k + 1] + lmax[k]);
        if (ca <= cb) [a, b] = [ca, cb];
        else if (steal(S[k], S[k + 1])) {
          setLen(k);
          [a, b] = own(k);
        }
      }
      lo[k] = a;
      hi[k] = b;
    }
    /* 前から: 弓を離したあとは、和音（下げ弓）なら元の近く、ほかはひと弾きが弓の中ほどに来る位置から */
    let prev = HAIR / 2;
    for (let k = 0; k < n; k++) {
      const s = S[k],
        dk = s.dir,
        L0n = len[k];
      let p = prev;
      if (s.lift || p < lo[k] - 1e-6 || p > hi[k] + 1e-6) {
        const pref = s.chord && dk > 0 ? MARGIN + 0.03 : HAIR / 2 - (dk * L0n) / 2;
        p = Math.min(hi[k], Math.max(lo[k], pref));
      }
      const [ea, eb] = k + 1 < n && !S[k + 1].lift ? [lo[k + 1], hi[k + 1]] : [MARGIN, H1];
      let la = Math.max(lmin[k], dk > 0 ? ea - p : p - eb),
        lb = Math.min(lmax[k], dk > 0 ? eb - p : p - ea);
      if (la > lb + 1e-9) la = lb = Math.max(0, Math.min(lmax[k], dk > 0 ? H1 - p : p - MARGIN));
      const L = Math.max(0, Math.min(lb, Math.max(la, L0n)));
      s.k = L0n > 1e-9 ? L / L0n : 1;
      s.p0 = p;
      s.p1 = p + dk * L;
      prev = s.p1;
    }
  }

  /** 時刻 t の弓の位置 [m]（計画から。弓を離している間は、次のひと弾きの始まりへ動かす） */
  posAt(t: number): number {
    const S = this.strokes;
    if (!S.length) return HAIR / 2;
    while (this.pj + 1 < S.length && S[this.pj + 1].t0 <= t) this.pj++;
    while (this.pj > 0 && S[this.pj].t0 > t) this.pj--;
    const s = S[this.pj];
    if (t < s.t0) return s.p0;
    if (t <= s.t1) {
      const f = s.prof,
        n = f.length - 1,
        x = (n * (t - s.t0)) / Math.max(1e-9, s.t1 - s.t0),
        i = Math.min(n - 1, Math.floor(x)),
        u = n > 0 ? f[i] + (f[i + 1] - f[i]) * (x - i) : 1;
      return s.p0 + (s.p1 - s.p0) * u;
    }
    const nx = S[this.pj + 1];
    return nx ? s.p1 + (nx.p0 - s.p1) * smooth((t - s.t1) / Math.max(1e-6, nx.t0 - s.t1)) : s.p1;
  }
}

/** 手で弾くときの弓と左手 */
export interface Manual {
  /** 弓が触れる弦（0 = E 線 … 3 = G 線）。空なら弓を離す */
  strings: number[];
  /** 弦ごとに押さえる音の高さ（開放弦からの半音。0 = 開放弦） */
  stop: number[];
  /** 弓速 [m/s]・弓圧 [N]（全部の弦の和）・β（弓の位置 ÷ 弦の長さ） */
  v: number;
  F: number;
  beta: number;
  /** 弓の向き（1 = 下げ弓: 元から先へ、−1 = 上げ弓） */
  dir: number;
}

/** 表示に使う、ある時刻の状態 */
export interface Frame {
  /** 出力の標本の番号（この区切りの終わり） */
  at: number;
  /** 弓速 [m/s]（下げ弓が正）と、弓の毛の元から触れている点までの長さ [m] */
  vb: number;
  pos: number;
  /** 弦ごと: 弓が触れている割合・弓圧 [N]・β・音の高さ（MIDI）・弦の中ほどの振れ幅 [m]（全振幅の目安） */
  c: number[];
  f: number[];
  b: number[];
  n: number[];
  a: number[];
  /** 曲の位置 [拍]（曲でなければ null）と、曲が終わったか */
  beat: number | null;
  done: boolean;
}

/** 弦の上の押さえた指の位置などから、振動する長さ [m] */
const lenOf = (q: number, n: number) => L0 * 2 ** (-(n - OPEN[q]) / 12);

export class ViolinPlayer {
  private body;
  private bank: BodyBank;
  private readonly strings: BowedString[];
  private readonly dirs = [0, 1, 2, 3].map(stringDir);
  /** 弦ごとの調弦のずれ [セント] と、それに合わせた特性インピーダンス */
  private readonly tune = [0, 0, 0, 0];
  private readonly z0 = STRINGS.map((s) => z0Of(s));
  /** 出力した標本の数 */
  private n = 0;
  private piece: Piece | null = null;
  /** 曲の頭の標本の番号 */
  private p0 = 0;
  private man: Manual = { strings: [], stop: [0, 0, 0, 0], v: 0.3, F: 0.8, beta: 0.1, dir: 1 };
  private vib: Vib = { on: true, cent: 50, hz: 5.9 };
  /** 揺らぎの大きさの倍率 */
  private fk = 1;
  /** 曲の弓圧の倍率 */
  private press = 1;
  /** 手で弾く弓: 速度 [m/s]（向き付き）、毛の上の位置 [m]、いまの向き、触れている割合 */
  private mv = 0;
  private pos = 0.3;
  private mdir = 1;
  /** 弓を返している途中か（速く返す） */
  private mrev = false;
  private readonly mc = [0, 0, 0, 0];
  private mph = 0;
  private readonly fV: Fluct;
  private readonly fF: Fluct;
  private readonly fB: Fluct;
  /* 区切りごとの制御の値 */
  private W = 0;
  private vbW = new Float64Array(0);
  private vibW = new Float64Array(0);
  private nV = new Float64Array(0);
  private nF = new Float64Array(0);
  private nB = new Float64Array(0);
  private pitchW: Float64Array[] = [];
  private contW: Float64Array[] = [];
  private fW: Float64Array[] = [];
  private bW: Float64Array[] = [];
  private readonly vb = new Float64Array(CTL);
  private readonly fn = new Float64Array(CTL);
  private readonly fb = new Float64Array(CTL);
  private readonly fH = new Float64Array(CTL);
  private readonly fVv = new Float64Array(CTL);
  private readonly oL = new Float64Array(CTL);
  private readonly oR = new Float64Array(CTL);
  private readonly len = STRINGS.map(() => L0);
  private readonly used = [false, false, false, false];
  private readonly gain = [1, 1, 1, 1];
  private readonly ds = [0, 1, 2, 3].map(() => ({
    ph: 0,
    r1: 0,
    i1: 0,
    r2: 0,
    i2: 0,
    over: 0,
    fall: false,
    note: -1,
    /* 乱れの見張り: 駒の力の直前の値の輪・書く位置・2 乗の平均・1 周期前との差の 2 乗の平均・弓圧の倍率 */
    ring: new Float32Array(RING),
    w: 0,
    e: 0,
    a: 0,
    rg: 1,
  }));
  private readonly hPtr = [0, 0, 0, 0];
  /** 見張りが見ている、弦ごとのひと弾きの番号 */
  private readonly wj = [0, 0, 0, 0];
  /** 止める（すべて止める）ときの、弦ごとの音の倍率の減り（0 なら止めていない） */
  private readonly mute = [0, 0, 0, 0];
  private readonly muteG = [1, 1, 1, 1];
  /** 表示用: 弦ごとの駒の力の 2 乗の平均 [N²]、最後の制御の値 */
  private readonly env = [0, 0, 0, 0];
  private readonly quiet = [0, 0, 0, 0];
  private readonly lastF = [0, 0, 0, 0];
  private readonly lastB = [0.1, 0.1, 0.1, 0.1];
  private readonly lastN: number[] = [...OPEN];
  private bowPos = 0.3;
  /** 出力の倍率: 胴の模型の音圧は R_MIC 先の値なので、1 m 先の音圧 [Pa] に直す（音量の 0 dB で 1 Pa をフルスケールに） */
  gainOut = R_MIC;

  constructor(
    readonly fs: number,
    spec: BodySpec,
    seed = 5,
  ) {
    this.body = makeBody(spec);
    this.bank = new BodyBank(this.body, fs);
    this.strings = [0, 1, 2, 3].map(() => {
      const s = new BowedString(fs);
      s.friction = 'thermal';
      s.rough = 0.03;
      return s;
    });
    this.fV = new Fluct(seed + 101, fs);
    this.fF = new Fluct(seed + 202, fs);
    this.fB = new Fluct(seed + 303, fs);
  }

  /** 胴を入れ替える（鳴っている胴の振動は消える） */
  setBody(spec: BodySpec): void {
    this.body = makeBody(spec);
    this.bank = new BodyBank(this.body, this.fs);
    for (let q = 0; q < 4; q++) this.used[q] = false;
  }

  setVib(v: Vib): void {
    this.vib = { ...v };
  }

  /** 弦ごとの調弦のずれ [セント]（0 = E 線 … 3 = G 線）。開放弦の音の高さを、張力を変えてずらす */
  setTune(cent: readonly number[]): void {
    for (let q = 0; q < 4; q++) {
      this.tune[q] = cent[q] ?? 0;
      this.z0[q] = z0Of(STRINGS[q], this.tune[q]);
    }
  }
  /** 弦 q の、いまの振動する長さの第 1 部分音の目安 [Hz]（曲げの硬さと駒との結合を除く） */
  private f0(q: number): number {
    return (noteHz(OPEN[q]) * 2 ** (this.tune[q] / 1200) * L0) / this.len[q];
  }

  /** 揺らぎの大きさの倍率（1 が標準）、松脂のむら（摩擦係数の相対の標準偏差）、曲の弓圧の倍率（1 が標準） */
  setFeel(fluct: number, rough: number, press = 1): void {
    this.fk = fluct;
    this.press = press;
    for (const s of this.strings) s.rough = rough;
  }

  /** 手で弾く弓と左手を変える。弦を新しく擦り始めるときは、決めた向きから始める */
  setManual(m: Manual): void {
    const was = this.man.strings.length > 0;
    if (!was && m.strings.length) {
      this.mdir = m.dir;
      this.stopPiece();
    } else if (m.dir !== this.man.dir) {
      this.mdir = m.dir;
      this.mrev = true;
    }
    this.man = { ...m, strings: [...m.strings], stop: [...m.stop] };
  }

  /** 曲を始める（at は曲の頭からの時刻 [s]。途中から続けるとき） */
  play(perf: PolyPerf, seed = 5, at = 0): void {
    this.man = { ...this.man, strings: [] };
    this.mv = 0;
    this.piece = new Piece(perf, this.vib, seed, this.fs, this.fk);
    this.p0 = this.n - Math.round(at * this.fs);
    /* 途中から始めるときは、それより前のひと弾きと音符を飛ばす */
    const pc = this.piece;
    for (let q = 0; q < 4; q++) {
      const ns = pc.byS[q];
      while (pc.ptr[q] + 1 < ns.length && ns[pc.ptr[q] + 1].t <= at) pc.ptr[q]++;
    }
    while (pc.sj < pc.strokes.length && pc.strokes[pc.sj].t1 + 0.08 < at) pc.sj++;
    for (let q = 0; q < 4; q++) {
      this.ds[q].note = -1;
      this.wj[q] = 0;
    }
  }

  /** 作った標本の数 */
  get count(): number {
    return this.n;
  }

  /** 演奏中の曲の弓の使い方（ひと弾きごと。確かめる用） */
  get strokes(): readonly Readonly<Omit<Stroke, 'prof'>>[] {
    return this.piece?.strokes ?? [];
  }

  /** 曲の位置 [s]（曲でなければ null） */
  pieceTime(): number | null {
    return this.piece ? (this.n - this.p0) / this.fs : null;
  }

  /** 曲をやめる（弓を離し、弦は鳴り残る） */
  stopPiece(): void {
    if (!this.piece) return;
    this.piece = null;
    for (let q = 0; q < 4; q++) {
      const d = this.ds[q];
      if (d.fall) {
        d.fall = false;
        this.strings[q].friction = 'thermal';
      }
      d.rg = 1;
      this.gain[q] = 1;
    }
  }

  /** すべての弦を止める（手のひらで弦に触れる）。弓も離す */
  muteAll(): void {
    this.stopPiece();
    this.man = { ...this.man, strings: [] };
    for (let q = 0; q < 4; q++) if (this.used[q]) this.mute[q] = 1;
  }

  /** 曲の制御の値（区切り [w0, w0 + wn) の標本。w0 は出力の標本の番号） */
  private pieceControls(pc: Piece, w0: number, wn: number): void {
    const fs = this.fs,
      { byS, strokes, ptr, lastPitch } = pc,
      tOf = (i: number) => (w0 - this.p0 + i) / fs,
      level = pc.perf.level;
    pc.vib.fill(this.vibW, w0 - this.p0, wn);
    /* 弦ごとの音の高さと、弓が触れている割合 */
    for (let q = 0; q < 4; q++) {
      const ns = byS[q],
        pw = this.pitchW[q],
        cw = this.contW[q];
      for (let i = 0; i < wn; i++) {
        const t = tOf(i);
        /* 次の音へ: その時刻になったら。前の音が終わっていれば 20 ms 前から（弓が先に触れるため） */
        while (
          ptr[q] + 1 < ns.length &&
          (ns[ptr[q] + 1].t <= t || (ns[ptr[q] + 1].t - 0.02 <= t && t >= ns[ptr[q]].t + ns[ptr[q]].d))
        )
          ptr[q]++;
        const j = ptr[q];
        let p = lastPitch[q],
          c = 0;
        /* 近くの音符（前・いま・次）から、触れている割合と音の高さ */
        for (let jj = Math.max(0, j - 1); jj <= Math.min(ns.length - 1, j + 1); jj++) {
          const nt = ns[jj],
            pv = jj > 0 ? ns[jj - 1] : null,
            nx = jj + 1 < ns.length ? ns[jj + 1] : null,
            joinPrev = !!pv && Math.abs(pv.t + pv.d - nt.t) < 1e-3,
            joinNext = !!nx && Math.abs(nt.t + nt.d - nx.t) < 1e-3,
            on = joinPrev ? 1 : nt.slur ? smooth((t - nt.c0 + SLUR_R / 2) / SLUR_R) : smooth((t - nt.c0 + ON_R) / ON_R),
            off = joinNext ? 1 : smooth((nt.c1 + OFF_R / 2 - t) / OFF_R),
            e = t > nt.c0 - Math.max(ON_R, SLUR_R / 2) - 0.001 && t < nt.c1 + OFF_R / 2 + 0.001 ? on * off : 0;
          if (e > c) c = e;
        }
        const nt = ns[j];
        if (nt && t >= nt.t - 0.02) {
          const pv = j > 0 ? ns[j - 1] : null,
            tn = t - nt.t;
          p = nt.n;
          if (pv && Math.abs(pv.t + pv.d - nt.t) < 1e-3 && tn >= 0) {
            const gl = nt.slur ? (nt.glide ?? 0.03) : 0.01;
            if (tn < gl) p = pv.n + (nt.n - pv.n) * smooth(tn / gl);
          }
          if (nt.n - OPEN[q] > 0.01 && (nt.vib ?? 1) > 0) p += this.vibW[i];
          lastPitch[q] = nt.n;
        }
        pw[i] = p;
        cw[i] = c;
      }
    }
    /* ひと弾きごとの弓速・β・弓圧の素 */
    while (pc.sj > 0 && strokes[pc.sj - 1].t1 + 0.08 > tOf(0)) pc.sj--;
    for (let j = pc.sj; j < strokes.length; j++) {
      const s = strokes[j];
      if (s.t0 - 0.03 >= tOf(wn)) break;
      if (s.t1 + 0.08 < tOf(0)) {
        pc.sj = j + 1;
        continue;
      }
      const a = Math.max(0, Math.floor((s.t0 - 0.03) * fs) - (w0 - this.p0)),
        b = Math.min(wn, Math.ceil((s.t1 + 0.08) * fs) - (w0 - this.p0));
      for (let i = a; i < b; i++) {
        const t = tOf(i);
        let cs = -1;
        for (let q = 0; q < 4; q++)
          if (this.contW[q][i] > 0) {
            cs = q;
            break;
          }
        if (cs < 0) cs = s.si;
        /*
         * 弓速は、弓の位置の計画で決めた倍率を掛ける（弓の長さに収めるため）。ただし乱れにくい弓速の範囲
         * （V_MIN〜弦ごとの上限）からは出さない
         */
        const oc = Math.abs(this.pitchW[cs][i] - OPEN[cs]) < 0.05,
          sp = strokeSpeed(s, t, cs, oc, level),
          ratio = sp.ratio,
          vs =
            Math.min(Math.max(sp.vs, oc ? OPEN_VMAX[cs] : V_MAX), Math.max(Math.min(sp.vs, s.vmin), sp.vs * s.k)) *
            (1 + SV * this.nV[i]),
          w = strokeShape(s, t),
          /* 弓を当てる（15 ms 前から）・弓を離す（動いたまま、終わりの LIFT_FADE で弓圧を抜く） */
          on = s.jin ? 1 : smooth((t - s.t0 + 0.015) / 0.015),
          off = s.jout ? 1 : smooth((s.t1 - t) / LIFT_FADE),
          u = on * off * Math.max(FLOOR, w) * s.g * (1 + SF * this.nF[i]),
          inside = t >= s.t0 && t < s.t1;
        this.vbW[i] += s.dir * vs * w;
        for (let q = 0; q < 4; q++) {
          const c = this.contW[q][i];
          if (c <= 0) continue;
          /*
           * 重音・和音の下の弦は、β を 0.1 より小さくしない（強く鳴らしすぎると多重の滑りに落ちやすい）。
           * 弓速を V_MIN より落とすひと弾きは、β の下限も LONG_B 倍まで下げる（弓を駒へ寄せる）
           */
          const oq = Math.abs(this.pitchW[q][i] - OPEN[q]) < 0.05,
            beta = Math.min(
              bMax(q, oq),
              Math.max(
                bMin(q, oq) * (s.vmin < V_MIN ? LONG_B : 1),
                q > cs ? 0.1 : 0,
                (vs / ratio) * (1 + SB * this.nB[i]),
              ),
            ),
            /* 弓圧 [N] = Schelleng の上限 2 Z0 v / (β (μs − μd)) の KT 倍（μs − μd ≈ 0.85）に、利用者の決めた倍率を掛ける */
            f = (this.press * KT * 2 * this.z0[q] * u * c * (vs / beta)) / 0.85;
          if (f > this.fW[q][i]) this.fW[q][i] = f;
          if (inside) this.bW[q][i] = beta;
        }
      }
    }
  }

  /** 手で弾くときの制御の値 */
  private manualControls(wn: number): void {
    const fs = this.fs,
      m = this.man,
      bowing = m.strings.length > 0,
      acc = 0.08,
      /* 弓の端の手前で止まれるように減らし始める（減らす時間 0.06 s で止まる距離） */
      stopDist = Math.abs(this.mv) * 0.06 * 0.6 + 0.01,
      vib = this.vib,
      dph = (2 * Math.PI * vib.hz) / fs;
    for (let i = 0; i < wn; i++) {
      /* 弓速: 向きの目標へ、加速 acc 秒で近づける。弓の端に来たら返す */
      let target = bowing ? this.mdir * m.v : 0;
      if (bowing && ((this.mdir > 0 && this.pos > HAIR - stopDist) || (this.mdir < 0 && this.pos < stopDist))) {
        this.mdir = -this.mdir;
        this.mrev = true;
        target = this.mdir * m.v;
      }
      /* 弓を返すときは、曲と同じく短く（下げて上げるまで約 20 ms） */
      const rate = m.v / (bowing ? (this.mrev ? 0.5 * (ACC_J + DEC_J) : acc) : 0.05) / fs;
      if (this.mv < target) this.mv = Math.min(target, this.mv + rate);
      else this.mv = Math.max(target, this.mv - rate);
      if (this.mv === target) this.mrev = false;
      this.pos = Math.min(HAIR, Math.max(0, this.pos + this.mv / fs));
      this.vbW[i] = this.mv * (1 + 0.5 * SV * this.nV[i]);
      this.mph += dph;
      const vw = vib.on ? (vib.cent / 200) * Math.sin(this.mph) : 0;
      /* 隣り合わない弦へ移るときは、前の弦から弓が離れきってから触れる（離すのは 15 ms で直線に） */
      for (let q = 0; q < 4; q++) {
        let on = m.strings.includes(q);
        for (let r = 0; r < 4 && on; r++)
          if (Math.abs(r - q) >= 2 && this.mc[r] > 0 && !m.strings.includes(r)) on = false;
        if (on) this.mc[q] += (1 - this.mc[q]) / (0.015 * fs);
        else this.mc[q] = Math.max(0, this.mc[q] - 1 / (0.015 * fs));
        const c = this.mc[q];
        this.contW[q][i] = c;
        this.pitchW[q][i] = OPEN[q] + m.stop[q] + (m.stop[q] > 0 ? vw : 0);
        /* 弓圧は触れている弦で分ける。弓が止まりかけると弱める（弓を返すとき） */
        const share = m.strings.length ? m.F / m.strings.length : 0,
          vr = m.v > 0 ? Math.min(1, Math.abs(this.mv) / m.v) : 0;
        this.fW[q][i] = c * share * (0.3 + 0.7 * vr) * (1 + 0.5 * SF * this.nF[i]);
        this.bW[q][i] = m.beta * (1 + 0.5 * SB * this.nB[i]);
      }
    }
  }

  private alloc(n: number): void {
    if (this.W >= n) return;
    this.W = n;
    const f = () => new Float64Array(n);
    this.vbW = f();
    this.vibW = f();
    this.nV = f();
    this.nF = f();
    this.nB = f();
    this.pitchW = [0, 1, 2, 3].map(f);
    this.contW = [0, 1, 2, 3].map(f);
    this.fW = [0, 1, 2, 3].map(f);
    this.bW = [0, 1, 2, 3].map(f);
  }

  /** wn 標本を作って L・R に書く（off から）。表示用の状態を返す */
  render(L: Float32Array, R: Float32Array, off: number, wn: number): Frame {
    this.alloc(wn);
    const fs = this.fs,
      w0 = this.n,
      pc = this.piece;
    this.vbW.fill(0, 0, wn);
    for (let q = 0; q < 4; q++) {
      this.fW[q].fill(0, 0, wn);
      this.bW[q].fill(B0, 0, wn);
      this.contW[q].fill(0, 0, wn);
    }
    this.fV.fill(this.nV, wn);
    this.fF.fill(this.nF, wn);
    this.fB.fill(this.nB, wn);
    if (this.fk !== 1)
      for (let i = 0; i < wn; i++) {
        this.nV[i] *= this.fk;
        this.nF[i] *= this.fk;
        this.nB[i] *= this.fk;
      }
    if (pc) this.pieceControls(pc, w0, wn);
    else this.manualControls(wn);

    /* 鳴らす */
    const { vb, fn, fb, fH, fVv, oL, oR, strings, len, used, gain } = this;
    for (let p = 0; p < wn; p += CTL) {
      const m = Math.min(CTL, wn - p);
      fH.fill(0);
      fVv.fill(0);
      for (let i = 0; i < m; i++) vb[i] = this.vbW[p + i];
      for (let q = 0; q < 4; q++) {
        const touching = this.fW[q][p] > 0 || this.fW[q][p + m - 1] > 0;
        if (touching) {
          len[q] = lenOf(q, this.pitchW[q][p + (m >> 1)]);
          used[q] = true;
          this.mute[q] = 0;
          this.muteG[q] = 1;
        }
        if (!used[q]) continue;
        const s = strings[q],
          open = len[q] > L0 * 0.999,
          beta = this.bW[q][p],
          f0 = this.f0(q),
          os = Math.max(1, Math.min(10, Math.ceil((24 * f0) / (beta * fs))));
        if (touching)
          s.set(
            stringModes(q, len[q], Math.min(21600, 0.45 * fs), open ? 0 : 1, this.body, this.tune[q]),
            beta * len[q],
            true,
            os,
          );
        /*
         * 摩擦曲線へ移った弦は、弓圧を上限の KC 倍にする（熱の模型より乱れやすいので低く）。熱の模型で上げた弓圧の倍率は
         * 掛けない（掛けると上限に近づき、音が割れる）
         */
        const kf = (pc && s.friction === 'curve' ? KC / KT : gain[q]) * (pc ? this.ds[q].rg : 1);
        for (let i = 0; i < m; i++) fn[i] = touching ? kf * this.fW[q][p + i] : 0;
        s.process(vb, fn, fb, 0, m);
        if (pc) this.watch(q, pc, (w0 - this.p0 + p) / fs, f0, m, touching);
        /* すべて止める: 80 ms で弦の音を消してから、弦を止める */
        if (this.mute[q]) {
          for (let i = 0; i < m; i++) {
            this.muteG[q] = Math.max(0, this.muteG[q] - 1 / (0.08 * fs));
            fb[i] *= this.muteG[q];
          }
          if (this.muteG[q] <= 0) {
            s.clear();
            used[q] = false;
            this.mute[q] = 0;
            this.muteG[q] = 1;
            this.env[q] = 0;
          }
        }
        /* 駒の力の 2 乗の平均（時定数 50 ms） */
        const dk = Math.exp(-m / (0.05 * fs));
        let ss = 0;
        for (let i = 0; i < m; i++) {
          ss += fb[i] * fb[i];
          fH[i] += this.dirs[q][0] * fb[i];
          fVv[i] += this.dirs[q][1] * fb[i];
        }
        const e = dk * this.env[q] + (1 - dk) * (ss / m);
        this.env[q] = e;
        /* 鳴り終えた弦は止めて、計算を休む */
        this.quiet[q] = !touching && e < 1e-10 ? this.quiet[q] + m : 0;
        if (this.quiet[q] > fs) {
          s.clear();
          used[q] = false;
          this.env[q] = 0;
        }
        this.lastF[q] = fn[m - 1];
        this.lastB[q] = beta;
        this.lastN[q] = this.pitchW[q][p + m - 1];
      }
      this.bank.process(fH, fVv, oL, oR, 0, m);
      for (let i = 0; i < m; i++) {
        L[off + p + i] = oL[i] * this.gainOut;
        R[off + p + i] = oR[i] * this.gainOut;
      }
    }
    /* 弓の位置（曲では弓の使い方の計画から） */
    this.bowPos = pc ? pc.posAt((w0 + wn - this.p0) / fs) : this.pos;
    this.n += wn;
    let beat: number | null = null,
      done = false;
    if (pc) {
      const t = (this.n - this.p0) / fs;
      beat = pc.perf.beat(t);
      if (t > pc.perf.end + 0.3) {
        done = true;
        this.stopPiece();
      }
    }
    const last = wn - 1;
    return {
      at: this.n,
      vb: this.vbW[last],
      pos: this.bowPos,
      c: [0, 1, 2, 3].map((q) => this.contW[q][last]),
      f: [...this.lastF],
      b: [...this.lastB],
      n: [...this.lastN],
      /*
       * 弦の中ほどの全振幅 ≈ 駒の力の山 ÷ (4 Z0 f)（Helmholtz の運動で、駒の力の山 Z0 v/β と中ほどの全振幅 v T/(4β) から）。
       * 駒の力の山は、のこぎり波として 2 乗の平均から √3 倍で求める
       */
      a: [0, 1, 2, 3].map((q) => Math.sqrt(3 * this.env[q]) / (4 * this.z0[q] * this.f0(q))),
      beat,
      done,
    };
  }

  /**
   * 二重の滑りの見張り: 駒の力の基音と第 2 倍音を、時定数 30 ms でならした複素振幅で追う。弓が動いていて、
   * 音の始まりから 80 ms より後に、第 2 倍音が基音を続けて上回ったら、D・G 線はまず弓圧を上げ、
   * それでも直らなければ、その音の残りを摩擦曲線（二重の滑りに落ちない）で鳴らす。この弦で次の音が始まったら熱の模型に戻す
   */
  private watch(q: number, pc: Piece, tNow: number, f0: number, m: number, touching: boolean): void {
    const d = this.ds[q],
      s = this.strings[q],
      st = pc.starts[q],
      fs = this.fs,
      fb = this.fb;
    while (this.hPtr[q] + 1 < st.length && st[this.hPtr[q] + 1] <= tNow) this.hPtr[q]++;
    while (this.hPtr[q] > 0 && st[this.hPtr[q]] > tNow) this.hPtr[q]--;
    const ni = st.length && st[this.hPtr[q]] <= tNow ? this.hPtr[q] : -1;
    if (ni !== d.note) {
      d.note = ni;
      d.over = 0;
      if (d.fall) {
        d.fall = false;
        s.friction = 'thermal';
        s.heat.reset();
      }
    }
    const w1 = (2 * Math.PI * f0) / fs,
      al = 1 / (0.03 * fs),
      al2 = 1 / (0.015 * fs),
      T = Math.min(RING - 2, fs / f0),
      ring = d.ring;
    for (let i = 0; i < m; i++) {
      d.ph += w1;
      if (d.ph > 2 * Math.PI) d.ph -= 2 * Math.PI;
      const c1 = Math.cos(d.ph),
        s1 = Math.sin(d.ph),
        c2 = c1 * c1 - s1 * s1,
        s2 = 2 * s1 * c1,
        x = fb[i];
      d.r1 += al * (x * c1 - d.r1);
      d.i1 += al * (x * s1 - d.i1);
      d.r2 += al * (x * c2 - d.r2);
      d.i2 += al * (x * s2 - d.i2);
      /* 1 周期前の値（直線で補間）との差 */
      ring[d.w] = x;
      const j = d.w - T + RING,
        k = Math.floor(j),
        fr = j - k,
        xd = (1 - fr) * ring[k % RING] + fr * ring[(k + 1) % RING],
        dd = x - xd;
      d.w = (d.w + 1) % RING;
      d.e += al2 * (x * x - d.e);
      d.a += al2 * (0.5 * dd * dd - d.a);
    }
    /* 弓を返した直後も音の始まりと同じに扱う（返すと駒の力の向きが逆になり、1 周期前との差が大きく出る） */
    const S = pc.strokes;
    while (this.wj[q] + 1 < S.length && S[this.wj[q] + 1].t0 <= tNow) this.wj[q]++;
    while (this.wj[q] > 0 && S[this.wj[q]].t0 > tNow) this.wj[q]--;
    const tS = S.length && S[this.wj[q]].t0 <= tNow ? tNow - S[this.wj[q]].t0 : Infinity,
      tIn = ni >= 0 ? Math.min(tS, tNow - st[ni]) : 0,
      moving = touching && Math.abs(this.vb[0]) > 0.5 * (S[this.wj[q]]?.vmin ?? V_MIN),
      /* 乱れ（周期的でない）と、二重の滑り（周期的で、第 2 倍音が基音を上回る） */
      rauc = moving && tIn > 0.06 && d.a > RAUC * d.e,
      dbl = moving && !rauc && tIn > 0.08 && Math.hypot(d.r2, d.i2) > Math.hypot(d.r1, d.i1);
    d.over = dbl ? d.over + m / fs : 0;
    /* 乱れたら弓圧を下げる（Schelleng の上限に近すぎて乱れることが多い）。乱れが収まったら戻す */
    if (rauc) d.rg = Math.max(RG_MIN, d.rg * (1 - m / fs / RG_DOWN));
    else d.rg += (1 - d.rg) * (m / fs / RG_UP);
    const dg = DS_GAIN[q];
    if (!d.fall && dg) {
      if (dbl) this.gain[q] = Math.min(dg, this.gain[q] * (1 + m / fs / 0.05));
      else this.gain[q] += (1 - this.gain[q]) * (m / fs / 0.3);
    }
    if (!d.fall && d.over > DS_HOLD[q]) {
      d.fall = true;
      s.friction = 'curve';
    }
  }
}
