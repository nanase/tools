import { describe, expect, it } from 'vitest';
import {
  type Code,
  devTxt,
  eRows,
  fromValue,
  INIT,
  keyOf,
  meaning,
  ohmsOf,
  optsOf,
  pick,
  rolesOf,
  seriesOf,
  withBands,
} from '../src/tools/colorcode/model';
import { R_DEF } from '../src/tools/colorcode/params';
import { bandButtons, bandsSvg, figLabel, substHtml } from '../src/tools/colorcode/view';

const code = (p: Partial<Code>): Code => ({ ...INIT, ...p });

describe('色帯', () => {
  it('初期値は 4.7 kΩ ±5 %（黄紫赤金）', () => {
    expect(ohmsOf(INIT)).toBe(4700);
    expect(rolesOf(4).map((r) => keyOf(INIT, r))).toEqual(['y', 'v', 'r', 'gd']);
    expect(R_DEF.v).toBe(4700);
  });
  it('帯の役割', () => {
    expect(rolesOf(4)).toEqual(['d0', 'd1', 'm', 't']);
    expect(rolesOf(5)).toEqual(['d0', 'd1', 'd2', 'm', 't']);
    expect(rolesOf(6)).toEqual(['d0', 'd1', 'd2', 'm', 't', 'tc']);
  });
  it('色の意味', () => {
    expect(meaning('d1', 'v', 0)).toBe('7');
    expect(meaning('m', 'pk', 0)).toBe('×0.001');
    expect(meaning('m', 'br', 0)).toBe('×10');
    expect(meaning('m', 'o', 0)).toBe('×1k');
    expect(meaning('m', 'w', 0)).toBe('×1G');
    expect(meaning('t', 'no', 0)).toBe('±20 %');
    expect(meaning('t', 'o', 0)).toBe('±0.05 %');
    expect(meaning('tc', 'br', 0)).toBe('100');
    expect(meaning('tc', 'br', 1)).toBe('100 ppm');
    expect(meaning('tc', 'br', 2)).toBe('100 ppm/K');
  });
  it('帯なしの許容差を選べるのは 4 本帯だけ', () => {
    expect(optsOf('t', 4)).toContain('no');
    expect(optsOf('t', 5)).not.toContain('no');
    expect(optsOf('m', 4)).toHaveLength(13);
  });
  it('色を選ぶ', () => {
    expect(ohmsOf(pick(INIT, 'd0', 'r'))).toBe(2700);
    expect(ohmsOf(pick(INIT, 'm', 'pk'))).toBe(0.047);
    expect(keyOf(pick(INIT, 'm', 'pk'), 'm')).toBe('pk');
    expect(pick(INIT, 't', 'no').tol).toBe('no');
    expect(INIT.d).toEqual([4, 7]);
  });
});

describe('抵抗値から色帯へ', () => {
  it('2 桁で表せる値は 4 本帯のまま', () => {
    expect(fromValue(1e3, INIT)).toEqual({ code: code({ d: [1, 0], m: 2 }), note: '', er: false });
    expect(fromValue(0.01, INIT).code).toMatchObject({ n: 4, d: [1, 0], m: -3 });
  });
  it('3 桁が要る値は 5 本帯にする', () => {
    expect(fromValue(4990, INIT)).toEqual({
      code: code({ n: 5, d: [4, 9, 9], m: 1 }),
      note: '有効数字 3 桁の値なので 5 本帯にしました',
      er: false,
    });
  });
  it('5 本帯では 2 桁の値も 3 桁で表す', () => {
    expect(fromValue(4700, code({ n: 5, d: [1, 0, 0], m: 0 })).code).toMatchObject({ n: 5, d: [4, 7, 0], m: 1 });
  });
  it('有効数字 3 桁に丸める', () => {
    expect(fromValue(4995, INIT)).toEqual({
      code: code({ d: [5, 0], m: 2 }),
      note: '色帯で表せるのは有効数字 3 桁までなので 5 kΩ にしました',
      er: true,
    });
  });
  it('範囲外は端に丸める', () => {
    expect(fromValue(0.001, INIT)).toEqual({
      code: code({ d: [1, 0], m: -3 }),
      note: '1 mΩ は範囲外のため下限 10 mΩ にしました',
      er: true,
    });
    const hi = fromValue(1e13, INIT);
    expect(hi.code).toMatchObject({ n: 5, d: [9, 9, 9], m: 9 });
    expect(hi.note).toBe('10000 GΩ は範囲外のため上限 999 GΩ にしました。有効数字 3 桁の値なので 5 本帯にしました');
  });
  it('0.1 Ω 未満は 2 桁の 4 本帯', () => {
    expect(fromValue(0.0123, code({ n: 5, d: [4, 7, 0], m: 1 }))).toEqual({
      code: code({ n: 4, d: [1, 2], m: -3 }),
      note: '0.1 Ω 未満は有効数字 2 桁までなので 12 mΩ にしました。5 本帯では表せないので 4 本帯にしました',
      er: true,
    });
  });
  it('5 本帯になるとき、帯なしの許容差は ±1 %（茶）にする', () => {
    expect(fromValue(4990, code({ tol: 'no' })).code.tol).toBe('br');
  });
});

