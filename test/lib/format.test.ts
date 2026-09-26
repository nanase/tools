import { describe, expect, it } from 'vitest';
import { fmt, parts, ro } from '../../src/lib/format';
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

  it('ro は単位を小さく出す HTML', () => {
    expect(ro(480.898, 'Hz')).toBe('480.9<span class="u">Hz</span>');
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
