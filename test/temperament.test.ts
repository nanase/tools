import { describe, expect, it } from 'vitest';
import {
  amp,
  analyze,
  CHORDS,
  cents,
  chordOf,
  coincidence,
  coins,
  deviations,
  envelope,
  firstOrder,
  INTERVALS,
  justRatios,
  keyStats,
  M3,
  P5,
  type Setup,
  swell,
  TEMPERAMENTS,
  temperamentOf,
} from '../src/tools/temperament/tem';

const S: Setup = { tem: 'et', ton: 0, a4: 440, tb: 'organ', pt: 'concert', st: false };

describe('音律の 12 音', () => {
  /* 照合した値（Barbour 1951・Scala。C = 0、C♯〜B） */
  const REF: Record<string, number[]> = {
    pyth: [113.7, 203.9, 294.1, 407.8, 498.0, 611.7, 702.0, 815.6, 905.9, 996.1, 1109.8],
    just: [111.7, 203.9, 315.6, 386.3, 498.0, 590.2, 702.0, 813.7, 884.4, 996.1, 1088.3],
    mt4: [76.0, 193.2, 310.3, 386.3, 503.4, 579.5, 696.6, 772.6, 889.7, 1006.8, 1082.9],
    mt6: [88.6, 196.7, 304.9, 393.5, 501.6, 590.2, 698.4, 787.0, 895.1, 1003.3, 1091.9],
    wm3: [90.2, 192.2, 294.1, 390.2, 498.0, 588.3, 696.1, 792.2, 888.3, 996.1, 1092.2],
    kb3: [90.2, 193.2, 294.1, 386.3, 498.0, 590.2, 696.6, 792.2, 889.7, 996.1, 1088.3],
    val: [94.1, 196.1, 298.0, 392.2, 502.0, 592.2, 698.0, 796.1, 894.1, 1000.0, 1090.2],
    yg2: [90.2, 196.1, 294.1, 392.2, 498.0, 588.3, 698.0, 792.2, 894.1, 996.1, 1090.2],
  };
  for (const [v, ref] of Object.entries(REF))
    it(v, () => {
      const c = cents(temperamentOf(v));
      expect(c[0]).toBe(0);
      c.slice(1).forEach((x, i) => {
        expect(x).toBeCloseTo(ref[i], 1);
      });
    });
  it('平均律は 100 セント刻み', () => {
    cents(temperamentOf('et')).forEach((x, i) => {
      expect(x).toBeCloseTo(100 * i, 9);
    });
  });
  it('12 個の 5 度を足すと 7 オクターブ（閉じる）', () => {
    for (const t of TEMPERAMENTS) {
      const c = cents(t);
      let s = 0;
      for (let p = 0; p < 12; p++) s += (((c[(p + 7) % 12] - c[p]) % 1200) + 1200) % 1200;
      expect(s).toBeCloseTo(7 * 1200, 6);
    }
  });
  it('A をそろえ、主音へ移す', () => {
    const d = deviations('mt4', 0);
    expect(d[9]).toBe(0);
    /* 主音 G では、C のときの C 長調の音程が G 長調へ移る */
    const g = deviations('mt4', 7);
    expect(g[11] - g[7]).toBeCloseTo(d[4] - d[0], 9);
  });
});

