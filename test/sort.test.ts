import { describe, expect, it } from 'vitest';
import { ALGS, algOf } from '../src/tools/sort/algorithms';
import { DISTS, gen, resample } from '../src/tools/sort/data';
import { Rec, STOP } from '../src/tools/sort/recorder';
import { countOps, Run, ranks } from '../src/tools/sort/run';

const LIM = 400000;
const NS = [2, 3, 8, 9, 16, 33, 64, 128, 256];

describe('順位', () => {
  it('回数の少ない順に付く', () => {
    expect(ranks([30, 10, 20])).toEqual([3, 1, 2]);
  });
  it('同じ回数は同じ順位で、次の順位はその数だけ飛ぶ', () => {
    expect(ranks([10, 10, 20])).toEqual([1, 1, 3]);
    expect(ranks([20, 10, 20, 30])).toEqual([2, 1, 2, 4]);
    expect(ranks([5, 5, 5])).toEqual([1, 1, 1]);
  });
});

describe('データ', () => {
  it('値は 1〜n で、同じ引数なら同じ', () => {
    for (const n of [8, 128, 1024])
      for (const [k] of DISTS) {
        const a = gen(k, n, 1);
        expect(a.length).toBe(n);
        expect(Math.min(...a)).toBeGreaterThanOrEqual(1);
        expect(Math.max(...a)).toBeLessThanOrEqual(n);
        expect(gen(k, n, 1)).toEqual(a);
      }
  });
  it('並び替え済みと逆順', () => {
    expect(gen('sorted', 5, 1)).toEqual([1, 2, 3, 4, 5]);
    expect(gen('reversed', 5, 1)).toEqual([5, 4, 3, 2, 1]);
  });
  it('ランダムは順列で、種を変えると変わる', () => {
    const a = gen('random', 64, 1);
    expect([...a].sort((p, q) => p - q)).toEqual(gen('sorted', 64, 1));
    expect(gen('random', 64, 2)).not.toEqual(a);
  });
  it('中央値付近に偏る', () => {
    const a = gen('center', 1024, 1),
      mid = a.filter((v) => v > 256 && v <= 768).length;
    expect(mid / 1024).toBeGreaterThan(0.85);
  });
  it('手描きのデータを別の個数へ写す', () => {
    const a = resample([1, 8, 8, 1, 4, 4, 2, 2], 16);
    expect(a.length).toBe(16);
    expect(Math.max(...a)).toBe(16);
    expect(a[0]).toBe(2);
  });
});

describe('どのアルゴリズムも並べ替える', () => {
  for (const alg of ALGS)
    it(alg.id, () => {
      for (const n of NS)
        for (const [d] of DISTS) {
          const src = gen(d, n, 1),
            want = [...src].sort((p, q) => p - q),
            r = new Run(alg, src, LIM);
          if (r.trunc) continue;
          while (r.step(null, false));
          expect(Array.from(r.a), `${d} ${n}`).toEqual(want);
          expect(r.c, `${d} ${n}`).toEqual(r.final);
        }
    });
  it('打ち切らない組がある（ボゴとボゾの大きな n を除く）', () => {
    for (const alg of ALGS) {
      if (alg.id === 'bogo' || alg.id === 'bozo' || alg.id === 'slow') continue;
      for (const [d] of DISTS) expect(countOps(alg, gen(d, 64, 1), LIM).trunc, `${alg.id} ${d}`).toBe(false);
    }
  });
});

describe('安定性', () => {
  /* キーを 4 種に絞り、下位ビットに元の位置を入れる */
  const SHIFT = 12;
  for (const alg of ALGS.filter((a) => a.st))
    it(`${alg.id} は同じ値の順を保つ`, () => {
      for (const n of [16, 50, 128]) {
        const src = gen('random', n, 3).map((v, i) => (((v % 4) + 1) << SHIFT) | i),
          r = new Rec(src, LIM, false, SHIFT);
        alg.fn(r);
        for (let i = 1; i < n; i++) {
          const ka = r.a[i - 1] >> SHIFT,
            kb = r.a[i] >> SHIFT;
          expect(ka, `${n}`).toBeLessThanOrEqual(kb);
          if (ka === kb) expect(r.a[i - 1] & 4095, `${n} ${i}`).toBeLessThan(r.a[i] & 4095);
        }
      }
    });
});

