import { describe, expect, it } from 'vitest';
import { CDELTA, cdelta, cwt, fourierFactor, icwt, jMax, power, scales } from '../src/tools/wavelet/cwt';
import {
  analyze,
  bank,
  compress,
  denoise,
  flat,
  maxLevel,
  mra,
  sigmaMad,
  snr,
  universal,
  WAVS,
  wavedec,
  waverec,
} from '../src/tools/wavelet/dwt';
import { freqs, ScaloBank } from '../src/tools/wavelet/live';
import { atom, dwtTiles, stftTiles } from '../src/tools/wavelet/plane';
import { noisy, rng, sample, sigAt } from '../src/tools/wavelet/signals';
import { processAudio, testClip } from '../src/tools/wavelet/sound';
import { gaborSpread, HEISENBERG, morletSpread, stft } from '../src/tools/wavelet/tf';

const rand = (n: number, seed = 3) => {
  const r = rng(seed);
  return Float64Array.from({ length: n }, () => r() * 2 - 1);
};
const sum = (a: ArrayLike<number>) => Array.from(a).reduce((s, v) => s + v, 0);
const sum2 = (a: ArrayLike<number>) => Array.from(a).reduce((s, v) => s + v * v, 0);

describe('フィルタ', () => {
  it('db2 は閉じた形 (1+√3)/(4√2) … で、PyWavelets の値と一致する', () => {
    const h = bank('db2').h;
    const py = [0.4829629131445341, 0.8365163037378079, 0.2241438680420134, -0.1294095225512604];
    for (let i = 0; i < 4; i++) expect(h[i]).toBeCloseTo(py[i], 15);
  });
  it('Σh = √2・Σh² = 1・2 つずらしで直交（正規直交の条件）', () => {
    for (const [w] of WAVS) {
      const h = bank(w).h;
      expect(sum(h)).toBeCloseTo(Math.SQRT2, 12);
      expect(sum2(h)).toBeCloseTo(1, 12);
      for (let m = 1; 2 * m < h.length; m++) {
        let s = 0;
        for (let n = 0; n + 2 * m < h.length; n++) s += h[n] * h[n + 2 * m];
        expect(s).toBeCloseTo(0, 12);
      }
    }
  });
  it('dbp の高域は p 個の積率が消える: Σ g[n] n^k = 0（k < p）', () => {
    for (const [w, , p] of WAVS) {
      const g = bank(w).g;
      for (let k = 0; k < p; k++) {
        const m = Array.from(g).reduce((s, v, n) => s + v * n ** k, 0);
        expect(Math.abs(m)).toBeLessThan(1e-9 * 10 ** k);
      }
      /* p 次の積率は消えない */
      expect(Math.abs(Array.from(g).reduce((s, v, n) => s + v * n ** p, 0))).toBeGreaterThan(1e-3);
    }
  });
});

describe('分解と合成', () => {
  it('Haar の 1 段: a = (x0 + x1)/√2・d = (x0 − x1)/√2', () => {
    const { a, d } = analyze([3, 1, 4, 8], 'haar');
    expect(Array.from(a)).toEqual([4 / Math.SQRT2, 12 / Math.SQRT2].map((v) => expect.closeTo(v, 12)));
    expect(Array.from(d)).toEqual([2 / Math.SQRT2, -4 / Math.SQRT2].map((v) => expect.closeTo(v, 12)));
  });
  it('どのフィルタでも完全に戻り、エネルギーを保つ', () => {
    const x = rand(256);
    for (const [w] of WAVS) {
      const c = wavedec(x, w, 10);
      expect(c.d.length).toBe(maxLevel(256, w));
      const y = waverec(c);
      for (let i = 0; i < x.length; i++) expect(y[i]).toBeCloseTo(x[i], 11);
      expect(sum2(flat(c))).toBeCloseTo(sum2(x), 9);
    }
  });
  it('段の数: 長さがフィルタより短くなる前で止める', () => {
    expect(maxLevel(256, 'haar')).toBe(8);
    expect(maxLevel(256, 'db4')).toBe(6);
    expect(maxLevel(96, 'haar')).toBe(5);
  });
  it('p − 1 次までの多項式は、端の折り返しを除いて詳細が 0', () => {
    for (const [w, , p] of WAVS) {
      const x = Float64Array.from({ length: 64 }, (_, i) => (i / 64) ** (p - 1) * 3 + 0.5);
      const { d } = analyze(x, w),
        L = bank(w).h.length;
      for (let k = 0; k < 32 - L / 2; k++) expect(Math.abs(d[k])).toBeLessThan(1e-10);
    }
  });
  it('多重解像度の成分の和は元の信号', () => {
    const x = rand(128, 5),
      parts = mra(wavedec(x, 'db3', 4));
    expect(parts.length).toBe(5);
    for (let i = 0; i < 128; i++) expect(sum(parts.map((p) => p[i]))).toBeCloseTo(x[i], 11);
  });
  it('Haar で Blocks（段だけの信号）を分けると、詳細は段の所にしか出ない', () => {
    const x = sample('blocks', 1024),
      c = wavedec(x, 'haar', 10),
      nz = c.d.reduce((s, v) => s + v.filter((u) => Math.abs(u) > 1e-9).length, 0);
    /* 11 か所の段が各段で高々 1 つの係数に入る */
    expect(nz).toBeLessThanOrEqual(11 * 10);
    expect(nz).toBeGreaterThan(11);
  });
});

