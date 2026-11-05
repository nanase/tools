import { describe, expect, it } from 'vitest';
import {
  average,
  BIG_O,
  DEFS,
  type Def,
  defOf,
  type Frame,
  inspect,
  levelsFor,
  type Method,
  makeKeys,
  makeOps,
  runTrace,
  STAGES,
  type Trace,
} from '../src/tools/b-tree/model';
import type { BarShape } from '../src/tools/list-queue-stack/model';

const def = (id: string): Def => {
  const d = defOf(id);
  if (!d) throw new Error(id);
  return d;
};
const SHAPE_LIST: readonly BarShape[] = ['rand', 'ramp', 'down', 'saw'];
const run = (id: string, m: number, shape: BarShape, n: number, seed: number, method: Method = 'add', free = false) => {
  const keys = makeKeys(shape, n, seed),
    ops = makeOps(keys, seed, method);
  return { keys, ops, t: runTrace(def(id), m, ops, { free }) };
};
/** 工程の終わりのコマ */
const endOf = (t: Trace, s: number): Frame => t.frames[s < 3 ? t.starts[s + 1] - 1 : t.frames.length - 1];
const sorted = (a: readonly number[]) => [...new Set(a)].sort((x, y) => x - y);
const trees = DEFS.filter((d) => d.kind !== 'bst');

describe('キー', () => {
  it('重複がなく、形のとおりに並ぶ', () => {
    for (const s of SHAPE_LIST) expect(new Set(makeKeys(s, 63, 3)).size).toBe(63);
    const up = makeKeys('ramp', 31, 3),
      down = makeKeys('down', 31, 3);
    expect(up).toEqual(sorted(up));
    expect(down).toEqual(sorted(down).reverse());
  });
  it('同じ種からは同じ列になる', () => {
    expect(makeKeys('rand', 31, 5)).toEqual(makeKeys('rand', 31, 5));
    expect(makeKeys('rand', 31, 5)).not.toEqual(makeKeys('rand', 31, 6));
  });
});

describe('木の形', () => {
  it.each(trees.map((d) => [d.name, d.id]))('%s: 追加で全キーが入り、全部の葉が同じ段にある', (_, id) => {
    for (const m of [3, 4, 5, 8, 16])
      for (const s of SHAPE_LIST)
        for (const n of [15, 63]) {
          const { keys, t } = run(id, m, s, n, 2),
            i = inspect(t, endOf(t, 0));
          expect(sorted(i.keys)).toEqual(sorted(keys));
          expect(i.bad).toBe(0);
          expect(i.uniform).toBe(true);
        }
  });
  it.each(['b', 'bp', 'td', 'cow', 'bs'].map((id) => [def(id).name, id]))(
    '%s: どのコマの操作の区切りでも下限を割らない',
    (_, id) => {
      for (const m of [3, 4, 5, 8, 16])
        for (const s of SHAPE_LIST) {
          const { keys, ops, t } = run(id, m, s, 63, 4),
            dels = (ops[3] as { k: number }[]).map((o) => o.k),
            i = inspect(t, endOf(t, 3));
          expect(sorted(i.keys)).toEqual(sorted(keys.filter((k) => !dels.includes(k))));
          expect(i.bad).toBe(0);
          expect(i.uniform).toBe(true);
          expect(i.low).toBe(0);
          expect(inspect(t, endOf(t, 0)).low).toBe(0);
        }
    },
  );
  it('二分探索木は整列したデータで 1 本に伸びる', () => {
    const { t } = run('bst', 4, 'ramp', 31, 1);
    expect(inspect(t, endOf(t, 0)).depth).toBe(31);
    expect(inspect(run('bst', 4, 'rand', 31, 1).t, endOf(run('bst', 4, 'rand', 31, 1).t, 0)).depth).toBeLessThan(15);
  });
  it('記録したコマはあとの操作で書き換わらない', () => {
    const { t } = run('b', 4, 'rand', 31, 1);
    /* 追加の間のキーの数は 1 個ずつ増える。あとの操作が前のコマを変えると全部 31 個になる */
    const counts = t.frames.slice(0, t.starts[1]).map((x) => inspect(t, x).keys.length);
    expect(counts[0]).toBe(0);
    expect(counts[counts.length - 1]).toBe(31);
    for (let i = 1; i < counts.length; i++) expect(counts[i] - counts[i - 1]).toBeGreaterThanOrEqual(0);
    expect(new Set(counts).size).toBe(32);
  });
});

