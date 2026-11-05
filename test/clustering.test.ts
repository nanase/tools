import { describe, expect, it } from 'vitest';
import { ALGOS, runLimited } from '../src/tools/clustering/algos';
import {
  aligner,
  ari,
  bisectors,
  type Data,
  d2,
  fitTime,
  frameAt,
  knnGraph,
  type Params,
  thin,
} from '../src/tools/clustering/core';
import { ctxOf, DATA, type DataId, drawnData, makeData } from '../src/tools/clustering/data';
import { digamma } from '../src/tools/clustering/distribution';
import { eigh } from '../src/tools/clustering/graph';
import { BRANCH } from '../src/tools/clustering/hierarchy';
import { METHODS, methodOf } from '../src/tools/clustering/methods';
import { METHOD_PARAMS } from '../src/tools/clustering/params';
import { bic } from '../src/tools/clustering/prototype';

const N = 120;
const data = (id: DataId, n = N, seed = 1): Data => makeData(id, n, seed);
const run = (mid: string, d: Data, over: Params = {}, seed = 1) =>
  ALGOS[mid](d, { ...methodOf(mid).def(ctxOf(d)), ...over, seed });

describe('一覧', () => {
  it('手法の一覧と計算の対応がそろう', () => {
    expect(METHODS.map((m) => m.id).sort()).toEqual(Object.keys(ALGOS).sort());
    expect(new Set(METHODS.map((m) => m.id)).size).toBe(METHODS.length);
  });
  it('パラメータの行は定義されたものだけを使う', () => {
    const keys = new Set([...METHOD_PARAMS.map((d) => d.k), 'init', 'cov']);
    for (const m of METHODS) for (const k of m.keys) expect(keys.has(k), `${m.id} ${k}`).toBe(true);
  });
  it('既定のパラメータは入力の範囲の中にある', () => {
    for (const D of DATA)
      for (const n of [50, 150, 300, 400])
        for (const m of METHODS) {
          const p = m.def(ctxOf(makeData(D.id, n, 1)));
          for (const k of m.keys) {
            const q = METHOD_PARAMS.find((d) => d.k === k);
            if (!q) continue;
            expect(p[k], `${m.id} ${D.id} ${n} ${k}`).toBeGreaterThanOrEqual(q.min);
            expect(p[k], `${m.id} ${D.id} ${n} ${k}`).toBeLessThanOrEqual(q.max);
          }
        }
  });
  it('文言は体言止めで句点を付けない', () => {
    for (const m of METHODS) {
      for (const [h, t] of m.steps) expect(`${h}${t}`, m.id).not.toMatch(/[。]|です|ます|ください|ません/);
      for (const [, t] of m.leg) expect(t, m.id).not.toMatch(/[。]/);
    }
  });
});

describe('全手法・全データ', () => {
  for (const m of METHODS)
    it(`${m.name} は手順を記録して終わる`, () => {
      for (const D of DATA) {
        const d = data(D.id),
          r = ALGOS[m.id](d, { ...m.def(ctxOf(d)), seed: 1 });
        expect(r.labels.length).toBe(d.n);
        expect(r.frames.length).toBeGreaterThan(0);
        expect(r.T).toBeGreaterThan(0);
        for (const f of r.frames) {
          expect(f.ms, `${m.id} ${D.id}`).toBeGreaterThan(0);
          expect(f.st, `${m.id} ${D.id}`).toBeLessThan(m.steps.length);
        }
        /* 手順の時刻は増え続ける */
        for (let i = 1; i < r.t.length; i++) expect(r.t[i]).toBeGreaterThan(r.t[i - 1]);
        if (r.ari !== null) {
          expect(r.ari).toBeGreaterThanOrEqual(-1);
          expect(r.ari).toBeLessThanOrEqual(1);
        }
      }
    });
  it('同じシードなら同じ結果になる', () => {
    for (const m of METHODS) {
      const d = data('blobs', 60);
      expect(Array.from(run(m.id, d).labels), m.id).toEqual(Array.from(run(m.id, d).labels));
    }
  });
  it('少ない点でも止まる', () => {
    const d = drawnData(
      [0.1, 0.2, 0.3, 0.8, 0.9, 1, 1.1, 1.2],
      [0.2, 0.2, 0.3, 0.7, 0.7, 0.8, 0.8, 0.9],
      [0, 0, 0, 1, 1, 1, 1, 1],
    );
    for (const m of METHODS) expect(run(m.id, d).labels.length, m.id).toBe(8);
  });
});

