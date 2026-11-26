/**
 * 表示の形（DOM に依存しない）: 針のメータの目盛り・合格の帯・針と、12 音のストロボの帯の縞。
 * メータは viewBox 600 × 236、針の軸は図の下の外（300, 300）。目盛りの半径は MR、1 セントは 50/目盛りの端 度
 */

export const MR = 245;
const CX = 300,
  CY = 300;
const f1 = (v: number) => v.toFixed(1);
/** 軸から半径 r・角度 a [度]（上が 0、右が正）の点 */
const P = (r: number, a: number) => {
  const t = (a * Math.PI) / 180;
  return `${f1(CX + r * Math.sin(t))} ${f1(CY - r * Math.cos(t))}`;
};
/** 1 セントの角度 [度]（目盛りの端 ±scale セントを ±50°に） */
export const degPer = (scale: number): number => 50 / scale;

/** 目盛り: 弧、細かい刻み（±50 は 2 セント、±20 は 1 セント）、太い刻み（10・5 セントごと） */
export function meterTicks(scale: number): { arc: string; minor: string; major: string } {
  const k = degPer(scale),
    step = scale === 20 ? 1 : 2,
    maj = scale === 20 ? 5 : 10;
  let minor = '',
    major = '';
  for (let c = -scale; c <= scale; c += step) {
    const a = c * k;
    if (c % maj === 0) major += `M${P(MR - 20, a)}L${P(MR, a)}`;
    else minor += `M${P(MR - 11, a)}L${P(MR, a)}`;
  }
  return { arc: `M${P(MR, -50)}A${MR} ${MR} 0 0 1 ${P(MR, 50)}`, minor, major };
}

/** 合格の帯（±tol セント）: 塗りと両端の線 */
export function zonePath(tol: number, scale: number): { zone: string; edge: string } {
  const z = Math.min(50, tol * degPer(scale)),
    r1 = MR - 36,
    r2 = MR - 3;
  return {
    zone: `M${P(r2, -z)}A${r2} ${r2} 0 0 1 ${P(r2, z)}L${P(r1, z)}A${r1} ${r1} 0 0 0 ${P(r1, -z)}Z`,
    edge: `M${P(r1, -z)}L${P(r2, -z)}M${P(r1, z)}L${P(r2, z)}`,
  };
}

/** 針（根元は半円のふたの下に隠れる）。端を少し越えたら止める */
export function needlePath(cents: number, scale: number): string {
  const a = Math.max(-52, Math.min(52, cents * degPer(scale)));
  return `M${P(104, a)}L${P(MR + 8, a)}`;
}

/* ---------- 12 音のストロボ ---------- */

/** 窓（viewBox 100 × 104）の帯 o（下から 0〜3 = 2〜5 オクターブ）の上端 */
export const bandY = (o: number): number => 78 - 25 * o;
/** 帯 o の縞の周期（上の帯ほど細かい。円盤の外側ほど区画が多いのと同じ） */
export const bandPeriod = (o: number): number => 48 / 2 ** o;

/** 帯 o の縞（位相 ph [周]。1 周で縞 1 本ぶん右へ動く）。窓の内側 x 3〜97 で切る */
export function stripes(o: number, ph: number): string {
  const P0 = bandPeriod(o),
    y0 = bandY(o),
    off = (((ph % 1) + 1) % 1) * P0;
  let d = '';
  for (let x = 3 - P0 + off; x < 97; x += P0) {
    const x0 = Math.max(3, x),
      x1 = Math.min(97, x + P0 / 2);
    if (x1 > x0) d += `M${f1(x0)} ${y0}H${f1(x1)}V${y0 + 23}H${f1(x0)}Z`;
  }
  return d;
}

/** 窓 p（ピッチクラス）・帯 o の基準の周波数 [Hz]。dev はピッチクラスごとの音律のずれ [セント] */
export function bandHz(p: number, o: number, a4: number, dev: readonly number[] | null): number {
  const n = 12 * (o + 3) + p;
  return a4 * 2 ** ((n - 69) / 12 + (dev ? dev[p] : 0) / 1200);
}

