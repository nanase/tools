import { describe, expect, it } from 'vitest';
import {
  barVals,
  baseTokens,
  canRun,
  DEFS,
  defOf,
  KEYS,
  opCurve,
  outSlot,
  type Rule,
  runTrace,
  SHAPES,
  type Token,
} from '../src/tools/list-queue-stack/model';

const N = 24;
const vals = barVals('rand', N, 3);
const def = (id: string) => {
  const d = defOf(id);
  if (!d) throw new Error(id);
  return d;
};
const bulk = baseTokens('bulk', N, 1);
const run = (id: string, tokens: readonly Token[] = bulk, rule?: Rule, pre = 0) =>
  runTrace(def(id), { n: N, vals, tokens, rule, pre });
const ids = Array.from({ length: N }, (_, i) => i);

describe('出る順', () => {
  it('スタックは入れた順の逆に出る', () => {
    expect(run('stack').outs).toEqual([...ids].reverse());
  });
  it('キューとリングバッファは入れた順に出る', () => {
    expect(run('queue').outs).toEqual(ids);
    expect(run('ring').outs).toEqual(ids);
  });
  it('両端キューは入れる端と出す端で決まる', () => {
    expect(run('deque', bulk, { in: 'left', out: 'right' }).outs).toEqual(ids);
    expect(run('deque', bulk, { in: 'left', out: 'left' }).outs).toEqual([...ids].reverse());
  });
  it('リストと配列は、先頭に入れて先頭から出すとスタックと同じ順になる', () => {
    const want = run('stack').outs;
    for (const id of ['array', 'sll', 'dll']) expect(run(id, bulk, { in: 'left', out: 'left' }).outs).toEqual(want);
  });
  it('リストと配列は、末尾に入れて先頭から出すとキューと同じ順になる', () => {
    const want = run('queue').outs;
    for (const id of ['array', 'sll', 'dll']) expect(run(id, bulk, { in: 'right', out: 'left' }).outs).toEqual(want);
  });
  it('小さい順に入れて先頭から出すと、値の小さい順に出る', () => {
    for (const id of ['array', 'sll', 'dll']) {
      const t = run(id, bulk, { in: 'sort', out: 'left' }),
        v = t.outs.map((x) => vals[x]);
      expect(v).toEqual([...v].sort((a, b) => a - b));
    }
  });
  it('交互の出し入れでも、すべてのバーが 1 回ずつ出る', () => {
    const mix = baseTokens('mix', N, 7);
    for (const d of DEFS) expect([...runTrace(d, { n: N, vals, tokens: mix }).outs].sort((a, b) => a - b)).toEqual(ids);
  });
});

describe('手順の記録', () => {
  it('どの手順でも、中のバーと出たバーの数の合計は入れた数に等しい', () => {
    for (const d of DEFS)
      for (const f of runTrace(d, { n: N, vals, tokens: baseTokens('mix', N, 2) }).frames) {
        expect(f.items.filter((v) => v != null).length + f.outN, d.id).toBe(f.next);
        expect(new Set(f.items.filter((v) => v != null)).size, d.id).toBe(f.items.filter((v) => v != null).length);
      }
  });
  it('最初の手順は操作の前の様子である', () => {
    for (const d of DEFS) {
      const f = runTrace(d, { n: N, vals, tokens: bulk }).frames[0];
      expect([f.tok, f.items.length, f.reads, f.writes]).toEqual([0, 0, 0, 0]);
    }
  });
  it('同じ指定なら同じ記録になり、読み書きの回数は減らない', () => {
    for (const d of DEFS) {
      const a = runTrace(d, { n: N, vals, tokens: bulk }),
        b = runTrace(d, { n: N, vals, tokens: bulk });
      expect(a.frames).toEqual(b.frames);
      for (let i = 1; i < a.frames.length; i++)
        expect(a.frames[i].reads + a.frames[i].writes).toBeGreaterThanOrEqual(
          a.frames[i - 1].reads + a.frames[i - 1].writes,
        );
    }
  });
  it('入れる前のバーを使い切っても、操作で新しいバーを足せる', () => {
    const t = run('stack', [...bulk, 'back+', 'back-']);
    expect(t.vals.length).toBe(N + 1);
    expect(t.outs[t.outs.length - 1]).toBe(N);
  });
  it('空のときの削除と満杯のときの追加は、何も変えない', () => {
    const t = run('stack', ['back-']);
    expect(t.frames).toHaveLength(2);
    expect(t.outs).toEqual([]);
    const adds = Array.from({ length: N + 10 }, () => 'back+' as const),
      f = run('stack', adds);
    expect(f.frames[f.frames.length - 1].items.length).toBe(N + 4);
    const op = def('stack').ops[0];
    expect(canRun(op, N + 4, N + 4)).toBe(false);
    expect(canRun(op, N + 3, N + 4)).toBe(true);
  });
  it('入れておいたバーから操作を始められる', () => {
    const t = run('queue', ['front-'], undefined, 8);
    expect(t.frames[0].items).toHaveLength(8);
    expect(t.outs).toEqual([0]);
  });
});

describe('待ちの回数', () => {
  it('全部入れて全部出すと、スタックの最長の待ちは 2n − 1、キューは n', () => {
    expect(run('stack').frames.at(-1)?.wM).toBe(2 * N - 1);
    expect(run('queue').frames.at(-1)?.wM).toBe(N);
  });
  it('入れた順のままの組の数は、キューが n − 1、スタックが 0', () => {
    expect(run('queue').frames.at(-1)?.ord).toBe(N - 1);
    expect(run('stack').frames.at(-1)?.ord).toBe(0);
  });
});

