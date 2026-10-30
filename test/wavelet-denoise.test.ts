import { describe, expect, it } from 'vitest';
import { sigmaMad, snr, universal, wavedec, waverec } from '../src/tools/wavelet/dwt';
import { noisy, rng, sample } from '../src/tools/wavelet/signals';
import { addNoise, CLIPS, clip, noise, rms } from '../src/tools/wavelet-denoise/clips';
import { bits, dequantize, kth, quantize } from '../src/tools/wavelet-denoise/code';
import { dct, dct4, idct, imdct, irdft, mdct, rdft, sineWin } from '../src/tools/wavelet-denoise/fourier';
import { BASES, compressAudio, dec, denoiseAudio, forward, unflat } from '../src/tools/wavelet-denoise/run';
import { apply, bayesLam, plan, sureHybrid, sureMin } from '../src/tools/wavelet-denoise/thresh';

const rand = (n: number, seed = 3) => {
  const r = rng(seed);
  return Float64Array.from({ length: n }, () => r() * 2 - 1);
};
const sum2 = (a: ArrayLike<number>) => Array.from(a).reduce((s, v) => s + v * v, 0);
const maxErr = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  Array.from(a).reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);
const mse = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  Array.from(a).reduce((s, v, i) => s + (v - b[i]) ** 2, 0) / a.length;

describe('フーリエの側', () => {
  it('DCT-II は定義の和（正規直交の係数）と一致し、逆で戻り、エネルギーを保つ', () => {
    const N = 32,
      x = rand(N),
      X = dct(x);
    for (let k = 0; k < N; k++) {
      let s = 0;
      for (let n = 0; n < N; n++) s += x[n] * Math.cos((Math.PI * (n + 0.5) * k) / N);
      expect(X[k]).toBeCloseTo(s * Math.sqrt((k ? 2 : 1) / N), 12);
    }
    expect(maxErr(idct(X), x)).toBeLessThan(1e-12);
    expect(sum2(X)).toBeCloseTo(sum2(x), 10);
  });
  it('実数の DFT の並べ替えは正規直交で、逆で戻る', () => {
    const x = rand(64, 9),
      c = rdft(x);
    expect(sum2(c)).toBeCloseTo(sum2(x), 10);
    expect(maxErr(irdft(c), x)).toBeLessThan(1e-12);
    /* 1 番目の余弦の係数: √(2/N) Σ x cos(2πn/N) */
    let s = 0;
    for (let n = 0; n < 64; n++) s += x[n] * Math.cos((2 * Math.PI * n) / 64);
    expect(c[2]).toBeCloseTo(Math.sqrt(2 / 64) * s, 12);
  });
  it('DCT-IV は定義の和と一致し、2 回で M/2 倍に戻る', () => {
    const M = 16,
      u = rand(M, 4),
      X = dct4(u);
    for (let k = 0; k < M; k++) {
      let s = 0;
      for (let n = 0; n < M; n++) s += u[n] * Math.cos((Math.PI / M) * (n + 0.5) * (k + 0.5));
      expect(X[k]).toBeCloseTo(s, 12);
    }
    expect(
      maxErr(
        dct4(X).map((v) => v / (M / 2)),
        u,
      ),
    ).toBeLessThan(1e-12);
  });
  it('MDCT は定義の和 Σ w x cos(π/M (n + ½ + M/2)(k + ½)) と一致する', () => {
    const M = 8,
      x = rand(40, 6),
      c = mdct(x, M),
      w = sineWin(M);
    for (let f = 0; f < c.length / M; f++)
      for (let k = 0; k < M; k++) {
        let s = 0;
        for (let n = 0; n < 2 * M; n++) {
          const i = (f - 1) * M + n,
            v = i >= 0 && i < x.length ? x[i] : 0;
          s += w[n] * v * Math.cos((Math.PI / M) * (n + 0.5 + M / 2) * (k + 0.5));
        }
        expect(c[f * M + k]).toBeCloseTo(s * Math.sqrt(2 / M), 12);
      }
  });
  it('MDCT は時間の折り返しが打ち消し合って完全に戻り（TDAC）、エネルギーを保つ', () => {
    const M = 64,
      x = rand(1000, 8),
      c = mdct(x, M);
    expect(maxErr(imdct(c, M, x.length), x)).toBeLessThan(1e-12);
    expect(sum2(c)).toBeCloseTo(sum2(x), 9);
  });
});