/**
 * 復調の低域通過（1 次を 2 段）の時定数 [s]。縞の遅れはおよそこの 2 倍。基準からずれた音ほど複素振幅が速く回って
 * 低域通過で弱まる。60 fps の画面では目のぼけが起きないので、さらに blur で速く流れる縞を薄くする
 */
export const STROBE_TAU = 0.03;
/** 復調する帯の数: 窓ごとに 2〜7 オクターブ（表示は 2〜5。上の 2 つは 1/2・1/4 の重ね写し用） */
const NO = 6;
/**
 * 帯 o には、1 つ上・2 つ上の帯の音も、縞が二重・四重に写って薄く止まって見える（機械式の円盤で、区画が点滅の 1/2・1/4 の帯）。
 * その見え方の重み。縞は帯 o の周期で描き、上の帯の位相の 1/2・1/4 で動かす（二重の縞が 1 本ぶん動くと、帯 o の縞の半分）
 */
const SUBS = [1, 0.3, 0.15] as const;
/** 音とみなす範囲: いちばん強い帯の振幅が、入力全体の振幅のこの割合を下回ると灰色、上回ると縞をはっきり描く */
const GATE = [0.08, 0.2] as const;
/** 入力全体の振幅の下限（これより静かなら灰色） */
const FLOOR = 1e-4;
/** 縞の濃さに掛けるぼけ: 毎秒 1.5 本より速いとぶれて薄くなり、7.5 本でほぼ灰色（機械式で、目が追えずにぼけるのと同じ） */
export const blur = (rate: number): number => {
  const a = Math.abs(rate);
  return a < 1.5 ? 1 : Math.max(0.1, 1 - (a - 1.5) / 6);
};
/** A4 で 1 セント = 0.254 Hz。「セント」の縞の速さは、周波数の差 × 439.7 / 帯の基準 */
const CENT_RATE = (0.254 * 1200) / Math.LN2;

/**
 * 12 音のストロボ（帯は窓 p・帯 o で p * 4 + o）。機械式で、入力で点滅するランプが基準の速さで回る円盤を照らすのと同じく、
 * 帯の基準の周波数 fb で入力を直交復調し、低域通過した複素振幅の角度を縞の位置に、大きさを縞の濃さにする。
 * 音高の推定を待たないので、鳴らした直後から写り、和音なら鳴っている音の窓がそれぞれ止まる。
 * feed に入力を標本の通し番号つきで渡し（位相を続けるため、番号は抜けなく続ける）、描画ごとに frame で縞を求める
 */
export class Strobe {
  /** 縞の位相 [周]・濃さ（0〜1） */
  readonly ph = new Float64Array(48);
  readonly c = new Float64Array(48);
  private readonly fb = new Float64Array(12 * NO);
  /** 2 段の低域通過の状態（実部・虚部） */
  private readonly z = new Float64Array(12 * NO * 4);
  /** 縞の位相（積算、1/2・1/4 にしても続くよう 4 周で折り返す）[周] と、前の frame の角度 [周] */
  private readonly acc = new Float64Array(12 * NO);
  private readonly prev = new Float64Array(12 * NO);
  private readonly q = new Float64Array(12 * NO);
  /** 縞の速さ [本/s]（ならした値） */
  private readonly rate = new Float64Array(12 * NO);
  /** 入力の 2 乗の低域通過（2 段） */
  private p1 = 0;
  private p2 = 0;
  private spd: 'hz' | 'cent' = 'hz';
  /** 最後に feed してからの時間 [s] */
  private age = Number.POSITIVE_INFINITY;

  /** 基準の周波数と縞の速さの決め方 */
  tune(a4: number, dev: readonly number[] | null, spd: 'hz' | 'cent'): void {
    for (let p = 0; p < 12; p++) for (let o = 0; o < NO; o++) this.fb[p * NO + o] = bandHz(p, o, a4, dev);
    this.spd = spd;
  }

