import { describe, expect, it } from 'vitest';
import { eList } from '../src/lib/eseries';
import { circuitSvg } from '../src/tools/passive-combination/circuit';
import { bands, cand, codeOf, errTxt, expr, flat, GOLD, SILVER, usable } from '../src/tools/passive-combination/model';
import { numDef } from '../src/tools/passive-combination/params';
import { createSearch, type Found, type Tree } from '../src/tools/passive-combination/search';

const P = (a: number, b: number) => (a * b) / (a + b);
const treeValue = (t: Tree): number =>
  typeof t === 'number' ? t : t[0] === 'S' ? treeValue(t[1]) + treeValue(t[2]) : P(treeValue(t[1]), treeValue(t[2]));

/** 全探索（旧ロジックと同じく、n 本のつなぎ方と値をすべて試す）で得られる合成値 */
function brute(V: readonly number[], n: number): number[] {
  const memo: number[][] = [[], [...V]];
  for (let j = 2; j <= n; j++) {
    const out = new Set<number>();
    for (let k = 1; k < j; k++)
      for (const a of memo[k])
        for (const b of memo[j - k]) {
          out.add(a + b);
          out.add(P(a, b));
        }
    memo[j] = [...out];
  }
  return memo[n];
}
const bestErr = (vals: number[], t: number) => Math.min(...vals.map((v) => Math.abs(v - t) / t));
const full = (t: number, v: readonly number[]) => createSearch({ t, v, stop: null, K: 10 });

describe('探索', () => {
  it('画面案と同じ候補（抵抗器 1234 Ω、E12、10 Ω〜1 MΩ、全探索）', () => {
    const s = full(1234, usable(12, { t: 1234, min: 10, max: 1e6, ex: [] }));
    const [r2, l2] = s.run(2);
    expect(r2).toBe('all');
    expect(l2.slice(0, 3)).toEqual([
      { v: 1233, t: ['S', 1200, 33] },
      { v: 1231.578947368421, t: ['P', 1800, 3900] },
      { v: 1239, t: ['S', 1200, 39] },
    ]);
    const [r3, l3] = s.run(3);
    expect(r3).toBe('all');
    expect(l3.slice(0, 3)).toEqual([
      { v: 1234, t: ['S', 1200, ['S', 12, 22]] },
      { v: 1234.0586896913833, t: ['P', 33000, ['S', 82, 1200]] },
      { v: 1234.174866182256, t: ['P', 120000, ['S', 47, 1200]] },
    ]);
  });

  it('画面案と同じ候補（コンデンサ 1.234 μF、E6、全範囲、全探索）', () => {
    const s = full(1.234e-6, usable(6, { t: 1.234e-6, min: 1e-12, max: 1, ex: [] }));
    expect(s.run(2)[1][0]).toEqual({ v: 0.0000012289156626506025, t: ['P', 0.0000015, 0.0000068] });
    expect(s.run(3)[1][0]).toEqual({ v: 0.0000012337278106508877, t: ['P', 0.0000015, ['S', 1.5e-7, 0.0000068]] });
  });

  it('最良の誤差は全探索と一致する（2〜5 本）', () => {
    const cases: [number, number[], number][] = [
      [1234, [10, 22, 47, 100, 220, 470, 1000], 2],
      [1234, [10, 22, 47, 100, 220, 470, 1000], 3],
      [777, [15, 33, 68, 150, 330], 4],
      [3.3, [1, 2.2, 4.7, 10], 5],
      [0.05, [1, 2.2, 4.7], 4],
      [5000, [1, 2.2, 4.7], 5],
    ];
    for (const [t, V, n] of cases) {
      const [, list] = full(t, V).run(n);
      expect(Math.abs(list[0].v - t) / t).toBeCloseTo(bestErr(brute(V, n), t), 12);
    }
  });

  it('候補は誤差の小さい順で、組の値は合成値に一致し、本数は n', () => {
    const [, list] = full(1234, eList(24, 10, 1e5)).run(4);
    expect(list).toHaveLength(10);
    const errs = list.map((f) => Math.abs(f.v - 1234) / 1234);
    expect(errs).toEqual([...errs].sort((a, b) => a - b));
    const count = (t: Tree): number => (typeof t === 'number' ? 1 : count(t[1]) + count(t[2]));
    for (const f of list) {
      expect(treeValue(f.t)).toBeCloseTo(f.v, 9);
      expect(count(f.t)).toBe(4);
    }
  });

  it('誤差の条件に届いたら、少し続けてから終える', () => {
    let clock = 0;
    const s = createSearch({ t: 1234, v: eList(12, 10, 1e6), stop: 1e-5, K: 10 }, () => (clock += 100));
    const [r, list] = s.run(3);
    expect(r).toBe('reach');
    expect(list[0].v).toBe(1234);
  });

  it('途中経過を知らせる', () => {
    let clock = 0;
    const ps: number[] = [];
    const s = createSearch({ t: 1234, v: eList(24, 1, 1e6), stop: null, K: 10 }, () => (clock += 200));
    s.run(3, (p) => ps.push(p));
    expect(ps.length).toBeGreaterThan(0);
    for (const p of ps) expect(p).toBeGreaterThan(0);
    expect(ps.at(-1)).toBeLessThanOrEqual(1);
  });
});

