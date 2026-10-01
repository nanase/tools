import { describe, expect, it } from 'vitest';
import { AMP, genTest, PERIODIC, periodic, type TestParams, WAVES } from '../src/tools/audio/signal';

const FS = 48000;
const P: TestParams = { wave: 'sine', f: 1000, ra: [2, 3], ph: 0 };

describe('テスト信号', () => {
  it('どこから書き始めても同じ波形になる（周期的な波形）', () => {
    for (const wave of PERIODIC) {
      const p = { ...P, wave },
        a = [new Float32Array(1000), new Float32Array(1000)],
        b = [new Float32Array(500), new Float32Array(500)];
      genTest(p, FS, 0, 1000, a[0], a[1]);
      genTest(p, FS, 500, 500, b[0], b[1]);
      for (let i = 0; i < 500; i++) {
        expect(b[0][i]).toBeCloseTo(a[0][500 + i], 3);
        expect(b[1][i]).toBeCloseTo(a[1][500 + i], 3);
      }
    }
  });
  it('輪のバッファには標本の番号の余りの位置へ書く', () => {
    const L = new Float32Array(100),
      R = new Float32Array(100),
      l = new Float32Array(10),
      r = new Float32Array(10);
    genTest(P, FS, 195, 10, L, R, true);
    genTest(P, FS, 195, 10, l, r);
    expect(L[95]).toBeCloseTo(l[0], 3);
    expect(L[4]).toBeCloseTo(l[9], 3);
  });
  it('振幅は 0.7、CH2 は周波数比と位相差に従う', () => {
    const n = 4800,
      L = new Float32Array(n),
      R = new Float32Array(n);
    genTest({ ...P, ra: [1, 1], ph: 90 }, FS, 0, n, L, R);
    expect(Math.max(...L)).toBeCloseTo(AMP, 3);
    /* 90° 進んだ CH2 は、CH1 が 0 のとき最大 */
    expect(R[0]).toBeCloseTo(AMP, 3);
    genTest({ ...P, ra: [1, 2] }, FS, 0, n, L, R);
    let zl = 0,
      zr = 0;
    for (let i = 1; i < n; i++) {
      if (L[i - 1] < 0 && L[i] >= 0) zl++;
      if (R[i - 1] < 0 && R[i] >= 0) zr++;
    }
    expect(zr).toBeCloseTo(2 * zl, -1);
  });
  it('正弦波・方形波・三角波は p = 0.25 で最大。どの波形も範囲は ±1 程度', () => {
    for (const w of ['sine', 'square', 'tri'] as const) expect(periodic(w, 0.25, 0.001)).toBeGreaterThan(0.9);
    for (const w of PERIODIC) {
      let m = 0;
      for (let p = 0; p < 1; p += 0.01) m = Math.max(m, Math.abs(periodic(w, p, 0.02)));
      expect(m, w).toBeLessThanOrEqual(1.3);
    }
  });
  it('すべての波形がフルスケールを超えない', () => {
    for (const [wave] of WAVES) {
      const L = new Float32Array(48000),
        R = new Float32Array(48000);
      genTest({ ...P, wave }, FS, 0, 48000, L, R);
      let m = 0;
      for (let i = 0; i < L.length; i++) m = Math.max(m, Math.abs(L[i]), Math.abs(R[i]));
      expect(m, wave).toBeLessThan(1);
    }
  });
});
