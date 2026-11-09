import { describe, expect, it } from 'vitest';
import {
  average,
  DEFS,
  type Def,
  defOf,
  type Frame,
  fnv,
  freshKey,
  type HashKey,
  inspect,
  type KeySet,
  keyOk,
  makeKeys,
  makeOps,
  probeSeq,
  runTrace,
  type Trace,
} from '../src/tools/dictionary/model';

const def = (id: string): Def => {
  const d = defOf(id);
  if (!d) throw new Error(id);
  return d;
};
const SETS: readonly KeySet[] = ['word', 'seq'];
const HASHES: readonly HashKey[] = ['fnv', 'sum'];
const run = (id: string, set: KeySet, hash: HashKey, grow: boolean, n: number, seed: number) => {
  const keys = makeKeys(set, n, seed),
    ops = makeOps(keys, set, seed);
  return { keys, ops, t: runTrace(def(id), ops, { n, hash, grow }) };
};
/** 工程の終わりのコマ */
const endOf = (t: Trace, s: number): Frame => t.frames[s < 2 ? t.starts[s + 1] - 1 : t.frames.length - 1];
const keysOf = (t: Trace, f: Frame): string[] => [...inspect(f, t.def, t.opt.hash).cost.keys()].sort();

describe('ハッシュ関数', () => {
  it('FNV-1a は公開されている試験値と一致する', () => {
    expect(fnv('')).toBe(0x811c9dc5);
    expect(fnv('a')).toBe(0xe40c292c);
    expect(fnv('foobar')).toBe(0xbf9cf968);
  });
  it('探す順番は 2 のべき乗の表の全部の場所を回る', () => {
    for (const seq of ['lin', 'quad', 'dbl', 'py'] as const)
      for (const m of [8, 16, 64])
        for (const k of ['cat', 'dog', 'k07']) {
          const nx = probeSeq(seq, fnv(k), k, m),
            seen = new Set<number>();
          for (let i = 0; i < 4 * m; i++) seen.add(nx(i));
          expect(seen.size, `${seq} ${m} ${k}`).toBe(m);
        }
  });
});

describe('操作の結果', () => {
  for (const d of DEFS)
    it(`${d.name}: 追加・検索・削除の結果が正しい`, () => {
      for (const set of SETS)
        for (const hash of HASHES)
          for (const grow of [true, false])
            for (const n of [12, 24, 48])
              for (let seed = 1; seed <= 3; seed++) {
                const { keys, ops, t } = run(d.id, set, hash, grow, n, seed),
                  tag = `${set} ${hash} ${grow} ${n} ${seed}`;
                /* 追加: 全部のキーが入る */
                expect(keysOf(t, endOf(t, 0)), tag).toEqual([...keys].sort());
                /* 検索: あるキーは発見、ないキーは該当なしが 1 回だけ */
                const fs = t.frames.slice(t.starts[1], t.starts[2]);
                ops[1].forEach((o, i) => {
                  const fr = fs.filter((f) => f.tok === i),
                    got = fr.some((f) => f.got.length > 0),
                    miss = fr.some((f) => f.miss);
                  expect(got, `${tag} ${o.k}`).toBe(keys.includes(o.k));
                  expect(miss, `${tag} ${o.k}`).toBe(!keys.includes(o.k));
                });
                /* 削除: 消したキーだけがなくなる */
                const gone = new Set(ops[2].map((o) => o.k)),
                  left = keys.filter((k) => !gone.has(k));
                expect(keysOf(t, endOf(t, 2)), tag).toEqual([...left].sort());
                /* 入れた順を保つ辞書と配列は入れた順のまま */
                if (d.kind === 'compact' || d.kind === 'list')
                  expect(endOf(t, 2).E.filter((x) => x !== null)).toEqual(left);
              }
    });
});

describe('拡張', () => {
  it('拡張ありでは負荷率が上限を超えない', () => {
    for (const d of DEFS) {
      if (d.kind === 'list') continue;
      for (const n of [12, 24, 48]) {
        const { t } = run(d.id, 'word', 'fnv', true, n, 1);
        for (const f of t.frames.slice(t.starts[0], t.starts[1])) {
          const s = inspect(f, t.def, 'fnv');
          expect(s.n / f.M, `${d.id} ${n}`).toBeLessThanOrEqual(d.load + 1e-9);
        }
      }
    }
  });
  it('拡張なしでは表の大きさが変わらない（カッコウは追い出しが続いたときだけ広げる）', () => {
    for (const d of DEFS) {
      if (d.kind === 'cuckoo' || d.kind === 'list') continue;
      const { t } = run(d.id, 'word', 'fnv', false, 24, 2);
      expect(new Set(t.frames.map((f) => f.M)).size, d.id).toBe(1);
      expect(t.frames[0].M, d.id).toBe(32);
    }
  });
});

describe('回数', () => {
  it('調べた回数と移動は工程の中で減らない', () => {
    for (const d of DEFS) {
      const { t } = run(d.id, 'word', 'fnv', true, 24, 3);
      for (let s = 0; s < 3; s++) {
        const fr = t.frames.slice(t.starts[s], s < 2 ? t.starts[s + 1] : t.frames.length);
        for (let i = 1; i < fr.length; i++) {
          expect(fr[i].cnt.p).toBeGreaterThanOrEqual(fr[i - 1].cnt.p);
          expect(fr[i].cnt.mv).toBeGreaterThanOrEqual(fr[i - 1].cnt.mv);
        }
        expect(fr[fr.length - 1].cnt).toEqual(t.totals[s]);
      }
    }
  });
  it('カッコウ・ハッシュ法の検索は 2 か所までしか見ない', () => {
    const { ops, t } = run('cuckoo', 'word', 'fnv', true, 48, 4);
    expect(t.totals[1].p).toBeLessThanOrEqual(2 * ops[1].length);
  });
  it('文字コードの和で連番を入れると線形探査法の調べる回数が増える', () => {
    const good = run('lin', 'seq', 'fnv', true, 24, 1).t,
      bad = run('lin', 'seq', 'sum', true, 24, 1).t;
    const max = (t: Trace) => inspect(endOf(t, 0), t.def, t.opt.hash).max;
    expect(max(bad)).toBeGreaterThan(2 * max(good));
  });
  it('配列を順に探す（参考）の検索は表より多く調べる', () => {
    const a = average(def('list'), 'fnv', true),
      b = average(def('chain'), 'fnv', true);
    expect(a.find.p).toBeGreaterThan(3 * b.find.p);
  });
});

describe('手で入れるキー', () => {
  it('英小文字と数字の 8 文字までを受け付ける', () => {
    expect(keyOk('cat')).toBe(true);
    expect(keyOk('k01')).toBe(true);
    expect(keyOk('')).toBe(false);
    expect(keyOk('Cat')).toBe(false);
    expect(keyOk('toolongkey')).toBe(false);
    expect(keyOk('<b>')).toBe(false);
  });
  it('新しいキーは表にないキーを選ぶ', () => {
    const have = makeKeys('word', 24, 1);
    for (let s = 1; s < 20; s++) expect(have).not.toContain(freshKey('word', have, s));
    expect(freshKey('seq', ['k01', 'k02'], 1)).toBe('k03');
  });
  it('手で入れた値は検索の文に出る', () => {
    const t = runTrace(def('lin'), [[{ t: 'add', k: 'apple', v: 'りんご' }], [{ t: 'find', k: 'apple' }], []], {
      n: 12,
      hash: 'fnv',
      grow: true,
    });
    expect(t.frames.some((f) => f.say.includes('apple → りんご'))).toBe(true);
  });
});
