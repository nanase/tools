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

/** 部分音（第 k 部分音の周波数と、いちばん強い部分音を 1 とした強さ） */
export interface Part {
  k: number;
  f: number;
  a: number;
}
/**
 * 基音の 1/2・1/4 の高さの帯にも、縞が二重・四重に写って薄く止まって見える（機械式のストロボで、
 * 円盤の区画が点滅の 1/2・1/4 のとき）。その見え方の重み
 */
const SUBS = [
  [0.5, 0.3],
  [0.25, 0.15],
] as const;

/**
 * 帯の基準の周波数 fb に最も近い部分音を選び、見え方 vis（0〜1）と縞の速さ rate [本/s] を返す。
 * 近さは 40 セントの幅のガウス関数で重みを付ける。縞の速さは、周波数の差（spd = 'hz'、機械式と同じ）か、
 * セント × 0.254（A4 で 1 セント = 0.254 Hz）
 */
export function bandOf(
  fb: number,
  f0: number,
  parts: readonly Part[],
  spd: 'hz' | 'cent',
): { vis: number; rate: number } {
  let vis = 0,
    rate = 0;
  const cand = parts.map((p) => [p.f, p.a] as const).concat(SUBS.map(([k, w]) => [k * f0, w] as const));
  for (const [f, a] of cand) {
    const dc = 1200 * Math.log2(f / fb),
      g = a * Math.exp(-((dc / 40) ** 2));
    if (g > vis) {
      vis = g;
      rate = spd === 'hz' ? f - fb : dc * 0.254;
    }
  }
  return { vis, rate };
}

/** 縞の濃さ: 見え方 × 動きの速さ（毎秒 1.5 本より速いとぶれて薄くなり、7.5 本でほぼ灰色） */
export function contrast(vis: number, rate: number): number {
  const a = Math.abs(rate),
    mf = a < 1.5 ? 1 : Math.max(0.1, 1 - (a - 1.5) / 6);
  return Math.min(1, 1.15 * vis) * mf;
}

/** 推定が途切れても、この間 [s] は直前の部分音で縞を描く（明瞭度が一瞬下がるたび、弾き直すたびに縞が消えないように） */
export const HOLD = 0.3;
/** ならしの時定数 [s]: 濃く・明るくなるとき、薄く・暗くなるとき、縞の速さ */
const UP = 0.04,
  DOWN = 0.3,
  RATE = 0.1;
const ease = (v: number, to: number, dt: number, tau = to > v ? UP : DOWN) => v + (to - v) * (1 - Math.exp(-dt / tau));

/**
 * 12 音のストロボの動き（帯は窓 p・帯 o で p * 4 + o）。推定ごとに update で帯の見え方と縞の速さの目標を決め、
 * 描画ごとに frame で縞を進め、濃さとランプの明るさを目標へならす。推定が HOLD を超えて途切れたら、ゆっくり消える
 */
export class Strobe {
  /** 縞の位相 [周]・速さ [本/s]・濃さ（ならした値） */
  readonly ph = new Float64Array(48);
  readonly rate = new Float64Array(48);
  readonly c = new Float64Array(48);
  /** ランプの明るさ（0〜1、ならした値） */
  lit = 0;
  private readonly vis = new Float64Array(48);
  private readonly to = new Float64Array(48);
  /** 最後の update からの時間 [s] */
  private age = Number.POSITIVE_INFINITY;

  update(f0: number, parts: readonly Part[], a4: number, dev: readonly number[] | null, spd: 'hz' | 'cent'): void {
    for (let p = 0; p < 12; p++)
      for (let o = 0; o < 4; o++) {
        const b = bandOf(bandHz(p, o, a4, dev), f0, parts, spd);
        this.vis[p * 4 + o] = b.vis;
        this.to[p * 4 + o] = b.rate;
      }
    this.age = 0;
  }

  frame(dt: number): void {
    this.age += dt;
    const live = this.age < HOLD;
    this.lit = ease(this.lit, live ? 1 : 0, dt);
    for (let i = 0; i < 48; i++) {
      this.rate[i] = ease(this.rate[i], this.to[i], dt, RATE);
      this.ph[i] = (this.ph[i] + this.rate[i] * dt) % 1;
      this.c[i] = ease(this.c[i], live ? contrast(this.vis[i], this.rate[i]) : 0, dt);
    }
  }

  /** ランプの明るさ: 消えかかったとき idle から、点いたとき 1 まで */
  lamp(idle: number): number {
    return idle + (1 - idle) * this.lit;
  }
}
