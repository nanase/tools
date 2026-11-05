/**
 * 無限音階の音を作る（DOM に依存しない）。音の高さごとの音量（山）を固定し、オクターブ違いの音を同じ速さで動かす。
 * 音の高さはすべて A0（27.5 Hz）からのオクターブ数 x で表す。
 * 倍音の音量も倍音自身の高さで決めるので、どの音色でも山の両端で音量 0 のまま出入りする
 */

/** 図と音の高さの基準 [Hz] */
export const F_MIN = 27.5;
/** スペクトログラムの縦軸のオクターブ数（27.5 Hz〜14.08 kHz） */
export const N_OCT = 9;
/** 同時に持つオクターブの枠の数。山の幅の最大 9 と、倍音の分の余白を足した数より大きくする */
const SLOTS = 16;
/** 音量と周波数を更新する間隔 [標本] */
const BLOCK = 128;
/** 正弦波の表の長さ */
const TBL_N = 4096;
const TBL = new Float32Array(TBL_N + 1);
for (let i = 0; i <= TBL_N; i++) TBL[i] = Math.sin((2 * Math.PI * i) / TBL_N);

/** 和音: 根音からの半音の数 */
export const CHORDS = {
  single: { name: '単音', s: [0], suffix: '' },
  fifth: { name: '5度', s: [0, 7], suffix: '5' },
  major: { name: 'メジャー', s: [0, 4, 7], suffix: '' },
  minor: { name: 'マイナー', s: [0, 3, 7], suffix: 'm' },
  sus4: { name: 'sus4', s: [0, 5, 7], suffix: 'sus4' },
  seventh: { name: 'セブンス', s: [0, 4, 7, 10], suffix: '7' },
  maj7: { name: 'メジャーセブンス', s: [0, 4, 7, 11], suffix: 'M7' },
  min7: { name: 'マイナーセブンス', s: [0, 3, 7, 10], suffix: 'm7' },
  aug: { name: 'オーギュメント', s: [0, 4, 8], suffix: 'aug' },
  dim7: { name: 'ディミニッシュ', s: [0, 3, 6, 9], suffix: 'dim7' },
} as const;
export type ChordId = keyof typeof CHORDS;

/** 1 つの音の部分音: [基本周波数との比, 大きさ] */
type Partial = readonly [number, number];
const saw: Partial[] = Array.from({ length: 10 }, (_, i) => [i + 1, 1 / (i + 1)]);
/** 音色。弦楽は少しずらした 2 本ののこぎり波、鐘は整数倍から外れた部分音 */
export const TIMBRES = {
  sine: { name: '正弦波', p: [[1, 1]] as readonly Partial[] },
  tri: {
    name: '三角波',
    p: [
      [1, 1],
      [3, 1 / 9],
      [5, 1 / 25],
      [7, 1 / 49],
    ] as readonly Partial[],
  },
  saw: { name: 'のこぎり波', p: saw as readonly Partial[] },
  organ: {
    name: 'オルガン',
    p: [
      [1, 1],
      [2, 0.7],
      [3, 0.45],
      [4, 0.35],
      [6, 0.2],
      [8, 0.15],
    ] as readonly Partial[],
  },
  strings: {
    name: '弦楽',
    p: saw.slice(0, 8).flatMap(([h, a]): Partial[] => [
      [h * 0.9971, a * 0.72],
      [h * 1.0029, a * 0.72],
    ]) as readonly Partial[],
  },
  bell: {
    name: '鐘',
    p: [
      [1, 1],
      [2.01, 0.55],
      [2.76, 0.42],
      [4.07, 0.25],
      [5.4, 0.16],
    ] as readonly Partial[],
  },
} as const;
export type TimbreId = keyof typeof TIMBRES;
/** 部分音の数の最大 */
const MAX_P = 16;

/** 音の高さ x [オクターブ] での音量。中心 c・幅 w の余弦の山で、外は 0 */
export function envAt(x: number, c: number, w: number): number {
  const d = (x - c) / w;
  return Math.abs(d) >= 0.5 ? 0 : 0.5 + 0.5 * Math.cos(2 * Math.PI * d);
}
/** 周波数 [Hz] → 音の高さ [オクターブ] */
export const octOf = (f: number): number => Math.log2(f / F_MIN);
/** 音の高さ [オクターブ] → 周波数 [Hz] */
export const hzOf = (x: number): number => F_MIN * 2 ** x;

/** 根音の位置 [半音] を音名とセントにする。位置 0 が A */
const NOTE = ['A', 'A♯', 'B', 'C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯'];
export function noteOf(pos: number): { name: string; cent: number } {
  const r = Math.round(pos);
  return { name: NOTE[((r % 12) + 12) % 12], cent: Math.round((pos - r) * 100) };
}

export interface Voice {
  /** 高さ [オクターブ] */
  x: number;
  /** 音量（和音の重みは含まない） */
  a: number;
  /** 根音からの半音の数 */
  pc: number;
  /** 基本音か（倍音でないか） */
  fund: boolean;
  /** 同じ音を時刻をまたいで追うための番号 */
  id: number;
}