describe('閾値', () => {
  it('SURE の最小は、すべての候補で SURE を計算して選んだものと同じ', () => {
    const r = rng(2),
      x = Float64Array.from(
        { length: 200 },
        (_, i) => (i < 20 ? 4 : 0) + Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(6.283 * r()),
      );
    const sure = (t: number) =>
      x.length - 2 * x.filter((v) => Math.abs(v) <= t).length + x.reduce((s, v) => s + Math.min(v * v, t * t), 0);
    let best = sure(0),
      bt = 0;
    for (const v of x) {
      const t = Math.abs(v);
      if (t <= Math.sqrt(2 * Math.log(x.length)) && sure(t) < best) {
        best = sure(t);
        bt = t;
      }
    }
    expect(sureMin(x)).toBeCloseTo(bt, 12);
  });
  it('雑音だけ（疎）なら hybrid は普遍閾値 √(2 ln n) を選ぶ', () => {
    const [, nz] = noisy(new Float64Array(1024), 1, 3);
    expect(sureHybrid(nz)).toBeCloseTo(Math.sqrt(2 * Math.log(1024)), 12);
  });
  it('BayesShrink: σ_X = √(mean d² − σ²) で λ = σ²/σ_X、信号がなければ全部捨てる', () => {
    expect(bayesLam([3, -4, 0, 0], 1)).toBeCloseTo(1 / Math.sqrt(25 / 4 - 1), 12);
    expect(bayesLam([0.5, -0.5], 1)).toBe(0.5);
  });
  it('段ごとの σ: ピンク雑音では粗い段ほど σ が大きく、最も細かい段の値 1 つでは足りない', () => {
    const c = wavedec(noise('pink', 1 << 14), 'db4', 8),
      p = plan(c, 'universal', 'level');
    for (let j = 1; j < 8; j++) expect(p.sig[j]).toBeGreaterThan(p.sig[j - 1]);
    /* 白色雑音なら段ごとにほぼ同じ */
    const pw = plan(wavedec(noise('white', 1 << 14), 'db4', 8), 'universal', 'level');
    for (let j = 0; j < 6; j++) expect(pw.sig[j] / pw.sig[0]).toBeGreaterThan(0.85);
  });
  it('普遍閾値・全体の σ・λ 倍率 1 は、ウェーブレット変換のページの denoise と同じ λ', () => {
    const [, nz] = noisy(sample('doppler', 1024), 7, 5),
      c = wavedec(nz, 'db4', 6),
      p = plan(c, 'universal', 'global');
    for (const l of p.lam) expect(l).toBeCloseTo(universal(sigmaMad(c.d[0]), 1024), 12);
  });
  it('Donoho・Johnstone の 4 信号（n = 2048・SN 比 7・柔らかい閾値）で、SURE は普遍閾値より誤差が小さい', () => {
    for (const s of ['doppler', 'blocks', 'bumps', 'heavisine'] as const) {
      const [clean, nz] = noisy(sample(s, 2048), 7, 5),
        c = wavedec(nz, 'db4', 7),
        e = (r: 'universal' | 'sure') => mse(clean, waverec(apply(c, plan(c, r, 'global').lam, 'soft').c));
      expect(e('sure')).toBeLessThan(e('universal'));
    }
  });
});