describe('充填率', () => {
  const fillOf = (id: string) => {
    let f = 0;
    for (let s = 1; s <= 6; s++) {
      const { t } = run(id, 8, 'rand', 255, s);
      f += inspect(t, endOf(t, 0)).fill;
    }
    return f / 6;
  };
  it('ランダムな追加で、B木は約 69 %、B*木はそれより高い', () => {
    const b = fillOf('b'),
      s = fillOf('bs');
    expect(b).toBeGreaterThan(0.62);
    expect(b).toBeLessThan(0.74);
    expect(s).toBeGreaterThan(b + 0.05);
  });
  it('右上がりのデータで、B木は半分近くまで下がる', () => {
    const { t } = run('b', 8, 'ramp', 255, 1);
    expect(inspect(t, endOf(t, 0)).fill).toBeLessThan(0.62);
  });
  it('まとめて構築は 1 個ずつより埋まり、分割より書き込みが少ない', () => {
    const a = run('bp', 8, 'rand', 255, 1).t,
      b = run('bp', 8, 'rand', 255, 1, 'bulk').t;
    expect(inspect(b, endOf(b, 0)).fill).toBeGreaterThan(inspect(a, endOf(a, 0)).fill);
    expect(b.totals[0].w).toBeLessThan(a.totals[0].w / 4);
    expect(b.totals[0].r).toBe(0);
  });
});

describe('B*木', () => {
  it('根だけ枠が広く、分けたときに下限を満たす', () => {
    expect(run('bs', 8, 'rand', 15, 1).t).toMatchObject({ maxK: 7, minK: 4, rootK: 8 });
    expect(run('bs', 4, 'rand', 15, 1).t).toMatchObject({ maxK: 3, minK: 2, rootK: 4 });
    expect(run('bs', 3, 'rand', 15, 1).t).toMatchObject({ maxK: 2, minK: 1, rootK: 2 });
  });
  it('2 つを 3 つへの分割と、隣へ分ける動きが出る', () => {
    const says = run('bs', 4, 'rand', 63, 1).t.frames.map((f) => f.say);
    expect(says.some((s) => s.startsWith('2 つを 3 つへ'))).toBe(true);
    expect(says.some((s) => s.startsWith('隣へ分ける'))).toBe(true);
  });
  it('削除で 3 つを 2 つへ戻す動きが出る', () => {
    const says = run('bs', 8, 'rand', 255, 1).t.frames.map((f) => f.say);
    expect(says.some((s) => s.startsWith('3 つを 2 つへ'))).toBe(true);
  });
});

describe('検索と範囲', () => {
  it.each(DEFS.map((d) => [d.name, d.id]))('%s: あるキーは見つかり、ないキーはない', (_, id) => {
    const { ops, t } = run(id, 4, 'rand', 31, 2),
      fr = t.frames.slice(t.starts[1], t.starts[2]),
      last = (ops[1][ops[1].length - 1] as { k: number }).k;
    for (const o of ops[1].slice(0, -1) as { k: number }[])
      expect(fr.some((f) => f.say.includes(`${o.k} を発見`))).toBe(true);
    expect(fr.some((f) => f.say === `${last} なし`)).toBe(true);
    expect(t.totals[1].w).toBe(0);
  });
  it.each(DEFS.map((d) => [d.name, d.id]))('%s: 範囲は過不足なく昇順に近い順で読める', (_, id) => {
    for (const s of SHAPE_LIST) {
      const { keys, ops, t } = run(id, 4, s, 63, 3),
        r = ops[2][0] as { lo: number; hi: number },
        got = endOf(t, 2).out;
      expect(sorted(got)).toEqual(sorted(keys.filter((k) => k >= r.lo && k <= r.hi)));
      if (id !== 'be') expect(got).toEqual(sorted(got));
    }
  });
  it('B+木の範囲は途中のノードへ戻らない', () => {
    const { t } = run('bp', 4, 'rand', 63, 3),
      b = run('b', 4, 'rand', 63, 3).t;
    expect(t.frames.slice(t.starts[2], t.starts[3]).some((f) => f.say === '親へ')).toBe(false);
    expect(b.frames.slice(b.starts[2], b.starts[3]).some((f) => f.say === '親へ')).toBe(true);
  });
});

describe('札と色', () => {
  const stageFrames = (t: Trace, s: number) => t.frames.slice(t.starts[s], s < 3 ? t.starts[s + 1] : t.frames.length);
  it.each(DEFS.map((d) => [d.name, d.id]))('%s: 追加は塗りの札、検索と削除は「?」の札', (_, id) => {
    const { t } = run(id, 4, 'rand', 31, 2),
      kinds = (s: number) => new Set(stageFrames(t, s).flatMap((f) => (f.cur ? [f.cur.q] : [])));
    expect([...kinds(0)]).toEqual([false]);
    expect([...kinds(1)]).toEqual([true]);
    expect([...kinds(3)]).toEqual([true]);
  });
  it.each(DEFS.map((d) => [d.name, d.id]))('%s: 範囲の札は読み終わるまで範囲を出し続ける', (_, id) => {
    const { ops, t } = run(id, 4, 'rand', 63, 3),
      r = ops[2][0] as { lo: number; hi: number },
      fr = stageFrames(t, 2).filter((f) => f.tok === 0 && (f.say.includes('個目') || f.say.includes('読み出し')));
    expect(fr.length).toBeGreaterThan(1);
    for (const f of fr) expect(f.cur).toMatchObject({ k: r.lo, hi: r.hi, q: true });
  });
  it.each(DEFS.map((d) => [d.name, d.id]))(
    '%s: 検索と範囲は書き込みの色を使わず、見つけたキーを読み出しの色にする',
    (_, id) => {
      const { t } = run(id, 4, 'rand', 31, 2);
      for (const s of [1, 2]) for (const f of stageFrames(t, s)) expect(f.hot).toEqual([]);
      expect(stageFrames(t, 1).some((f) => f.got.length === 1)).toBe(true);
      expect(stageFrames(t, 2).some((f) => f.got.length === 1)).toBe(true);
    },
  );
});