describe('途中への移動', () => {
  it('順に進めたときと同じ状態になる', () => {
    for (const id of ['quick-last', 'merge', 'heap', 'shell', 'radix-msd', 'tim', 'selection', 'dual']) {
      const src = gen('random', 128, 1),
        r = new Run(algOf(id), src);
      for (const f of [0.77, 0.05, 0.31, 1, 0]) {
        const p = Math.floor(r.total * f),
          q = new Run(algOf(id), src);
        for (let i = 0; i < p; i++) q.step(null, false);
        r.seek(p);
        expect(Array.from(r.a), id).toEqual(Array.from(q.a));
        expect([r.pos, r.p1, r.p2, r.pv, r.rlo, r.rhi, r.inf, r.c], id).toEqual([
          q.pos,
          q.p1,
          q.p2,
          q.pv,
          q.rlo,
          q.rhi,
          q.inf,
          q.c,
        ]);
        expect(Array.from(r.fixd), id).toEqual(Array.from(q.fixd));
      }
    }
  });
  it('上限で打ち切ると未完になる', () => {
    const r = new Run(algOf('bogo'), gen('random', 16, 1));
    expect(r.trunc).toBe(true);
    expect(r.total).toBe(200000);
    expect(new Run(algOf('slow'), gen('random', 256, 1), 1000).total).toBe(1000);
  });
  it('STOP の外の例外はそのまま投げる', () => {
    const alg = {
      ...algOf('bubble'),
      fn: () => {
        throw new Error('x');
      },
    };
    expect(() => countOps(alg, [2, 1])).toThrow('x');
    expect(STOP).toBeTypeOf('symbol');
  });
});

describe('計算量', () => {
  const total = (id: string, d: Parameters<typeof gen>[0], n: number) => countOps(algOf(id), gen(d, n, 1));
  it('バブルは並び替え済みで n − 1 回の比較、逆順で n(n − 1)/2 回の交換', () => {
    expect(total('bubble', 'sorted', 128).c.cmp).toBe(127);
    expect(total('bubble', 'reversed', 128).c.swap).toBe((128 * 127) / 2);
  });
  it('挿入は並び替え済みで n − 1 回の比較', () => {
    expect(total('insertion', 'sorted', 128).c.cmp).toBe(127);
  });
  it('選択はどのデータでも n(n − 1)/2 回の比較', () => {
    for (const d of ['sorted', 'random'] as const) expect(total('selection', d, 128).c.cmp).toBe((128 * 127) / 2);
  });
  it('末尾をピボットにしたクイックは並び替え済みで n(n − 1)/2 回の比較', () => {
    expect(total('quick-last', 'sorted', 128).c.cmp).toBe((128 * 127) / 2);
    expect(total('quick-mid', 'sorted', 128).c.cmp).toBeLessThan(128 * 10);
  });
  it('マージの比較は n log₂ n 以下', () => {
    for (const d of ['random', 'reversed', 'few'] as const)
      expect(total('merge', d, 256).c.cmp).toBeLessThanOrEqual(256 * 8);
  });
  it('ヒープの比較は 2n log₂ n 程度', () => {
    expect(total('heap', 'random', 1024).c.cmp).toBeLessThan(2 * 1024 * 10 + 1024);
  });
  it('ティムとパワーは並び替え済みで n − 1 回の比較', () => {
    expect(total('tim', 'sorted', 256).c.cmp).toBe(255);
    expect(total('power', 'sorted', 256).c.cmp).toBe(255);
    expect(total('tim', 'reversed', 256).c.cmp).toBe(255);
  });
  it('pdqsort は並び替え済みで 2n 回程度', () => {
    expect(total('pdq', 'sorted', 1024).total).toBeLessThan(3 * 1024);
  });
  it('スムースは並び替え済みで比較が線形', () => {
    expect(total('smooth', 'sorted', 1024).c.cmp).toBeLessThan(5 * 1024);
    expect(total('smooth', 'reversed', 1024).c.cmp).toBeGreaterThan(5 * 1024);
  });
  it('3 分割クイックは値の種類が少ないと速い', () => {
    expect(total('quick3', 'few', 1024).total).toBeLessThan(total('quick-last', 'few', 1024).total / 2);
  });
  it('サイクルの書き込みは正しい位置にない要素の数以下', () => {
    const src = gen('random', 256, 1),
      r = countOps(algOf('cycle'), src),
      off = [...src].sort((p, q) => p - q).filter((v, i) => src[i] !== v).length;
    expect(r.c.write).toBeLessThanOrEqual(off);
  });
  it('ソーティングネットワークの比較器の数は n = 16 で 63・80・63 で、データによらない', () => {
    for (const [id, want] of [
      ['batcher', 63],
      ['bitonic', 80],
      ['pairwise', 63],
    ] as const)
      for (const [d] of DISTS) expect(total(id, d, 16).c.cmp, `${id} ${d}`).toBe(want);
  });
  it('ストゥージは n^2.71 程度', () => {
    const a = total('stooge', 'random', 16).c.cmp,
      b = total('stooge', 'random', 256).c.cmp,
      k = Math.log(b / a) / Math.log(16);
    expect(k).toBeGreaterThan(2.5);
    expect(k).toBeLessThan(3);
  });
  it('計数は比較をしない', () => {
    for (const id of ['counting', 'radix-lsd', 'radix-msd', 'flag', 'bead'])
      expect(total(id, 'random', 128).c.cmp, id).toBe(0);
  });
});
