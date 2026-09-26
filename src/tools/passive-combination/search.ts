/**
 * 目標に近い合成値の探索（DOM に依存しない。worker.ts から使う）。
 *
 * 値を S（和）と P（逆数の和の逆数）の 2 演算で組む。抵抗とインダクタでは S が直列、コンデンサでは S が並列。
 * n 本の組は k 本と n−k 本の組の S か P なので、k 本（1・2 本）の側を列挙し、n−k 本の側は必要な値を逆算して
 * 「その値以下で最大・以上で最小」を再帰で求める。1・2 本の組は値を並べた表を二分探索する。
 */
export type Op = 'S' | 'P';
/** 組: 数値は 1 本、[演算, 左, 右] は 2 つの組をつないだもの */
export type Tree = number | readonly [Op, Tree, Tree];
/** 見つけた組と合成値 */
export interface Found {
  v: number;
  t: Tree;
}
/** 終えた理由: reach は誤差の条件に届いた、all は全探索した */
export type Reason = 'reach' | 'all';

export interface SearchInput {
  /** 目標 */
  t: number;
  /** 使う値 */
  v: readonly number[];
  /** 探索を終える誤差（相対値）。null は全探索 */
  stop: number | null;
  /** 残す候補の数 */
  K: number;
}

/** 扱う本数の上限 */
export const MAX_N = 5;
/** 誤差の条件に届いた後、候補を埋めるために続ける時間（ms） */
const AFTER_REACH = 300;
/** 途中経過を知らせる間隔（ms） */
const PROGRESS_MS = 150;

/** 探索中の組の記録: 2 本の組は値だけ持ち（['2', 値]）、最後に表から復元する */
type W = number | readonly ['2', number] | readonly [Op, W, W];
interface Bracket {
  lo: number;
  hi: number;
  lw: W | null;
  hw: W | null;
}
interface Item {
  v: number;
  e: number;
  w: W;
}

const P = (a: number, b: number) => (a * b) / (a + b);

/** 二分探索: x 以上の最初の位置 */
function lb(A: Float64Array, x: number): number {
  let l = 0,
    h = A.length;
  while (l < h) {
    const c = (l + h) >>> 1;
    if (A[c] < x) l = c + 1;
    else h = c;
  }
  return l;
}

/**
 * 探索の準備（値の表を作る）。run(n) で n 本の候補を誤差の小さい順に返す。
 * now は時刻の取得（テストで差し替える）
 */
