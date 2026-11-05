import { describe, expect, it } from 'vitest';
import {
  BIG_O,
  barVals,
  countOp,
  DEFS,
  defOf,
  type Frame,
  isPointer,
  KEYS,
  levelOf,
  levelsOf,
  type OpKey,
  parentOf,
  runTrace,
  sortTokens,
  storeTokens,
  totalOf,
  VM,
} from '../src/tools/binary-heap/model';

const N = 31;
const vals = barVals('rand', N, 3);
const def = (id: string) => {
  const d = defOf(id);
  if (!d) throw new Error(id);
  return d;
};
const heaps = DEFS.filter((d) => d.kind !== 'array');
const pointers = DEFS.filter((d) => isPointer(d));
const bulk = storeTokens('add', N);
/** 操作の区切りのコマ: 次のコマで次の操作に移る直前 */
const ends = (fr: Frame[]) => fr.filter((f, i) => i === fr.length - 1 || fr[i + 1].tok !== f.tok);

describe('添字', () => {
  it('二分木の親と段が式どおりになる', () => {
    expect([1, 2, 3, 4, 5, 6].map((i) => parentOf(i, 2))).toEqual([0, 0, 1, 1, 2, 2]);
    expect([0, 1, 2, 3, 6, 7, 14, 15].map((i) => levelOf(i, 2).l)).toEqual([0, 1, 1, 2, 2, 3, 3, 4]);
    expect(levelsOf(31, 2)).toBe(5);
    expect(levelsOf(32, 2)).toBe(6);
    expect(levelsOf(0, 2)).toBe(0);
  });
  it('4 分木の親が式どおりになる', () => {
    expect([1, 4, 5, 8, 9].map((i) => parentOf(i, 4))).toEqual([0, 0, 1, 1, 2]);
    expect(levelsOf(21, 4)).toBe(3);
  });
});

describe('データ', () => {
  it('値は 1〜VM に収まり、右上がりは配列の左から増える', () => {
    for (const s of ['rand', 'ramp', 'down', 'saw'] as const)
      for (const v of barVals(s, 63, 5)) {
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(VM);
      }
    const r = barVals('ramp', 15, 1);
    expect([...r].sort((a, b) => a - b)).toEqual(r);
    const d = barVals('down', 15, 1);
    expect([...d].sort((a, b) => b - a)).toEqual(d);
  });
});

describe('ヒープの条件', () => {
  for (const d of heaps)
    for (const max of [true, false]) {
      const name = `${d.name}（${max ? '最大' : '最小'}）`;
      it(`${name}: 1 個ずつ追加すると操作の区切りごとに条件を満たす`, () => {
        const t = runTrace(d, { vals, tokens: bulk, max });
        for (const f of ends(t.frames)) expect(f.bad).toBe(0);
      });
      it(`${name}: まとめて構築しても最後に条件を満たす`, () => {
        const t = runTrace(d, { vals, tokens: ['build'], max });
        if (d.kind === 'implicit') expect(t.frames.some((f) => f.bad > 0)).toBe(true);
        expect((t.frames.at(-1) as Frame).bad).toBe(0);
        expect((t.frames.at(-1) as Frame).h).toHaveLength(N);
      });
      it(`${name}: 取り出しの途中でも操作の区切りでは条件を満たす`, () => {
        const t = runTrace(d, { vals, pre: bulk, tokens: Array(N).fill('pop'), max });
        for (const f of ends(t.frames)) expect(f.bad).toBe(0);
      });
    }
});

describe('取り出す順', () => {
  const sorted = (a: number[], max: boolean) => [...a].sort((x, y) => (max ? y - x : x - y));
  for (const d of DEFS)
    for (const max of [true, false])
      for (const m of ['add', 'build'] as const) {
        it(`${d.name}・${max ? '最大' : '最小'}・${m}: 値の順に全部出る`, () => {
          const store = storeTokens(m, N),
            tokens = sortTokens(d, { vals, max }, store),
            t = runTrace(d, { vals, pre: store, tokens, max }),
            last = t.frames.at(-1) as Frame;
          expect(last.h).toHaveLength(0);
          const out = last.out.map((id) => t.vals[id]);
          expect(out).toEqual(sorted(vals, max));
        });
      }
  it('格納の前に何度追加しても取り出しの回数がそろう', () => {
    const store: OpKey[] = [...bulk, 'add', 'add'];
    expect(sortTokens(def('bin'), { vals }, store)).toHaveLength(N + 2);
  });
});