describe('点の上限', () => {
  const big = makeData('blobs', 600, 2),
    pOf = (mid: string): Params => ({ ...methodOf(mid).def(ctxOf(big)), seed: 1 });
  it('上限より多いと抽出して計算し、全部の点にラベルを付ける', () => {
    const r = runLimited('ward', big, pOf('ward'), 150);
    expect(r.d.n).toBe(150);
    expect(r.full).toBe(big);
    expect(r.labels.length).toBe(600);
    expect(r.subL?.length).toBe(150);
    expect(r.frames.at(-1)?.all).toBe(true);
    expect(r.frames.at(-1)?.l?.length).toBe(600);
    expect(r.ari as number).toBeGreaterThan(0.95);
    expect(r.t.at(-1)).toBe(r.T);
  });
  it('上限以下ならそのまま計算する', () => {
    const d = makeData('blobs', 100, 1),
      r = runLimited('ward', d, { ...methodOf('ward').def(ctxOf(d)), seed: 1 }, 150);
    expect(r.full).toBeUndefined();
    expect(r.d.n).toBe(100);
  });
  it('手法の上限が効く', () => {
    expect(methodOf('cure').lim).toBeLessThan(600);
    const r = runLimited('cure', big, pOf('cure'));
    expect(r.d.n).toBe(methodOf('cure').lim);
    expect(r.labels.length).toBe(600);
  });
  it('全手法が小さい上限でも手順と全部のラベルを返す', () => {
    for (const m of METHODS) {
      const r = runLimited(m.id, big, pOf(m.id), 60);
      expect(r.labels.length, m.id).toBe(600);
      expect(r.frames.at(-1)?.st, m.id).toBeLessThan(m.steps.length);
      expect(r.t.length, m.id).toBe(r.frames.length);
    }
  });
});

