import { describe, expect, it } from 'vitest';
import {
  COLORS,
  cssOf,
  DIGIT_KEYS,
  decode,
  encode,
  MULT_KEYS,
  multKey,
  TC_KEYS,
  TOL_KEYS,
} from '../../src/lib/colorcode';

const names = (L: readonly (keyof typeof COLORS)[]) => L.map((k) => COLORS[k].n).join('');

describe('色の対応（IEC 60062:2016）', () => {
  it('数字は黒 0 〜 白 9', () => {
    expect(names(DIGIT_KEYS)).toBe('黒茶赤橙黄緑青紫灰白');
    expect(DIGIT_KEYS.map((k) => COLORS[k].d)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
  it('乗数は桃 ×0.001・銀 ×0.01・金 ×0.1 から白 ×10^9 まで', () => {
    expect(names(MULT_KEYS)).toBe('桃銀金黒茶赤橙黄緑青紫灰白');
    expect(MULT_KEYS.map((k) => COLORS[k].m)).toEqual([-3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(multKey(-3)).toBe('pk');
    expect(multKey(2)).toBe('r');
    expect(multKey(10)).toBeUndefined();
  });
  it('許容差は小さい順、帯なしは ±20 %', () => {
    expect(names(TOL_KEYS)).toBe('灰黄橙紫青緑茶赤金銀なし');
    expect(TOL_KEYS.map((k) => COLORS[k].t)).toEqual([0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20]);
  });
  it('温度係数（ppm/K）は小さい順', () => {
    expect(names(TC_KEYS)).toBe('灰紫青橙緑黄赤茶黒');
    expect(TC_KEYS.map((k) => COLORS[k].tc)).toEqual([1, 5, 10, 15, 20, 25, 50, 100, 250]);
  });
  it('色見本の背景: 金・銀はグラデーション', () => {
    expect(cssOf('r')).toBe('#ff0000');
    expect(cssOf('gd')).toContain('linear-gradient');
    expect(COLORS.gd.fill).toBe('url(#lu-g)');
  });
});

describe('値の符号化', () => {
  it('2 桁・3 桁の数字と乗数に分ける', () => {
    expect(encode(4700, 2)).toEqual({ d: [4, 7], m: 2 });
    expect(encode(4700, 3)).toEqual({ d: [4, 7, 0], m: 1 });
    expect(encode(0.47, 2)).toEqual({ d: [4, 7], m: -2 });
    expect(encode(1.1, 2)).toEqual({ d: [1, 1], m: -1 });
    expect(encode(1000, 2)).toEqual({ d: [1, 0], m: 2 });
    expect(encode(999e9, 3)).toEqual({ d: [9, 9, 9], m: 9 });
  });
  it('桃（×0.001）まで使う', () => {
    expect(encode(0.01, 2)).toEqual({ d: [1, 0], m: -3 });
    expect(encode(0.01, 3)).toBeNull();
  });
  it('ちょうど表せない値・乗数の範囲外は null', () => {
    expect(encode(4990, 2)).toBeNull();
    expect(encode(1e12, 3)).toBeNull();
    expect(encode(0, 2)).toBeNull();
    expect(encode(Number.NaN, 2)).toBeNull();
  });
  it('数字と乗数から値に戻す', () => {
    expect(decode([4, 7], 2)).toBe(4700);
    expect(decode([1, 0], -3)).toBe(0.01);
    expect(decode([4, 9, 9], 1)).toBe(4990);
  });
});
