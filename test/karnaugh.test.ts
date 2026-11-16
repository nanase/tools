import { describe, expect, it } from 'vitest';
import { buildCircuit, type Kind } from '../src/tools/karnaugh/circuit';
import { kmapSvg } from '../src/tools/karnaugh/kmap';
import {
  canonical,
  covers,
  DC,
  evalLits,
  type Form,
  hazardTerms,
  minimize,
  pc,
  termLits,
  type Val,
} from '../src/tools/karnaugh/logic';
import { SAMPLES } from '../src/tools/karnaugh/samples';

/** 解が真理値表と合うか（Don't Care の行は問わない） */
function agrees(f: readonly Val[], n: number, form: Form, lits: ReturnType<typeof termLits>): boolean {
  for (let k = 0; k < 1 << n; k++) if (f[k] !== DC && evalLits(lits, form, k, n) !== f[k]) return false;
  return true;
}
/** 乱数（試験を毎回同じにする） */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}
/** 小さな表で、すべての項の組から最小の項の数を探す */
function brute(f: readonly Val[], n: number): number {
  const all: { v: number; m: number }[] = [];
  for (let m = 0; m < 1 << n; m++) for (let v = 0; v < 1 << n; v++) if (!(v & m)) all.push({ v, m });
  const ok = all.filter((t) => {
    for (let k = 0; k < 1 << n; k++) if (covers(t, k) && f[k] === 0) return false;
    return true;
  });
  const need = [...Array(1 << n).keys()].filter((k) => f[k] === 1);
  if (!need.length) return 0;
  for (let size = 1; size <= need.length; size++) {
    const pick = (start: number, left: number, cov: Set<number>): boolean => {
      if (!left) return need.every((k) => cov.has(k));
      for (let i = start; i < ok.length; i++) {
        const c2 = new Set(cov);
        for (const k of need) if (covers(ok[i], k)) c2.add(k);
        if (pick(i + 1, left - 1, c2)) return true;
      }
      return false;
    };
    if (pick(0, size, new Set())) return size;
  }
  return need.length;
}

describe('簡単化', () => {
  it('サンプルのすべての出力で、どの解も真理値表と合う', () => {
    for (const s of SAMPLES)
      for (const o of s.outs)
        for (const form of ['sop', 'pos'] as const) {
          const m = minimize(o.f, s.n, form);
          expect(m.sols.length, `${s.id} ${o.name}`).toBeGreaterThan(0);
          for (const sol of m.sols)
            expect(agrees(o.f, s.n, form, termLits(sol, s.n, form)), `${s.id} ${o.name} ${form}`).toBe(true);
        }
  });
  it('3 入力の表では項の数が総当たりの最小と同じ', () => {
    const r = rng(7);
    for (let i = 0; i < 120; i++) {
      const f = Array.from({ length: 8 }, () => [0, 1, 1, DC][Math.floor(r() * 4)] as Val);
      expect(minimize(f, 3, 'sop').sols[0].length, f.join('')).toBe(brute(f, 3));
    }
  });
  it('乱数の 4〜6 入力の表でも解が合う', () => {
    const r = rng(11);
    for (const n of [4, 5, 6])
      for (let i = 0; i < 12; i++) {
        const f = Array.from({ length: 1 << n }, () => [0, 0, 1, 1, DC][Math.floor(r() * 5)] as Val);
        for (const form of ['sop', 'pos'] as const) {
          const m = minimize(f, n, form);
          expect(agrees(f, n, form, termLits(m.sols[0], n, form))).toBe(true);
        }
      }
  });
  it('解が 2 通りの形では 2 つの解を挙げる', () => {
    const s = SAMPLES.find((x) => x.id === 'two');
    expect(s && minimize(s.outs[0].f, 3, 'sop').sols.length).toBe(2);
  });
  it("Don't Care で項が小さくなる（5 以上は A + B·D + B·C）", () => {
    const s = SAMPLES.find((x) => x.id === 'ge5');
    const sol = s ? minimize(s.outs[0].f, 4, 'sop').sols[0] : [];
    expect(sol.map((t) => 4 - pc(t.m)).sort()).toEqual([1, 2, 2]);
  });
  it('定数の表は 0 固定・1 固定', () => {
    const z = Array<Val>(8).fill(0),
      o = Array<Val>(8).fill(1);
    expect(minimize(z, 3, 'sop').sols[0]).toEqual([]);
    expect(termLits(minimize(o, 3, 'sop').sols[0], 3, 'sop')).toEqual([[]]);
  });
  it('標準形は覆う行ごとに項が 1 つ', () => {
    const f = SAMPLES[0].outs[0].f;
    expect(canonical(f, 3, 'sop').length).toBe(4);
    expect(canonical(f, 3, 'pos').length).toBe(4);
  });
  it('ハザード対策の項はとなりの 1 を同じ項で覆う', () => {
    /* Y = A̅·B + A·C: B = C = 1 で A を変えるとハザード。B·C を足す */
    const f = SAMPLES.find((x) => x.id === 'mux')?.outs[0].f ?? [];
    const m = minimize(f, 3, 'sop');
    const add = hazardTerms(3, f, m.sols[0], m.P);
    expect(add).toEqual([{ v: 3, m: 4 }]);
  });
});

