import { describe, expect, it } from 'vitest';
import { eList, pow2List } from '../../src/lib/eseries';
import { plain } from '../../src/lib/format';
import {
  accept,
  badText,
  followsGroup,
  formatter,
  keyOf,
  kindOf,
  nearest,
  previewText,
  resolve,
  shiftIsBig,
  stepLabel,
  stepValue,
  ticksHtml,
  titleText,
  valueList,
} from '../../src/lib/param-core';
import type { ParamDef } from '../../src/lib/param-def';
import { PARAMS } from '../../src/tools/timer555/params';

const byK = (k: string) => {
  const d = PARAMS.find((p) => p.k === k);
  if (!d) throw new Error(k);
  return d;
};
const R1 = byK('r1'),
  VCC = byK('vcc');
const majors = (h: string) => (h.match(/class="M"/g) ?? []).length;
const labels = (h: string) => [...h.matchAll(/<span[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]);

describe('555 の行（E 系列はグループに従う・一様な刻み）', () => {
  it('種類と並び', () => {
    expect(kindOf(R1)).toBe('e');
    expect(followsGroup(R1)).toBe(true);
    expect(valueList(R1, 6)).toEqual(eList(6, 100, 1e6));
    expect(kindOf(VCC)).toBe('lin');
    expect(followsGroup(VCC)).toBe(false);
    const L = valueList(VCC, 12);
    expect(L).toHaveLength(171);
    expect(L.at(-1)).toBe(18);
  });

  it('表記: E 系列は接頭辞つき、一様な刻みは有効 4 桁', () => {
    const f = formatter(R1);
    expect(f.input(4700)).toBe('4.7 k');
    expect(f.input(100)).toBe('100');
    expect(f.step(12_000)).toBe('12k');
    expect(f.text(4700)).toBe('4.7 kΩ');
    expect(f.preview(12_345.6)).toBe('12.346 kΩ');
    const g = formatter(VCC);
    expect(g.input(3.3)).toBe('3.3');
    expect(g.step(5.1)).toBe('5.1');
    expect(g.text(5)).toBe('5 V');
  });

  it('目盛り: 10 の累乗と 5 V ごとに大目盛り、ラベルは tk', () => {
    const h = ticksHtml(R1, valueList(R1, 12));
    expect(majors(h)).toBe(5);
    expect(labels(h)).toEqual(['100', '1k', '10k', '100k', '1M']);
    const v = ticksHtml(VCC, valueList(VCC, 12));
    expect(majors(v)).toBe(3);
    expect((v.match(/<i /g) ?? []).length).toBe(18);
  });

  it('title と ▲▼ の読み上げ', () => {
    expect(titleText(R1, 12, formatter(R1))).toBe(
      '100 Ω – 1 MΩ　↑↓: E12 の隣の値　PgUp/PgDn: 10 倍・1/10　Enter: 確定　Esc: 戻す',
    );
    expect(titleText(VCC, 12, formatter(VCC))).toBe('1 V – 18 V　↑↓: ±0.1 V（Shift で ±1 V）　Enter: 確定　Esc: 戻す');
    expect(stepLabel(R1, 24)).toBe('E24 で');
    expect(stepLabel(VCC, 12)).toBe('0.1 V');
  });

  it('確定: 範囲外は端に丸めて理由を返す', () => {
    const f = formatter(VCC),
      L = valueList(VCC, 12);
    expect(resolve(VCC, L, f, 5)).toEqual({ w: 5, why: '' });
    const r = resolve(VCC, L, f, 20);
    expect(r).toEqual({ w: 18, why: '20 V は範囲外のため上限 18 V にしました', bound: 'max' });
    expect(previewText(r, 20, f)).toBe('→ 20 V（上限 18 V に丸めます）');
    expect(previewText(resolve(VCC, L, f, 3.3), 3.3, f)).toBe('→ 3.3 V');
    expect(accept(R1, 0)).toBe(false);
    expect(badText(R1)).toBe('読めない値です（例 4.7k・4k7・100n・1e3）');
  });

  it('▲▼: 隣の値、PgUp/PgDn は 10 倍か big ずつ、端で止まる', () => {
    const L = valueList(R1, 12);
    expect(stepValue(R1, L, 10_000, 1, false)).toBe(12_000);
    expect(stepValue(R1, L, 10_000, -1, true)).toBe(1000);
    expect(stepValue(R1, L, 200_000, 1, true)).toBe(1e6);
    expect(stepValue(R1, L, 1e6, 1, false)).toBeUndefined();
    const V = valueList(VCC, 12);
    expect(stepValue(VCC, V, 5, 1, false)).toBe(5.1);
    expect(stepValue(VCC, V, 5, -1, true)).toBe(4);
    expect(stepValue(VCC, V, 17.5, 1, true)).toBe(18);
    expect(shiftIsBig(R1)).toBe(false);
    expect(shiftIsBig(VCC)).toBe(true);
  });
});

/* PID のゲイン: 0 から 20、0 の次は 1e-4、E12 刻みで 20 まで届く。接頭辞なし */
const GAIN: ParamDef = {
  k: 'kp',
  nm: 'Kp',
  sym: '',
  name: '比例ゲイン',
  sub: '',
  unit: '',
  min: 0,
  max: 20,
  v: 0.0047,
  ph: '',
  pre: [],
  tk: [
    [0, '0'],
    [0.01, '0.01'],
    [1, '1'],
    [10, '10'],
  ],
  series: 12,
  floor: 1e-4,
  ends: true,
  sign: 'nonneg',
  notation: 'plain',
};

describe('0 を含む E 系列の行（PID のゲイン）', () => {
  const L = valueList(GAIN, 24);

  it('並びは 0・1e-4 から始まり、固定の E12 で max で終わる', () => {
    expect(followsGroup(GAIN)).toBe(false);
    expect(L.slice(0, 3)).toEqual([0, 1e-4, 1.2e-4]);
    expect(L.slice(-3)).toEqual([15, 18, 20]);
  });

  it('0 はスライダーで正の最小値の左に置く', () => {
    const key = keyOf(GAIN, L);
    expect(key(0)).toBeLessThan(key(1e-4));
    expect(nearest(L, key, 0)).toBe(0);
    expect(nearest(L, key, 1e-6)).toBe(0);
  });

  it('10 倍・1/10 は 0 をまたぐ', () => {
    expect(stepValue(GAIN, L, 0, 1, true)).toBe(1e-4);
    expect(stepValue(GAIN, L, 0, -1, true)).toBeUndefined();
    expect(stepValue(GAIN, L, 5e-4, -1, true)).toBe(0);
    expect(stepValue(GAIN, L, 0.0047, 1, true)).toBe(0.047);
    expect(stepValue(GAIN, L, 18, 1, false)).toBe(20);
  });

  it('大目盛りは 0 と、1e-4 より大きい 10 の累乗', () => {
    expect(majors(ticksHtml(GAIN, L))).toBe(1 + 5);
  });

  it('接頭辞なしの表記と 0 以上の条件', () => {
    const f = formatter(GAIN);
    expect(f.input(0.0047)).toBe('0.0047');
    expect(f.step(0.00012)).toBe('0.00012');
    expect(f.text(12.5)).toBe('12.5');
    expect(accept(GAIN, 0)).toBe(true);
    expect(accept(GAIN, -1)).toBe(false);
  });
});

describe('負の値を含む一様な刻み（PID の流速）', () => {
  const W: ParamDef = {
    ...GAIN,
    k: 'w',
    unit: 'm/s',
    min: -100,
    max: 100,
    v: -1,
    lin: { step: 0.1, big: 1, major: 50, minor: 10 },
    sign: 'any',
    series: undefined,
    floor: undefined,
    tk: [
      [-100, '−100'],
      [0, '0'],
      [100, '100'],
    ],
  };
  const L = valueList(W, 12);

  it('刻みと目盛り', () => {
    expect(L).toHaveLength(2001);
    const h = ticksHtml(W, L);
    expect((h.match(/<i /g) ?? []).length).toBe(21);
    expect(majors(h)).toBe(5);
  });

  it('表記と範囲', () => {
    const f = formatter(W);
    expect(f.input(-1)).toBe('−1');
    expect(f.text(-12.5)).toBe('−12.5 m/s');
    expect(titleText(W, 12, f)).toBe('−100 m/s – 100 m/s　↑↓: ±0.1 m/s（Shift で ±1 m/s）　Enter: 確定　Esc: 戻す');
    expect(resolve(W, L, f, -150).why).toBe('−150 m/s は範囲外のため下限 −100 m/s にしました');
    expect(stepValue(W, L, -1, -1, false)).toBe(-1.1);
    expect(stepValue(W, L, -99.5, -1, true)).toBe(-100);
  });
});

describe('並びを与える行（双2次フィルタ）', () => {
  const N: ParamDef = {
    k: 'n',
    nm: 'N',
    sym: '',
    name: 'インパルス長',
    sub: '',
    unit: '',
    min: 256,
    max: 32768,
    v: 1024,
    ph: '',
    pre: [],
    tk: [
      [256, '256'],
      [4096, '4096'],
      [65536, '65536'],
    ],
    list: () => pow2List(8, 15),
    log: true,
    jump: 2,
    snap: true,
    format: { input: String, step: String, text: String },
  };
  const L = valueList(N, 12);

  it('関数の並び、snap、jump', () => {
    expect(L[0]).toBe(256);
    expect(L.at(-1)).toBe(32768);
    const f = formatter(N);
    expect(resolve(N, L, f, 3000)).toEqual({ w: 4096, why: '3000 は選べないため 4096 にしました' });
    expect(resolve(N, L, f, 1e6).w).toBe(32768);
    expect(previewText(resolve(N, L, f, 3000), 3000, f)).toBe('→ 4096（3000 は選べないため 4096 にします）');
    expect(stepValue(N, L, 1024, 1, false)).toBe(2048);
    expect(stepValue(N, L, 1024, 1, true)).toBe(4096);
    expect(stepValue(N, L, 16384, 1, true)).toBe(32768);
    expect(shiftIsBig(N)).toBe(true);
  });

  it('min〜max の外の並びは使わない（範囲を変えたとき）', () => {
    expect(valueList({ ...N, max: 3000 }, 12)).toEqual([256, 512, 1024, 2048]);
  });

  it('範囲外の tk は目盛りに出さない', () => {
    expect(labels(ticksHtml(N, L))).toEqual(['256', '4096']);
  });

  it('fix で確定する値を差し替える（fc < fs/2）', () => {
    const FC: ParamDef = {
      ...N,
      k: 'fc',
      unit: 'Hz',
      min: 1,
      max: 24_000,
      list: [10, 100, 1000, 10_000, 20_000],
      snap: false,
      format: undefined,
      fix: (v) => (v >= 24_000 ? [20_000, 'fs/2 = 24 kHz 未満にするため 20 kHz にしました'] : null),
    };
    const f = formatter(FC),
      LL = valueList(FC, 12);
    expect(resolve(FC, LL, f, 30_000)).toEqual({ w: 20_000, why: 'fs/2 = 24 kHz 未満にするため 20 kHz にしました' });
    expect(resolve(FC, LL, f, 1500)).toEqual({ w: 1500, why: '' });
    expect(f.input(1500)).toBe('1.5 k');
    expect(f.text(1500)).toBe('1.5 kHz');
  });
});

describe('受動素子の行（固定の E192・E1）', () => {
  const T: ParamDef = { ...R1, k: 't', min: 1e-3, max: 1e9, v: 1234, series: 192, sig: 6 };
  const MN: ParamDef = { ...R1, k: 'min', min: 1e-3, max: 1e9, v: 10, series: 1 };

  it('E192 の隣の値、E1 は 10 倍ずつ', () => {
    const L = valueList(T, 12);
    expect(followsGroup(T)).toBe(false);
    expect(stepValue(T, L, 1234, 1, false)).toBe(1240);
    expect(formatter(T).input(1234)).toBe('1.234 k');
    expect(formatter(T).preview(1234.56)).toBe('1.23456 kΩ');
    const M = valueList(MN, 12);
    expect(M).toHaveLength(13);
    expect(stepValue(MN, M, 10, 1, false)).toBe(100);
  });
});

it('plain は有効桁を落として末尾の 0 を付けない', () => {
  expect(plain(0.1 + 0.2)).toBe('0.3');
});
