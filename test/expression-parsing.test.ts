import { describe, expect, it } from 'vitest';
import {
  build,
  CAP,
  calcTones,
  checkRule,
  fmt,
  lexIt,
  lexTones,
  METHODS,
  parseTones,
  RULES,
  type RuleDef,
  ruleOf,
  SAMPLES,
  STEP_LIMIT,
  semiOf,
  setAssoc,
  sexpr,
  swapRows,
  TONE_VM,
} from '../src/tools/expression-parsing/model';

const rule = (id: string): RuleDef => {
  const r = ruleOf(id);
  if (!r) throw new Error(id);
  return r;
};
const ans = (src: string, id = 'std') => fmt(build(src, rule(id), 'pr').ans);
const EXTRA = [
  '2*-3',
  '2^-3^2',
  '-2*3',
  '--2',
  '1-2+3',
  '12.5*2',
  '(1)+(2)',
  '2(3)4',
  '2*-3+1',
  '((2))',
  '7-(2-(3-(4-5)))',
];

describe('字句解析', () => {
  it('続く数字は 1 つの数にする', () => {
    expect(lexIt('12 + 345').toks.map((t) => t.txt)).toEqual(['12', '+', '345']);
  });
  it('全角と × ÷ − ** を読み替える', () => {
    expect(lexIt('２×３÷４−１').toks.map((t) => t.op ?? t.txt)).toEqual(['2', '*', '3', '/', '4', '-', '1']);
    expect(lexIt('2**3').toks.map((t) => t.op ?? t.txt)).toEqual(['2', '^', '3']);
  });
  it('前に値がない − は符号にする', () => {
    expect(lexIt('-1 - -2').toks.map((t) => t.t)).toEqual(['neg', 'num', 'op', 'neg', 'num']);
  });
  it('省略した × を補う', () => {
    const t = lexIt('2(3)4(5)').toks.filter((q) => q.imp);
    expect(t).toHaveLength(3);
    expect(t.every((q) => q.op === '·')).toBe(true);
  });
  it('読めない文字と読めない数はエラーにする', () => {
    expect(lexIt('1 + a').err).toContain('a');
    expect(lexIt('1.2.3').err).toContain('1.2.3');
  });
});

describe('どの手法でも同じ結果', () => {
  for (const r of RULES) {
    it(`${r.name}: 木が一致する`, () => {
      for (const src of [...SAMPLES.map((s) => s[0]), ...EXTRA]) {
        const list = METHODS.map((m) => build(src, r, m.id)),
          ok = list.filter((t) => !t.aborted),
          shapes = new Set(ok.map((t) => (t.err ? 'エラー' : sexpr(t))));
        expect([...shapes], `${src}`).toHaveLength(1);
      }
    });
    it(`${r.name}: エラーの字句が一致する`, () => {
      for (const src of ['1 + * 2', '2 * (3 + 4', '1 2', '(', ')', '1 +', '(1 + 2))', '* 3', '()']) {
        const toks = new Set(METHODS.map((m) => build(src, r, m.id).errTok));
        expect([...toks], src).toHaveLength(1);
        expect([...toks][0], src).toBeGreaterThanOrEqual(0);
      }
    });
  }
});

