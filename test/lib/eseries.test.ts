import { describe, expect, it } from 'vitest';
import { eList, inSeries, linList, nearIdx, nextOf, pow2List, prevOf, same } from '../../src/lib/eseries';

describe('eList', () => {
  it('1 桁ぶんの E6', () => {
    expect(eList(6, 1, 10)).toEqual([1, 1.5, 2.2, 3.3, 4.7, 6.8, 10]);
  });

  it('範囲の両端を含み、桁をまたいでも丸め誤差を出さない', () => {
    const L = eList(12, 100, 1e6);
    expect(L).toHaveLength(4 * 12 + 1);
    expect(L[0]).toBe(100);
    expect(L.at(-1)).toBe(1e6);
    expect(L).toContain(4700);
    expect(L).toContain(820_000);
  });

  it('小さい値でも正確（C の 1 pF〜1 mF）', () => {
    const L = eList(24, 1e-12, 1e-3);
    expect(L[0]).toBe(1e-12);
    expect(L).toContain(4.7e-9);
    expect(L).toContain(1e-7);
    expect(L.at(-1)).toBe(1e-3);
    expect(L).toHaveLength(9 * 24 + 1);
  });
});

describe('linList', () => {
  it('0.1 刻みで 1〜18', () => {
    const L = linList(1, 18, 0.1);
    expect(L).toHaveLength(171);
    expect(L[1]).toBe(1.1);
    expect(L[23]).toBe(3.3);
    expect(L.at(-1)).toBe(18);
  });
});

describe('前後の値', () => {
  const L = eList(12, 100, 1e6);

  it('系列上の値からは隣の値', () => {
    expect(nextOf(L, 10_000)).toBe(12_000);
    expect(prevOf(L, 10_000)).toBe(8200);
  });

  it('系列にない値からは、その上下で最も近い系列の値', () => {
    expect(nextOf(L, 5000)).toBe(5600);
    expect(prevOf(L, 5000)).toBe(4700);
  });

  it('端では undefined', () => {
    expect(nextOf(L, 1e6)).toBeUndefined();
    expect(prevOf(L, 100)).toBeUndefined();
  });

  it('nearIdx は対数で最も近い値を選ぶ', () => {
    expect(L[nearIdx(L, 5100, true)]).toBe(4700);
    expect(L[nearIdx(L, 5200, true)]).toBe(5600);
  });

  it('same は相対誤差 1e-9 まで同じとみなす', () => {
    expect(same(0.1 + 0.2, 0.3)).toBe(true);
    expect(same(4700, 4701)).toBe(false);
  });
});

describe('E1〜E192', () => {
  it('E1・E3 は 10 の累乗と 2.2・4.7', () => {
    expect(eList(1, 1e-3, 1e9)).toHaveLength(13);
    expect(eList(3, 1, 10)).toEqual([1, 2.2, 4.7, 10]);
  });

  it('E48・E96・E192 は 1 桁に 48・96・192 個、3 桁の値', () => {
    expect(eList(48, 1, 9.99)).toHaveLength(48);
    expect(eList(96, 1, 9.99)).toHaveLength(96);
    const L = eList(192, 100, 1000);
    expect(L).toHaveLength(193);
    expect(L).toContain(101);
    expect(L).toContain(988);
    expect(eList(192, 1e-12, 1e-11)).toContain(1.01e-12);
  });

  it('inSeries', () => {
    expect(inSeries(12, 4700)).toBe(true);
    expect(inSeries(12, 5000)).toBe(false);
    expect(inSeries(192, 1.24e-6)).toBe(true);
    expect(inSeries(12, 0)).toBe(false);
  });

  it('pow2List', () => {
    expect(pow2List(8, 10)).toEqual([256, 512, 1024]);
  });
});
