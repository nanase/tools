import { describe, expect, it } from 'vitest';
import { bitStr } from '../src/tools/pcm/fig';
import { PARAMS, PRESETS } from '../src/tools/pcm/params';
import {
  aDecode,
  aEncode,
  aliasOf,
  g711Levels,
  idealSnr,
  muDecode,
  muEncode,
  quantize,
  restore,
  sample,
  saw,
  sine,
  specAt,
  stepOf,
  sweep,
} from '../src/tools/pcm/pcm';
import { makeSource, SOURCES } from '../src/tools/pcm/sources';
import { CAPTIONS, STEPS } from '../src/tools/pcm/story';

const F = 48000;
const rms = (x: ArrayLike<number>) => {
  let p = 0;
  for (let i = 0; i < x.length; i++) p += x[i] * x[i];
  return Math.sqrt(p / x.length);
};
const db = (v: number) => 20 * Math.log10(v);
/** 最も強いビンの周波数 [Hz] と強さ [dB] */
const peak = (x: ArrayLike<number>, M = 8192) => {
  const sp = specAt(x, x.length / 2, M);
  let k = 1;
  for (let i = 1; i < sp.length; i++) if (sp[i] > sp[k]) k = i;
  return { f: (k * F) / M, db: sp[k] };
};
const scaled = (x: Float32Array, g: number) => Float32Array.from(x, (v) => v * g);

describe('量子化', () => {
  it('正弦波の SN 比は 6.02N + 1.76 dB に近い', () => {
    /* 頭が切れないよう少し下げ、その分を足して比べる */
    const g = 0.99,
      x = scaled(sine(997, F, 1), g);
    for (const N of [8, 12, 16, 20]) expect(quantize(x, N).snr - db(g), `${N} bit`).toBeCloseTo(idealSnr(N), 0);
  });
  it('1 ビット増やすと SN 比は約 6 dB 上がる', () => {
    const x = scaled(sine(997, F, 1), 0.5),
      d = quantize(x, 13).snr - quantize(x, 12).snr;
    expect(d).toBeGreaterThan(5.5);
    expect(d).toBeLessThan(6.5);
  });
  it('誤差の電力は Δ²/12 に近く、誤差は ±Δ/2 に収まる', () => {
    const N = 10,
      x = scaled(sine(997, F, 1), 0.7),
      q = quantize(x, N),
      D = stepOf(N);
    expect(rms(q.e) ** 2 / ((D * D) / 12)).toBeCloseTo(1, 1);
    expect(q.e.reduce((m, v) => Math.max(m, Math.abs(v)), 0)).toBeLessThanOrEqual(D / 2 + 1e-9);
  });
  it('フルスケールを超える入力は最大の値で切れる', () => {
    const q = quantize([2, -2, 0], 4);
    expect([...q.code]).toEqual([7, -8, 0]);
    expect(q.y[0]).toBeCloseTo(7 / 8, 12);
    expect(q.y[1]).toBe(-1);
  });
  it('1 ビットは ±0.5 の 2 値', () => {
    const q = quantize([0.3, -0.3], 1);
    expect([...q.y]).toEqual([0.5, -0.5]);
  });
  it('ディザは誤差の電力を理論どおり 3 倍にし、小さい音の値を 0 に固めない', () => {
    const N = 10,
      x = scaled(sine(997, F, 1), 0.7),
      D = stepOf(N),
      e = quantize(x, N, 'lin', true).e;
    expect(rms(e) ** 2 / ((D * D) / 4)).toBeCloseTo(1, 1);
    const tiny = scaled(sine(997, F, 1), D * 0.3);
    expect(rms(quantize(tiny, N).y)).toBe(0);
    expect(rms(quantize(tiny, N, 'lin', true).y)).toBeGreaterThan(0);
  });
  it('2 進数は N 桁の 2 の補数', () => {
    expect(bitStr(-1, 4)).toBe('1111');
    expect(bitStr(-8, 4)).toBe('1000');
    expect(bitStr(5, 4)).toBe('0101');
    expect(bitStr(0, 1)).toBe('0');
    expect(bitStr(-8388608, 24)).toBe('100000000000000000000000');
  });
});

describe('G.711', () => {
  it('μ-law の代表の値（G.711 の表の端）', () => {
    expect(muEncode(0)).toBe(0xff);
    expect(muDecode(0xff)).toBe(0);
    expect(muDecode(0x80)).toBe(32124);
    expect(muDecode(0x00)).toBe(-32124);
    expect(muEncode(32767)).toBe(0x80);
    expect(muEncode(-32768)).toBe(0x00);
  });
  it('A-law の代表の値（G.711 の表の端）', () => {
    expect(aDecode(0xd5)).toBe(8);
    expect(aDecode(0x55)).toBe(-8);
    expect(aEncode(0)).toBe(0xd5);
    expect(aDecode(0xaa)).toBe(32256);
    expect(aDecode(0x2a)).toBe(-32256);
    expect(aEncode(32767)).toBe(0xaa);
    expect(aEncode(-32768)).toBe(0x2a);
  });
  it('どの符号語も、復号して符号化すると元に戻る', () => {
    for (let c = 0; c < 256; c++) {
      expect(aEncode(aDecode(c)), `A ${c}`).toBe(c);
      /* μ-law の負の 0 だけは正の 0 に戻る */
      if (c !== 0x7f) expect(muEncode(muDecode(c)), `μ ${c}`).toBe(c);
    }
    expect(muEncode(muDecode(0x7f))).toBe(0xff);
  });
  it('レベルは 256 個で小さい値ほど間隔が狭い', () => {
    for (const law of ['mu', 'a'] as const) {
      const v = g711Levels(law);
      expect(v.length).toBe(256);
      const near = v[129] - v[128],
        far = v[255] - v[254];
      expect(far / near, law).toBeGreaterThan(30);
    }
  });
  it('小さい音の SN 比は同じ 8 bit の線形より高い', () => {
    const x = scaled(sine(440, F, 1), 0.01),
      lin = quantize(x, 8).snr;
    expect(quantize(x, 8, 'mu').snr - lin).toBeGreaterThan(15);
    expect(quantize(x, 8, 'a').snr - lin).toBeGreaterThan(15);
  });
});

