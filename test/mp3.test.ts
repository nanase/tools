import { describe, expect, it } from 'vitest';
import { BITRATES, encode, FS, SFB_L } from '../src/tools/mp3/encoder';
import { evaluate, findDelay, shifted, spectrogram } from '../src/tools/mp3/evaluate';
import { lowpass } from '../src/tools/mp3/filterbank';
import { followLp, LAME_LP, LP_NONE, lpView, PARAMS } from '../src/tools/mp3/params';
import { makeSource, SOURCES } from '../src/tools/mp3/sources';
import { caption, type LpPair, STEPS, type StoryData } from '../src/tools/mp3/story';
import { HUFF } from '../src/tools/mp3/tables';
import { decode, frames } from './mp3-decoder';

const DELAY = 1057;
const sine = (f: number, dur: number, a = 0.5) =>
  Float32Array.from({ length: Math.round(FS * dur) }, (_, i) => a * Math.sin((2 * Math.PI * f * i) / FS));
const snr = (a: Float32Array, b: Float32Array) => {
  let s = 0,
    e = 0;
  for (let i = 2000; i < a.length - 2000; i++) {
    s += a[i] * a[i];
    e += (a[i] - b[i]) ** 2;
  }
  return 10 * Math.log10(s / e);
};
/** 符号化して読み戻し、遅れを合わせて NMR を出す */
const nmrOf = (ch: Float32Array[], kbps: number, lp = 0) => {
  const d = decode(encode(ch, { kbps, lowpass: lp }).bytes);
  return evaluate(ch[0], shifted(d[0], DELAY, ch[0].length), lp).nmr;
};

describe('ハフマンの表', () => {
  it('どの表も符号が余らず欠けない（クラフトの不等式が等号）', () => {
    for (const [k, e] of Object.entries(HUFF)) {
      let kraft = 0;
      for (let i = 0; i < e.length; i += 3) kraft += 2 ** -e[i + 2];
      expect(kraft, `表 ${k}`).toBe(1);
    }
  });
});

describe('ビット列', () => {
  it('どのビットレートでも規格どおりのフレームの列になる', () => {
    const ch = makeSource('drums', 1);
    for (const kbps of BITRATES) {
      const { bytes, stats } = encode(ch, { kbps }),
        fs = frames(bytes);
      expect(fs.every((f) => f.kbps === kbps && f.nch === 1)).toBe(true);
      expect(bytes.length).toBeCloseTo((fs.length * 1152 * kbps * 1000) / 8 / FS, -1);
      expect(Math.max(...fs.map((f) => f.mainBegin))).toBeLessThanOrEqual(511);
      expect(Array.from(stats.res)).toEqual(fs.map((f) => f.mainBegin));
    }
  });
  it('ステレオも読める', () => {
    const fs = frames(encode(makeSource('mix', 1), { kbps: 128 }).bytes);
    expect(fs.every((f) => f.nch === 2)).toBe(true);
    expect(fs.some((f) => f.ms)).toBe(true);
  });
  it('正弦波は別実装のデコーダで元に戻る', () => {
    const x = sine(1000, 2),
      d = decode(encode([x], { kbps: 128 }).bytes);
    expect(snr(x, shifted(d[0], DELAY, x.length))).toBeGreaterThan(25);
  });
  it('遅れは 1057 サンプル', () => {
    const ch = makeSource('drums', 1),
      d = decode(encode(ch, { kbps: 192 }).bytes);
    expect(findDelay(ch[0], d[0])).toBe(DELAY);
  });
  it('M/S のステレオで左右が取り違わらない', () => {
    const l = sine(1000, 1.5),
      r = sine(1000, 1.5, 0.25),
      d = decode(encode([l, r], { kbps: 192 }).bytes);
    expect(snr(l, shifted(d[0], DELAY, l.length))).toBeGreaterThan(20);
    expect(snr(r, shifted(d[1], DELAY, r.length))).toBeGreaterThan(20);
  });
  it('高いビットレートは大きな値も符号にできる', () => {
    const x = sine(440, 1, 0.99),
      d = decode(encode([x], { kbps: 320 }).bytes);
    expect(snr(x, shifted(d[0], DELAY, x.length))).toBeGreaterThan(30);
  });
  it('無音でも止まらない', () => {
    const x = new Float32Array(FS),
      d = decode(encode([x], { kbps: 128 }).bytes);
    expect(Math.max(...d[0].map(Math.abs))).toBeLessThan(1e-3);
  });
});

