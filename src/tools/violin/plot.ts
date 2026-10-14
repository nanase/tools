/**
 * 表示窓に描く SVG の組み立て（DOM に依存しない）: 胴の応答（対数の周波数軸）。
 * 音の波形とスペクトラムは、ギターのページと同じもの（guitar/plot.ts）を使う
 */
import { fmt, minus } from '../../lib/format';
import { DV, SW } from '../../lib/scope';
import { type Body, radiation, yTop } from './body';

/* ---------- 胴の応答: 100 Hz – 10 kHz、10 × 6 div ---------- */
export const BH = 6 * DV;
const F0 = 100,
  F1 = 10000;
export const LX = (f: number): number => (Math.log10(f / F0) / Math.log10(F1 / F0)) * SW;
export const fAtX = (x: number): number => F0 * (F1 / F0) ** (x / SW);
/** 縦軸の上端 [dB] と 1 div あたり [dB]: CH1 アドミタンス（dB re 1 s/kg）、CH2 音圧 ÷ 力（dB re 1 Pa/N） */
export const Y1_TOP = -10,
  Y2_TOP = 10,
  DB_DIV = 10;

/** 目盛り（ビルド時に使う） */
export function bodyGrid(): string {
  let g = '';
  for (let d = 2; d <= 4; d++)
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
  /** シグネチャモードの縦線と名前 */
  marks: string;
  /** 弦の部分音の印（下端） */
  partials: string;
  axes: string;
}

const yDb = (db: number, top: number) => Math.max(-6, Math.min(BH + 6, ((top - db) / DB_DIV) * DV));

/**
 * 駒の上端の水平のアドミタンスと、水平の力に対する音圧（1.2 m 先、左右の平均のパワー）の周波数特性。
 * fs は印を付ける部分音の周波数
 */
export function bodyPlot(b: Body, fs: readonly number[]): BodyPlot {
  let y = '',
    p = '';
  const n = 400;
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * SW,
      f = fAtX(x),
      ya = yTop(b, f),
      r0 = radiation(b, f, 0),
      r1 = radiation(b, f, 1),
      pa = Math.sqrt((r0.re ** 2 + r0.im ** 2 + r1.re ** 2 + r1.im ** 2) / 2);
    y += `${i ? 'L' : 'M'}${x.toFixed(1)} ${yDb(20 * Math.log10(Math.hypot(ya.re, ya.im) + 1e-12), Y1_TOP).toFixed(1)}`;
    p += `${i ? 'L' : 'M'}${x.toFixed(1)} ${yDb(20 * Math.log10(pa + 1e-12), Y2_TOP).toFixed(1)}`;
  }
  let marks = '',
    /* 名前が重ならないように、前の名前から 24 px 以上離す（右へずらす） */
    last = -1e9;
  for (const m of b.raw.filter((r) => r.name).sort((p, q) => p.f - q.f)) {
    const x = LX(m.f),
      lab = m.name === 'B1-' ? 'B1⁻' : m.name === 'B1+' ? 'B1⁺' : m.name,
      tx = Math.max(x, last + 24);
    last = tx;
    marks += `<path class="mkl" d="M${x.toFixed(1)} 0V${BH}"/><text class="mkt" x="${tx.toFixed(1)}" y="-4" text-anchor="middle">${lab}</text>`;
  }
  let partials = '';
  for (const f of fs) if (f > F0 && f < F1) partials += `M${LX(f).toFixed(1)} ${BH}v-7`;
  let axes = '';
  for (const f of [100, 200, 500, 1000, 2000, 5000, 10000])
    axes += `<text x="${LX(f).toFixed(1)}" y="${BH + 17}" text-anchor="middle">${fmt(f, 'Hz', 3).replace(' ', '')}</text>`;
  for (let j = 0; j <= 6; j += 2) {
    axes += `<text x="-8" y="${j * DV + 4}" text-anchor="end">${minus(String(Y1_TOP - j * DB_DIV))}</text>`;
    axes += `<text class="r2" x="${SW + 8}" y="${j * DV + 4}">${minus(String(Y2_TOP - j * DB_DIV))}</text>`;
  }
  return { y, p, marks, partials: `<path class="mkp" d="${partials}"/>`, axes };
}