describe('帯の数を変える', () => {
  it('4 → 5 本帯は 3 桁にする', () => {
    expect(withBands(INIT, 5)).toEqual({ code: code({ n: 5, d: [4, 7, 0], m: 1 }), note: '' });
  });
  it('5 → 4 本帯は 2 桁に丸める', () => {
    expect(withBands(code({ n: 5, d: [4, 9, 9], m: 1 }), 4)).toEqual({
      code: code({ n: 4, d: [5, 0], m: 2 }),
      note: '4 本帯は数字 2 桁なので 4.99 kΩ を 5 kΩ にしました',
    });
  });
  it('0.1 Ω 未満は 5・6 本帯にできない', () => {
    expect(withBands(code({ d: [1, 0], m: -3 }), 5)).toEqual({
      error: '10 mΩ は 5 本帯では表せません（5・6 本帯は 0.1 Ω 以上）',
    });
  });
  it('帯なしの許容差は ±1 %（茶）にする', () => {
    expect(withBands(code({ tol: 'no' }), 6)).toEqual({
      code: code({ n: 6, d: [4, 7, 0], m: 1, tol: 'br' }),
      note: '許容差を ±1 %（茶）にしました',
    });
  });
});

describe('E 系列', () => {
  it('載っている系列（有効数字 3 桁で比べる）', () => {
    expect(seriesOf(4700)).toEqual([6, 12, 24, 192]);
    expect(seriesOf(1000)).toEqual([6, 12, 24, 48, 96, 192]);
    expect(seriesOf(2.2)).toEqual([6, 12, 24]);
    expect(seriesOf(2.21)).toEqual([96, 192]);
    expect(seriesOf(4990)).toEqual([96, 192]);
    expect(seriesOf(1234)).toEqual([]);
  });
  it('載っていなければ前後の近い値', () => {
    const rows = eRows(4700);
    expect(rows.map((r) => r.hit)).toEqual([true, true, true, false, false, true]);
    expect(rows[3]).toEqual({ s: 48, tol: 2, hit: false, near: [4640, 4870] });
    expect(rows[4].near).toEqual([4640, 4750]);
  });
  it('範囲の外の近い値は出さない', () => {
    expect(eRows(950e9)[0].near).toEqual([680e9]);
  });
  it('差の表記', () => {
    expect(devTxt(4640, 4700)).toBe('−1.28 %');
    expect(devTxt(4870, 4700)).toBe('+3.62 %');
  });
});

describe('表示', () => {
  it('図の読み上げ。帯なしは 3 本と数える', () => {
    expect(figLabel(INIT)).toBe('4 本の色帯の抵抗器: 黄、紫、赤、金（4.7 kΩ ±5 %）');
    expect(figLabel(code({ tol: 'no' }))).toBe('3 本の色帯の抵抗器: 黄、紫、赤（4.7 kΩ ±20 %）');
  });
  it('帯なしは破線の枠で描く', () => {
    expect(bandsSvg(INIT).match(/<rect /g)).toHaveLength(4);
    expect(bandsSvg(code({ tol: 'no' }))).toContain('class="r-no"');
  });
  it('帯ごとのボタン', () => {
    const h = bandButtons(code({ n: 6, d: [4, 7, 0], m: 1 }), 'm');
    expect(h.match(/class="bt"/g)).toHaveLength(6);
    expect(h).toContain('aria-pressed="true" aria-label="4 本目、乗数: 茶、×10"');
  });
  it('代入した式: 温度係数は 6 本帯だけ', () => {
    expect(substHtml(INIT)).not.toContain('&#x3B1;');
    expect(substHtml(code({ n: 6, d: [4, 7, 0], m: 1 }))).toContain(
      '<mn>470</mn><mspace width="0.17em"/><mi mathvariant="normal">mΩ/K</mi>',
    );
  });
});