describe('ブロックの型', () => {
  it('打音で短いブロックを使い、切り替えの順序を守る', () => {
    const { types } = encode(makeSource('drums', 2), { kbps: 128 }).stats,
      t = Array.from(types);
    expect(t.includes(2)).toBe(true);
    for (let i = 1; i < t.length; i++) {
      if (t[i] === 2) expect([1, 2]).toContain(t[i - 1]);
      if (t[i] === 3) expect(t[i - 1]).toBe(2);
      if (t[i - 1] === 1) expect(t[i]).toBe(2);
      if (t[i - 1] === 2) expect([2, 3]).toContain(t[i]);
    }
  });
  it('持続する音はほとんど長いブロック', () => {
    const t = Array.from(encode([sine(1000, 2)], { kbps: 128 }).stats.types);
    expect(t.filter((v) => v === 2).length).toBeLessThan(6);
  });
});

describe('音質とビット', () => {
  const ch = makeSource('drums', 2);
  it('ビットレートを上げると NMR が下がる', () => {
    const a = nmrOf(ch, 64),
      b = nmrOf(ch, 128),
      c = nmrOf(ch, 320);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
  });
  it('低いビットレートではローパスで NMR が下がる', () => {
    expect(nmrOf(ch, 64, 10000)).toBeLessThan(nmrOf(ch, 64) - 1);
  });
  it('下げすぎると逆に NMR が上がる', () => {
    expect(nmrOf(ch, 192, 4000)).toBeGreaterThan(nmrOf(ch, 192, 16000));
  });
  it('高音を捨てたぶんのビットが低い帯域へ回る', () => {
    const cut = 10000,
      k = SFB_L.findIndex((v) => (v * FS) / 2 / 576 >= cut),
      sum = (a: Float64Array, i0: number, i1: number) => a.subarray(i0, i1).reduce((s, v) => s + v, 0),
      none = encode(ch, { kbps: 64 }).stats.bandBits,
      lp = encode(ch, { kbps: 64, lowpass: cut }).stats.bandBits;
    expect(sum(lp, k + 1, 22)).toBeLessThan(sum(none, k + 1, 22) * 0.1);
    expect(sum(lp, 0, k)).toBeGreaterThan(sum(none, 0, k) * 1.1);
  });
  it('ビットの内訳が合う', () => {
    const { stats: s } = encode(ch, { kbps: 128 }),
      huff = s.bandBits.reduce((a, v) => a + v, 0);
    expect(huff + s.sfBits).toBeCloseTo(s.mainBits, 3);
    expect(s.sideBits + s.mainBits).toBeLessThanOrEqual(s.totalBits);
  });
  it('ビットリザーバを使う', () => {
    const r = encode(ch, { kbps: 128 }).stats.res;
    expect(Math.max(...r)).toBeGreaterThan(100);
  });
});

describe('ローパス', () => {
  it('通過域は変えず、阻止域を落とす', () => {
    const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length),
      low = lowpass(sine(4000, 1), FS, 10000),
      high = lowpass(sine(14000, 1), FS, 10000);
    expect(rms(low.subarray(2000, -2000)) / rms(sine(4000, 1).subarray(2000, -2000))).toBeCloseTo(1, 2);
    expect(rms(high.subarray(2000, -2000))).toBeLessThan(0.002);
  });
  it('遅れが出ない', () => {
    const x = sine(1000, 1),
      y = lowpass(x, FS, 10000);
    expect(snr(x, y)).toBeGreaterThan(50);
  });
  it('fc がナイキスト周波数以上なら入力のまま', () => {
    const x = sine(1000, 0.1);
    expect(lowpass(x, FS, 22050)).toBe(x);
    expect(lowpass(x, FS, 0)).toBe(x);
  });
});

