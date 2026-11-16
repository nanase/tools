/**
 * カルノー図のページの計算: 真理値表から最小の積和形・和積形を求める。
 * クワイン・マクラスキー法で主項を挙げ、ペトリック法で残りの行を覆う最小の組を選ぶ。
 * 入力は 6 個まで。主項が多いときは、ペトリック法の途中で安い組だけを残す（ビーム）
 */

/** 真理値表の値。2 は Don't Care（X） */
export type Val = 0 | 1 | 2;
export const DC = 2;
/** 積和形（1 をまとめる）と和積形（0 をまとめる） */
export type Form = 'sop' | 'pos';
/** まとまり（項）。v: 値、m: 消えた変数の位置（1 = 消えた）。A が最上位のビット */
export interface Term {
  v: number;
  m: number;
}
/** 文字。i: 変数の番号、neg: 否定 */
export interface Lit {
  i: number;
  neg: boolean;
}
export const VN = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
export const MAX_N = 6;

export const pc = (x: number): number => {
  let c = 0;
  for (let y = x; y; y >>= 1) c += y & 1;
  return c;
};
export const bitOf = (k: number, i: number, n: number): 0 | 1 => ((k >> (n - 1 - i)) & 1) as 0 | 1;
export const covers = (t: Term, k: number): boolean => ((k ^ t.v) & ~t.m) === 0;
export const cellsOf = (t: Term, n: number): number[] => {
  const r: number[] = [];
  for (let k = 0; k < 1 << n; k++) if (covers(t, k)) r.push(k);
  return r;
};
/** 項の文字（積和形の積の項として） */
export function litsOf(t: Term, n: number): Lit[] {
  const r: Lit[] = [];
  for (let i = 0; i < n; i++) {
    const b = 1 << (n - 1 - i);
    if (!(t.m & b)) r.push({ i, neg: !(t.v & b) });
  }
  return r;
}
export const flip = (ls: readonly Lit[]): Lit[] => ls.map((l) => ({ i: l.i, neg: !l.neg }));
/** 積和形の項（積）と和積形の項（和）。和積形は 0 のまとまりの文字を反転する */
export const termLits = (ts: readonly Term[], n: number, form: Form): Lit[][] =>
  ts.map((t) => (form === 'sop' ? litsOf(t, n) : flip(litsOf(t, n))));
const nLits = (t: Term, n: number): number => n - pc(t.m);

/** ペトリック法で残す組の数 */
const BEAM = 400;

export interface Cover {
  /** 主項（? だけを覆うものは除く） */
  P: Term[];
  /** 必須主項の番号 */
  ess: number[];
  /** 最小の組（主項の番号）。項の数が少なく、次に文字の数が少ないもの */
  sols: number[][];
}
/** クワイン・マクラスキー法とペトリック法。on は覆う行、dc は Don't Care の行 */
export function cover(n: number, on: readonly number[], dc: readonly number[]): Cover {
  type T = Term & { used?: boolean };
  let cur: T[] = [...on, ...dc].sort((a, b) => a - b).map((k) => ({ v: k, m: 0 }));
  const primes: T[] = [];
  while (cur.length) {
    const next: T[] = [],
      seen = new Set<string>();
    /* 消えた位置が同じで、値が 1 か所だけ違う 2 つをまとめる */
    const byM = new Map<number, T[]>();
    for (const t of cur) {
      const g = byM.get(t.m);
      if (g) g.push(t);
      else byM.set(t.m, [t]);
    }
    for (const g of byM.values())
      for (let i = 0; i < g.length; i++)
        for (let j = i + 1; j < g.length; j++) {
          const a = g[i],
            b = g[j],
            d = a.v ^ b.v;
          if (d & (d - 1)) continue;
          a.used = b.used = true;
          const v = a.v & ~d,
            m = a.m | d,
            key = `${v},${m}`;
          if (!seen.has(key)) {
            seen.add(key);
            next.push({ v, m });
          }
        }
    for (const t of cur) if (!t.used) primes.push({ v: t.v, m: t.m });
    cur = next;
  }
  const P = primes.filter((p) => on.some((k) => covers(p, k)));
  P.sort((a, b) => pc(b.m) - pc(a.m) || a.v - b.v || a.m - b.m);
  const by = on.map((k) => P.map((p, i) => (covers(p, k) ? i : -1)).filter((i) => i >= 0));
  const ess = [...new Set(by.filter((c) => c.length === 1).map((c) => c[0]))].sort((a, b) => a - b);
  const rem = by.filter((c) => !c.some((i) => ess.includes(i)));
  const lit = (s: readonly number[]): number => s.reduce((a, i) => a + nLits(P[i], n), 0);
  const cost = (s: readonly number[]): number => s.length * 1000 + lit(s);
  let prods: number[][] = [[]];
  for (const C of rem) {
    const np = new Map<string, number[]>();
    for (const p of prods) {
      if (p.some((i) => C.includes(i))) {
        np.set(p.join(','), p);
        continue;
      }
      for (const c of C) {
        const q = [...p, c].sort((a, b) => a - b);
        np.set(q.join(','), q);
      }
    }
    const list = [...np.values()].sort((a, b) => cost(a) - cost(b)).slice(0, BEAM * 4);
    /* ほかの組を含む組は要らない */
    const keep: number[][] = [];
    for (const p of list) if (!keep.some((q) => q.length < p.length && q.every((i) => p.includes(i)))) keep.push(p);
    prods = keep.slice(0, BEAM);
  }
  const all = prods.map((p) => [...ess, ...p].sort((a, b) => a - b));
  const best = Math.min(...all.map(cost));
  const sols = all.filter((s) => cost(s) === best).slice(0, 8);
  return { P, ess, sols };
}