describe('Donoho・Johnstone の試しの信号', () => {
  it('値（WaveLab の MakeSignal）', () => {
    expect(sigAt('heavisine', 0.5)).toBeCloseTo(-2, 12);
    expect(sigAt('blocks', 0.5)).toBeCloseTo(4 - 5 + 3 - 4 + 5 - 4.2 + 2.1, 12);
    expect(sigAt('bumps', 0.4)).toBeCloseTo(4.2 + 1e-3, 2);
    expect(sigAt('doppler', 0.5)).toBeCloseTo(0.5 * Math.sin((2 * Math.PI * 1.05) / 0.55), 12);
  });
  it('雑音の σ を最も細かい詳細の中央値から推定できる（±10 %）', () => {
    const [, y, sg] = noisy(sample('doppler', 2048), 7);
    const est = sigmaMad(wavedec(y, 'db4', 1).d[0]);
    expect(est / sg).toBeGreaterThan(0.9);
    expect(est / sg).toBeLessThan(1.1);
  });
  it('普遍閾値で硬く切ると、4 つの信号どれも誤差の 2 乗和が雑音の半分未満になる', () => {
    for (const s of ['doppler', 'blocks', 'bumps', 'heavisine'] as const) {
      const n = 2048,
        [x, y, sg] = noisy(sample(s, n), 7, 11),
        c = wavedec(y, s === 'blocks' ? 'haar' : 'db4', 6),
        lam = universal(sigmaMad(c.d[0]), n),
        e0 = sum2(y.map((v, i) => v - x[i])),
        err = (m: 'hard' | 'soft') => sum2(waverec(denoise(c, lam, m).c).map((v, i) => v - x[i])) / e0;
      expect(lam / sg).toBeCloseTo(Math.sqrt(2 * Math.log(n)), 0);
      expect(err('hard')).toBeLessThan(0.5);
      /* 柔らかい閾値は山を λ だけ削るので、細い山の並ぶ Bumps では雑音より悪くなる */
      if (s !== 'bumps') expect(err('soft')).toBeLessThan(0.5);
      else expect(err('soft')).toBeGreaterThan(err('hard'));
    }
  });
  it('圧縮: 捨てた係数の 2 乗和が誤差の 2 乗和に等しい', () => {
    const x = sample('heavisine', 1024),
      c = wavedec(x, 'db4', 6),
      r = compress(c, 60),
      y = waverec(r.c);
    expect(flat(r.c).filter((v) => v !== 0).length).toBe(60);
    expect(sum2(y.map((v, i) => v - x[i]))).toBeCloseTo(r.err2, 8);
    expect(snr(x, y)).toBeCloseTo(10 * Math.log10(r.energy / r.err2), 8);
    /* 滑らかな信号は 6 % の係数で 30 dB を超える */
    expect(snr(x, y)).toBeGreaterThan(30);
  });
});