describe('使う値', () => {
  it('範囲の E 系列から、目標と同じ値と除外した値を除く', () => {
    const s = { t: 1000, min: 100, max: 10e3, ex: [2200] };
    expect(usable(6, s)).toEqual([100, 150, 220, 330, 470, 680, 1500, 3300, 4700, 6800, 10000]);
    expect(usable(1, { t: 1234, min: 100, max: 100, ex: [100] })).toEqual([]);
  });
});

describe('結果の組み立て', () => {
  it('同じつなぎ方の入れ子を平らにし、素子を大きい順、組を後ろに並べる', () => {
    const tr = flat(['S', 12, ['S', ['P', 4700, 2200], 1200]]);
    expect(tr).toEqual({ o: 'S', c: [1200, 12, { o: 'P', c: [4700, 2200] }] });
    expect(expr(tr, 'R')).toBe('1.2k + 12 + (4.7k ∥ 2.2k)');
    /* コンデンサでは和が並列 */
    expect(expr(flat(['S', 1e-6, ['P', 2.2e-6, 4.7e-6]]), 'C')).toBe('1μ ∥ (4.7μ + 2.2μ)');
  });

  it('候補: 誤差・種類数・本数', () => {
    const c = cand({ v: 1234, t: ['S', 1200, ['S', 12, 22]] } satisfies Found, 'R', 1234);
    expect(c).toMatchObject({ v: 1234, e: 0, x: '1.2k + 22 + 12', k: 3, n: 3 });
    expect(cand({ v: 20, t: ['S', 10, 10] }, 'R', 25)).toMatchObject({ e: -0.2, k: 1, n: 2 });
  });

  it('誤差の表記', () => {
    expect(errTxt(0)).toBe('0 %');
    expect(errTxt(1e-13)).toBe('0 %');
    expect(errTxt((1233 - 1234) / 1234)).toBe('−0.081 %');
    expect(errTxt(0.012346)).toBe('+1.235 %');
    expect(errTxt(1.2345e-7)).toBe('+0.000012 %');
    expect(errTxt(-4.75e-8)).toBe('−0.0000048 %');
  });
});

describe('カラーコード', () => {
  const names = (b: ReturnType<typeof bands>) => b?.map((x) => x[0]).join('');
  it('2 桁で表せる値は 4 本帯', () => {
    expect(names(bands(1200, GOLD))).toBe('茶赤赤金');
    expect(names(bands(47, GOLD))).toBe('黄紫黒金');
    expect(names(bands(2.2, GOLD))).toBe('赤赤金金');
    expect(names(bands(0.33, GOLD))).toBe('橙橙銀金');
  });
  it('3 桁が要る値（E48 以上）は 5 本帯で許容差 1 %', () => {
    expect(names(bands(1240, GOLD))).toBe('茶赤黄茶茶');
    expect(names(bands(49.9, GOLD))).toBe('黄白白金茶');
  });
  it('インダクタは μH で読み、許容差は銀', () => {
    expect(names(codeOf(10e-6, 'L'))).toBe('茶黒黒銀');
    expect(names(bands(1.24, SILVER))).toBe('茶赤黄銀銀');
    expect(codeOf(1e-6, 'C')).toBeNull();
  });
  it('乗数で表せない値は null', () => {
    expect(bands(0.001, GOLD)).toBeNull();
    expect(bands(1e12, GOLD)).toBeNull();
  });
});

describe('回路図', () => {
  it('素子の数だけ値のラベルを描き、両端に端子を置く', () => {
    const c = cand({ v: 1234, t: ['S', 1200, ['P', 22, 22]] }, 'R', 1234);
    const s = circuitSvg(c, 'R');
    expect(s.match(/class="s-v"/g)).toHaveLength(3);
    expect(s.match(/class="s-o"/g)).toHaveLength(2);
    expect(s).toContain('カラーコード: 1.2 kΩ 茶赤赤金、22 Ω 赤赤黒金');
    /* 並列の両端に接続点 */
    expect(s.match(/class="s-j"/g)).toHaveLength(2);
  });
  it('コンデンサは極板で描き、カラーコードを出さない（逆数の和は直列）', () => {
    const s = circuitSvg(cand({ v: 2e-6, t: ['P', 1e-6, 1e-6] }, 'C', 2e-6), 'C');
    expect(s).toContain('class="s-pl"');
    expect(s).not.toContain('カラーコード');
    expect(s).toContain('1μ + 1μ');
  });
});

describe('入力の行', () => {
  it('種類ごとの範囲と単位', () => {
    expect(numDef('t', 'C')).toMatchObject({ unit: 'F', min: 1e-12, max: 1, v: 1.234e-6, series: 192 });
    expect(numDef('max', 'L')).toMatchObject({ unit: 'H', min: 1e-9, max: 1, v: 1, series: 1 });
    expect(numDef('min', 'R').name).toBe('使う最小の抵抗値');
  });
});