describe('工程', () => {
  it('ソートは格納の結果から 0 回で始まる', () => {
    for (const d of DEFS) {
      const t = runTrace(d, { vals, pre: bulk, tokens: sortTokens(d, { vals }, bulk) }),
        f = t.frames[0];
      expect(f.h).toHaveLength(N);
      expect(f.out).toHaveLength(0);
      expect(f.cmp + f.mov).toBe(0);
    }
  });
  it('格納は空から始まり、全部入って止まる', () => {
    const t = runTrace(def('bin'), { vals, tokens: bulk }),
      a = t.frames[0],
      z = t.frames.at(-1) as Frame;
    expect(a.h).toHaveLength(0);
    expect(a.next).toBe(0);
    expect(z.h).toHaveLength(N);
    expect(z.next).toBe(N);
    expect(z.out).toHaveLength(0);
  });
  it('工程の始めと終わりの文を出す', () => {
    const t = runTrace(def('bin'), { vals, tokens: bulk, startSay: 'A', endSay: 'B' });
    expect(t.frames[0].say).toBe('A');
    expect(t.frames.at(-1)?.say).toBe('B');
  });
  it('回数だけ数えた合計は記録の回数と同じ', () => {
    for (const d of DEFS)
      for (const m of ['add', 'build'] as const) {
        const store = storeTokens(m, N),
          f = runTrace(d, { vals, tokens: store }).frames.at(-1) as Frame;
        expect(totalOf(d, { vals, tokens: store })).toBe(f.cmp + f.mov);
      }
  });
});

describe('比較と移動の回数', () => {
  it('1 回の交換は移動 1 回、比べるたびに比較が増える', () => {
    const t = runTrace(def('bin'), { vals: [1, 2], tokens: ['add', 'add'] }),
      z = t.frames.at(-1) as Frame;
    /* 2 回の追加と 1 回の交換、1 回の比較 */
    expect(z.mov).toBe(3);
    expect(z.cmp).toBe(1);
    expect(z.h.map((id) => t.vals[id])).toEqual([2, 1]);
  });
  it('取り出しの比較は子の数だけ増える', () => {
    /* 根が抜けたあと、末尾の 1 が根に来る。子は 2 つで、大きいほうの 3 と交換する */
    const v = [4, 3, 2, 1],
      pre: OpKey[] = ['add', 'add', 'add', 'add'],
      f = runTrace(def('bin'), { vals: v, pre, tokens: ['pop'] }).frames.at(-1) as Frame;
    expect(f.out).toEqual([0]);
    /* 根に移した 1 の子は 3 と 2。3 と交換したあと 1 の子はない */
    expect(f.cmp).toBe(2);
    expect(f.mov).toBe(2);
  });
  it('値の変更のあとも条件を満たす', () => {
    for (const d of heaps)
      for (let seed = 1; seed < 30; seed++) {
        const f = runTrace(d, { vals, pre: bulk, tokens: ['change'], seed }).frames.at(-1) as Frame;
        expect(f.bad, `${d.id} ${seed}`).toBe(0);
        expect(f.h).toHaveLength(N);
      }
  });
  it('要素が尽きたあとの追加は新しい値を足す', () => {
    const t = runTrace(def('bin'), { vals, tokens: [...bulk, 'add'] }),
      z = t.frames.at(-1) as Frame;
    expect(z.h).toHaveLength(N + 1);
    expect(z.bad).toBe(0);
    expect(t.vals).toHaveLength(N + 1);
  });
  it('空のときは操作しても壊れない', () => {
    for (const d of DEFS)
      for (const k of ['pop', 'peek', 'change'] as const) {
        const f = runTrace(d, { vals: [], tokens: [k] }).frames.at(-1) as Frame;
        expect(f.h).toHaveLength(0);
        expect(f.cmp + f.mov).toBe(0);
      }
  });
  it('同じ値が並んでも条件を満たし全部出る', () => {
    const same = Array(15).fill(50),
      store = storeTokens('build', 15),
      t = runTrace(def('bin'), { vals: same, pre: store, tokens: sortTokens(def('bin'), { vals: same }, store) });
    expect((t.frames.at(-1) as Frame).out).toHaveLength(15);
  });
});

