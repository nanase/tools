import { describe, expect, it } from 'vitest';
import { parse } from '../../src/lib/parse';

describe('parse', () => {
  it.each([
    ['4.7k', 'Ω', 4700],
    ['4k7', 'Ω', 4700],
    ['4R7', 'Ω', 4.7],
    ['470', 'Ω', 470],
    ['1meg', 'Ω', 1e6],
    ['1MEG', 'Ω', 1e6],
    ['1M', 'Ω', 1e6],
    ['1e3', 'Ω', 1000],
    ['2.2E-1k', 'Ω', 220],
    ['4.7 kΩ', 'Ω', 4700],
    ['4.7kohm', 'Ω', 4700],
    ['1,000', 'Ω', 1000],
    ['.5k', 'Ω', 500],
    ['0.1u', 'F', 1e-7],
    ['0.1μ', 'F', 1e-7],
    ['0.1µF', 'F', 1e-7],
    ['100n', 'F', 1e-7],
    ['100nF', 'F', 1e-7],
    ['1p', 'F', 1e-12],
    ['3V3', 'V', 3.3],
    ['3.3V', 'V', 3.3],
    ['12', 'V', 12],
  ] as const)('%s (%s) → %d', (raw, unit, v) => {
    expect(parse(raw, unit)).toBe(v);
  });

  it('全角の数字・記号・接頭辞を読む', () => {
    expect(parse('４．７ｋ', 'Ω')).toBe(4700);
    expect(parse('１００ｎ', 'F')).toBe(1e-7);
    expect(parse('３Ｖ３', 'V')).toBe(3.3);
  });

  it.each([
    ['', 'Ω'],
    ['   ', 'Ω'],
    ['abc', 'Ω'],
    ['4.7x', 'Ω'],
    ['1..2', 'Ω'],
    ['-1', 'Ω'],
    ['k', 'Ω'],
    ['4k7k', 'Ω'],
    ['1e', 'Ω'],
    ['3V3', 'Ω'],
  ] as const)('不正値 %j (%s) は NaN', (raw, unit) => {
    expect(parse(raw, unit)).toBeNaN();
  });
});

describe('parse: 符号と単位', () => {
  it.each([
    ['-12.5', 'm', -12.5],
    ['−3', 'm', -3],
    ['–3', 'm', -3],
    ['+3dB', 'dB', 3],
    ['-6 dB', 'dB', -6],
    ['−1e-3', '', -1e-3],
    ['-4.7m', '', -0.0047],
  ] as const)('符号つき %s (%s) → %d', (raw, unit, v) => {
    expect(parse(raw, unit, true)).toBe(v);
  });

  it('符号を読まない既定では負の値は NaN', () => {
    expect(parse('-6', 'dB')).toBeNaN();
    expect(parse('+3', 'dB')).toBeNaN();
    expect(parse('-', 'dB', true)).toBeNaN();
  });

  it.each([
    ['1.5kHz', 'Hz', 1500],
    ['44.1 kHz', 'Hz', 44100],
    ['48k', 'Hz', 48000],
    ['50%', '%', 50],
    ['4.7m', 'm', 4.7],
    ['4.7', 'm', 4.7],
    ['2.5m/s', 'm/s', 2.5],
    ['2.5m', 'm/s', 0.0025],
    ['10uH', 'H', 1e-5],
    ['10 μH', 'H', 1e-5],
    ['10ms', 's', 0.01],
    ['4.7m', '', 0.0047],
    ['1k', '', 1000],
  ] as const)('%s (%s) → %d', (raw, unit, v) => {
    expect(parse(raw, unit)).toBe(v);
  });
});