describe('評価', () => {
  it('同じ音なら雑音なし', () => {
    const x = makeSource('pluck', 1)[0],
      e = evaluate(x, x, 0);
    expect(e.nmr).toBeLessThan(-100);
    expect(e.over).toBe(0);
  });
  it('大きな雑音を足すと閾値を超える', () => {
    const x = makeSource('pluck', 1)[0],
      y = Float32Array.from(x, (v, i) => v + 0.05 * Math.sin(i * i * 0.37));
    expect(evaluate(x, y, 0).over).toBeGreaterThan(0.5);
  });
  it('純音は雑音より閾値が厳しい（Johnston のオフセット）', () => {
    /* 同じ大きさの差を、純音に足したときのほうが NMR が大きい */
    const n = FS,
      noise = Float32Array.from({ length: n }, (_, i) => 0.3 * Math.sin(i * i * 0.37)),
      tone = sine(1000, 1, 0.3),
      err = Float32Array.from({ length: n }, (_, i) => 0.003 * Math.sin(i * i * 0.11)),
      withErr = (x: Float32Array) => Float32Array.from(x, (v, i) => v + err[i]);
    expect(evaluate(tone, withErr(tone), 0).nmr).toBeGreaterThan(evaluate(noise, withErr(noise), 0).nmr);
  });
  it('遅れを見つける', () => {
    const x = makeSource('drums', 1)[0],
      y = new Float32Array(x.length + 500);
    y.set(x, 321);
    expect(findDelay(x, y)).toBe(321);
    expect(shifted(y, 321, x.length)[1000]).toBeCloseTo(x[1000], 6);
  });
  it('スペクトログラムで正弦波の周波数が見える', () => {
    const s = spectrogram(sine(5512.5, 0.5, 1)),
      row = Array.from({ length: s.R }, (_, r) => s.d[10 * s.R + r]),
      top = row.indexOf(Math.max(...row));
    expect(((top + 0.5) / s.R) * (FS / 2)).toBeCloseTo(5512.5, -2);
  });
});

describe('しくみの札', () => {
  const ch = makeSource('drums', 2),
    a = encode(ch, { kbps: 64, capture: 20 }),
    b = encode(ch, { kbps: 64, lowpass: 17000 }),
    pair: LpPair = { cut: 17000, none: a.stats, with: b.stats, nmrNone: 3, nmrWith: 2 },
    d = (p: LpPair | null): StoryData => {
      if (!a.stats.capture) throw new Error('途中経過がない');
      return { cap: a.stats.capture, stats: a.stats, x: ch[0], dur: 2, pair: p, cut: 17000 };
    };
  it('工程は 7 つで、札に「。」を使わない', () => {
    expect(STEPS.length).toBe(7);
    for (let i = 0; i < STEPS.length; i++) expect(caption(i, d(pair)), `工程 ${i + 1}`).not.toContain('。');
  });
  it('途中経過は長いブロックを選ぶ', () => {
    expect(a.stats.capture?.type).toBe(0);
    expect(a.stats.capture?.fr).toBeGreaterThanOrEqual(20);
  });
  it('空いたビットがほとんどなければ、そのことを出す', () => {
    expect(caption(6, d(pair))).not.toContain('空いた 0 kbps');
  });
  it('sfb 21 の中のローパスでも空いたビットを数える', () => {
    const hi = encode(makeSource('pad', 2), { kbps: 320 }),
      lp = encode(makeSource('pad', 2), { kbps: 320, lowpass: 17000 }),
      p: LpPair = { cut: 17000, none: hi.stats, with: lp.stats, nmrNone: 3, nmrWith: 2 };
    expect(caption(6, { ...d(p), dur: 2 })).toMatch(/空いた [1-9]/);
  });
  it('比較がまだなら計算中と出す', () => {
    expect(caption(6, d(null))).toBe('計算中…');
  });
});

describe('定義', () => {
  it('LAME の既定はどのビットレートにもある', () => {
    for (const k of BITRATES) expect(LAME_LP[k], `${k}`).toBeGreaterThan(4000);
  });
  it('LAME の既定はビットレートに追随し、手で決めた値は動かない', () => {
    expect(followLp(LAME_LP[128], 128, 64)).toBe(LAME_LP[64]);
    expect(followLp(LAME_LP[64], 64, 320)).toBe(LAME_LP[320]);
    expect(followLp(12000, 128, 64)).toBe(12000);
    expect(followLp(0, 128, 64)).toBe(0);
  });
  it('ローパスの「なし」', () => {
    expect(lpView(LP_NONE)).toBe('なし');
    expect(lpView(17000)).toBe('17k');
    expect(lpView(15100)).toBe('15.1k');
    expect(PARAMS.find((p) => p.k === 'lp')?.v).toBe(LP_NONE);
  });
  it('サンプル音源はどれも音があり、頭が切れない', () => {
    for (const [name] of SOURCES) {
      const ch = makeSource(name, 0.5),
        m = Math.max(...ch.map((c) => Math.max(...c.map(Math.abs))));
      expect(m, name).toBeCloseTo(0.9, 3);
    }
  });
  it('サンプル音源は作るたびに同じ', () => {
    expect(makeSource('drums', 0.2)[0]).toEqual(makeSource('drums', 0.2)[0]);
  });
});
