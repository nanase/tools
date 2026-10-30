import { describe, expect, it } from 'vitest';
import { dftOps, fftOps, radix2Formula, splitRadixFormula, twKind } from '../src/tools/fft/count';
import { bitrev, butterflies, dft, flow, group, log2, output, tw } from '../src/tools/fft/radix2';
import { rng, type SIGS, signal } from '../src/tools/fft/signals';
import { fft, plan } from '../src/tools/spectrum/fft';

const close = (a: ArrayLike<number>, b: ArrayLike<number>, eps = 1e-9) => {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) expect(Math.abs(a[i] - b[i])).toBeLessThan(eps);
};
const randC = (N: number, seed: number): [Float64Array, Float64Array] => {
  const r = rng(seed);
  return [Float64Array.from({ length: N }, () => 2 * r() - 1), Float64Array.from({ length: N }, () => 2 * r() - 1)];
};
const NS = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];

describe('ビット反転', () => {
  it('8 点は 0 4 2 6 1 5 3 7（Cooley–Tukey の桁の反転）', () => {
    expect(Array.from({ length: 8 }, (_, i) => bitrev(i, 3))).toEqual([0, 4, 2, 6, 1, 5, 3, 7]);
  });
  it('16 点で 3（0011）は 12（1100）、1（0001）は 8（1000）（Smith 12 章）', () => {
    expect(bitrev(3, 4)).toBe(12);
    expect(bitrev(1, 4)).toBe(8);
    expect(bitrev(15, 4)).toBe(15);
  });
  it('スペクトラムアナライザの並べ替えの表と同じ', () => {
    for (const N of NS) {
      const m = log2(N);
      expect(Array.from(plan(N).rev)).toEqual(Array.from({ length: N }, (_, i) => bitrev(i, m)));
    }
  });
  it('2 回反転すると戻る', () => {
    for (let i = 0; i < 64; i++) expect(bitrev(bitrev(i, 6), 6)).toBe(i);
  });
  it('2 の累乗でない N は受け付けない', () => {
    expect(() => log2(12)).toThrow();
    expect(() => log2(1)).toThrow();
  });
});

describe('回転因子', () => {
  it('W_8 の 0〜7 乗', () => {
    const h = Math.SQRT1_2;
    const want: [number, number][] = [
      [1, 0],
      [h, -h],
      [0, -1],
      [-h, -h],
      [-1, 0],
      [-h, h],
      [0, 1],
      [h, h],
    ];
    for (let p = 0; p < 8; p++) close(tw(8, p), want[p], 1e-15);
    close(tw(8, 9), want[1], 1e-15);
    close(tw(8, -1), want[7], 1e-15);
  });
  it('種類: 1・−i・(1 − i)/√2 の向き・一般', () => {
    expect(twKind(16, 0)).toBe('one');
    expect(twKind(16, 4)).toBe('mi');
    expect(twKind(16, 2)).toBe('eighth');
    expect(twKind(16, 6)).toBe('eighth');
    expect(twKind(16, 1)).toBe('gen');
    expect(twKind(4, 1)).toBe('mi');
  });
});