describe('回路図', () => {
  it('どの形の回路も式と同じ値を出す', () => {
    for (const s of SAMPLES)
      for (const o of s.outs)
        for (const [form, kinds] of [
          ['sop', ['and-or', 'nand']],
          ['pos', ['or-and', 'nor']],
        ] as [Form, Kind[]][]) {
          const lits = termLits(minimize(o.f, s.n, form).sols[0], s.n, form);
          for (const kind of kinds) {
            const c = buildCircuit(s.n, lits, kind, 'mil');
            for (let k = 0; k < 1 << s.n; k++)
              if (o.f[k] !== DC) expect(c.ev(k)[c.outS], `${s.id} ${o.name} ${kind} ${k}`).toBe(o.f[k]);
            expect(c.svg).toContain('<svg');
          }
        }
  });
  it('ゲートの数と段数（多数決の積和形は AND 3 個と OR 1 個の 2 段）', () => {
    const f = SAMPLES[0].outs[0].f;
    const c = buildCircuit(3, termLits(minimize(f, 3, 'sop').sols[0], 3, 'sop'), 'and-or', 'jis');
    expect([c.gates, c.ins, c.levels]).toEqual([4, 9, 2]);
  });
});

describe('カルノー図', () => {
  it('入力の数ごとにすべての行のマスを 1 つずつ描く', () => {
    for (const n of [2, 3, 4, 5, 6]) {
      const svg = kmapSvg(n, Array<Val>(1 << n).fill(0), []);
      const ks = [...svg.matchAll(/data-k="(\d+)"/g)].map((x) => Number(x[1])).sort((a, b) => a - b);
      expect(ks).toEqual([...Array(1 << n).keys()]);
    }
  });
  it('となりのマスは 1 変数だけ違う（端どうしも）', () => {
    for (const n of [2, 3, 4]) {
      const svg = kmapSvg(n, Array<Val>(1 << n).fill(0), [], { S: 52 });
      const cells = [...svg.matchAll(/data-k="(\d+)"><rect x="([\d.]+)" y="([\d.]+)"/g)].map((x) => ({
        k: +x[1],
        x: +x[2],
        y: +x[3],
      }));
      const xs = [...new Set(cells.map((c) => c.x))].sort((a, b) => a - b),
        ys = [...new Set(cells.map((c) => c.y))].sort((a, b) => a - b);
      for (const c of cells) {
        const ci = xs.indexOf(c.x),
          ri = ys.indexOf(c.y);
        const right = cells.find((d) => d.y === c.y && d.x === xs[(ci + 1) % xs.length]);
        const down = cells.find((d) => d.x === c.x && d.y === ys[(ri + 1) % ys.length]);
        if (right && right !== c) expect(pc(right.k ^ c.k)).toBe(1);
        if (down && down !== c) expect(pc(down.k ^ c.k)).toBe(1);
      }
    }
  });
});
