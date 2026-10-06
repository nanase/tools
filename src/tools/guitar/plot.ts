/**
 * 表示窓に描く SVG の組み立て（DOM に依存しない）: 胴の応答（対数の周波数軸）と、1 回の撥弦の音の波形・スペクトラム
 */
import { fmt, minus } from '../../lib/format';
import { DV, SW } from '../../lib/scope';
import { toDb } from '../spectrum/fft';
import { admittance, type Body, C, cabs, pressure } from './body';

/* ---------- 胴の応答: 50 Hz – 5 kHz、10 × 6 div ---------- */
export const BH = 6 * DV;
const F0 = 50,
  F1 = 5000;
export const LX = (f: number): number => (Math.log10(f / F0) / Math.log10(F1 / F0)) * SW;
export const fAtX = (x: number): number => F0 * (F1 / F0) ** (x / SW);
/** 縦軸の上端 [dB] と 1 div あたり [dB]: CH1 アドミタンス（dB re 1 s/kg）、CH2 音圧（dB re 1 Pa/N） */
export const Y1_TOP = -10,
  Y2_TOP = 10,
  DB_DIV = 10;

/** 目盛り（ビルド時に使う） */
export function bodyGrid(): string {
  let g = '';
  for (let d = 1; d <= 3; d++)
    for (let m = 1; m < 10; m++) {
      const f = m * 10 ** d;
      if (f <= F0 || f >= F1) continue;
      g += `<path class="${m === 1 ? 'gl' : 'gl2'}" d="M${LX(f).toFixed(1)} 0V${BH}"/>`;
    }
  for (let j = 1; j < 6; j++) g += `<path class="gl" d="M0 ${j * DV}H${SW}"/>`;
  for (let y = 8; y < BH; y += 8) g += `<path class="gb" d="M0 ${y}h4M${SW} ${y}h-4"/>`;
  return `${g}<rect class="gb" x="0" y="0" width="${SW}" height="${BH}"/>`;
}

export interface BodyPlot {
  y: string;
  p: string;
  /** 共振の縦線と名前 */
  marks: string;
  /** 弦の部分音の印（下端） */
  partials: string;
  axes: string;
}

const yDb = (db: number, top: number) => Math.max(-6, Math.min(BH + 6, ((top - db) / DB_DIV) * DV));

/** 駒のアドミタンスと音圧の周波数特性。fs は印を付ける部分音の周波数 */
export function bodyPlot(b: Body, fs: readonly number[]): BodyPlot {
  let y = '',
    p = '';
  const n = 400;
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * SW,
      f = fAtX(x),
      ya = cabs(admittance(b, C.cx(2 * Math.PI * f), 0)),
      pa = cabs(pressure(b, f));
    y += `${i ? 'L' : 'M'}${x.toFixed(1)} ${yDb(20 * Math.log10(ya), Y1_TOP).toFixed(1)}`;
    p += `${i ? 'L' : 'M'}${x.toFixed(1)} ${yDb(20 * Math.log10(pa), Y2_TOP).toFixed(1)}`;
  }
  let marks = '';
  for (const [f, l] of [
    [b.fm, 'f₋'],
    [b.fh, 'fₕ'],
    [b.fpl, 'f₊'],
  ] as const) {
    const x = LX(f).toFixed(1);
    marks += `<path class="mkl" d="M${x} 0V${BH}"/><text class="mkt" x="${x}" y="-4" text-anchor="middle">${l}</text>`;
  }
  let partials = '';
  for (const f of fs) if (f > F0 && f < F1) partials += `M${LX(f).toFixed(1)} ${BH}v-7`;
  let axes = '';
  for (const f of [50, 100, 200, 500, 1000, 2000, 5000])
    axes += `<text x="${LX(f).toFixed(1)}" y="${BH + 17}" text-anchor="middle">${fmt(f, 'Hz', 3).replace(' ', '')}</text>`;
  for (let j = 0; j <= 6; j += 2) {
    axes += `<text x="-8" y="${j * DV + 4}" text-anchor="end">${minus(String(Y1_TOP - j * DB_DIV))}</text>`;
    axes += `<text class="r2" x="${SW + 8}" y="${j * DV + 4}">${minus(String(Y2_TOP - j * DB_DIV))}</text>`;
  }
  return { y, p, marks, partials: `<path class="mkp" d="${partials}"/>`, axes };
}