export function createSearch(inp: SearchInput, now: () => number = () => performance.now()) {
  const T = inp.t,
    STOP = inp.stop,
    K = inp.K;
  const V = Float64Array.from(inp.v).sort(),
    m = V.length;
  if (!m) throw new Error('使える値がない');
  /* 1 本目は目標に近い順に試す（誤差の条件に早く届く） */
  const VO = Float64Array.from(V).sort((a, b) => Math.abs(Math.log(a / T)) - Math.abs(Math.log(b / T)));
  let S2: Float64Array | null = null;
  const MIN: number[] = [],
    MAX: number[] = [],
    MINW: W[] = [],
    MAXW: W[] = [],
    C: number[] = [];
  MIN[1] = V[0];
  MAX[1] = V[m - 1];
  MINW[1] = V[0];
  MAXW[1] = V[m - 1];
  for (let j = 2; j <= MAX_N; j++) {
    MIN[j] = P(V[0], MIN[j - 1]);
    MAX[j] = V[m - 1] + MAX[j - 1];
    MINW[j] = ['P', V[0], MINW[j - 1]];
    MAXW[j] = ['S', V[m - 1], MAXW[j - 1]];
  }
  /* 進み具合の分母: j 本の側 1 回の探索の重み */
  C[1] = C[2] = 1;
  for (let j = 3; j <= MAX_N; j++) {
    C[j] = 0;
    for (let k = 1; k <= j >> 1; k++) C[j] += (k === 1 ? m : m * (m + 1)) * 2 * C[j - k];
  }
  const RS: Bracket[] = Array.from({ length: MAX_N + 1 }, () => ({ lo: NaN, hi: NaN, lw: null, hw: null }));
  const mk = (j: number, v: number, w: W | null): W => (j === 1 ? v : j === 2 ? ['2', v] : (w ?? v));

  /** j 本の組で、x 以下で最大（lo）と x 以上で最小（hi） */
  function sub(j: number, x: number): Bracket {
    const r = RS[j];
    if (j <= 2) {
      const A = j === 1 ? V : (S2 as Float64Array),
        i = lb(A, x);
      r.hi = i < A.length ? A[i] : NaN;
      r.lo = i < A.length && A[i] === x ? x : i > 0 ? A[i - 1] : NaN;
      return r;
    }
    if (!(x > MIN[j])) {
      r.lo = NaN;
      r.hi = MIN[j];
      r.hw = MINW[j];
      return r;
    }
    if (x >= MAX[j]) {
      r.lo = MAX[j];
      r.hi = NaN;
      r.lw = MAXW[j];
      return r;
    }
    return near(j, x, r);
  }

  function near(n: number, t: number, r: Bracket): Bracket {
    let lo = -Infinity,
      hi = Infinity,
      lw: W | null = null,
      hw: W | null = null;
    for (let k = 1; k <= n >> 1; k++) {
      const j = n - k,
        L = k === 1 ? V : (S2 as Float64Array),
        len = L.length,
        mx = MAX[j];
      for (let i = 0; i < len; i++) {
        const a = L[i];
        let s = sub(j, t - a),
          b = s.lo,
          c = s.hi,
          v = a + b;
        if (v > lo) {
          lo = v;
          lw = ['S', mk(k, a, null), mk(j, b, s.lw)];
        }
        v = a + c;
        if (v < hi) {
          hi = v;
          hw = ['S', mk(k, a, null), mk(j, c, s.hw)];
        }
        if (a > t) {
          s = sub(j, (a * t) / (a - t));
          b = s.lo;
          c = s.hi;
          v = P(a, b);
          if (v > lo) {
            lo = v;
            lw = ['P', mk(k, a, null), mk(j, b, s.lw)];
          }
          v = P(a, c);
          if (v < hi) {
            hi = v;
            hw = ['P', mk(k, a, null), mk(j, c, s.hw)];
          }
        } else {
          v = P(a, mx);
          if (v > lo) {
            lo = v;
            lw = ['P', mk(k, a, null), mk(j, mx, MAXW[j])];
          }
        }
      }
    }
    r.lo = lo > -Infinity ? lo : NaN;
    r.hi = hi < Infinity ? hi : NaN;
    r.lw = lw;
    r.hw = hw;
    return r;
  }

  /** 2 本の組の値から、元の 2 本とつなぎ方を探す */
  function find2(v: number): Tree {
    for (let i = 0; i < m; i++) {
      const a = V[i];
      let q = lb(V, (v - a) * (1 - 1e-9));
      for (let z = q; z < q + 2 && z < m; z++) if (a + V[z] === v) return ['S', a, V[z]];
      if (a > v) {
        q = lb(V, ((a * v) / (a - v)) * (1 - 1e-9));
        for (let z = q; z < q + 2 && z < m; z++) if (P(a, V[z]) === v) return ['P', a, V[z]];
      }
    }
    return v;
  }
  const dec = (w: W): Tree => (typeof w === 'number' ? w : w[0] === '2' ? find2(w[1]) : [w[0], dec(w[1]), dec(w[2])]);
  const out = (list: Item[]): Found[] => list.map((x) => ({ v: x.v, t: dec(x.w) }));

  /**
   * n 本の組を探す。onProgress には進み具合（0〜1）と、候補が変わっていれば候補を渡す
   */
  function run(n: number, onProgress?: (p: number, list: Found[] | null) => void): [Reason, Found[]] {
    if (n < 2 || n > MAX_N) throw new Error(`本数は 2〜${MAX_N}: ${n}`);
    if (n >= 3 && !S2) {
      const s = new Float64Array(m * (m + 1));
      let q = 0;
      for (let i = 0; i < m; i++)
        for (let j = i; j < m; j++) {
          s[q++] = V[i] + V[j];
          s[q++] = P(V[i], V[j]);
        }
      S2 = s.sort();
    }
    const list: Item[] = [];
    let reached = 0,
      dirty = false;
    const cons = (v: number, o: Op, k: number, a: number, j: number, b: number, bw: W | null) => {
      if (!(v > 0)) return;
      const e = Math.abs(v - T) / T;
      if (list.length >= K && e >= list[K - 1].e) return;
      for (const x of list) if (Math.abs(x.v - v) <= v * 1e-12) return;
      let i = list.length;
      while (i > 0 && list[i - 1].e > e) i--;
      list.splice(i, 0, { v, e, w: [o, mk(k, a, null), mk(j, b, bw)] });
      if (list.length > K) list.pop();
      dirty = true;
      if (!reached && STOP !== null && e <= Math.max(STOP, 1e-12)) reached = now() || 1;
    };
    let tot = 0,
      done = 0,
      last = now();
    for (let k = 1; k <= n >> 1; k++) tot += (k === 1 ? m : m * (m + 1)) * 2 * C[n - k];
    for (let k = 1; k <= n >> 1; k++) {
      const j = n - k,
        L = k === 1 ? VO : (S2 as Float64Array),
        len = L.length,
        w = 2 * C[j],
        mx = MAX[j];
      for (let i = 0; i < len; i++) {
        const a = L[i];
        let s = sub(j, T - a);
        cons(a + s.lo, 'S', k, a, j, s.lo, s.lw);
        cons(a + s.hi, 'S', k, a, j, s.hi, s.hw);
        if (a > T) {
          s = sub(j, (a * T) / (a - T));
          cons(P(a, s.lo), 'P', k, a, j, s.lo, s.lw);
          cons(P(a, s.hi), 'P', k, a, j, s.hi, s.hw);
        } else cons(P(a, mx), 'P', k, a, j, mx, MAXW[j]);
        if (reached && now() - reached > AFTER_REACH) return ['reach', out(list)];
        done += w;
        if (onProgress && (w > 5000 || (i & 255) === 0)) {
          const t = now();
          if (t - last > PROGRESS_MS) {
            last = t;
            onProgress(done / tot, dirty ? out(list) : null);
            dirty = false;
          }
        }
      }
    }
    return [reached ? 'reach' : 'all', out(list)];
  }

  return { run };
}