describe('種類ごとの違い', () => {
  it('トップダウン分割は親へ戻らず、奇数の次数を偶数で動かす', () => {
    const { t } = run('td', 5, 'rand', 63, 1);
    expect(t.m).toBe(6);
    const says = t.frames.slice(t.starts[0], t.starts[1]).map((f) => f.say);
    expect(says).not.toContain('あふれ');
    expect(says).toContain('満杯: 下りる前に分割');
  });
  it('コピーオンライトは B木より書き込みが多く、木の形は同じ', () => {
    const b = run('b', 4, 'rand', 63, 1).t,
      c = run('cow', 4, 'rand', 63, 1).t;
    expect(c.totals[0].w).toBeGreaterThan(b.totals[0].w);
    expect(inspect(c, endOf(c, 0)).nodes).toBe(inspect(b, endOf(b, 0)).nodes);
    /* 書くたびに古いページが出る */
    expect(c.frames.some((f) => f.stale.length > 0)).toBe(true);
    expect(b.frames.some((f) => f.stale.length > 0)).toBe(false);
  });
  it('Bε木は追加の読み書きが B木より少なく、バッファにキーが残る', () => {
    const b = run('b', 16, 'rand', 255, 1).t,
      e = run('be', 16, 'rand', 255, 1).t;
    expect(e.totals[0].w).toBeLessThan(b.totals[0].w);
    expect(e.totals[0].r).toBeLessThan(b.totals[0].r);
    expect(endOf(e, 0).N.some((v) => v && v.buf.length > 0)).toBe(true);
  });
  it('Bε木は消す印のあとに検索しても見つからない', () => {
    const keys = makeKeys('rand', 63, 1),
      k = keys[5],
      t = runTrace(def('be'), 4, [
        makeOps(keys, 1, 'add')[0],
        [
          { t: 'del', k },
          { t: 'find', k },
        ],
        [],
        [],
      ]);
    const says = t.frames.slice(t.starts[1], t.starts[2]).map((f) => f.say);
    expect(says.some((s) => s === `バッファに消す印: ${k} なし` || s === `${k} なし`)).toBe(true);
    expect(says).not.toContain(`${k} を発見`);
  });
  it('空で解放は半分で併合より書き込みが少なく、B+木だけに効く', () => {
    const a = run('bp', 8, 'rand', 255, 1).t,
      b = run('bp', 8, 'rand', 255, 1, 'add', true).t,
      c = run('b', 8, 'rand', 255, 1, 'add', true).t,
      d = run('b', 8, 'rand', 255, 1).t;
    expect(b.totals[3].w).toBeLessThan(a.totals[3].w);
    expect(c.totals[3]).toEqual(d.totals[3]);
    const i = inspect(b, endOf(b, 3));
    expect(i.bad).toBe(0);
    expect(i.uniform).toBe(true);
  });
});

describe('工程と回数', () => {
  it('回数は工程ごとに 0 から数え、最後のコマが合計になる', () => {
    const { t } = run('b', 4, 'rand', 31, 1);
    for (const s of [0, 1, 2, 3]) {
      expect(t.frames[t.starts[s]].cnt).toEqual({ r: 0, w: 0, c: 0, s: 0, m: 0 });
      expect(endOf(t, s).cnt).toEqual(t.totals[s]);
      expect(endOf(t, s).say).toBe(`${STAGES[s][1]} 完了`);
    }
  });
  it('操作の番号は工程の中で順に進む', () => {
    const { ops, t } = run('b', 4, 'rand', 31, 1),
      fr = t.frames.slice(t.starts[1], t.starts[2]);
    expect(fr[0].tok).toBe(0);
    expect(fr[fr.length - 1].tok).toBe(ops[1].length);
  });
  it('平均は n = 31 で B木が二分探索木より読み込みが少ない', () => {
    const b = average(def('b'), 4),
      s = average(def('bst'), 4);
    expect(b.find).toBeLessThan(s.find);
    expect(b.depth).toBeLessThan(s.depth);
  });
});

describe('計算量と段数', () => {
  it('全部の種類に計算量がある', () => {
    for (const d of DEFS) for (const [k] of STAGES) expect(BIG_O[d.id][k]).toBeTruthy();
  });
  it('1 億行・8 KB のページは二分探索木の 27 段に対して B+木 4 段', () => {
    expect(levelsFor(1e8, 8192)).toEqual({ bin: 27, fan: 512, bt: 4 });
  });
  it('ページが大きいほど段数が減る', () => {
    expect(levelsFor(1e10, 16384).bt).toBeLessThanOrEqual(levelsFor(1e10, 4096).bt);
  });
});