describe('ずらして平均', () => {
  it('Haar・硬い閾値の Blocks は、16 回ずらして平均すると誤差が減る（Coifman・Donoho）', () => {
    const [clean, nz] = noisy(sample('blocks', 2048), 7, 5),
      x = Float32Array.from(nz),
      o = { w: 'haar', J: 7, rule: 'universal', sm: 'global', m: 'hard', k: 1 } as const;
    expect(mse(clean, denoiseAudio(x, { ...o, spin: 16 }).y)).toBeLessThan(
      0.8 * mse(clean, denoiseAudio(x, { ...o, spin: 1 }).y),
    );
  });
});

describe('量子化とビット数', () => {
  it('不感帯つきの量子化: 幅より小さいものは 0、戻すと区間の中点', () => {
    expect(Array.from(quantize([0.4, -0.99, 1, -2.5, 3.2], 1))).toEqual([0, 0, 1, -2, 3]);
    expect(Array.from(dequantize([0, 1, -2], 0.5))).toEqual([0, 0.75, -1.25]);
  });
  it('位置 + 値は列全体の 0 次のエントロピー × n（連鎖律）', () => {
    const q = [0, 0, 0, 0, 1, -1, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0],
      b = bits(q),
      n = q.length,
      cnt = new Map<number, number>();
    for (const v of q) cnt.set(v, (cnt.get(v) ?? 0) + 1);
    let H = 0;
    for (const m of cnt.values()) H -= (m / n) * Math.log2(m / n);
    expect(b.nz).toBe(4);
    expect(b.pos + b.val).toBeCloseTo(n * H, 12);
  });
  it('K 番目に大きい絶対値', () => {
    expect(kth([1, -5, 3, 0.5], 2)).toBe(3);
    expect(kth([1, 2], 0)).toBe(Number.POSITIVE_INFINITY);
    /* 0 でない係数が足りなければ、0 でない最も小さいもの */
    expect(kth([0, 0, 0, 3, -0.5], 3)).toBe(0.5);
    expect(kth([0, 0], 1)).toBe(0);
  });
  it('無音を多く含む音: 0 でない係数をすべて残しても、量子化した音は元の音に近い', () => {
    const x = new Float32Array(48000);
    for (let i = 20000; i < 20400; i++) x[i] = 0.8 * Math.sin(i / 3);
    for (const [b] of BASES) expect(snr(x, compressAudio(x, b, 0.3).y)).toBeGreaterThan(10);
  });
});