describe('連続ウェーブレット変換（Torrence・Compo 1998）', () => {
  it('Morlet（ω0 = 6）のフーリエ周期は 1.033 s', () => {
    expect(fourierFactor(6)).toBeCloseTo(1.033, 3);
  });
  it('尺度の数: Niño3 の例（N = 506・δt = 1/4 年・s0 = 2δt・δj = 0.125）', () => {
    /* 式 (10) の上限は 63。図 1b は 2 の 7 乗までの J = 56 で、0.5〜64 年の 57 本 */
    expect(jMax(506, 0.25, 0.5, 0.125)).toBe(63);
    const s = scales(0.5, 0.125, 56);
    expect(s.length).toBe(57);
    expect(s[56]).toBeCloseTo(64, 9);
  });
  it('δ 関数から求めた Cδ は表 2 の 0.776（ナイキストより上まで尺度を並べたとき）', () => {
    expect(cdelta(1024, 0.25, scales(0.125, 0.125, 80), 0.125)).toBeCloseTo(CDELTA, 2);
    /* s0 = 2δt で止めると、ナイキストの近くを取りこぼして小さくなる */
    expect(cdelta(1024, 0.25, scales(0.5, 0.125, 56), 0.125)).toBeLessThan(0.72);
  });
  it('再構成（式 (11)）の誤差は分散の 3 % 未満、白色雑音のエネルギー（式 (14)）は ±10 %', () => {
    const N = 512,
      dt = 1,
      dj = 0.125,
      s0 = dt / 2,
      s = scales(s0, dj, jMax(N, dt, s0, dj)),
      x = rand(N, 9),
      m = sum(x) / N,
      xc = x.map((v) => v - m),
      c = cwt(x, dt, s),
      y = icwt(c, dj),
      v = sum2(xc) / N;
    expect(sum2(y.map((u, i) => u - xc[i])) / N / v).toBeLessThan(0.03);
    const P = power(c),
      e = P.reduce((acc, row, j) => acc + sum(row) / s[j], 0) * ((dj * dt) / (CDELTA * N));
    expect(e / v).toBeGreaterThan(0.9);
    expect(e / v).toBeLessThan(1.1);
  });
  it('周期 P の余弦は、尺度 P/1.033 で最もパワーが大きい', () => {
    const N = 1024,
      P = 32,
      dj = 1 / 32,
      s = scales(4, dj, 160),
      x = Float64Array.from({ length: N }, (_, n) => Math.cos((2 * Math.PI * n) / P)),
      pw = power(cwt(x, 1, s)).map((r) => sum(r.subarray(256, 768)));
    const j = pw.indexOf(Math.max(...pw));
    expect(Math.abs(Math.log2(s[j] / (P / fourierFactor(6))))).toBeLessThanOrEqual(dj);
  });
  it('δ 関数のパワーは √2 s 離れると e⁻² に減る（影響の円錐）', () => {
    const N = 512,
      s = Float64Array.of(8),
      x = new Float64Array(N);
    x[256] = 1;
    const p = power(cwt(x, 1, s))[0],
      off = Math.round(Math.SQRT2 * 8 * 4) / 4;
    /* 整数の位置で比べるため、√2·8 ≈ 11.3 に近い 11 と 12 の間を補う */
    const at = (d: number) => p[256 + Math.floor(d)] + (p[256 + Math.ceil(d)] - p[256 + Math.floor(d)]) * (d % 1);
    expect(at(off) / p[256]).toBeCloseTo(Math.exp(-2), 2);
  });
});