export interface Minimal {
  /** 覆う行（積和形は 1、和積形は 0） */
  on: number[];
  dc: number[];
  /** 最小の解（項の並び）。定数のときは 1 つの解に変数のない項が 1 つ */
  sols: Term[][];
  P: Term[];
}
/** 真理値表 f から最小の解 */
export function minimize(f: readonly Val[], n: number, form: Form): Minimal {
  const N = 1 << n,
    tv = form === 'sop' ? 1 : 0,
    on: number[] = [],
    dc: number[] = [];
  for (let k = 0; k < N; k++) {
    if (f[k] === DC) dc.push(k);
    else if (f[k] === tv) on.push(k);
  }
  if (!on.length) return { on, dc, sols: [[]], P: [] };
  if (on.length + dc.length === N) {
    const t = { v: 0, m: N - 1 };
    return { on, dc, sols: [[t]], P: [t] };
  }
  const c = cover(n, on, dc);
  return { on, dc, sols: c.sols.map((s) => s.map((i) => c.P[i])), P: c.P };
}
/** 標準形（主加法標準形・主乗法標準形）の項: 覆う行ごとに 1 つ */
export function canonical(f: readonly Val[], n: number, form: Form): Term[] {
  const r: Term[] = [];
  for (let k = 0; k < 1 << n; k++) if (f[k] === (form === 'sop' ? 1 : 0)) r.push({ v: k, m: 0 });
  return r;
}

/**
 * 静的ハザードを消す項。隣り合う 2 行（1 変数だけ違う）がどちらも覆う値なのに、両方を覆う項がなければ、
 * 両方を覆う主項を足す（コンセンサス項）。fT は覆う値を 1 にした表
 */
export function hazardTerms(n: number, fT: readonly Val[], terms: readonly Term[], P: readonly Term[]): Term[] {
  const add: Term[] = [];
  const both = (a: number, b: number, ts: readonly Term[]) => ts.some((t) => covers(t, a) && covers(t, b));
  for (let k = 0; k < 1 << n; k++) {
    if (fT[k] !== 1) continue;
    for (let i = 0; i < n; i++) {
      const k2 = k ^ (1 << i);
      if (k2 < k || fT[k2] !== 1 || both(k, k2, terms) || both(k, k2, add)) continue;
      const p = P.filter((q) => covers(q, k) && covers(q, k2)).sort((a, b) => pc(b.m) - pc(a.m))[0];
      if (p) add.push(p);
    }
  }
  return add;
}

/** 文字の並びの値（積和形は積、和積形は和）と、式全体の値 */
export function evalLits(ts: readonly (readonly Lit[])[], form: Form, k: number, n: number): 0 | 1 {
  const lv = (l: Lit) => (bitOf(k, l.i, n) ^ (l.neg ? 1 : 0)) as 0 | 1;
  if (form === 'sop') return ts.some((t) => t.every((l) => lv(l))) ? 1 : 0;
  return ts.every((t) => t.some((l) => lv(l))) ? 1 : 0;
}