describe('出力の表示の位置', () => {
  it('要素数までは、取り出した順に右から並ぶ', () => {
    expect([0, 1, 2].map((r) => outSlot(r, 3, 8))).toEqual([0, 1, 2]);
    expect(outSlot(7, 8, 8)).toBe(7);
  });
  it('要素数を超えると、古いバーから右端の外へ流れ、位置は枠に収まる', () => {
    const n = 8,
      outN = 50;
    for (let r = 0; r < outN; r++) {
      const s = outSlot(r, outN, n);
      if (r < outN - n) expect(s).toBeLessThan(0);
      else {
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThan(n);
      }
    }
    expect(outSlot(outN - 1, outN, n)).toBe(n - 1);
  });
  it('手で操作を繰り返しても、見えるバーは要素数以下である', () => {
    const toks: Token[] = [];
    for (let i = 0; i < 40; i++) toks.push('back+', 'back-');
    for (const id of ['stack', 'array', 'sll', 'dll', 'deque']) {
      const t = run(id, toks),
        f = t.frames.at(-1);
      expect(f?.outN, id).toBe(40);
      const seen = t.outs.slice(0, f?.outN).filter((_, r) => outSlot(r, f?.outN ?? 0, N) >= 0);
      expect(seen.length, id).toBe(N);
    }
  });
});

describe('リングバッファ', () => {
  it('先頭の場所は上限で 1 周する', () => {
    const toks: Token[] = [];
    for (let i = 0; i < N + 6; i++) toks.push('back+', 'front-');
    const t = run('ring', toks),
      f = t.frames.at(-1);
    expect(f?.hd).toBe((N + 6) % t.cap);
    expect(f?.items).toEqual([]);
  });
  it('先頭に足すと先頭の場所が 1 つ戻る', () => {
    const t = run('ring', ['front+']);
    expect(t.frames.at(-1)?.hd).toBe(t.cap - 1);
  });
});

describe('配列の作り直し', () => {
  it('足りなくなると倍の大きさになり、バーを写す', () => {
    const t = run(
        'array',
        Array.from({ length: 5 }, () => 'back+' as const),
      ),
      sizes = t.frames.map((f) => f.size);
    expect(sizes[0]).toBe(4);
    expect(sizes.at(-1)).toBe(8);
    expect(t.frames.some((f) => f.say === '領域の再確保')).toBe(true);
  });
  it('入れておいたバーがちょうど入る大きさなら、次の追加で作り直さない', () => {
    const t = run('array', ['back+'], undefined, 7);
    expect(t.frames[0].size).toBe(8);
    expect(t.frames.at(-1)?.size).toBe(8);
  });
});

describe('計算量の表記と数えた回数', () => {
  /* 表記が O(1) ならバーの数によらず同じ、O(n) ならバーの数に比例して増える */
  for (const d of DEFS)
    for (const op of d.ops)
      it(`${d.name}: ${op.label} は ${op.o}`, () => {
        const c = opCurve(d, op, [8, 16, 32, 64]);
        if (op.o === 'O(n)') {
          /* バーの数を倍にすると、増える回数も倍になる */
          expect((c[3] - c[2]) / (c[2] - c[1])).toBeCloseTo(2, 0);
          expect((c[2] - c[1]) / (c[1] - c[0])).toBeCloseTo(2, 0);
        } else if (op.amort) {
          for (const v of c) expect(v).toBeLessThanOrEqual(3.5);
        } else expect(new Set(c).size).toBe(1);
      });
  it('片方向リストの末尾の削除だけ、双方向より遅い', () => {
    const cnt = (id: string) => {
      const d = def(id),
        op = d.ops.find((x) => x.key === 'back-');
      if (!op) throw new Error(id);
      return opCurve(d, op, [64])[0];
    };
    expect(cnt('sll')).toBeGreaterThan(60);
    expect(cnt('dll')).toBeLessThan(5);
  });
  it('どの操作も一覧の表の列にある', () => {
    const keys = new Set(KEYS.map((k) => k[0]));
    for (const d of DEFS) for (const op of d.ops) expect(keys.has(op.key), `${d.id} ${op.key}`).toBe(true);
  });
  it('同じデータ構造に同じ列の操作は 1 つだけ', () => {
    for (const d of DEFS) expect(new Set(d.ops.map((o) => o.key)).size, d.id).toBe(d.ops.length);
  });
});

describe('バーの並び', () => {
  it('値は 1〜1000 の整数で、同じ引数なら同じ', () => {
    for (const [k] of SHAPES)
      for (const n of [8, 24, 64]) {
        const a = barVals(k, n, 2);
        expect(a).toHaveLength(n);
        for (const v of a) {
          expect(Number.isInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(1);
          expect(v).toBeLessThanOrEqual(1000);
        }
        expect(barVals(k, n, 2)).toEqual(a);
      }
  });
  it('右上がりは右端のバー（最初に入るバー）がいちばん高い', () => {
    const a = barVals('ramp', 8, 1);
    expect(a[0]).toBe(Math.max(...a));
    expect(a[7]).toBe(Math.min(...a));
  });
});

describe('出し入れの列', () => {
  it('交互の列は、途中で中身が負にならず最後に空になる', () => {
    for (const seed of [1, 2, 3]) {
      let c = 0;
      for (const t of baseTokens('mix', 32, seed)) {
        c += t === 'in' ? 1 : -1;
        expect(c).toBeGreaterThanOrEqual(0);
      }
      expect(c).toBe(0);
    }
  });
});