describe('バタフライの並び', () => {
  it('各段は N/2 個、どの行も 1 回ずつ', () => {
    for (const kind of ['dit', 'dif'] as const)
      for (const N of [4, 16, 64]) {
        const m = log2(N);
        for (let s = 1; s <= m; s++) {
          const bf = butterflies(N, kind, s);
          expect(bf.length).toBe(N / 2);
          expect(
            bf
              .flatMap((b) => [b.a, b.b])
              .sort((x, y) => x - y)
              .join(),
          ).toBe(Array.from({ length: N }, (_, i) => i).join());
        }
      }
  });
  it('DIT は段 s で 2^{s−1} 離れた行を組み、DIF はその逆の順', () => {
    const N = 16;
    for (let s = 1; s <= 4; s++) {
      for (const b of butterflies(N, 'dit', s)) expect(b.b - b.a).toBe(1 << (s - 1));
      for (const b of butterflies(N, 'dif', s)) expect(b.b - b.a).toBe(N >> s);
    }
  });
  it('回転因子: DIT の段 1 はすべて W^0、最後の段は W^0〜W^{N/2−1}。DIF は逆', () => {
    const N = 16;
    expect(butterflies(N, 'dit', 1).every((b) => b.p === 0)).toBe(true);
    expect(butterflies(N, 'dit', 4).map((b) => b.p)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(butterflies(N, 'dif', 1).map((b) => b.p)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(butterflies(N, 'dif', 4).every((b) => b.p === 0)).toBe(true);
  });
});

describe('変換の値', () => {
  it('DIT・DIF ともに定義どおりの DFT と同じ', () => {
    for (const N of NS) {
      const [re, im] = randC(N, N),
        [Xr, Xi] = dft(re, im);
      for (const kind of ['dit', 'dif'] as const) {
        const [Yr, Yi] = output(flow(re, im, kind));
        close(Yr, Xr, 1e-9 * N);
        close(Yi, Xi, 1e-9 * N);
      }
    }
  });
  it('スペクトラムアナライザの FFT と同じ', () => {
    for (const N of NS) {
      const [re, im] = randC(N, 7 + N),
        p = plan(N);
      p.re.set(re);
      p.im.set(im);
      fft(p);
      const [Yr, Yi] = output(flow(re, im, 'dit'));
      close(Yr, p.re, 1e-12 * N);
      close(Yi, p.im, 1e-12 * N);
    }
  });
  it('列の数は m + 2。DIT は並べ替えが先、DIF は後', () => {
    const f = flow(...signal('rand', 16), 'dit'),
      g = flow(...signal('rand', 16), 'dif');
    expect(f.re.length).toBe(6);
    expect(g.re.length).toBe(6);
    expect(f.steps[0].t).toBe('rev');
    expect(g.steps[4].t).toBe('rev');
  });
  it('見本: インパルスは全部 1、一定は X[0] = N、余弦 1 周は X[1] = X[N−1] = N/2、回転 2 周は X[2] = N', () => {
    const N = 16,
      out = (s: (typeof SIGS)[number][0]) => output(flow(...signal(s, N), 'dit'));
    close(out('imp')[0], new Float64Array(N).fill(1), 1e-12);
    const e = (k: number, v: number) => {
      const a = new Float64Array(N);
      a[k] = v;
      return a;
    };
    close(out('dc')[0], e(0, N), 1e-12);
    const c = e(1, N / 2);
    c[N - 1] = N / 2;
    close(out('cos')[0], c, 1e-12);
    close(out('cos')[1], new Float64Array(N), 1e-12);
    close(out('rot')[0], e(2, N), 1e-12);
    close(out('rot')[1], new Float64Array(N), 1e-12);
  });
  it('ずれたインパルスは |X[k]| = 1 で位相が −2πk/N', () => {
    const N = 8,
      [Xr, Xi] = output(flow(...signal('shift', N), 'dif'));
    for (let k = 0; k < N; k++) {
      expect(Math.hypot(Xr[k], Xi[k])).toBeCloseTo(1, 12);
      close(tw(N, k), [Xr[k], Xi[k]], 1e-12);
    }
  });
});

describe('途中の列の意味', () => {
  it('DIT の段 s の後、2^s 行の組は x[r0 + j·N/2^s] の 2^s 点の DFT（r0 は組の番号のビット反転）', () => {
    const N = 32,
      m = 5,
      [re, im] = randC(N, 3),
      f = flow(re, im, 'dit');
    for (let s = 1; s <= m; s++) {
      const L = 1 << s,
        c = s + 1;
      for (let g = 0; g < N / L; g++) {
        const r0 = bitrev(g, m - s),
          yr = Array.from({ length: L }, (_, j) => re[r0 + (j * N) / L]),
          yi = Array.from({ length: L }, (_, j) => im[r0 + (j * N) / L]),
          [Yr, Yi] = dft(yr, yi);
        close(f.re[c].subarray(g * L, g * L + L), Yr, 1e-12);
        close(f.im[c].subarray(g * L, g * L + L), Yi, 1e-12);
        expect(group(f, c, g * L + 1)).toEqual({ lo: g * L, size: L });
      }
    }
  });
  it('DIF の段 s の後、N/2^s 行の組の DFT は X[k0 + 2^s·k′]（k0 は組の番号のビット反転）', () => {
    const N = 32,
      m = 5,
      [re, im] = randC(N, 4),
      f = flow(re, im, 'dif'),
      [Xr, Xi] = dft(re, im);
    for (let s = 1; s <= m; s++) {
      const L = N >> s;
      for (let g = 0; g < 1 << s; g++) {
        const k0 = bitrev(g, s),
          [Zr, Zi] = dft(f.re[s].subarray(g * L, g * L + L), f.im[s].subarray(g * L, g * L + L));
        close(
          Zr,
          Array.from({ length: L }, (_, j) => Xr[k0 + (j << s)]),
          1e-9,
        );
        close(
          Zi,
          Array.from({ length: L }, (_, j) => Xi[k0 + (j << s)]),
          1e-9,
        );
        expect(group(f, s, g * L)).toEqual({ lo: g * L, size: L });
      }
    }
  });
  it('入力を変えると途中の列も変わる（線形: 和の列は列の和）', () => {
    const N = 16,
      a = randC(N, 5),
      b = randC(N, 6),
      fa = flow(...a, 'dit'),
      fb = flow(...b, 'dit'),
      fs = flow(
        a[0].map((v, i) => v + b[0][i]),
        a[1].map((v, i) => v + b[1][i]),
        'dit',
      );
    for (let c = 0; c < fs.re.length; c++) {
      close(
        fs.re[c],
        fa.re[c].map((v, i) => v + fb.re[c][i]),
        1e-12,
      );
      close(
        fs.im[c],
        fa.im[c].map((v, i) => v + fb.im[c][i]),
        1e-12,
      );
    }
  });
});

describe('演算の数', () => {
  it('定義どおり: 複素数の掛け算 N²、足し算 N(N − 1)', () => {
    expect(dftOps(8)).toMatchObject({ cmul: 64, cadd: 56 });
    expect(dftOps(1024).cmul).toBe(1048576);
  });
  it('FFT: 複素数の掛け算 (N/2) log2 N、足し算 N log2 N（DIT と DIF で同じ）', () => {
    for (const N of NS) {
      const m = log2(N);
      for (const kind of ['dit', 'dif'] as const)
        expect(fftOps(N, kind)).toMatchObject({ cmul: (N / 2) * m, cadd: N * m });
    }
    expect(fftOps(1024).cmul).toBe(5120);
  });
  it('すべて掛けると実数で 5 N log2 N（掛け算 2 N log2 N・足し算 3 N log2 N）', () => {
    for (const N of NS) {
      const m = log2(N),
        o = fftOps(N);
      expect(o.mul).toBe(2 * N * m);
      expect(o.add).toBe(3 * N * m);
    }
  });
  it('自明な回転因子を除き 3/3 で数えると (3/2)N log2 N − 5N + 8 と (7/2)N log2 N − 5N + 8（Duhamel–Vetterli 1990）', () => {
    for (const N of NS.slice(1)) {
      const o = fftOps(N, 'dit', '3/3', false),
        [M, A] = radix2Formula(N);
      expect([o.mul, o.add]).toEqual([M, A]);
      expect(fftOps(N, 'dif', '3/3', false)).toEqual(o);
    }
    expect(radix2Formula(16)).toEqual([24, 152]);
    expect(radix2Formula(1024)).toEqual([10248, 30728]);
  });
  it('自明な回転因子を除き 4/2 で数えると 2N log2 N − 7N + 12 と 3N log2 N − 3N + 4', () => {
    for (const N of NS.slice(1)) {
      const m = log2(N),
        o = fftOps(N, 'dit', '4/2', false);
      expect([o.mul, o.add]).toEqual([2 * N * m - 7 * N + 12, 3 * N * m - 3 * N + 4]);
    }
  });
  it('分割基数の式は N = 16 で 20・148、N = 1024 で 7172・27652', () => {
    expect(splitRadixFormula(16)).toEqual([20, 148]);
    expect(splitRadixFormula(1024)).toEqual([7172, 27652]);
  });
  it('N = 1024 で複素数の掛け算は 1/204.8', () => {
    expect(dftOps(1024).cmul / fftOps(1024).cmul).toBeCloseTo(204.8, 9);
  });
});
