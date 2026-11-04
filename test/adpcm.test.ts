import { describe, expect, it } from 'vitest';
import { type AdpSet, decode, delta, encode, INDEX, marks, STEP } from '../src/tools/adpcm/adpcm';
import { PARAMS, PRESETS } from '../src/tools/adpcm/params';
import { CAPTIONS, STEPS } from '../src/tools/adpcm/story';
import { quantize, sample, saw, sine } from '../src/tools/pcm/pcm';

const F = 44100;
const ADPCM: AdpSet = { bits: 4, pred: true, adapt: true, fix: 337 };
const scaled = (x: ArrayLike<number>, g: number) => Float64Array.from(x as Float32Array, (v) => v * g);

describe('表', () => {
  it('間隔の表は IMA の 89 個で単調に増える', () => {
    expect(STEP.length).toBe(89);
    expect(STEP[0]).toBe(7);
    expect(STEP[88]).toBe(32767);
    for (let i = 1; i < STEP.length; i++) expect(STEP[i]).toBeGreaterThan(STEP[i - 1]);
  });
  it('番号の増減はビット数ごとに大きさの数だけある', () => {
    for (const N of [2, 3, 4, 5]) expect(INDEX[N].length).toBe(2 ** (N - 1));
    expect(INDEX[4]).toEqual([-1, -1, -1, -1, 2, 4, 6, 8]);
  });
});

describe('段階', () => {
  it('4 bit は IMA のシフトの計算と同じ値になる', () => {
    for (const step of [7, 16, 337, 32767])
      for (let m = 0; m < 8; m++) {
        const want = (step >> 3) + (m & 4 ? step : 0) + (m & 2 ? step >> 1 : 0) + (m & 1 ? step >> 2 : 0);
        expect(delta(m, step, 4)).toBe(want);
      }
  });
  it('どのビット数でも大きさとともに遠くなる', () => {
    for (const N of [2, 3, 4, 5])
      for (let m = 1; m < 2 ** (N - 1); m++) expect(delta(m, 1000, N)).toBeGreaterThan(delta(m - 1, 1000, N));
  });
});

describe('符号化', () => {
  it('手で計算した始めの標本と一致する', () => {
    /* 1000: 間隔 7 の一番外（距離 11）を選び、番号は 0 → 8 で間隔は 16 */
    const a = encode([1000 / 32768, 1000 / 32768], ADPCM);
    expect(a.code[0]).toBe(7);
    expect(a.y[0] * 32768).toBe(11);
    expect(a.st[1] * 32768).toBe(16);
    expect(a.p[1] * 32768).toBe(11);
    /* 残り 989: 間隔 16 の一番外（距離 2 + 16 + 8 + 4 = 30） */
    expect(a.code[1]).toBe(7);
    expect(a.y[1] * 32768).toBe(41);
  });
  it('負の差は正負のビットが立つ', () => {
    const a = encode([-1000 / 32768], ADPCM);
    expect(a.code[0]).toBe(15);
    expect(a.y[0] * 32768).toBe(-11);
  });
  it('フルスケールの外へ出ない', () => {
    const a = encode(new Float64Array(2000).fill(2), ADPCM);
    expect(Math.max(...a.y)).toBeLessThanOrEqual(32767 / 32768);
    expect(a.y[1999]).toBeGreaterThan(0.99);
  });
  it('記録したビットだけから同じ値へ戻せる（どの組み合わせでも）', () => {
    const x = sine(440, F, 0.2);
    for (const bits of [2, 3, 4, 5])
      for (const pred of [true, false])
        for (const adapt of [true, false]) {
          const o = { bits, pred, adapt, fix: 337 },
            a = encode(x, o);
          expect(decode(a.code, o)).toEqual(a.y);
        }
  });
  it('誤差は再生した値と入力の差で、SN 比はそこから求める', () => {
    const x = sine(440, F, 0.1),
      a = encode(x, ADPCM);
    let ps = 0,
      pe = 0;
    for (let i = 0; i < x.length; i++) {
      expect(a.e[i]).toBeCloseTo(a.y[i] - x[i], 12);
      ps += x[i] * x[i];
      pe += a.e[i] * a.e[i];
    }
    expect(a.snr).toBeCloseTo(10 * Math.log10(ps / pe), 9);
  });
});

