import { describe, expect, it } from 'vitest';
import { fmt, fmtR, minus, parts, plain, ro } from '../../src/lib/format';
import { nice } from '../../src/lib/scope';

describe('SI 接頭辞つきの整形', () => {
  it.each([
    [4700, 'Ω', undefined, '4.7 kΩ'],
    [1e-7, 'F', undefined, '100 nF'],
    [1e6, 'Ω', undefined, '1 MΩ'],
    [480.898, 'Hz', undefined, '480.9 Hz'],
    [1.386294e-3, 's', undefined, '1.386 ms'],
    [5e-4, 'A', undefined, '500 μA'],
    [2.5e-3, 'W', undefined, '2.5 mW'],
    [0, 'V', undefined, '0 V'],
    [-0.0015, 'A', undefined, '−1.5 mA'],
    [1e-13, 's', undefined, '0.1 ps'],
    [3.3e12, 'Hz', undefined, '3300 GHz'],
    [12345, 'Ω', 3, '12.3 kΩ'],
  ])('%d %s (sig %s) → %s', (v, u, sig, s) => {
    expect(fmt(v, u, sig)).toBe(s);
  });

  it('丸めで 1000 に届いたら次の接頭辞へ繰り上げる', () => {
    expect(fmt(999_999, 'Hz')).toBe('1 MHz');
    expect(fmt(0.99999, 's')).toBe('1 s');
  });

  it('有限でない値はダッシュ', () => {
    expect(parts(Number.NaN, 'Hz')).toEqual(['—', '']);
    expect(fmt(Number.POSITIVE_INFINITY, 'Hz')).toBe('—');
  });

  it('単位なしでは接頭辞だけ', () => {
    expect(parts(4700, '', 3)).toEqual(['4.7', 'k']);
    expect(parts(5, '')).toEqual(['5', '']);
  });

  it('ro は単位を小さく出す HTML。計算結果なので末尾の 0 を残す', () => {
    expect(ro(480.898, 'Hz')).toBe('480.9<span class="u">Hz</span>');
    expect(ro(440.3, 'Hz', 5)).toBe('440.30<span class="u">Hz</span>');
    expect(ro(1000, 'Hz', 5)).toBe('1.0000<span class="u">kHz</span>');
  });

  it('fmtR は末尾の 0 を残す（fmt は落とす）', () => {
    expect(fmtR(440.3, 'Hz', 5)).toBe('440.30 Hz');
    expect(fmt(440.3, 'Hz', 5)).toBe('440.3 Hz');
    expect(fmtR(4700, 'Ω', 2)).toBe('4.7 kΩ');
    expect(fmtR(999_999, 'Hz')).toBe('1.000 MHz');
    expect(fmtR(-0.0015, 'A')).toBe('−1.500 mA');
    expect(fmtR(0, 'V')).toBe('0 V');
    /* 桁が整数部より少ないときは丸めた整数（指数表記にしない） */
    expect(fmtR(123456, 'Ω', 2)).toBe('120 kΩ');
    expect(parts(4700, '', 4, true)).toEqual(['4.700', 'k']);
  });
});

describe('nice', () => {
  it.each([
    [0.3, 0.5],
    [1, 1],
    [1.0000001, 1],
    [1.5, 2],
    [2.1, 5],
    [7, 10],
    [6.93e-4, 1e-3],
    [1.2e-6, 2e-6],
  ])('%d → %d', (x, v) => {
    expect(nice(x)).toBe(v);
  });
});

describe('接頭辞なしの表記', () => {
  it.each([
    [0.0047, undefined, '0.0047'],
    [-12.5, undefined, '−12.5'],
    [20, undefined, '20'],
    [0, undefined, '0'],
    [1e-5, undefined, '1e-5'],
    [1.5e-5, undefined, '1.5e-5'],
    [1.23456789, 3, '1.23'],
    [123456.7, 6, '123457'],
  ])('%d (sig %s) → %s', (v, sig, s) => {
    expect(plain(v, sig)).toBe(s);
  });

  it('有限でない値はダッシュ', () => {
    expect(plain(Number.NaN)).toBe('—');
  });

  it('keep なら末尾の 0 を残す', () => {
    expect(plain(12.5, 4, true)).toBe('12.50');
    expect(plain(-3, 3, true)).toBe('−3.00');
    expect(plain(0, 4, true)).toBe('0');
    expect(plain(123456.7, 3, true)).toBe('123000');
  });

  it('minus は先頭のハイフンをマイナス記号にする', () => {
    expect(minus('-3')).toBe('−3');
    expect(minus('3-1')).toBe('3-1');
  });
});
