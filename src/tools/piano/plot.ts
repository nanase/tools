/**
 * 表示窓に描く SVG の組み立て（DOM に依存しない）: 響板の応答（対数の周波数軸）と、ハンマーの力。
 * 音の波形とスペクトラムはギターと同じもの（guitar/plot.ts）を使う
 */
import { fmt, minus } from '../../lib/format';
import { DV, SW } from '../../lib/scope';
import { C, cabs } from '../guitar/body';
import { admittance, type Board, pressure } from './soundboard';

export { OH, specPlot, wavePlot } from '../guitar/plot';

/* ---------- 響板の応答: 20 Hz – 10 kHz、10 × 6 div ---------- */
export const BH = 6 * DV;
const F0 = 20,
  F1 = 10000;
export const LX = (f: number): number => (Math.log10(f / F0) / Math.log10(F1 / F0)) * SW;
export const fAtX = (x: number): number => F0 * (F1 / F0) ** (x / SW);
/** 縦軸の上端 [dB] と 1 div あたり [dB]: CH1 アドミタンス（dB re 1 s/kg）、CH2 音圧（dB re 1 Pa/N） */
export const Y1_TOP = -40,
  Y2_TOP = 0,
  DB_DIV = 10;

/** 目盛り（ビルド時に使う） */
export function boardGrid(): string {
  let g = '';
  for (let d = 1; d <= 4; d++)
    for (let m = 1; m < 10; m++) {
      const f = m * 10 ** d;
      if (f <= F0 || f >= F1) continue;
      g += `<path class="${m === 1 ? 'gl' : 'gl2'}" d="M${LX(f).toFixed(1)} 0V${BH}"/>`;
    }
  for (let j = 1; j < 6; j++) g += `<path class="gl" d="M0 ${j * DV}H${SW}"/>`;
  for (let y = 8; y < BH; y += 8) g += `<path class="gb" d="M0 ${y}h4M${SW} ${y}h-4"/>`;
  return `${g}<rect class="gb" x="0" y="0" width="${SW}" height="${BH}"/>`;
}

const yDb = (db: number, top: number) => Math.max(-6, Math.min(BH + 6, ((top - db) / DB_DIV) * DV));

/** 駒のアドミタンスと音圧の周波数特性。fs は印を付ける部分音の周波数 */
export function boardPlot(b: Board, fs: readonly number[]): { y: string; p: string; partials: string; axes: string } {
  let y = '',
    p = '';
  const n = 500;
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * SW,
      f = fAtX(x),
      ya = cabs(admittance(b, C.cx(2 * Math.PI * f))),
      pa = cabs(pressure(b, f));
    y += `${i ? 'L' : 'M'}${x.toFixed(1)} ${yDb(20 * Math.log10(ya), Y1_TOP).toFixed(1)}`;
    p += `${i ? 'L' : 'M'}${x.toFixed(1)} ${yDb(20 * Math.log10(pa), Y2_TOP).toFixed(1)}`;
  }
  let partials = '';
  for (const f of fs) if (f > F0 && f < F1) partials += `M${LX(f).toFixed(1)} ${BH}v-7`;
  let axes = '';
  for (const f of [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000])
    axes += `<text x="${LX(f).toFixed(1)}" y="${BH + 17}" text-anchor="middle">${fmt(f, 'Hz', 3).replace(' ', '')}</text>`;
  for (let j = 0; j <= 6; j += 2) {
    axes += `<text x="-8" y="${j * DV + 4}" text-anchor="end">${minus(String(Y1_TOP - j * DB_DIV))}</text>`;
    axes += `<text class="r2" x="${SW + 8}" y="${j * DV + 4}">${minus(String(Y2_TOP - j * DB_DIV))}</text>`;
  }
  return { y, p, partials: `<path class="mkp" d="${partials}"/>`, axes };
}

/** ハンマーの力の波形（弦 1 本ぶん）。dt は 1 点の時間 [s] */
export function forcePlot(F: Float64Array, dt: number): { d: string; axes: string; vd: number; hd: number } {
  const OH = 4 * DV,
    tEnd = F.length * dt,
    nice = (x: number) => {
      const e = Math.floor(Math.log10(x)),
        m = x / 10 ** e;
      return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * 10 ** e;
    };
  let pk = 1e-6;
  for (const v of F) pk = Math.max(pk, v);
  const vd = nice(pk / 3.5),
    hd = nice(tEnd / 9),
    Y = (v: number) => (OH - (v / vd) * DV).toFixed(1);
  let d = '';
  const n = F.length,
    step = Math.max(1, Math.floor(n / 800));
  for (let i = 0; i < n; i += step) d += `${i ? 'L' : 'M'}${((i * dt) / (10 * hd)) * SW} ${Y(F[i])}`;
  let axes = '';
  for (let i = 0; i <= 10; i += 2)
    axes += `<text x="${i * DV}" y="${OH + 17}" text-anchor="middle">${i ? fmt(i * hd, 's', 3) : '0'}</text>`;
  for (let j = 0; j <= 4; j++)
    axes += `<text x="-8" y="${j * DV + 4}" text-anchor="end">${j === 4 ? '0' : fmt((4 - j) * vd, 'N', 3).replace(' N', '')}</text>`;
  return { d, axes, vd, hd };
}