describe('時間と周波数の箱', () => {
  it('ガウスの窓と Morlet は不確定性の下限 1/(4π) にちょうど届く', () => {
    const [a, b] = gaborSpread(0.01);
    expect(a * b).toBeCloseTo(HEISENBERG, 14);
    for (const s of [0.001, 0.1, 3]) {
      const m = morletSpread(s);
      expect(m.dt * m.df).toBeCloseTo(HEISENBERG, 14);
      /* Q（中心の周波数 / 幅）は尺度に依らない */
      expect(m.f / m.df).toBeCloseTo(morletSpread(1).f / morletSpread(1).df, 10);
    }
  });
  it('DWT の箱は N 個で、どれも面積 1/2、合わせて平面全体を覆う（時間 N/fs × 周波数 fs/2）', () => {
    const N = 64,
      c = wavedec(rand(N), 'haar', 4),
      b = dwtTiles(c),
      area = (t: { t0: number; t1: number; f0: number; f1: number }) => (t.t1 - t.t0) * N * (t.f1 - t.f0) * 0.5;
    expect(b.length).toBe(N);
    for (const t of b) expect(area(t)).toBeCloseTo(0.5, 12);
    expect(sum(b.map(area))).toBeCloseTo(N / 2, 10);
  });
  it('STFT の箱は N/2 個（複素数 1 つで実数 2 つ）で面積 1、平面全体を覆う', () => {
    const N = 256,
      b = stftTiles(rand(N), 32);
    expect(b.length).toBe(N / 2);
    expect(sum(b.map((t) => (t.t1 - t.t0) * (t.f1 - t.f0)))).toBeCloseTo(1, 12);
  });
  it('DWT の箱の波形は、その係数だけを 1 にして戻した波形で、エネルギー 1・ほかの箱と直交', () => {
    const N = 128,
      c = wavedec(rand(N), 'db2', 5),
      b = dwtTiles(c),
      p = atom(b[70], N, { c }),
      q = atom(b[3], N, { c });
    expect(sum2(p)).toBeCloseTo(1, 12);
    expect(sum(p.map((v, i) => v * q[i]))).toBeCloseTo(0, 12);
  });
  it('STFT の箱は、その周波数の正弦波で最も大きい', () => {
    const N = 256,
      L = 32,
      /* 箱 k = 3 の中心 (3.5)·fs/L */
      x = Float64Array.from({ length: N }, (_, n) => Math.cos((2 * Math.PI * 3.5 * n) / L)),
      b = stftTiles(x, L).filter((t) => t.t0 === 0.5),
      top = b.reduce((m, t) => (t.v > m.v ? t : m));
    expect(top.k % (L / 2)).toBe(3);
  });
  it('STFT（ハン）は振幅 1 の正弦波で、その周波数の bin のパワーが 1', () => {
    const N = 256,
      x = Float64Array.from({ length: 4096 }, (_, n) => Math.sin((2 * Math.PI * 32 * n) / N));
    const col = stft(x, N, 128)[16];
    expect(col[32]).toBeCloseTo(1, 6);
  });
});

describe('音のスカログラム', () => {
  it('振幅 1 の正弦波は、その周波数の行で 1（0 dBFS）', () => {
    const fs = 48000,
      f = freqs(100, 8000, 12),
      b = new ScaloBank(fs, f, 480),
      i = 36,
      x = Float32Array.from({ length: 2 * b.delay + 1 }, (_, n) => Math.sin((2 * Math.PI * f[i] * n) / fs)),
      out = new Float32Array(f.length);
    b.column(x, b.delay, out);
    expect(out[i]).toBeCloseTo(1, 3);
    /* 1 オクターブ上の行（σ が半分）: 周波数の差 f は包絡の σ_ω の ω0/2 倍なので e^(−ω0²/8) */
    expect(out[i + 12] / Math.exp(-4.5)).toBeCloseTo(1, 1);
    /* 1 オクターブ下の行: 本来 e^(−ω0²/2) ≈ 1.5e-8 だが、核を ±4σ で切った漏れ（−70 dB 程度）で決まる */
    expect(out[i - 12]).toBeLessThan(1e-4);
    expect(out[i + 1]).toBeLessThan(out[i]);
  });
  it('列の計算量は低い周波数の行で決まる（100 Hz 〜 8 kHz・1 オクターブ 12 本で 1 列 30 万回未満）', () => {
    const b = new ScaloBank(48000, freqs(100, 8000, 12), 480);
    expect(b.cost).toBeLessThan(300000);
  });
});

describe('音の処理', () => {
  it('何もしなければ元の音に戻り、圧縮で全部残しても同じ', () => {
    const x = testClip('mix', 8000, 0.3);
    for (const p of [{ kind: 'off' as const }, { kind: 'compress' as const, keep: 1 }]) {
      const r = processAudio(x, 'db4', 8, p);
      for (let i = 0; i < x.length; i += 37) expect(r.y[i]).toBeCloseTo(x[i], 5);
    }
  });
  it('低い音・打音・高い音に雑音を足すと、普遍閾値で硬く切って SN 比が 5 dB 上がる', () => {
    const fs = 32000,
      x = testClip('mix', fs, 1),
      y = testClip('mix', fs, 1, 0.05),
      r = processAudio(y, 'db4', 8, { kind: 'denoise', m: 'hard', k: 1 });
    expect(snr(x, r.y)).toBeGreaterThan(snr(x, y) + 5);
  });
  it('掃引の音は DWT では疎にならず、閾値で切ると高い所が削れて SN 比が下がる', () => {
    const fs = 32000,
      x = testClip('sweep', fs, 1),
      y = testClip('sweep', fs, 1, 0.05),
      r = processAudio(y, 'db4', 8, { kind: 'denoise', m: 'soft', k: 1 });
    expect(snr(x, r.y)).toBeLessThan(snr(x, y));
  });
});