/** 音の動きと音色の状態。ワークレットは音を作り、画面は音を出す前の図に同じ計算を使う */
export class Shepard {
  /** 根音の位置 [半音]（増え続ける） */
  pos = 0;
  /** 今の速さ [半音/秒]（符号つき）。目標へなめらかに近づく */
  vel = 0;
  /** 目標の速さ [半音/秒] */
  rate = 1;
  /** 1 で上昇、-1 で下降 */
  dir: 1 | -1 = 1;
  /** 音程を動かしているか */
  moving = true;
  /** 半音ずつ動くか */
  stepped = false;
  /** 音を出すか */
  on = false;
  /** 山の中心 [オクターブ]・幅 [オクターブ] */
  center: number = N_OCT / 2;
  width: number = N_OCT;

  private gain = 0;
  private noteEnv = 1;
  private timbre: readonly Partial[] = TIMBRES.sine.p;
  private pending: readonly Partial[] | null = null;
  /** 12 の半音ごとの重みの目標と今の値（和音を替えるときに重みをなめらかに変える） */
  private readonly pcT = new Float32Array(12);
  private readonly pcW = new Float32Array(12);
  /** 音ごとの位相と音量。添字は (半音, オクターブの枠, 部分音) */
  private readonly ph = new Float64Array(12 * SLOTS * MAX_P);
  private readonly amp = new Float32Array(12 * SLOTS * MAX_P);
  private readonly lastF = new Float32Array(12 * SLOTS * MAX_P);
  private readonly used = new Uint8Array(12 * SLOTS * MAX_P);

  constructor(private readonly fs: number) {
    this.setChord(CHORDS.major.s);
    this.pcW.set(this.pcT);
  }

  /** 和音を半音の数の並びで与える */
  setChord(s: readonly number[]): void {
    this.pcT.fill(0);
    for (const v of s) this.pcT[((v % 12) + 12) % 12] = 1;
  }
  /** 音色を替える。鳴っている間は 1 度音を絞ってから替える */
  setTimbre(id: TimbreId): void {
    if (this.gain > 0.002) this.pending = TIMBRES[id].p;
    else {
      this.timbre = TIMBRES[id].p;
      this.pending = null;
      this.amp.fill(0);
    }
  }
  /** 鳴っている音が消え切ったか */
  get silent(): boolean {
    return !this.on && this.gain < 1e-4;
  }
  /** 音に使う根音の位置 [半音]。半音ずつのときは整数になる */
  shown(): number {
    return this.stepped ? Math.round(this.pos) : this.pos;
  }
  /** 今の音の開け閉め（半音ずつのとき、音の変わり目で 0）。pos の位置で求める */
  gate(pos = this.pos): number {
    if (!this.stepped || Math.abs(this.vel) <= 0.02) return 1;
    const fr = (pos - Math.round(pos)) * Math.sign(this.vel) + 0.5;
    return Math.max(0, Math.min(1, fr / 0.06, (1 - fr) / 0.14));
  }
  /** 位置を dt [s] 進める */
  advance(dt: number): void {
    const want = this.moving ? this.rate * this.dir : 0;
    this.vel += (want - this.vel) * Math.min(1, dt / 0.12);
    this.pos += this.vel * dt;
  }
  /** 音の大きさをそろえる倍率。和音の音の数・音色・山の幅によらず同じ大きさに聞こえるようにする */
  norm(): number {
    let pw = 0,
      cnt = 0;
    for (const q of this.timbre) pw += q[1] * q[1];
    for (let k = 0; k < 12; k++) cnt += this.pcT[k];
    return 0.42 / Math.sqrt(Math.max(1, cnt) * pw * (this.width / 3));
  }

  /** 位置 pos で鳴っている音の一覧 */
  voices(pos = this.shown()): Voice[] {
    const res: Voice[] = [],
      P = this.timbre,
      top = Math.log2(P[P.length - 1][0]),
      lo = this.center - this.width / 2,
      hi = lo + this.width;
    for (let k = 0; k < 12; k++) {
      if (!this.pcT[k]) continue;
      const xb = (pos + k) / 12;
      for (let oc = Math.ceil(lo - top - xb); xb + oc < hi; oc++) {
        const slot = ((oc % SLOTS) + SLOTS) % SLOTS;
        for (let h = 0; h < P.length; h++) {
          const x = xb + oc + Math.log2(P[h][0]),
            e = envAt(x, this.center, this.width);
          if (e > 0) res.push({ x, a: P[h][1] * e, pc: k, fund: P[h][0] === 1, id: (k * SLOTS + slot) * MAX_P + h });
        }
      }
    }
    return res;
  }