describe('parse: mm と µm（接頭辞を読まない）', () => {
  it.each([
    ['0.5', 'mm', 0.5],
    ['0.5mm', 'mm', 0.5],
    ['0.5 MM', 'mm', 0.5],
    ['8mil', 'mm', 0.2032],
    ['10 mils', 'mm', 0.254],
    ['35', 'µm', 35],
    ['35um', 'µm', 35],
    ['35µm', 'µm', 35],
    ['35μm', 'µm', 35],
    ['１２', 'µm', 12],
  ] as const)('%s (%s) → %d', (raw, unit, v) => {
    expect(parse(raw, unit)).toBe(v);
  });

  it.each([
    ['0.5m', 'mm'],
    ['1k', 'mm'],
    ['8mil', 'µm'],
    ['35n', 'µm'],
    ['-1', 'mm'],
  ] as const)('不正値 %s (%s) は NaN', (raw, unit) => {
    expect(parse(raw, unit)).toBeNaN();
  });
});

describe('parse: 質量・組立単位・回転の単位', () => {
  it.each([
    ['0.23kg', 'kg', 0.23],
    ['0.23 kg', 'kg', 0.23],
    ['0.23', 'kg', 0.23],
    ['1.5kg', 'g', 1500],
    ['230 g', 'g', 230],
    ['5.4 N·s/m', 'N·s/m', 5.4],
    ['5.4N*s/m', 'N·s/m', 5.4],
    ['5.4 N s/m', 'N·s/m', 5.4],
    ['5.4 N⋅s/m', 'N·s/m', 5.4],
    ['5.4 N・s/m', 'N·s/m', 5.4],
    ['78.8 kg·cm²', 'kg·cm²', 78.8],
    ['78.8kg*cm^2', 'kg·cm²', 78.8],
    ['78.8 kg cm2', 'kg·cm²', 78.8],
    ['3.9 g·cm²', 'g·cm²', 3.9],
    ['7.67 mN·m/A', 'mN·m/A', 7.67],
    ['7.67mN*m/A', 'mN·m/A', 7.67],
    ['23.4m N·m/A', 'N·m/A', 0.0234],
    ['0.0024 N·m·s', 'N·m·s', 0.0024],
    ['2.4m N·m·s', 'N·m·s', 0.0024],
    ['2.4m', 'N·m·s', 0.0024],
    ['10 mN·m', 'N·m', 0.01],
    ['0.05 N·s', 'N·s', 0.05],
    ['6 m/s²', 'm/s²', 6],
    ['6m/s^2', 'm/s²', 6],
    ['3 rad/s', 'rad/s', 3],
    ['180 V/rad', 'V/rad', 180],
    ['27 V·s/rad', 'V·s/rad', 27],
    ['1.5 V/(rad·s)', 'V/(rad·s)', 1.5],
    ['1.5 V/rad*s', 'V/(rad·s)', 1.5],
    ['0.22 rad/m', 'rad/m', 0.22],
    ['0.27 rad·s/m', 'rad·s/m', 0.27],
    ['3000rpm', 'rpm', 3000],
    ['3k rpm', 'rpm', 3000],
    ['0.25 rev', 'rev', 0.25],
    ['500 P/R', 'P/R', 500],
    ['１．５ｋｇ', 'kg', 1.5],
  ] as const)('%s (%s) → %d', (raw, unit, v) => {
    expect(parse(raw, unit)).toBe(v);
  });

  it('符号つき', () => {
    expect(parse('−3 rad/s', 'rad/s', true)).toBe(-3);
  });

  it.each([
    /* 接頭辞を含む単位では接頭辞を読まない */
    ['1m', 'kg'],
    ['230g', 'kg'],
    ['10k', 'g·cm²'],
    ['1k', 'mN·m/A'],
    /* n はナノで、N（ニュートン）ではない */
    ['5.4 n·s/m', 'N·s/m'],
    /* 違う単位 */
    ['5.4 N·s', 'N·s/m'],
    ['6 m/s', 'm/s²'],
  ] as const)('不正値 %s (%s) は NaN', (raw, unit) => {
    expect(parse(raw, unit)).toBeNaN();
  });
});