describe('標本化と再生', () => {
  it('ナイキスト周波数より低い音は振幅も周波数も保つ', () => {
    const x = scaled(sine(1000, F, 1), 0.5),
      o = restore(sample(x, F, 8000, true), F, 8000, x.length, 'smooth');
    expect(db(rms(o) / rms(x))).toBeCloseTo(0, 1);
    expect(Math.abs(peak(o).f - 1000)).toBeLessThan(10);
  });
  it('ローパスなしでは高い音が折り返す', () => {
    const x = scaled(sine(12000, F, 1), 0.5),
      o = restore(sample(x, F, 16000, false), F, 16000, x.length, 'smooth'),
      p = peak(o);
    expect(aliasOf(12000, 16000)).toBe(4000);
    expect(Math.abs(p.f - 4000)).toBeLessThan(10);
    expect(p.db).toBeGreaterThan(-10);
  });
  it('入力のローパスがあれば高い音は消える', () => {
    const x = scaled(sine(12000, F, 1), 0.5),
      o = restore(sample(x, F, 16000, true), F, 16000, x.length, 'smooth');
    expect(db(rms(o))).toBeLessThan(-60);
  });
  it('階段は標本の値をそのまま保つ', () => {
    const s = [0.1, 0.2, 0.3, 0.4],
      o = restore(s, F, 12000, 16, 'stair');
    expect([...o.slice(0, 8)].map((v) => +v.toFixed(3))).toEqual([0.1, 0.1, 0.1, 0.1, 0.2, 0.2, 0.2, 0.2]);
  });
  it('出力のローパスは標本の点を通る', () => {
    const x = sine(440, F, 0.25),
      s = sample(x, F, 8000, true),
      o = restore(s, F, 8000, x.length, 'smooth');
    for (let n = 100; n < 110; n++) expect(o[n * 6]).toBeCloseTo(s[n], 3);
  });
  it('音源以上の標本化周波数では音は変わらない', () => {
    const x = sine(1000, F, 0.25);
    for (const fs of [F, 96000, 192000]) {
      const o = restore(sample(x, F, fs, true), F, fs, x.length, 'smooth');
      expect(
        o.reduce((m, v, i) => Math.max(m, Math.abs(v - x[i])), 0),
        `${fs}`,
      ).toBeLessThan(1e-5);
    }
  });
});

describe('音源', () => {
  it('どの音源も 4 秒で振幅の最大が 1', () => {
    for (const [n] of SOURCES) {
      const x = makeSource(n, 440);
      expect(x.length, n).toBe(F * 4);
      expect(
        x.reduce((m, v) => Math.max(m, Math.abs(v)), 0),
        n,
      ).toBeCloseTo(1, 2);
    }
  });
  it('周期の音は 1 周の切れ目でつながる', () => {
    for (const x of [sine(440, F, 4), saw(441.7, F, 4)]) {
      const step = Math.abs(x[0] - x[x.length - 1]),
        typ = Math.abs(x[1] - x[0]);
      expect(step).toBeLessThanOrEqual(typ + 0.01);
    }
  });
  it('のこぎり波は 20 kHz まで倍音があり、スイープは頭と終わりが無音', () => {
    const x = saw(440, F, 1),
      sp = specAt(x, F / 2, 8192),
      at = (f: number) => sp[Math.round((f * 8192) / F)];
    expect(at(440 * 40)).toBeGreaterThan(-50);
    expect(at(22000)).toBeLessThan(-80);
    const y = sweep(F, 1);
    expect(y[0]).toBeCloseTo(0, 6);
    expect(Math.abs(y[y.length - 1])).toBeLessThan(0.01);
  });
});

describe('プリセット', () => {
  const list = (k: string) => PARAMS.find((d) => d.k === k)?.list as readonly number[];
  it('どれも入力の並びにある値で、ビットレートの小さい順', () => {
    let last = 0;
    for (const p of PRESETS) {
      expect(list('fs'), p.name).toContain(p.fs);
      expect(list('bits'), p.name).toContain(p.bits);
      const rate = p.fs * p.bits;
      expect(rate, p.name).toBeGreaterThanOrEqual(last);
      last = rate;
    }
  });
  it('G.711 は 8 kHz・8 bit', () => {
    for (const p of PRESETS.filter((q) => q.law !== 'lin')) expect([p.fs, p.bits], p.name).toEqual([8000, 8]);
  });
});

describe('文言', () => {
  it('工程と説明の数がそろっている', () => {
    expect(CAPTIONS.length).toBe(STEPS.length);
    expect(CAPTIONS[3]).toContain('8,000 × 4 = 32,000');
  });
});