describe('計算量の表', () => {
  it('どのデータ構造にもすべての操作がある', () => {
    for (const d of DEFS) for (const [k] of KEYS) expect(BIG_O[d.id][k], `${d.id} ${k}`).toBeTruthy();
  });

  /* 表の記号から、要素数を 8 倍にしたときの回数の比の範囲を決める。平均は表の上限より小さくなることがある */
  const RANGE: Record<string, [number, number]> = {
    'O(1)': [0.5, 2],
    'O(1)*': [0.5, 2],
    'O(log n)': [0.7, 3.5],
    'O(log n)*': [0.7, 3.5],
    'o(log n)*': [0.5, 3.5],
    'O(n)': [5, 11],
    'O(n)*': [5, 11],
  };
  for (const d of DEFS)
    for (const [k] of KEYS) {
      const key = `${d.id}/${k}`,
        o = BIG_O[d.id][k];
      it(`${key} は ${o} で増える`, () => {
        const ratio = countOp(d, k, 255) / countOp(d, k, 31),
          [a, b] = RANGE[o];
        expect(ratio).toBeGreaterThan(a);
        expect(ratio).toBeLessThan(b);
      });
    }
  it('二分ヒープの追加は最も悪い場合に段数ぶん交換する', () => {
    for (const n of [31, 255]) {
      /* 右上がりの列を入れると、新しい値はいつも根まで上がる */
      const v = barVals('ramp', n, 1).map((_, i) => i + 1),
        pre: OpKey[] = Array(n - 1).fill('add'),
        f = runTrace(def('bin'), { vals: v, pre, tokens: ['add'] }).frames.at(-1) as Frame;
      expect(f.cmp).toBe(levelsOf(n, 2) - 1);
      expect(f.mov).toBe(levelsOf(n, 2));
    }
  });
  it('まとめて構築の交換は要素数を超えない', () => {
    for (const n of [31, 127, 1023]) {
      const v = barVals('ramp', n, 1).map((_, i) => i + 1),
        f = runTrace(def('bin'), { vals: v, tokens: ['build'] }).frames.at(-1) as Frame;
      /* 配列へ入れる n 回と交換。交換は各要素の高さの和で、n 未満になる */
      expect(f.mov - n).toBeLessThan(n);
    }
  });
  it('右上がりのデータでは、まとめて構築のほうが 1 個ずつ追加より回数が少ない', () => {
    const v = barVals('ramp', 255, 1).map((_, i) => i + 1);
    expect(totalOf(def('bin'), { vals: v, tokens: ['build'] })).toBeLessThan(
      totalOf(def('bin'), { vals: v, tokens: storeTokens('add', 255) }),
    );
  });
  it('配列の取り出しは全要素を比べる', () => {
    expect(countOp(def('ar'), 'pop', 31)).toBe(31);
    expect(countOp(def('ar'), 'add', 31)).toBe(1);
  });
});