  /** out の先頭から n 標本を書く（先に 0 で埋めておかなくてよい） */
  render(out: Float32Array, n: number): void {
    out.fill(0, 0, n);
    const sr = this.fs,
      dtB = BLOCK / sr;
    for (let o = 0; o < n; o += BLOCK) {
      const len = Math.min(BLOCK, n - o);
      /* 音を止めている間は位置も進めない */
      if (this.on || this.gain > 1e-3) this.advance(dtB);
      if (this.pending && this.gain < 0.002) {
        this.timbre = this.pending;
        this.pending = null;
        this.amp.fill(0);
      }
      const want = this.pending || !this.on ? 0 : 1,
        g0 = this.gain,
        g1 = g0 + (want - g0) * Math.min(1, dtB / 0.015);
      this.gain = g1;
      const e0 = this.noteEnv,
        e1 = this.gate();
      this.noteEnv = e1;
      const kW = Math.min(1, dtB / 0.03);
      if (g0 < 1e-4 && g1 < 1e-4) {
        for (let k = 0; k < 12; k++) this.pcW[k] += (this.pcT[k] - this.pcW[k]) * kW;
        this.amp.fill(0);
        continue;
      }
      this.synth(out, o, len, kW);
      const nm = this.norm();
      for (let s = 0; s < len; s++) {
        const u = s / len;
        out[o + s] *= nm * (g0 + (g1 - g0) * u) * (e0 + (e1 - e0) * u);
      }
    }
    for (let i = 0; i < n; i++) out[i] = Math.tanh(out[i]);
  }

  /** 1 ブロック分の音を足す */
  private synth(out: Float32Array, o: number, len: number, kW: number): void {
    const P = this.timbre,
      nP = P.length,
      sr = this.fs,
      sh = this.shown(),
      top = Math.log2(P[nP - 1][0]),
      lo = this.center - this.width / 2,
      hi = lo + this.width,
      nyq = 0.45 * sr;
    this.pcW.forEach((w, k) => {
      this.pcW[k] = w + (this.pcT[k] - w) * kW;
    });
    /* 使わなくなった音の音量を 0 へ下げるため、毎回使った音に印を付ける */
    this.used.fill(0);
    for (let k = 0; k < 12; k++) {
      const w = this.pcW[k];
      if (w < 1e-4) continue;
      const xb = (sh + k) / 12;
      for (let oc = Math.ceil(lo - top - xb); xb + oc < hi; oc++) {
        const slot = ((oc % SLOTS) + SLOTS) % SLOTS,
          f = hzOf(xb + oc);
        for (let h = 0; h < nP; h++) {
          const i = (k * SLOTS + slot) * MAX_P + h,
            fh = f * P[h][0];
          /* ナイキスト周波数の近くで少しずつ消す。超えた音は位相を進めない */
          if (fh >= nyq) continue;
          const fade = Math.min(1, (nyq - fh) / (0.1 * sr)),
            a1 = w * P[h][1] * fade * envAt(xb + oc + Math.log2(P[h][0]), this.center, this.width),
            a0 = this.amp[i];
          this.used[i] = 1;
          this.amp[i] = a1;
          this.lastF[i] = fh;
          this.addSine(out, o, len, i, fh, a0, a1);
        }
      }
    }
    /* 山や和音から外れた音は、前の周波数のまま 1 ブロックで下げ切る */
    for (let i = 0; i < this.amp.length; i++) {
      if (this.used[i] || this.amp[i] === 0) continue;
      const a0 = this.amp[i];
      this.amp[i] = 0;
      this.addSine(out, o, len, i, this.lastF[i], a0, 0);
    }
  }

  private addSine(out: Float32Array, o: number, len: number, i: number, f: number, a0: number, a1: number): void {
    if (a0 < 1e-5 && a1 < 1e-5) return;
    let ph = this.ph[i];
    const inc = (f / this.fs) * TBL_N,
      da = (a1 - a0) / len;
    for (let s = 0; s < len; s++) {
      const j = ph | 0;
      out[o + s] += (a0 + da * s) * (TBL[j] + (TBL[j + 1] - TBL[j]) * (ph - j));
      ph += inc;
      if (ph >= TBL_N) ph -= TBL_N;
    }
    this.ph[i] = ph;
  }
}

/**
 * 残響のインパルス応答。t60 秒で 60 dB 減る雑音で、時間がたつほど高い音を減らす。全体のエネルギーを 1 にそろえる。
 * seed を変えると左右で別の雑音になる
 */
export function roomIr(fs: number, t60: number, seed: number): Float32Array {
  const n = Math.ceil(t60 * 1.15 * fs),
    x = new Float32Array(n),
    decay = 6.91 / t60;
  let s = seed >>> 0,
    lp = 0;
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const t = i / fs,
      b = 0.72 / (1 + (1.6 / t60) * t);
    lp += ((s / 4294967296) * 2 - 1 - lp) * b;
    x[i] = lp * Math.exp(-decay * t) * Math.min(1, i / (0.012 * fs));
  }
  let e = 0;
  for (let i = 0; i < n; i++) e += x[i] * x[i];
  const g = 1 / Math.sqrt(e);
  for (let i = 0; i < n; i++) x[i] *= g;
  return x;
}