describe('決まりごとの答え', () => {
  it('順位', () => {
    expect(ans('1 + 2 * 3')).toBe('7');
    expect(ans('(1 + 2) * 3')).toBe('9');
    expect(ans('2 + 3 * (4 - 1) ^ 2')).toBe('29');
  });
  it('結合', () => {
    expect(ans('8 - 3 - 2')).toBe('3');
    expect(ans('2 ^ 3 ^ 2')).toBe('512');
  });
  it('省略した ×', () => {
    expect(ans('6 / 2(1 + 2)')).toBe('9');
    expect(ans('6 / 2(1 + 2)', 'imp')).toBe('1');
    expect(build('6 / 2(1 + 2)', rule('xl'), 'pr').err).not.toBeNull();
  });
  it('Excel は符号が ^ より先で、^ は左結合', () => {
    expect(ans('-2 ^ 2')).toBe('−4');
    expect(ans('-2 ^ 2', 'xl')).toBe('4');
    expect(ans('2 ^ 3 ^ 2', 'xl')).toBe('64');
  });
  it('標準の電卓は入力した順', () => {
    expect(ans('1 + 2 * 3', 'calc')).toBe('9');
    expect(ans('2 + 3 * (4 - 1) ^ 2', 'calc')).toBe('225');
  });
  it('APL は右から', () => {
    expect(ans('8 - 3 - 2', 'apl')).toBe('7');
    expect(ans('2 * 3 + 1', 'apl')).toBe('8');
  });
  it('符号は演算子の後ろにも書ける', () => {
    expect(ans('2 * -3')).toBe('−6');
    expect(ans('2 ^ -1')).toBe('0.5');
    expect(ans('--2')).toBe('2');
  });
  it('÷ 0 はエラー', () => {
    expect(ans('1 / 0')).toBe('エラー');
  });
});

describe('エラー', () => {
  it('式がないときはエラーで、計算の工程を作らない', () => {
    const t = build('', rule('std'), 'sy');
    expect(t.err).not.toBeNull();
    expect(t.calc).toHaveLength(0);
  });
  it('エラーのコマが最後にあり、字句を指す', () => {
    const t = build('1 + * 2', rule('std'), 'sy'),
      z = t.parse[t.parse.length - 1];
    expect(z.bad).toBe(2);
    expect(z.say).toContain('エラー');
  });
  it('読めない文字は構文解析へ進まない', () => {
    const t = build('1 + a', rule('std'), 'pk');
    expect(t.err).toContain('a');
    expect(t.parse).toHaveLength(1);
    expect(t.calc).toHaveLength(0);
  });
});

describe('手順', () => {
  const src = '2 + 3 * (4 - 1) ^ 2',
    std = rule('std'),
    steps = (s: string, m: Parameters<typeof build>[2]) => build(s, std, m).steps;
  it('バックトラックだけ読み直す字句がある（パックラットは戻るが読み直さない）', () => {
    expect(build(src, std, 'sy').back).toBe(0);
    expect(build(src, std, 'sr').back).toBe(0);
    expect(build(src, std, 'rd').back).toBe(0);
    expect(build(src, std, 'pr').back).toBe(0);
    expect(build(src, std, 'bt').back).toBeGreaterThan(0);
  });
  it('括弧が深いとバックトラックの手順は急に増え、パックラットは増えない', () => {
    const d2 = '((1))',
      d4 = '((((1))))',
      grow = steps(d4, 'bt') / steps(d2, 'bt'),
      memo = steps(d4, 'pk') / steps(d2, 'pk');
    expect(grow).toBeGreaterThan(30);
    expect(memo).toBeLessThan(3);
  });
  it('上限を超えると打ち切る', () => {
    const t = build('((((((((((1))))))))))', std, 'bt');
    expect(t.aborted).toBe(true);
    expect(t.steps).toBe(STEP_LIMIT);
    expect(t.parse.length).toBeLessThanOrEqual(CAP + 1);
    expect(t.parse[t.parse.length - 1].say).toBe('打ち切り');
    expect(t.calc).toHaveLength(0);
  });
  it('コマを残せなくても正しい木と答えを出す', () => {
    const t = build('(((1 + 2)))', std, 'bt');
    expect(t.trunc).toBe(true);
    expect(fmt(t.ans)).toBe('3');
    expect(t.parse[t.parse.length - 1].roots).toEqual([t.root]);
  });
  it('計算のコマは葉から順に進み、最後に根の値が答えになる', () => {
    const t = build(src, std, 'sy'),
      z = t.calc[t.calc.length - 1];
    expect(t.calc[0].hot).toBeUndefined();
    expect(z.hot).toBe(t.root);
    expect(z.vals?.get(t.root as number)).toBe(t.ans);
    expect(z.say).toBe('2 + 27 = 29');
  });
  it('表示', () => {
    expect(fmt(29)).toBe('29');
    expect(fmt(-4)).toBe('−4');
    expect(fmt(1 / 3)).toBe('0.333333');
    expect(fmt(2 ** 80)).toContain('e+');
    expect(fmt(Number.NaN)).toBe('エラー');
  });
});

