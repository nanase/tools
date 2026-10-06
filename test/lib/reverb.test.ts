import { describe, expect, it } from 'vitest';
import { acoustics, Reverb, ROOMS, reverbSpec, roomOf, shelf } from '../../src/lib/reverb';

const FS = 48000;
/** 左右に単位インパルスを入れたときの残響音（直接音を除く） */
function ir(v: string, dist: number, sec: number): [Float32Array, Float32Array] {
  const rv = new Reverb(FS),
    n = Math.round(sec * FS),
    L = new Float32Array(n),
    R = new Float32Array(n);
  rv.set(reverbSpec(roomOf(v), dist));
  L[0] = 1;
  R[0] = 1;
  for (let i = 0; i < n; i += 128) rv.process(L, R, i, Math.min(128, n - i));
  L[0] -= 1;
  R[0] -= 1;
  return [L, R];
}
/** 周波数 f を中心とする 1 オクターブのエネルギーの平均 [dB] */
function bandDb(y: Float32Array, f0: number): number {
  let acc = 0,
    cnt = 0;
  for (let f = f0 / Math.SQRT2; f <= f0 * Math.SQRT2; f += 1) {
    let re = 0,
      im = 0;
    const w = (2 * Math.PI * f) / FS;
    for (let i = 0; i < y.length; i++) {
      re += y[i] * Math.cos(w * i);
      im -= y[i] * Math.sin(w * i);
    }
    acc += re * re + im * im;
    cnt++;
  }
  return 10 * Math.log10(acc / cnt);
}

describe('部屋の残響', () => {
  it('残響時間は Eyring の式（0.161 V / (−S ln(1 − α) + 4mV)）、臨界距離は √(A / 16π)', () => {
    const a = acoustics(roomOf('small'));
    expect(a.V).toBe(5400);
    expect(a.S).toBe(2040);
    expect(a.t60).toBeCloseTo((0.161 * 5400) / (-2040 * Math.log(0.75) + ((4 * 1.9e-3) / 4.343) * 5400), 6);
    expect(a.rc).toBeCloseTo(Math.sqrt(a.A / (16 * Math.PI)), 9);
    /* 高い周波数は吸音と空気の吸収で短い */
    for (const r of ROOMS.filter((x) => x.v !== 'off')) expect(acoustics(r).t60Hi).toBeLessThan(acoustics(r).t60);
  });
  it('1 次の低域通過は、2 つの周波数で指定の大きさになる', () => {
    const [b0, a1] = shelf(0.9, 0.6, 0.07, 0.5),
      mag = (w: number) => b0 / Math.hypot(1 - a1 * Math.cos(w), a1 * Math.sin(w));
    expect(mag(0.07)).toBeCloseTo(0.9, 9);
    expect(mag(0.5)).toBeCloseTo(0.6, 9);
  });
  it('聴く位置が臨界距離なら、500 Hz の残響音のエネルギーは直接音（1）と同じ（±2 dB）', () => {
    const a = acoustics(roomOf('small')),
      [L] = ir('small', a.rc, 2.2);
    expect(Math.abs(bandDb(L, 500))).toBeLessThan(2);
  });
  it('500 Hz の帯域の減衰は残響時間に合い（±20 %）、左右はほぼ無相関', () => {
    const a = acoustics(roomOf('hall')),
      [L, R] = ir('hall', a.rc, 3);
    /* 500 Hz 付近を通す 2 次の帯域通過で、Schroeder の積分から −5〜−25 dB の傾きを測る */
    const w = (2 * Math.PI * 500) / FS,
      r = Math.exp(-w / 4),
      y = new Float64Array(L.length);
    for (let i = 2; i < L.length; i++) y[i] = L[i] - L[i - 2] + 2 * r * Math.cos(w) * y[i - 1] - r * r * y[i - 2];
    const sch = new Float64Array(y.length);
    let acc = 0;
    for (let i = y.length - 1; i >= 0; i--) {
      acc += y[i] * y[i];
      sch[i] = acc;
    }
    const db = (i: number) => 10 * Math.log10(sch[i] / sch[0]);
    let i5 = 0,
      i25 = 0;
    for (let i = 0; i < y.length; i++) {
      if (!i5 && db(i) < -5) i5 = i;
      if (!i25 && db(i) < -25) {
        i25 = i;
        break;
      }
    }
    const t60 = ((i25 - i5) / FS) * 3;
    expect(t60 / a.t60).toBeGreaterThan(0.8);
    expect(t60 / a.t60).toBeLessThan(1.2);
    let ll = 0,
      rr = 0,
      lr = 0;
    for (let i = 0; i < L.length; i++) {
      ll += L[i] * L[i];
      rr += R[i] * R[i];
      lr += L[i] * R[i];
    }
    expect(Math.abs(lr / Math.sqrt(ll * rr))).toBeLessThan(0.1);
  });
  it('なしなら何も足さない', () => {
    const [L] = ir('off', 10, 0.1);
    expect(L.every((v) => v === 0)).toBe(true);
  });
});