/* ---------- 1 回の撥弦の音: 10 × 4 div ---------- */
export const OH = 4 * DV;

/** 1-2-5 の切りのよい値に切り上げる */
const nice = (x: number): number => {
  const e = Math.floor(Math.log10(x)),
    m = x / 10 ** e;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * 10 ** e;
};

export interface WavePlot {
  d: string;
  axes: string;
  /** 縦軸の 1 div あたり（フルスケールを 1 とする）と、横軸の 1 div あたり [s] */
  vd: number;
  hd: number;
}

/** 波形: 初めから span 秒ぶん。縦は全体のピークに合わせる */
export function wavePlot(y: Float32Array, fs: number, span: number): WavePlot {
  const n = Math.min(y.length, Math.round(span * fs));
  let pk = 1e-6;
  for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(y[i]));
  const vd = nice(pk / 2),
    mid = OH / 2,
    Y = (v: number) => Math.max(-4, Math.min(OH + 4, mid - (v / vd) * DV)).toFixed(1);
  let d = '';
  if (n <= 2 * SW) for (let i = 0; i < n; i++) d += `${i ? 'L' : 'M'}${((i / n) * SW).toFixed(2)} ${Y(y[i])}`;
  else
    for (let j = 0; j < 2 * SW; j++) {
      const i0 = Math.floor((j / (2 * SW)) * n),
        i1 = Math.floor(((j + 1) / (2 * SW)) * n);
      let lo = Infinity,
        hi = -Infinity;
      for (let i = i0; i < Math.max(i1, i0 + 1); i++) {
        lo = Math.min(lo, y[i]);
        hi = Math.max(hi, y[i]);
      }
      d += `${j ? 'L' : 'M'}${j / 2} ${Y(hi)}L${j / 2} ${Y(lo)}`;
    }
  const hd = span / 10;
  let axes = '';
  for (let i = 0; i <= 10; i += 2)
    axes += `<text x="${i * DV}" y="${OH + 17}" text-anchor="middle">${i ? fmt(i * hd, 's', 3) : '0'}</text>`;
  for (let j = 0; j <= 4; j++) {
    const v = (2 - j) * vd;
    axes += `<text x="-8" y="${j * DV + 4}" text-anchor="end">${v === 0 ? '0' : (v > 0 ? '+' : '') + minus(String(Number(v.toPrecision(3))))}</text>`;
  }
  return { d, axes, vd, hd };
}

/** スペクトラムの縦軸: 上端 0 dB（1 Pa）、30 dB/div（下端 −120 dB） */
export const SP_DIV = 30;
export const spY = (db: number): number => Math.max(-4, Math.min(OH + 4, (-db / SP_DIV) * DV));

/** スペクトラム（パワー P の 0〜N/2 bin、横軸 0〜fmax） */
export function specPlot(P: Float32Array, fs: number, N: number, fmax: number): { d: string; axes: string } {
  const km = Math.min(N / 2, Math.round((fmax / fs) * N)),
    k = SW / km;
  let d = '';
  for (let j = 0; j < 2 * SW; j++) {
    const i0 = Math.ceil(j / (2 * k)),
      i1 = Math.min(km, Math.floor((j + 1) / (2 * k)));
    let hi = -Infinity;
    for (let i = i0; i <= i1; i++) hi = Math.max(hi, P[i]);
    if (hi > -Infinity) d += `${d ? 'L' : 'M'}${j / 2} ${spY(toDb(hi)).toFixed(1)}`;
  }
  let axes = '';
  for (let i = 0; i <= 10; i += 2)
    axes += `<text x="${i * DV}" y="${OH + 17}" text-anchor="middle">${i ? fmt((i / 10) * fmax, 'Hz', 3) : '0'}</text>`;
  for (let j = 0; j <= 4; j++)
    axes += `<text x="-8" y="${j * DV + 4}" text-anchor="end">${j ? minus(String(-j * SP_DIV)) : '0'}</text>`;
  return { d, axes };
}
