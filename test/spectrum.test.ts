import { describe, expect, it } from 'vitest';
import { genTest } from '../src/tools/audio/signal';
import {
  axisFn,
  binMap,
  dbStep,
  fLab,
  fTicks,
  imel,
  mel,
  niceStep,
  noteOf,
  peak,
  valAt,
} from '../src/tools/spectrum/axis';
import { spectra, toDb, WINS, winData } from '../src/tools/spectrum/fft';

const FS = 48000;
const sine = (f: number, n: number, amp = 1) =>
  Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / FS));
function spec(x: Float32Array, y: Float32Array, N: number, win: (typeof WINS)[number][0] = 'hann') {
  const px = new Float32Array(N / 2 + 1),
    py = new Float32Array(N / 2 + 1);
  spectra(x, y, N, win, px, py);
  return [px, py];
}
const argmax = (a: Float32Array) => a.reduce((b, v, i) => (v > a[b] ? i : b), 0);

describe('窓関数', () => {
  it('等価雑音帯域幅（Harris 1978）', () => {
    const N = 4096;
    expect(winData('rect', N).enbw).toBeCloseTo(1, 6);
    expect(winData('hann', N).enbw).toBeCloseTo(1.5, 3);
    expect(winData('hamming', N).enbw).toBeCloseTo(1.36, 2);
    expect(winData('blackman', N).enbw).toBeCloseTo(1.73, 2);
    expect(winData('bh', N).enbw).toBeCloseTo(2.0, 2);
    expect(winData('flat', N).enbw).toBeCloseTo(3.77, 2);
  });
  it('コヒーレントゲインは係数の a0', () => {
    for (const [w, , , c] of WINS) expect(winData(w, 1024).cg).toBeCloseTo(c[0], 9);
  });
});

describe('FFT', () => {
  it('bin にちょうど乗る正弦波は、窓によらず振幅 1 で 0 dBFS', () => {
    const N = 4096,
      f = (100 * FS) / N;
    for (const [w] of WINS) {
      const [p] = spec(sine(f, N), new Float32Array(N), N, w);
      expect(argmax(p)).toBe(100);
      expect(toDb(p[100])).toBeCloseTo(0, 6);
    }
  });
  it('フラットトップ窓は bin の間の正弦波も 0.01 dB 以内で読む', () => {
    const N = 4096,
      f = (100.5 * FS) / N;
    const [p] = spec(sine(f, N), new Float32Array(N), N, 'flat');
    expect(Math.abs(toDb(Math.max(p[100], p[101])))).toBeLessThan(0.01);
  });
  it('CH1 と CH2 を 1 回の変換で分けて求める', () => {
    const N = 2048,
      x = sine((50 * FS) / N, N, 0.5),
      y = sine((300 * FS) / N, N, 0.25);
    const [px, py] = spec(x, y, N, 'rect');
    expect(argmax(px)).toBe(50);
    expect(argmax(py)).toBe(300);
    expect(toDb(px[50])).toBeCloseTo(20 * Math.log10(0.5), 6);
    expect(toDb(py[300])).toBeCloseTo(20 * Math.log10(0.25), 6);
    expect(px[300]).toBeLessThan(1e-12);
    expect(py[50]).toBeLessThan(1e-12);
  });
  it('末尾の N 点を使う', () => {
    const N = 256,
      x = new Float32Array(1000);
    x.set(sine((10 * FS) / N, N), 1000 - N);
    const [px] = spec(x, x, N, 'rect');
    expect(argmax(px)).toBe(10);
  });
  it('長さが 2 の累乗でなければ例外', () => {
    expect(() => spec(new Float32Array(1000), new Float32Array(1000), 1000)).toThrow();
  });
});

describe('周波数軸', () => {
  it('メル尺度は 1000 Hz でほぼ 1000、逆関数で戻る', () => {
    expect(mel(1000)).toBeCloseTo(1000, 0);
    for (const f of [20, 440, 8000]) expect(imel(mel(f))).toBeCloseTo(f, 6);
  });
  it('写像は両端が 0 と 1、逆関数で戻る', () => {
    for (const ax of ['lin', 'log', 'mel'] as const) {
      const a = axisFn(ax, 20, 20000, FS, 4096);
      expect(a.fwd(a.lo)).toBeCloseTo(0, 9);
      expect(a.fwd(a.hi)).toBeCloseTo(1, 9);
      expect(a.inv(a.fwd(1234))).toBeCloseTo(1234, 6);
    }
  });
  it('上端は fs/2 で頭打ち、対数の下端は Δf と 1 Hz 以上', () => {
    expect(axisFn('lin', 0, 24000, 44100, 4096).hi).toBe(22050);
    expect(axisFn('log', 0, 20000, FS, 1024).lo).toBeCloseTo(FS / 1024, 9);
    expect(axisFn('lin', 0, 20000, FS, 1024).lo).toBe(0);
  });
  it('表示の点に bin をまとめる（最大）か、補間する', () => {
    const N = 4096,
      a = axisFn('log', 20, 20000, FS, N),
      m = binMap(801, a, FS, N),
      P = new Float32Array(N / 2 + 1);
    P[1000] = 1;
    const j = Math.round(a.fwd((1000 * FS) / N) * 800);
    expect(valAt(P, m, j)).toBe(1);
    /* 低い周波数は bin より細かいので補間する */
    P.fill(0);
    P[2] = 1;
    P[3] = 3;
    const f = (2.5 * FS) / N,
      j2 = Math.round(a.fwd(f) * 800);
    expect(m.k1[j2]).toBeLessThan(m.k0[j2]);
    expect(valAt(P, m, j2)).toBeGreaterThan(1);
    expect(valAt(P, m, j2)).toBeLessThan(3);
  });
  it('目盛り', () => {
    expect(fTicks('log', axisFn('log', 20, 20000, FS, 4096))).toEqual([
      20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000,
    ]);
    expect(fTicks('lin', axisFn('lin', 0, 20000, FS, 4096))).toEqual([0, 5000, 10000, 15000, 20000]);
    expect(niceStep(2500)).toBe(5000);
    expect(niceStep(1.2)).toBe(2);
    expect(fLab(2500)).toBe('2.5k');
    expect(fLab(500)).toBe('500');
    expect(dbStep(120)).toBe(20);
    expect(dbStep(40)).toBe(5);
  });
});

describe('読み取り', () => {
  it('ピークを放物線補間する', () => {
    const N = 8192,
      x = new Float32Array(N);
    genTest({ wave: 'sine', f: 1000, ra: [1, 1], ph: 0 }, FS, 0, N, x, new Float32Array(N));
    const [p] = spec(x, x, N, 'hann'),
      pk = peak((k) => p[k], 1, N / 2 - 1, FS / N);
    expect(pk?.f).toBeDefined();
    expect(Math.abs((pk?.f ?? 0) - 1000)).toBeLessThan(0.5);
    /* 振幅 0.7 = −3.1 dBFS。ハン窓の補間の誤差は 0.5 dB 以内 */
    expect(Math.abs((pk?.db ?? 0) - 20 * Math.log10(0.7))).toBeLessThan(0.5);
    expect(peak(() => 0, 1, 100, 1)).toBeNull();
  });
  it('音名とセント', () => {
    expect(noteOf(440)).toEqual({ name: 'A4', cent: 0 });
    expect(noteOf(261.63)).toEqual({ name: 'C4', cent: 0 });
    expect(noteOf(1500)).toEqual({ name: 'F♯6', cent: 23 });
    expect(noteOf(10)).toBeNull();
  });
});
