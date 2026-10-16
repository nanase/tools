/**
 * 表示窓に描く SVG の組み立て（DOM に依存しない）: 管の入力インピーダンス（対数の周波数軸、60 Hz – 2 kHz）。
 * 音の波形とスペクトラムは、ギターのページと同じもの（guitar/plot.ts）を使う
 */
import { fmt } from '../../lib/format';
import { DV, SW } from '../../lib/scope';
import { type Air, air, profile, SPEC, VALVE_LEN } from './bore';
import { CYL_EXTRA } from './instrument';
import { boreSteps, inputImpedance, type Peak, peaksOf, type Steps } from './tmm';

export const ZH = 6 * DV;
const F0 = 60,
  F1 = 2000;
export const LX = (f: number): number => (Math.log10(f / F0) / Math.log10(F1 / F0)) * SW;
export const fAtX = (x: number): number => F0 * (F1 / F0) ** (x / SW);

/** 目盛り（ビルド時に使う） */
export function zGrid(): string {
  let g = '';
  for (let d = 1; d <= 3; d++)
    for (let m = 1; m < 10; m++) {
      const f = m * 10 ** d;
      if (f <= F0 || f >= F1) continue;
      g += `<path class="${m === 1 ? 'gl' : 'gl2'}" d="M${LX(f).toFixed(1)} 0V${ZH}"/>`;
    }
  for (let j = 1; j < 6; j++) g += `<path class="gl" d="M0 ${j * DV}H${SW}"/>`;
  for (let y = 8; y < ZH; y += 8) g += `<path class="gb" d="M0 ${y}h4M${SW} ${y}h-4"/>`;
  return `${g}<rect class="gb" x="0" y="0" width="${SW}" height="${ZH}"/>`;
}

/** 入力インピーダンスの曲線と山（弁の組 v、抜差しを出した長さ [m]、温度 T） */
export interface ZCurve {
  f: Float64Array;
  z: Float64Array;
  peaks: Peak[];
}
const cache = new Map<string, ZCurve>();
export function zCurve(v: readonly boolean[], slide: number, T: number): ZCurve {
  const key = `${v.map(Number).join('')}/${slide.toFixed(3)}/${T}`,
    hit = cache.get(key);
  if (hit) return hit;
  const A: Air = air(T),
    st = boreSteps(
      profile({ ...SPEC, cylLen: SPEC.cylLen + CYL_EXTRA }),
      v.reduce((a, on, i) => a + (on ? VALVE_LEN[i] : 0), 0) + slide,
      1.5e-3,
    ),
    n = 360,
    f = new Float64Array(n + 1),
    z = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) {
    f[i] = fAtX((i / n) * SW);
    const Z = inputImpedance(A, st, f[i]);
    z[i] = Math.hypot(Z[0], Z[1]);
  }
  const out = { f, z, peaks: peaksOf(f, z) };
  cache.set(key, out);
  return out;
}

/** 縦軸: 線形（0〜120 MPa·s/m³）か dB（1 MPa·s/m³ を 0 dB、−20〜+40 dB） */
export const zY = (z: number, db: boolean): number =>
  db
    ? Math.max(-6, Math.min(ZH + 6, ((40 - 20 * Math.log10(z / 1e6 + 1e-9)) / 60) * ZH))
    : Math.max(-6, ZH - (z / 1e6 / 120) * ZH);

export function zPath(c: ZCurve, db: boolean): string {
  let d = '';
  for (let i = 0; i < c.f.length; i++) d += `${i ? 'L' : 'M'}${LX(c.f[i]).toFixed(1)} ${zY(c.z[i], db).toFixed(1)}`;
  return d;
}

export function zAxes(db: boolean): string {
  let a = '';
  for (const f of [60, 100, 200, 500, 1000, 2000])
    a += `<text x="${LX(f).toFixed(1)}" y="${ZH + 17}" text-anchor="middle">${f === 2000 ? '2kHz' : fmt(f, 'Hz', 3).replace(' Hz', '').replace(' ', '')}</text>`;
  for (let j = 0; j <= 6; j += 2)
    a += `<text x="-8" y="${j * DV + 4}" text-anchor="end">${db ? String(40 - j * 10) : String(120 - j * 20)}</text>`;
  return a;
}

/** マウスピースだけ（縁を閉じ、シャンクの先を開いた）の最初の共鳴 [Hz]（popping 周波数の目安） */
export function mouthpieceResonance(T = 27): number {
  const p = profile(SPEC),
    len: number[] = [],
    rad: number[] = [];
  for (let i = 0; i + 1 < p.head.x.length; i++) {
    const a = p.head.x[i],
      b = p.head.x[i + 1];
    if (b <= a || b > SPEC.mpLen + 1e-9) continue;
    const m = Math.ceil((b - a) / 2e-4);
    for (let j = 0; j < m; j++) {
      len.push((b - a) / m);
      rad.push(p.head.r[i] + ((p.head.r[i + 1] - p.head.r[i]) * (j + 0.5)) / m);
    }
  }
  const st: Steps = { len: Float64Array.from(len), rad: Float64Array.from(rad), end: SPEC.shankR },
    A = air(T),
    n = 400,
    f = new Float64Array(n),
    z = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    f[i] = 400 + 2 * i;
    const Z = inputImpedance(A, st, f[i]);
    z[i] = Math.hypot(Z[0], Z[1]);
  }
  return peaksOf(f, z)[0]?.f ?? 0;
}

/** 非線形の伝搬の実効円筒長 z = ∫ D0/D dx [m]（リードパイプからベルの開口まで。押した弁の迂回管を足す） */
export function zEffOf(v: readonly boolean[]): number {
  const p = profile({ ...SPEC, cylLen: SPEC.cylLen + CYL_EXTRA }),
    rc = SPEC.cylR;
  let z = 0;
  const add = (pr: { x: Float64Array; r: Float64Array }, x0: number) => {
    for (let i = 0; i + 1 < pr.x.length; i++) {
      const a = Math.max(pr.x[i], x0),
        b = pr.x[i + 1];
      if (b <= a) continue;
      z += ((b - a) * rc) / ((pr.r[i] + pr.r[i + 1]) / 2);
    }
  };
  add(p.head, SPEC.mpLen);
  add(p.tail, 0);
  return z + p.cylLen + v.reduce((a, on, i) => a + (on ? VALVE_LEN[i] : 0), 0);
}