  /** 前の入力を忘れる（入力元を変えたとき） */
  reset(): void {
    this.z.fill(0);
    this.p1 = this.p2 = 0;
  }

  /** x[from, to) を通す。pos0 は x[from] の通し番号、fs は標本化周波数 */
  feed(x: ArrayLike<number>, from: number, to: number, pos0: number, fs: number): void {
    if (to <= from) return;
    const al = 1 - Math.exp(-1 / (STROBE_TAU * fs)),
      z = this.z;
    for (let d = 0; d < 12 * NO; d++) {
      const f = this.fb[d] / fs,
        /* 基準の位相は通し番号から求める（frame ごとの区切り方に依らない） */
        th = 2 * Math.PI * ((f * pos0) % 1),
        cw = Math.cos(2 * Math.PI * f),
        sw = Math.sin(2 * Math.PI * f);
      let c = Math.cos(th),
        s = Math.sin(th),
        r1 = z[4 * d],
        i1 = z[4 * d + 1],
        r2 = z[4 * d + 2],
        i2 = z[4 * d + 3];
      for (let n = from; n < to; n++) {
        const v = x[n];
        r1 += al * (v * c - r1);
        i1 -= al * (v * s + i1);
        r2 += al * (r1 - r2);
        i2 += al * (i1 - i2);
        const c2 = c * cw - s * sw;
        s = s * cw + c * sw;
        c = c2;
      }
      z[4 * d] = r1;
      z[4 * d + 1] = i1;
      z[4 * d + 2] = r2;
      z[4 * d + 3] = i2;
    }
    let p1 = this.p1,
      p2 = this.p2;
    for (let n = from; n < to; n++) {
      p1 += al * (x[n] * x[n] - p1);
      p2 += al * (p1 - p2);
    }
    this.p1 = p1;
    this.p2 = p2;
    this.age = 0;
  }

  /** 描画ごとに、縞の位相と濃さを求める。入力が来なくなったら（停止）、縞は薄れて灰色に戻る */
  frame(dt: number): void {
    this.age += dt;
    if (this.age > 0.1) {
      for (let i = 0; i < 48; i++) this.c[i] *= Math.exp(-dt / 0.3);
      return;
    }
    const z = this.z,
      /* 正弦波 A sin の複素振幅は A/2、全体の √(平均の 2 乗 / 2) も A/2 */
      amp = Math.sqrt(Math.max(0, this.p2) / 2);
    let m = 0;
    for (let d = 0; d < 12 * NO; d++) {
      const r = z[4 * d + 2],
        i = z[4 * d + 3],
        a = Math.atan2(i, r) / (2 * Math.PI);
      let da = a - this.prev[d];
      da -= Math.round(da);
      this.prev[d] = a;
      const dv = da * (this.spd === 'hz' ? 1 : CENT_RATE / this.fb[d]);
      this.acc[d] = (this.acc[d] + dv) % 4;
      if (dt > 0) this.rate[d] += (dv / dt - this.rate[d]) * Math.min(1, dt / 0.05);
      this.q[d] = amp > FLOOR ? Math.hypot(r, i) / amp : 0;
      m = Math.max(m, this.q[d]);
    }
    const gate = Math.max(0, Math.min(1, (m - GATE[0]) / (GATE[1] - GATE[0]))),
      M = Math.max(m, 1e-12);
    for (let p = 0; p < 12; p++)
      for (let o = 0; o < 4; o++) {
        let best = 0,
          k = 0;
        SUBS.forEach((w, j) => {
          const d = p * NO + o + j,
            /* 1/2・1/4 の重ね写しは、帯 o の縞としては 1/2・1/4 の速さ */
            g = ((w * this.q[d]) / M) * blur(this.rate[d] / 2 ** j);
          if (g > best) {
            best = g;
            k = j;
          }
        });
        const i = p * 4 + o;
        this.c[i] = Math.min(1, 1.15 * best) * gate;
        this.ph[i] = this.acc[p * NO + o + k] / 2 ** k;
      }
  }
}