describe('予測と適応', () => {
  it('予測なしは予測値が 0 のまま', () => {
    const a = encode(sine(440, F, 0.05), { ...ADPCM, pred: false });
    expect(a.p.every((v) => v === 0)).toBe(true);
  });
  it('適応なしは間隔が変わらない', () => {
    const a = encode(sine(440, F, 0.05), { ...ADPCM, adapt: false });
    expect(a.st.every((v) => v === 337 / 32768)).toBe(true);
  });
  it('音が大きくなると間隔が広がり、小さくなると狭まる', () => {
    const n = 8000,
      x = Float64Array.from({ length: n }, (_, i) => (i < n / 2 ? 0.8 : 0.01) * Math.sin((2 * Math.PI * 440 * i) / F)),
      a = encode(x, ADPCM);
    expect(a.st[n / 2 - 1]).toBeGreaterThan(a.st[n - 1] * 10);
  });
});

describe('PCM との比較', () => {
  const fs = 44100,
    tone = sample(sine(440, F, 1), F, fs, true);
  it('同じビット数なら正弦波の SN 比は PCM より高い', () => {
    expect(encode(tone, ADPCM).snr).toBeGreaterThan(quantize(tone, 4).snr + 15);
  });
  it('ビット数を増やすと SN 比が上がる', () => {
    let last = Number.NEGATIVE_INFINITY;
    for (const bits of [2, 3, 4, 5]) {
      const v = encode(tone, { ...ADPCM, bits }).snr;
      expect(v).toBeGreaterThan(last);
      last = v;
    }
  });
  it('入力を 40 dB 下げても SN 比がほとんど下がらない', () => {
    const a = encode(tone, ADPCM).snr,
      b = encode(scaled(tone, 0.01), ADPCM).snr,
      q = quantize(scaled(tone, 0.01), 4).snr;
    expect(a - b).toBeLessThan(15);
    expect(q).toBeLessThan(5);
  });
  it('のこぎり波の段差は追いつけず PCM より悪い', () => {
    const s = sample(saw(440, F, 1), F, 22050, true);
    expect(encode(s, ADPCM).snr).toBeLessThan(quantize(s, 4).snr);
  });
  it('1 ビットが壊れるとずれが最後まで残る', () => {
    const a = encode(tone, ADPCM),
      c = a.code.slice();
    c[1000] ^= 4;
    const y = decode(c, ADPCM),
      n = y.length;
    expect(Array.from(y.subarray(0, 1000))).toEqual(Array.from(a.y.subarray(0, 1000)));
    expect(Math.abs(y[n - 1] - a.y[n - 1])).toBeGreaterThan(1e-3);
  });
});

describe('移動先', () => {
  it('立ち上がり・静かな所・誤差が最大の所を見つける', () => {
    const fs = 8000,
      n = fs,
      s = Float64Array.from({ length: n }, (_, i) => {
        const t = i / fs;
        return (t < 0.5 ? 0.01 : 0.8) * Math.sin(2 * Math.PI * 440 * t);
      }),
      e = new Float64Array(n);
    e[6000] = 1;
    const m = marks(s, e, fs);
    expect(m.up).toBeGreaterThan(0.49);
    expect(m.up).toBeLessThan(0.51);
    expect(m.low).toBeLessThan(0.5);
    expect(m.big).toBeCloseTo(0.75, 2);
  });
  it('無音は静かな所に数えない', () => {
    const fs = 8000,
      s = new Float64Array(fs);
    for (let i = fs / 2; i < fs; i++) s[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / fs);
    expect(marks(s, new Float64Array(fs), fs).low).toBeGreaterThanOrEqual(0.5);
  });
});

describe('入力の定義', () => {
  const P = Object.fromEntries(PARAMS.map((d) => [d.k, d]));
  it('プリセットは入力の並びの中にある', () => {
    for (const p of PRESETS) {
      expect(P.fs.list).toContain(p.fs);
      expect(P.bits.list).toContain(p.bits);
    }
  });
  it('固定の間隔の既定値は表の中にある', () => {
    expect(STEP).toContain(P.gap.v);
  });
  it('工程と説明の数がそろう', () => {
    expect(CAPTIONS.length).toBe(STEPS.length);
  });
});
