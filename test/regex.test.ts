import { describe, expect, it } from 'vitest';
import {
  type Analysis,
  analyze,
  DFA_MAX,
  ENGINES,
  isErr,
  type ParseErr,
  PRESETS,
  parseRe,
  replaceAll,
  STEP_MAX,
} from '../src/tools/regex/model';

const ok = (r: Analysis | ParseErr): Analysis => {
  if (isErr(r)) throw new Error(r.err);
  return r;
};
/** ブラウザの RegExp の一致（位置とグループ） */
function native(p: string, t: string, f: string): (number | string | null)[][] {
  return [...t.matchAll(new RegExp(p, `g${f}`))].map((m) => [
    m.index,
    m.index + m[0].length,
    ...m.slice(1).map((x) => x ?? null),
  ]);
}

const CASES: [string, string, string][] = [
  ...PRESETS.map((p): [string, string, string] => [p.pat, p.text, '']),
  ['a*', 'baaab', ''],
  ['(a|ab)(c|bcd)(d*)', 'abcd', ''],
  ['x*?y', 'xxy xy', ''],
  ['^\\w+$', 'foo\nbar', 'm'],
  ['^\\w+$', 'foo\nbar', ''],
  ['[^a-c]+', 'abcdefabc', ''],
  ['(a*)*b', 'aaab', ''],
  ['(a?){3}a{3}', 'aaa', ''],
  ['A+', 'aAaB', 'i'],
  ['[a-z]+', 'ABC def', 'i'],
  ['\\bcat\\b', 'cat concat cat.', ''],
  ['\\Bcat', 'cat concat', ''],
  ['(?:ab)+', 'abababx', ''],
  ['a{2,}', 'a aa aaaa', ''],
  ['(\\d+)-\\1', '12-12 3-4', ''],
  ['', 'ab', ''],
  ['a|', 'ba', ''],
  ['(a|b)*?b', 'aabab', ''],
  ['[\\d.]+', '3.14 x 2', ''],
  ['(x)?y', 'y xy', ''],
  ['\\s+', 'a  b\tc', ''],
  ['[^\\W\\d]+', 'ab12cd', ''],
];

describe('照合', () => {
  it.each(CASES)('%s を %j でブラウザの RegExp と同じ位置とグループ', (p, t, f) => {
    const a = ok(analyze(p, t, f)),
      want = native(p, t, f);
    for (const e of ENGINES) {
      const r = a.runs[e.id];
      if (r.unsup) continue;
      const mine = r.matches.map((m) => [
        m.s,
        m.e,
        ...Array.from({ length: a.re.ng }, (_, k) => {
          const x = m.caps[2 * k + 2],
            y = m.caps[2 * k + 3];
          return x >= 0 && y >= 0 ? t.slice(x, y) : null;
        }),
      ]);
      /* DFA は位置だけを求める */
      const cut =
        e.id === 'dfa' || e.id === 'ldfa' ? (v: unknown[][]) => v.map((x) => x.slice(0, 2)) : (v: unknown[][]) => v;
      expect(cut(mine), e.id).toEqual(cut(want));
    }
  });
  it('後方参照はバックトラックだけ、DFA は ^ $ \\b を扱わない', () => {
    const a = ok(analyze('(a)\\1', 'aa')),
      b = ok(analyze('^a', 'a'));
    expect(a.runs.nfa.unsup).toBeTruthy();
    expect(a.runs.memo.unsup).toBeUndefined();
    expect(b.runs.dfa.unsup).toBeTruthy();
    expect(b.runs.ldfa.unsup).toBeUndefined();
  });
});

describe('手間', () => {
  it('破滅的バックトラックはバックトラックだけ比較が膨らむ', () => {
    const a = ok(analyze('(a+)+b', 'a'.repeat(12)));
    expect(a.runs.bt.steps).toBeGreaterThan(20_000);
    for (const id of ['memo', 'nfa', 'ldfa', 'dfa'] as const) expect(a.runs[id].steps).toBeLessThan(200);
  });
  it('長い文章では打ち切る', () => {
    const a = ok(analyze('(a+)+b', 'a'.repeat(30)));
    expect(a.runs.bt.aborted).toBe(true);
    expect(a.runs.bt.steps).toBe(STEP_MAX);
    expect(a.runs.memo.aborted).toBe(false);
  });
  it('DFA は状態が増える例で遅延 DFA より多くの状態を作る', () => {
    const a = ok(analyze('(a|b)*a(a|b){4}', 'abbabaababba'));
    expect(a.runs.dfa.states).toBeGreaterThanOrEqual(32);
    expect(a.runs.ldfa.states ?? 0).toBeLessThan(a.runs.dfa.states ?? 0);
    const big = ok(analyze('(a|b)*a(a|b){12}', 'ab'));
    expect(big.runs.dfa.unsup).toContain(DFA_MAX.toLocaleString('en-US'));
  });
  it('DFA は作成を状態と文字の組ごとに記録してから文章を読む', () => {
    const a = ok(analyze('(a|b)*a(a|b){4}', 'abbabaababba')),
      r = a.runs.dfa,
      build = r.fr.filter((f) => f.k === 'build'),
      al = r.alpha ?? [];
    expect(build.length).toBe((r.states ?? 0) * al.length);
    expect(build[0].steps).toBeLessThan(10);
    expect(r.dsets?.length).toBe(r.states);
    expect(build.filter((f) => f.isNew).length).toBe((r.states ?? 0) - 1);
    expect(r.fr.findIndex((f) => f.k !== 'build')).toBe(build.length);
  });
  it('コマの比較の回数は増えるだけ', () => {
    for (const p of PRESETS) {
      const a = ok(analyze(p.pat, p.text));
      for (const e of ENGINES) {
        const fr = a.runs[e.id].fr;
        for (let i = 1; i < fr.length; i++) expect(fr[i].steps).toBeGreaterThanOrEqual(fr[i - 1].steps);
      }
    }
  });
});

describe('パターンの誤り', () => {
  it.each([
    ['(', '「)」がありません。'],
    ['a)', '「(」がありません。'],
    ['*a', '繰り返す対象がありません。'],
    ['[a', '「]」がありません。'],
    ['a{3,1}', '{m,n} の m が n より大きくなっています。'],
    ['(?=a)', 'この記法には対応していません。'],
    ['(a)\\2', 'グループ 2 がありません。'],
    ['^*', 'この記号は繰り返せません。'],
  ])('%s', (p, msg) => {
    const r = parseRe(p);
    expect(isErr(r) && r.err).toBe(msg);
  });
});

describe('置換', () => {
  it('$1 と $& を置き換え、置き換えた範囲を返す', () => {
    const a = ok(analyze('(\\d{4})/(\\d+)', 'x 2026/11 y'));
    const r = replaceAll('x 2026/11 y', a.matches, '$1年$2月[$&]');
    expect(r.out).toBe('x 2026年11月[2026/11] y');
    expect(r.parts).toEqual([[2, 19]]);
  });
});