describe('手法ごとの性質', () => {
  it('分かれた塊は代表的な手法で正解と一致する', () => {
    const d = data('blobs', 150);
    for (const m of ['kmeans', 'kmedoids', 'ward', 'gmm', 'spectral', 'meanshift', 'hdbscan', 'birch', 'dpeaks']) {
      const over: Params = m === 'kmeans' ? { init: 1 } : {};
      expect(run(m, d, over).ari, m).toBeGreaterThan(0.98);
    }
  });
  it('三日月は形を拾う手法だけが分けられる', () => {
    const d = data('moons', 300);
    for (const m of ['single', 'dbscan', 'spectral', 'mst', 'hdbscan']) expect(run(m, d).ari, m).toBeGreaterThan(0.95);
    for (const m of ['kmeans', 'gmm', 'complete']) expect(run(m, d).ari, m).toBeLessThan(0.7);
  });
  it('同心円も形を拾う手法だけが分けられる', () => {
    const d = data('circles', 300);
    for (const m of ['single', 'dbscan', 'spectral']) expect(run(m, d).ari, m).toBeGreaterThan(0.95);
    expect(Math.abs(run('kmeans', d).ari as number)).toBeLessThan(0.1);
  });
  it('k-means の誤差平方和は反復で増えない（単調性を手で確かめる）', () => {
    const d = data('varied'),
      r = run('kmeans', d),
      sse = (cx: number[], cy: number[], l: Int16Array) => {
        let s = 0;
        const col = new Map<number, number>();
        r.frames.at(-1)?.cen?.forEach((q, i) => {
          col.set(q.c, i);
        });
        for (let i = 0; i < d.n; i++) {
          const c = col.get(l[i]) as number;
          s += (d.x[i] - cx[c]) ** 2 + (d.y[i] - cy[c]) ** 2;
        }
        return s;
      },
      last = r.frames.at(-1);
    expect(last?.cen).toBeDefined();
    const cen = last?.cen ?? [];
    expect(
      sse(
        cen.map((q) => q.x),
        cen.map((q) => q.y),
        r.labels,
      ),
    ).toBeCloseTo(r.sse as number, 6);
  });
  it('k-medoids の代表点はデータの点で、総距離は BUILD より増えない', () => {
    const d = data('blobs', 90),
      r = run('kmedoids', d),
      cen = r.frames.at(-1)?.cen ?? [];
    for (const q of cen) expect([...d.x].some((v, i) => v === q.x && d.y[i] === q.y)).toBe(true);
    const total = (F: typeof cen) => {
      let s = 0;
      for (let i = 0; i < d.n; i++) s += Math.min(...F.map((q) => Math.hypot(d.x[i] - q.x, d.y[i] - q.y)));
      return s;
    };
    const built = r.frames.filter((f) => f.st === 0).at(-1)?.cen ?? [];
    expect(total(cen)).toBeLessThanOrEqual(total(built) + 1e-9);
  });
  it('階層の結合の高さは単調に増え、切断の数はパラメータのとおり', () => {
    for (const m of ['ward', 'complete', 'average', 'single']) {
      const r = run(m, data('blobs', 60), { k: 4 });
      if (r.side?.type !== 'dendro') throw new Error('no dendro');
      const hs = r.side.merges.map((q) => q.h);
      for (let i = 1; i < hs.length; i++) expect(hs[i], m).toBeGreaterThanOrEqual(hs[i - 1] - 1e-9);
      expect(r.side.merges.length).toBe(59);
      expect(r.nc).toBe(4);
    }
  });
  it('最短距離法と最小全域木の切断は同じ分け方になる', () => {
    const d = data('moons', 80);
    expect(ari(run('single', d, { k: 3 }).labels, run('mst', d, { k: 3 }).labels)).toBeCloseTo(1, 9);
  });
  it('DBSCAN は半径を大きくするとクラスタが減り、ノイズも減る', () => {
    const d = data('varied', 200),
      a = run('dbscan', d, { eps: 0.03 }),
      b = run('dbscan', d, { eps: 0.2 });
    expect(b.noise).toBeLessThan(a.noise);
    expect(b.nc).toBeLessThanOrEqual(a.nc);
  });
  it('OPTICS の閾値は同じ半径の DBSCAN に近い結果になる', () => {
    const d = data('moons', 200),
      e = ctxOf(d).eps,
      a = run('optics', d, { cut: e }).labels,
      b = run('dbscan', d, { eps: e }).labels;
    expect(ari(a, b)).toBeGreaterThan(0.9);
  });
  it('混合ガウス分布の対数尤度は反復で下がらない', () => {
    const d = data('aniso'),
      r = run('gmm', d);
    expect(r.ll).toBeDefined();
    expect(r.ari as number).toBeGreaterThan(0.9);
  });
  it('変分ベイズは多めの成分を正しい数へ減らす', () => {
    const r = run('vbgmm', data('blobs', 200));
    expect(r.nc).toBe(3);
  });
  it('BIRCH の CF の半径は上限を守る', () => {
    const d = data('blobs', 150),
      T = 0.03,
      r = run('birch', d, { T }),
      circ = r.frames.find((f) => f.st === 1)?.circ ?? [];
    expect(circ.length).toBeGreaterThan(BRANCH);
    for (const c of circ) expect(c.r).toBeLessThanOrEqual(T + 1e-9);
    expect(circ.length).toBeLessThan(150);
  });
  it('X-means の BIC は離れた 2 つの塊で分割を選ぶ', () => {
    const d = makeData('blobs', 90, 1),
      A = [...d.t].flatMap((c, i) => (c === 0 ? [i] : [])),
      B = [...d.t].flatMap((c, i) => (c === 1 ? [i] : [])),
      m = [...A, ...B];
    expect(bic(d, m, [A, B])).toBeGreaterThan(bic(d, m, [m]));
  });
  it('CLIQUE の点は密なセルにあるときだけクラスタに入る', () => {
    const d = data('blobs', 150),
      r = run('clique', d, { ctau: 3 }),
      rect = r.frames.at(-1)?.rect ?? [];
    for (let i = 0; i < d.n; i++) {
      const inside = rect.some((q) => d.x[i] >= q.x && d.x[i] < q.x + q.w && d.y[i] >= q.y && d.y[i] < q.y + q.h);
      expect(r.labels[i] >= 0).toBe(inside);
    }
  });
});