describe('決まりの編集', () => {
  it('順位を入れ替えると木と答えが変わる', () => {
    const d = rule('std'),
      next = swapRows(d, 2, 3);
    expect(next.id).toBe('custom');
    expect(fmt(build('1 + 2 * 3', next, 'sy').ans)).toBe('9');
    expect(d.rank[2]).toContain('*');
  });
  it('結合を変えると答えが変わる', () => {
    const next = setAssoc(rule('std'), 3, true);
    expect(fmt(build('8 - 3 - 2', next, 'sr').ans)).toBe('7');
    const left = setAssoc(rule('std'), 0, false);
    expect(fmt(build('2 ^ 3 ^ 2', left, 'rd').ans)).toBe('64');
  });
  it('編集した決まりでも全手法が一致する', () => {
    const d = setAssoc(swapRows(rule('std'), 0, 3), 0, true);
    for (const src of ['1 + 2 * 3 - 4', '2 ^ 3 + 1', '-2 + 3', '(1 - 2) - 3']) {
      expect(new Set(METHODS.map((m) => sexpr(build(src, d, m.id)))).size, src).toBe(1);
    }
  });
  it('保存した決まりを確かめる', () => {
    expect(checkRule(swapRows(rule('std'), 0, 1))?.id).toBe('custom');
    expect(checkRule(null)).toBeNull();
    expect(checkRule({ rank: [['+']], right: [] })).toBeNull();
    expect(checkRule({ rank: 1, right: [] })).toBeNull();
    const dup = rule('std').rank.map((r) => r.slice());
    dup[0] = ['+'];
    expect(checkRule({ rank: dup, right: [] })).toBeNull();
  });
});

describe('音', () => {
  const t = build('1 + 2 * (3 - 4)', rule('std'), 'sy');
  it('音階は範囲に収まり、音程が上がる', () => {
    for (let d = 0; d <= 25; d++) expect(semiOf(d) + 1).toBeLessThanOrEqual(TONE_VM);
    expect(semiOf(0)).toBe(0);
    expect(semiOf(1)).toBeGreaterThan(semiOf(0));
    expect(semiOf(5)).toBe(12);
  });
  it('スタックが深いほど高い', () => {
    const f = t.parse.filter((q) => !q.r.length && q.mk == null && q.bad == null),
      low = f.find((q) => q.stk.length === 0),
      high = f.find((q) => q.stk.length === t.maxS);
    expect(parseTones(high as (typeof f)[number])[0]).toBeGreaterThan(parseTones(low as (typeof f)[number])[0]);
  });
  it('比較と木に足す手順は 2 音、読み直しは最も低い音', () => {
    expect(parseTones(t.parse.find((q) => q.r.length === 2) as (typeof t.parse)[number])).toHaveLength(2);
    expect(parseTones(t.parse.find((q) => q.mk != null) as (typeof t.parse)[number])).toHaveLength(2);
    const b = build('1 + 2', rule('std'), 'bt').parse.find((q) => q.backed);
    expect(parseTones(b as (typeof t.parse)[number])).toEqual([1]);
  });
  it('字句解析は字句ができたときだけ鳴らす', () => {
    const lx = lexIt('12 + 3');
    expect(lexTones(lx.F[0], lx.s.length)).toEqual([]);
    expect(lexTones(lx.F[lx.F.length - 1], lx.s.length)).toEqual([]);
    expect(lx.F.filter((f) => lexTones(f, lx.s.length).length).length).toBe(3);
  });
  it('計算は根に近づくと下がる', () => {
    const c = t.calc.filter((q) => q.hot != null),
      a = calcTones(t, c[0]),
      z = calcTones(t, c[c.length - 1]);
    expect(z[0]).toBeLessThan(a[0]);
    expect(calcTones(t, t.calc[0])).toEqual([]);
  });
});