describe('音の処理', () => {
  const fs = 16000;
  it('試しの音は 4 種類とも最大 0.5、雑音は狙いの SN 比', () => {
    for (const [k] of CLIPS) {
      const x = clip(k, fs, 2);
      expect(Math.max(...Array.from(x, Math.abs))).toBeCloseTo(0.5, 6);
      for (const nk of ['white', 'pink'] as const) {
        const [, w] = addNoise(x, nk, 12);
        expect(20 * Math.log10(rms(x) / rms(w))).toBeCloseTo(12, 4);
      }
    }
  });
  it('1 列に並べた係数から戻せる（どの基底も、全部残せば元の音）', () => {
    const x = clip('pluck', fs, 1),
      c = dec(x, 'db4', 8);
    expect(
      maxErr(
        waverec(
          unflat(
            Float64Array.from([
              ...c.a,
              ...c.d
                .slice()
                .reverse()
                .flatMap((v) => [...v]),
            ]),
            'db4',
            c.a.length << 8,
            8,
          ),
        ).subarray(0, x.length),
        x,
      ),
    ).toBeLessThan(1e-6);
    for (const [b] of BASES) {
      const [f, inv] = forward(x, b);
      expect(maxErr(inv(f).subarray(0, x.length), x)).toBeLessThan(1e-6);
      expect(sum2(f)).toBeCloseTo(sum2(x), 4);
    }
  });
  it('白色雑音（SN 比 10 dB）の打楽器: SURE で柔らかく切ると SN 比が 3 dB 以上上がり、取り除いた成分は足した雑音に近い', () => {
    const x = clip('drums', 48000, 3),
      [nz, w] = addNoise(x, 'white', 10),
      o = denoiseAudio(nz, { w: 'db4', J: 8, rule: 'sure', sm: 'global', m: 'soft', k: 1, spin: 1 });
    expect(snr(x, o.y)).toBeGreaterThan(snr(x, nz) + 3);
    const removed = Float32Array.from(nz, (v, i) => v - o.y[i]);
    expect(rms(removed) / rms(w)).toBeGreaterThan(0.8);
    expect(rms(removed) / rms(w)).toBeLessThan(1.2);
  });
  it('雑音だけの区間から測る σ: 白色は段によらず 1、ピンクは粗い段ほど大きい', () => {
    for (const k of ['white', 'pink'] as const) {
      const n = noise(k, 1 << 15),
        c = dec(Float32Array.from(n), 'db4', 8),
        p = plan(c, 'sure', 'quiet', 1, [0, 1 << 14]);
      if (k === 'white') for (const s of p.sig) expect(s).toBeCloseTo(1, 0);
      else for (let j = 1; j < 8; j++) expect(p.sig[j]).toBeGreaterThan(p.sig[j - 1]);
    }
  });
  it('ピンク雑音では、雑音だけの区間から段ごとに測った σ のほうが、全体の σ より SN 比が高い', () => {
    const fs = 48000,
      x = clip('drums', fs, 3, 0.5),
      [nz] = addNoise(x, 'pink', 10),
      o = { w: 'db4', J: 8, rule: 'sure', m: 'soft', k: 1, spin: 1, quiet: [0, fs / 2] } as const;
    expect(snr(x, denoiseAudio(nz, { ...o, sm: 'quiet' }).y)).toBeGreaterThan(
      snr(x, denoiseAudio(nz, { ...o, sm: 'global' }).y) + 1,
    );
  });
  it('無音のない音でも、足した雑音そのものから段ごとに測った σ なら、ピンク雑音で全体の σ より SN 比が高い', () => {
    const x = clip('drums', 48000, 4),
      [nz, w] = addNoise(x, 'pink', 10),
      o = { w: 'db4', J: 8, rule: 'sure', m: 'soft', k: 1, spin: 1 } as const;
    expect(snr(x, denoiseAudio(nz, { ...o, sm: 'quiet', noise: w }).y)).toBeGreaterThan(
      snr(x, denoiseAudio(nz, { ...o, sm: 'global' }).y) + 1,
    );
  });
  it('同じ 5 % を残すと、打楽器はウェーブレットが DCT・DFT より、持続音は MDCT がウェーブレットより SN 比が高い', () => {
    const s = (k: 'drums' | 'organ', b: 'wav' | 'dct' | 'dft' | 'mdct') => {
      const x = clip(k, fs, 2);
      return snr(x, compressAudio(x, b, 0.05).yk);
    };
    expect(s('drums', 'wav')).toBeGreaterThan(s('drums', 'dct'));
    expect(s('drums', 'wav')).toBeGreaterThan(s('drums', 'dft'));
    expect(s('organ', 'mdct')).toBeGreaterThan(s('organ', 'wav'));
  });
  it('圧縮: 量子化しないときの誤差の 2 乗和は捨てた係数の 2 乗和（0 で埋めた所を除く）、ビット数は PCM 16 ビットよりずっと少ない', () => {
    const x = clip('pluck', fs, 1),
      o = compressAudio(x, 'wav', 0.05),
      [c] = forward(x, 'wav'),
      dropped = Array.from(c).reduce((s, v) => s + (Math.abs(v) < o.step ? v * v : 0), 0);
    /* 0 で埋めた末尾の誤差は聞く音に入らないので、少しだけ小さい */
    const e2 = sum2(Float32Array.from(x, (v, i) => v - o.yk[i]));
    expect(e2).toBeLessThanOrEqual(dropped + 1e-9);
    expect(e2).toBeGreaterThan(0.99 * dropped);
    expect(o.kept).toBeGreaterThanOrEqual(Math.round(0.05 * x.length));
    expect((o.pos + o.val) / (16 * x.length)).toBeLessThan(0.1);
  });
});