describe('うなり', () => {
  it('一致する部分音', () => {
    expect(coincidence(7)).toEqual([3, 2]);
    expect(coincidence(4)).toEqual([5, 4]);
    expect(coincidence(3)).toEqual([6, 5]);
    expect(coincidence(12)).toEqual([2, 1]);
    expect(coincidence(16)).toEqual([5, 2]);
    expect(coincidence(28)).toEqual([5, 1]);
    expect(coincidence(10)).toBeNull();
    expect(coincidence(6)).toBeNull();
  });
  /* A4 = 440 Hz の平均律（Reblitz 1993 の表と一致する値） */
  it.each([
    [60, 4, 10.38],
    [60, 7, 0.886],
    [60, 5, 1.18],
    [53, 4, 6.93],
  ])('平均律の %i + %i 半音', (lo, d, beat) => {
    const r = analyze(S, lo, [0, d]);
    expect(Math.abs(r.pairs[0].b)).toBeCloseTo(beat, 2);
  });
  it('純正律の C 長調の主和音はうならない', () => {
    const r = analyze({ ...S, tem: 'just' }, 60, [0, 4, 7]);
    for (const p of r.pairs) expect(Math.abs(p.b)).toBeLessThan(1e-9);
  });
  it('平均律の長 3 度は広く、5 度は狭い', () => {
    const r = analyze(S, 60, [0, 4, 7]);
    const [ce, cg] = r.pairs;
    expect(ce.ct).toBeCloseTo(400 - M3, 6);
    expect(cg.ct).toBeCloseTo(700 - P5, 6);
  });
  it('正弦波では 3 度の部分音がないが、同じ速さの 2 次のうなりになる', () => {
    const r = analyze({ ...S, tb: 'sine' }, 60, [0, 4]),
      o = analyze(S, 60, [0, 4]);
    expect(r.pairs[0].ah).toBe(0);
    expect(amp('sine', 5)).toBe(0);
    expect(firstOrder(r.pairs[0])).toBe(false);
    expect(firstOrder(o.pairs[0])).toBe(true);
    /* Plomp 1967: 比 m:n に近い 2 つの純音は mN − nM 回/秒（C4 の 5 倍と E4 の 4 倍の差） */
    expect(Math.abs(r.pairs[0].b)).toBeCloseTo(10.38, 2);
    expect(r.pairs[0].b).toBeCloseTo(o.pairs[0].b, 9);
    const c = coins(r);
    expect(c).toHaveLength(1);
    expect(firstOrder(c[0])).toBe(false);
  });
  it('一致する部分音の 2 倍・3 倍の組も並べる', () => {
    const c = coins(analyze(S, 60, [0, 4, 7]));
    /* C–E は第 5・第 4、C–G は第 3・第 2 と第 6・第 4、E–G は第 6・第 5（オルガンは第 8 部分音まで） */
    expect(c.map((x) => [x.i, x.nl, x.nh])).toEqual([
      [0, 5, 4],
      [1, 3, 2],
      [1, 6, 4],
      [2, 6, 5],
    ]);
    expect(c[2].b).toBeCloseTo(2 * c[1].b, 9);
  });
  it('純正な比', () => {
    expect(justRatios(chordOf('maj').iv)).toEqual([4, 5, 6]);
    expect(justRatios(chordOf('min').iv)).toEqual([10, 12, 15]);
    expect(justRatios(chordOf('dom7').iv)).toEqual([20, 25, 30, 36]);
    expect(justRatios(chordOf('open').iv)).toEqual([1, 2, 3, 5]);
    expect(justRatios(chordOf('M17').iv)).toEqual([1, 5]);
    /* 一致する部分音が、比の目盛りの同じ位置に来る */
    for (const ch of [...CHORDS, ...INTERVALS]) {
      const r = analyze(S, 60, ch.iv),
        q = justRatios(ch.iv);
      for (const p of r.pairs) {
        if (!p.c) continue;
        const a = r.notes.indexOf(p.lo),
          b = r.notes.indexOf(p.hi);
        expect(p.c[0] * q[a]).toBe(p.c[1] * q[b]);
      }
    }
  });
  it('ピアノの非調和性で、長 3 度のうなりは遅く、5 度は速くなる', () => {
    const o = analyze(S, 60, [0, 4, 7]).pairs,
      p = analyze({ ...S, tb: 'piano' }, 60, [0, 4, 7]).pairs;
    expect(Math.abs(p[0].b)).toBeLessThan(Math.abs(o[0].b));
    expect(Math.abs(p[1].b)).toBeGreaterThan(Math.abs(o[1].b));
  });
  it('包絡は 0〜1 で、t = 0 で 1', () => {
    const p = analyze(S, 60, [0, 4]).pairs[0];
    expect(envelope(p, 0)).toBeCloseTo(1, 9);
    expect(envelope(p, 0.5 / Math.abs(p.b))).toBeCloseTo(Math.abs(p.al - p.ah) / (p.al + p.ah), 9);
  });
  it('和音の音の組の数', () => {
    for (const c of CHORDS) {
      const n = c.iv.length;
      expect(analyze(S, 60, c.iv).pairs).toHaveLength((n * (n - 1)) / 2);
    }
  });
});

describe('調ごとの主和音', () => {
  it('1/4 コンマ・ミーントーンは 8 つの調の長 3 度が純正、4 つはウルフの 3 度', () => {
    const k = keyStats({ ...S, tem: 'mt4' }, 4, false);
    expect(k.filter((x) => Math.abs(x.t3) < 1e-6)).toHaveLength(8);
    expect(k.filter((x) => x.t3 > 41)).toHaveLength(4);
    /* G♯–E♭ のウルフの 5 度は約 35.7 セント広い */
    expect(k[8].p5).toBeCloseTo(35.7, 1);
  });
  it('平均律はどの調も同じ', () => {
    const k = keyStats(S, 4, false);
    for (const x of k) expect(x.t3).toBeCloseTo(400 - M3, 9);
  });
});

describe('全体の音の揺れ', () => {
  const sw = (tem: string, tb: Setup['tb'], iv: readonly number[]) =>
    swell(analyze({ ...S, tem, tb }, 60, iv).notes, justRatios(iv), tb, 2, 200);
  const range = (v: number[]) => Math.max(...v) - Math.min(...v);
  it('純正律の長三和音（正弦波・オルガン）は揺れない', () => {
    expect(range(sw('just', 'sine', [0, 4, 7]))).toBeLessThan(1e-9);
    expect(range(sw('just', 'organ', [0, 4, 7]))).toBeLessThan(1e-9);
  });
  it('正弦波でも、平均律の長三和音は山の高さが 2 次のうなりで揺れる', () => {
    const v = sw('et', 'sine', [0, 4, 7]);
    expect(Math.max(...v)).toBeGreaterThan(0.99);
    expect(Math.min(...v)).toBeLessThan(0.7);
    expect(range(sw('et', 'sine', [0, 4]))).toBeGreaterThan(0.05);
  });
  it('ピアノは減衰を割って除くので、山の高さが 0〜1 に収まる', () => {
    for (const x of sw('et', 'piano', [0, 4, 7])) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});