describe('ポインタでつなぐヒープ', () => {
  /** 行きがけ順の親の位置から、各要素の子の数を数える */
  const kidCounts = (f: Frame) => {
    const k = new Array<number>(f.h.length).fill(0);
    for (const p of f.par ?? []) if (p >= 0) k[p]++;
    return k;
  };
  it('形は親の位置で表し、親は子より前に来る', () => {
    for (const d of pointers) {
      const t = runTrace(d, { vals, tokens: bulk });
      for (const f of t.frames) {
        expect(f.par).toHaveLength(f.h.length);
        (f.par as number[]).forEach((p, i) => {
          expect(p).toBeLessThan(i);
        });
      }
    }
  });
  it('どの要素も木に 1 回だけ現れる', () => {
    for (const d of pointers) {
      const t = runTrace(d, { vals, pre: bulk, tokens: Array(10).fill('pop') });
      for (const f of t.frames) expect(new Set([...f.h, ...f.out]).size).toBe(f.h.length + f.out.length);
    }
  });
  it('左傾ヒープとスキューヒープは操作の区切りで木が 1 本になる', () => {
    for (const id of ['lt', 'sk', 'pr']) {
      const t = runTrace(def(id), { vals, tokens: bulk });
      for (const f of ends(t.frames).slice(1)) expect((f.par as number[]).filter((p) => p < 0)).toHaveLength(1);
    }
  });
  it('二分木の 2 種は子が 2 個以下で、子が 1 個のときは左の子である', () => {
    for (const id of ['lt', 'sk']) {
      const f = runTrace(def(id), { vals, tokens: bulk }).frames.at(-1) as Frame;
      expect(Math.max(...kidCounts(f))).toBeLessThanOrEqual(2);
    }
  });
  it('二項ヒープは要素数の 2 進数の 1 の数だけ木を持つ', () => {
    for (const n of [7, 15, 16, 21, 31, 32]) {
      const v = barVals('rand', n, 5),
        f = runTrace(def('bn'), { vals: v, tokens: storeTokens('add', n) }).frames.at(-1) as Frame,
        ones = n.toString(2).replaceAll('0', '').length;
      expect(
        (f.par as number[]).filter((p) => p < 0),
        `n=${n}`,
      ).toHaveLength(ones);
    }
  });
  it('二項ヒープの取り出しのあとも木の大きさが 1 種ずつになる', () => {
    const f = runTrace(def('bn'), { vals, pre: bulk, tokens: Array(9).fill('pop') }).frames.at(-1) as Frame,
      k = kidCounts(f),
      deg = (f.par as number[]).flatMap((p, i) => (p < 0 ? [k[i]] : []));
    expect(new Set(deg).size).toBe(deg.length);
    expect((f.par as number[]).filter((p) => p < 0)).toHaveLength((31 - 9).toString(2).replaceAll('0', '').length);
  });
  it('フィボナッチヒープの追加は比較 1 回と移動 1 回で済み、根の列に並ぶ', () => {
    const t = runTrace(def('fb'), { vals, tokens: bulk }),
      f = t.frames.at(-1) as Frame;
    expect(f.depth).toBe(1);
    expect(f.mov).toBe(N);
    expect(f.cmp).toBe(N - 1);
  });
  it('フィボナッチヒープの取り出しのあとは子の数が同じ根がない', () => {
    const f = runTrace(def('fb'), { vals, pre: bulk, tokens: ['pop'] }).frames.at(-1) as Frame,
      k = kidCounts(f),
      deg = (f.par as number[]).flatMap((p, i) => (p < 0 ? [k[i]] : []));
    expect(new Set(deg).size).toBe(deg.length);
  });
  it('左傾ヒープとスキューヒープのまとめて構築は 1 本の木になる', () => {
    for (const id of ['lt', 'sk']) {
      const f = runTrace(def(id), { vals, tokens: ['build'] }).frames.at(-1) as Frame;
      expect((f.par as number[]).filter((p) => p < 0)).toHaveLength(1);
      expect(f.h).toHaveLength(N);
      expect(f.bad).toBe(0);
    }
  });
  it('値の変更は根に近づく向きに変える', () => {
    for (const d of DEFS)
      for (const max of [true, false])
        for (let seed = 1; seed < 20; seed++) {
          const t = runTrace(d, { vals, pre: bulk, tokens: ['change'], seed, max }),
            after = new Set((t.frames.at(-1) as Frame).h),
            gone = t.frames[0].h.filter((id) => !after.has(id)),
            added = t.vals[t.vals.length - 1];
          expect(t.vals).toHaveLength(N + 1);
          expect(gone).toHaveLength(1);
          if (max) expect(added).toBeGreaterThanOrEqual(t.vals[gone[0]]);
          else expect(added).toBeLessThanOrEqual(t.vals[gone[0]]);
        }
  });
  it('値の変更を続けても全部正しい順に取り出せる', () => {
    for (const d of heaps)
      for (let seed = 1; seed < 12; seed++) {
        const tokens: OpKey[] = [...Array(12).fill('change'), ...Array(N).fill('pop')],
          t = runTrace(d, { vals, pre: bulk, tokens, seed }),
          last = t.frames.at(-1) as Frame,
          out = last.out.map((id) => t.vals[id]);
        expect(out, `${d.id} ${seed}`).toEqual([...out].sort((a, b) => b - a));
        expect(out).toHaveLength(N);
        expect(last.h).toHaveLength(0);
      }
  });
  it('追加と取り出しを混ぜても全部出て条件を満たす', () => {
    const tokens: OpKey[] = [];
    for (let i = 0; i < N; i++)
      tokens.push('add', ...(i % 3 === 2 ? (['pop'] as OpKey[]) : []), ...(i % 5 === 4 ? (['change'] as OpKey[]) : []));
    for (const d of heaps) {
      const t = runTrace(d, { vals, tokens, seed: 3 });
      for (const f of ends(t.frames)) expect(f.bad, d.id).toBe(0);
    }
  });
  it('フィボナッチヒープの根の札に使う最良の値はいつも根の列にある', () => {
    const t = runTrace(def('fb'), { vals, pre: bulk, tokens: Array(N).fill('pop') });
    for (const f of ends(t.frames).slice(0, -1)) {
      if (!f.h.length) continue;
      const roots = f.h.filter((_, i) => (f.par as number[])[i] < 0).map((id) => t.vals[id]),
        all = f.h.map((id) => t.vals[id]);
      expect(Math.max(...roots)).toBe(Math.max(...all));
    }
  });
});