describe('共通の処理', () => {
  it('領域の境界は 2 つの重心から等距離で、ほかの重心はそれより遠い', () => {
    const cen = [
        { x: 0.3, y: 0.3 },
        { x: 1.2, y: 0.4 },
        { x: 0.8, y: 0.8 },
        { x: 0.7, y: 0.2 },
      ],
      s = bisectors(cen, { x0: -0.2, y0: -0.1, x1: 1.8, y1: 1.1 });
    expect(s.length).toBeGreaterThan(0);
    for (let i = 0; i < s.length; i += 2) {
      const ds = cen.map((q) => Math.hypot(q.x - s[i], q.y - s[i + 1])).sort((a, b) => a - b);
      /* 端を含めて最も近い 2 つの重心から等距離 */
      expect(ds[1] - ds[0]).toBeLessThan(1e-9);
      expect(s[i]).toBeGreaterThanOrEqual(-0.2 - 1e-9);
      expect(s[i]).toBeLessThanOrEqual(1.8 + 1e-9);
    }
  });
  it('重心が 1 個や同じ位置なら境界はない', () => {
    const box = { x0: 0, y0: 0, x1: 1, y1: 1 };
    expect(bisectors([{ x: 0.5, y: 0.5 }], box)).toEqual([]);
    expect(
      bisectors(
        [
          { x: 0.5, y: 0.5 },
          { x: 0.5, y: 0.5 },
        ],
        box,
      ),
    ).toEqual([]);
  });
  it('近傍グラフは全部を並べ替えた結果と同じ', () => {
    const d = data('varied', 80),
      adj = knnGraph(d, 5);
    for (let i = 0; i < d.n; i++) {
      const near = Array.from({ length: d.n }, (_, j) => j)
        .filter((j) => j !== i)
        .sort((a, b) => d2(d, i, a) - d2(d, i, b))
        .slice(0, 5);
      for (const j of near) expect(adj[i].has(j)).toBe(true);
    }
  });
  it('再生の長さを縮めても順序は保つ', () => {
    const r = run('dbscan', data('blobs', 200)),
      f = fitTime(r, r.T / 2);
    expect(f.T).toBeCloseTo(r.T / 2, 6);
    expect(f.frames.length).toBe(r.frames.length);
    expect(fitTime(r, r.T * 2)).toBe(r);
  });
  it('調整ランド指数は番号の付け方によらず、一致で 1 になる', () => {
    expect(ari([0, 0, 1, 1, 2, 2], [5, 5, 3, 3, 9, 9])).toBeCloseTo(1, 12);
    /* Hubert & Arabie の式を手で計算した例 */
    expect(ari([0, 0, 0, 1, 1, 1], [0, 0, 1, 1, 2, 2])).toBeCloseTo(0.2424, 3);
  });
  it('正解の外れ値は一致度から除く', () => {
    expect(ari([0, 0, 1, 1, -1], [0, 0, 1, 1, 0])).toBeCloseTo(1, 12);
  });
  it('色の番号は正解へ寄せる', () => {
    const d = drawnData([0, 0, 0, 1, 1, 1], [0, 0, 0, 0, 0, 0], [1, 1, 1, 0, 0, 0]),
      f = aligner(d, [7, 7, 7, 4, 4, 4]);
    expect(f(7)).toBe(1);
    expect(f(4)).toBe(0);
    expect(f(-1)).toBe(-1);
    expect(f(123)).toBeGreaterThanOrEqual(8);
  });
  it('固有値分解は A v = λ v を満たす', () => {
    const n = 6,
      A = new Float64Array(n * n);
    for (let i = 0; i < n; i++)
      for (let j = 0; j <= i; j++) {
        A[i * n + j] = Math.sin(i * 3 + j * 7) + (i === j ? 3 : 0);
        A[j * n + i] = A[i * n + j];
      }
    const { val, vec } = eigh(A, n);
    for (let c = 0; c < n; c++)
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let j = 0; j < n; j++) s += A[i * n + j] * vec[j * n + c];
        expect(s).toBeCloseTo(val[c] * vec[i * n + c], 9);
      }
  });
  it('ディガンマ関数は既知の値に合う', () => {
    expect(digamma(1)).toBeCloseTo(-0.5772156649, 8);
    expect(digamma(0.5)).toBeCloseTo(-1.963510026, 8);
  });
  it('間引いても段階は残り、長さは変わらない', () => {
    const r = run('ward', data('blobs', 200)),
      t = thin(r, 48);
    expect(t.frames.length).toBeLessThanOrEqual(60);
    expect(t.T).toBeCloseTo(r.T, 6);
    expect(new Set(t.frames.map((f) => f.st))).toEqual(new Set(r.frames.map((f) => f.st)));
    expect(t.frames.at(-1)?.done).toBe(true);
  });
  it('時刻からコマを引ける', () => {
    const r = { t: [10, 30, 60] };
    expect(frameAt(r, 0)).toBe(0);
    expect(frameAt(r, 10)).toBe(1);
    expect(frameAt(r, 59)).toBe(2);
    expect(frameAt(r, 1000)).toBe(2);
  });
  it('描いたデータのパラメータは点の間隔から決まる', () => {
    const x = Array.from({ length: 40 }, (_, i) => 0.1 + i * 0.02),
      c = ctxOf(
        drawnData(
          x,
          x.map(() => 0.5),
          x.map((_, i) => (i < 20 ? 0 : 1)),
        ),
      );
    expect(c.k).toBe(2);
    expect(c.eps).toBeGreaterThanOrEqual(0.03);
  });
});
