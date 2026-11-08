import { describe, expect, it } from 'vitest';
import type { BarShape } from '../src/tools/list-queue-stack/model';
import {
  average,
  BIG_O,
  boundOf,
  DEFS,
  type Def,
  defOf,
  type Frame,
  inspect,
  makeKeys,
  makeOps,
  RULES,
  runTrace,
  type Trace,
} from '../src/tools/red-black-tree/model';

const def = (id: string): Def => {
  const d = defOf(id);
  if (!d) throw new Error(id);
  return d;
};
const SHAPE_LIST: readonly BarShape[] = ['rand', 'ramp', 'down', 'saw'];
const run = (id: string, shape: BarShape, n: number, seed: number) => {
  const keys = makeKeys(shape, n, seed),
    ops = makeOps(keys, seed);
  return { keys, ops, t: runTrace(def(id), ops) };
};
/** 工程の終わりのコマ */
const endOf = (t: Trace, s: number): Frame => t.frames[s < 2 ? t.starts[s + 1] - 1 : t.frames.length - 1];
const sorted = (a: readonly number[]) => [...a].sort((x, y) => x - y);

/** 種類ごとの条件を破った数 */
function broken(d: Def, f: Frame): number {
  const s = inspect(f);
  let bad = 0;
  if (d.fam) {
    if (!s.even) bad++;
    if (f.root !== null && f.N[f.root].c === 1) bad++;
    for (const k of s.order) {
      const n = f.N[k];
      for (const c of [n.l, n.r]) if (c !== null && n.c === 1 && f.N[c].c === 1) bad++;
      if (d.kind === 'llrb' && n.r !== null && f.N[n.r].c === 1) bad++;
      if (d.kind === 'aa' && n.l !== null && f.N[n.l].i === n.i) bad++;
    }
  }
  if (d.kind === 'avl') for (const k of s.order) if (Math.abs(f.N[k].i) > 1) bad++;
  return bad;
}

describe('木の形', () => {
  it.each(DEFS.map((d) => [d.name, d.id]))('%s: 追加と削除のあとも順番と条件を保つ', (_, id) => {
    const d = def(id);
    for (const s of SHAPE_LIST)
      for (const n of [7, 15, 31, 63])
        for (let seed = 1; seed <= 6; seed++) {
          const { keys, ops, t } = run(id, s, n, seed),
            gone = new Set(ops[2].map((o) => o.k));
          expect(inspect(endOf(t, 0)).order).toEqual(sorted(keys));
          expect(inspect(endOf(t, 2)).order).toEqual(sorted(keys.filter((k) => !gone.has(k))));
          expect(broken(d, endOf(t, 0))).toBe(0);
          expect(broken(d, endOf(t, 2))).toBe(0);
          /* 1 回の削除が終わるたびに条件を保つ */
          const F = t.frames;
          for (let i = t.starts[2]; i < F.length - 1; i++)
            if (F[i].tok >= 0 && F[i + 1].tok !== F[i].tok) expect(broken(d, F[i])).toBe(0);
        }
  });
  it.each(DEFS.filter((d) => d.kind !== 'bst').map((d) => [d.name, d.id]))('%s: 高さが上限を超えない', (_, id) => {
    for (const s of SHAPE_LIST)
      for (const n of [15, 31, 63]) {
        const { t } = run(id, s, n, 2);
        expect(inspect(endOf(t, 0)).h).toBeLessThanOrEqual(boundOf(def(id).kind, n));
      }
  });
  it('右上がりのキーで二分探索木は 1 本に伸び、赤黒木は伸びない', () => {
    expect(inspect(endOf(run('bst', 'ramp', 31, 1).t, 0)).h).toBe(31);
    expect(inspect(endOf(run('rb', 'ramp', 31, 1).t, 0)).h).toBeLessThanOrEqual(10);
  });
});

describe('回数', () => {
  it('赤黒木の 1 回の追加の回転は 2 回まで、削除は 3 回まで', () => {
    for (const s of SHAPE_LIST) {
      const { t } = run('rb', s, 63, 4);
      for (const stage of [0, 2]) {
        const F = t.frames,
          a = t.starts[stage],
          b = stage < 2 ? t.starts[stage + 1] : F.length;
        /* 操作の境ごとに、その操作の回転の数を見る */
        let before = F[a].cnt.rot;
        for (let i = a + 1; i < b; i++)
          if (F[i].tok !== F[i - 1].tok && F[i - 1].tok >= 0) {
            expect(F[i - 1].cnt.rot - before).toBeLessThanOrEqual(stage ? 3 : 2);
            before = F[i - 1].cnt.rot;
          }
      }
    }
  });
  it('検索は木を変えない', () => {
    for (const d of DEFS) {
      const { t } = run(d.id, 'rand', 31, 3);
      expect(t.totals[1].rot).toBe(0);
      expect(t.totals[1].pt).toBe(0);
      expect(endOf(t, 1).N).toEqual(endOf(t, 0).N);
    }
  });
  it('使った規則は種類の規則の表にある', () => {
    for (const d of DEFS) {
      const ids = new Set(RULES[d.kind].map((r) => r[0])),
        { t } = run(d.id, 'rand', 63, 5);
      for (const f of t.frames) if (f.rule) expect(ids.has(f.rule)).toBe(true);
    }
  });
  it('平均の比較は AVL木が赤黒木以下、二分探索木の追加はランダムでも多い', () => {
    const rb = average(def('rb')),
      avl = average(def('avl'));
    expect(avl.find.c).toBeLessThanOrEqual(rb.find.c + 0.3);
    expect(average(def('bst')).add.c).toBeGreaterThan(rb.add.c);
  });
  it('計算量の表が全種類にある', () => {
    for (const d of DEFS) expect(BIG_O[d.id]).toBeDefined();
  });
});
