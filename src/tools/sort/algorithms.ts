/** ソートのアルゴリズムと、その名前・計算量。手順は Rec を通して記録する */
import type { Rec } from './recorder';

type Fn = (r: Rec) => void;

/* ---------- 交換 ---------- */
const bubble: Fn = (r) => {
  const n = r.n;
  for (let e = n - 1; e > 0; e--) {
    let s = false;
    for (let i = 0; i < e; i++)
      if (r.cmp(i, i + 1) > 0) {
        r.swap(i, i + 1);
        s = true;
      }
    r.fix(e, n - 1);
    if (!s) break;
  }
};
const shaker: Fn = (r) => {
  let lo = 0,
    hi = r.n - 1;
  while (lo < hi) {
    let last = lo;
    for (let i = lo; i < hi; i++)
      if (r.cmp(i, i + 1) > 0) {
        r.swap(i, i + 1);
        last = i;
      }
    r.fix(last + 1, hi);
    hi = last;
    last = hi;
    for (let i = hi; i > lo; i--)
      if (r.cmp(i - 1, i) > 0) {
        r.swap(i - 1, i);
        last = i;
      }
    r.fix(lo, last - 1);
    lo = last;
  }
};
const comb: Fn = (r) => {
  const n = r.n;
  let g = n,
    s = false;
  while (g > 1 || s) {
    g = Math.max(1, Math.floor(g / 1.3));
    r.info(g);
    s = false;
    for (let i = 0; i + g < n; i++)
      if (r.cmp(i, i + g) > 0) {
        r.swap(i, i + g);
        s = true;
      }
  }
};
const gnome: Fn = (r) => {
  let i = 1;
  while (i < r.n) {
    if (r.cmp(i - 1, i) <= 0) i++;
    else {
      r.swap(i - 1, i);
      if (i > 1) i--;
    }
  }
};
const oddeven: Fn = (r) => {
  let s = true;
  while (s) {
    s = false;
    for (let p = 0; p < 2; p++)
      for (let i = p; i + 1 < r.n; i += 2)
        if (r.cmp(i, i + 1) > 0) {
          r.swap(i, i + 1);
          s = true;
        }
  }
};

/* ---------- 選択 ---------- */
const selection: Fn = (r) => {
  const n = r.n;
  for (let i = 0; i < n - 1; i++) {
    let m = i;
    r.pivot(m);
    for (let j = i + 1; j < n; j++)
      if (r.cmp(j, m) < 0) {
        m = j;
        r.pivot(m);
      }
    if (m !== i) r.swap(i, m);
    r.fix(i, i);
  }
  r.pivot(-1);
};
const dselection: Fn = (r) => {
  let lo = 0,
    hi = r.n - 1;
  while (lo < hi) {
    let mn = lo,
      mx = lo;
    r.pivot(mn);
    r.pivot2(mx);
    for (let j = lo + 1; j <= hi; j++) {
      if (r.cmp(j, mn) < 0) {
        mn = j;
        r.pivot(mn);
      }
      if (r.cmp(j, mx) > 0) {
        mx = j;
        r.pivot2(mx);
      }
    }
    if (mn !== lo) r.swap(lo, mn);
    if (mx === lo) mx = mn;
    if (mx !== hi) r.swap(hi, mx);
    r.fix(lo, lo);
    r.fix(hi, hi);
    lo++;
    hi--;
  }
  r.pivot(-1);
  r.pivot2(-1);
};
function sift(r: Rec, lo: number, s: number, e: number): void {
  let i = s;
  for (;;) {
    let c = 2 * i + 1;
    if (c >= e) return;
    if (c + 1 < e && r.cmp(lo + c, lo + c + 1) < 0) c++;
    if (r.cmp(lo + i, lo + c) >= 0) return;
    r.swap(lo + i, lo + c);
    i = c;
  }
}
function heapRange(r: Rec, lo: number, hi: number, mark: boolean): void {
  const m = hi - lo + 1;
  for (let s = (m >> 1) - 1; s >= 0; s--) sift(r, lo, s, m);
  for (let e = m - 1; e > 0; e--) {
    r.swap(lo, lo + e);
    if (mark) {
      r.fix(lo + e, lo + e);
      r.range(lo, lo + e - 1);
    }
    sift(r, lo, 0, e);
  }
}
const heap: Fn = (r) => {
  r.range(0, r.n - 1);
  heapRange(r, 0, r.n - 1, true);
  r.range(-1, -1);
};
/** Leonardo 数の大きさの木を並べたヒープ。根は右端にある */
const smooth: Fn = (r) => {
  const n = r.n,
    L = [1, 1];
  while (L[L.length - 1] < n) L.push(L[L.length - 1] + L[L.length - 2] + 1);
  /** 並んでいる木の次数（左から） */
  const ord: number[] = [];
  const sink = (root: number, order: number): void => {
    let i = root,
      o = order;
    while (o >= 2) {
      const right = i - 1,
        left = i - 1 - L[o - 2],
        toLeft = r.cmp(left, right) >= 0,
        c = toLeft ? left : right;
      if (r.cmp(i, c) >= 0) return;
      r.swap(i, c);
      i = c;
      o = toLeft ? o - 1 : o - 2;
    }
  };
  /** k 番目の木の根を、左の木の根と比べて正しい木まで運び、沈める */
  const settle = (k0: number, root: number): void => {
    let k = k0,
      cur = root;
    while (k > 0) {
      const prev = cur - L[ord[k]];
      if (r.cmp(prev, cur) <= 0) break;
      const o = ord[k];
      if (o >= 2) {
        const right = cur - 1,
          left = cur - 1 - L[o - 2];
        if (r.cmp(prev, left) <= 0 || r.cmp(prev, right) <= 0) break;
      }
      r.swap(prev, cur);
      cur = prev;
      k--;
    }
    sink(cur, ord[k]);
  };
  for (let i = 0; i < n; i++) {
    const m = ord.length;
    if (m >= 2 && ord[m - 2] === ord[m - 1] + 1) {
      ord.pop();
      ord[ord.length - 1]++;
    } else if (m >= 1 && ord[m - 1] === 1) ord.push(0);
    else ord.push(1);
    settle(ord.length - 1, i);
  }
  for (let e = n - 1; e > 0; e--) {
    const o = ord.pop() as number;
    r.fix(e, e);
    if (o >= 2) {
      const right = e - 1,
        left = e - 1 - L[o - 2];
      ord.push(o - 1);
      settle(ord.length - 1, left);
      ord.push(o - 2);
      settle(ord.length - 1, right);
    }
  }
};
const cycle: Fn = (r) => {
  const n = r.n;
  for (let cs = 0; cs < n - 1; cs++) {
    let item = r.get(cs),
      pos = cs;
    r.pval(item);
    for (let i = cs + 1; i < n; i++) if (r.cmpv(i, item) < 0) pos++;
    if (pos === cs) {
      r.fix(cs, cs);
      continue;
    }
    while (r.cmpv(pos, item) === 0) pos++;
    let t = r.get(pos);
    r.set(pos, item);
    item = t;
    r.pval(item);
    while (pos !== cs) {
      pos = cs;
      for (let i = cs + 1; i < n; i++) if (r.cmpv(i, item) < 0) pos++;
      while (r.cmpv(pos, item) === 0) pos++;
      t = r.get(pos);
      r.set(pos, item);
      item = t;
      r.pval(item);
    }
    r.fix(cs, cs);
  }
  r.pval(-1);
};
const pancake: Fn = (r) => {
  const flip = (k: number): void => {
    for (let i = 0, j = k; i < j; i++, j--) r.swap(i, j);
  };
  for (let e = r.n - 1; e > 0; e--) {
    let m = 0;
    r.pivot(0);
    for (let i = 1; i <= e; i++)
      if (r.cmp(i, m) > 0) {
        m = i;
        r.pivot(m);
      }
    if (m !== e) {
      if (m > 0) flip(m);
      flip(e);
    }
    r.fix(e, e);
  }
  r.pivot(-1);
};

/* ---------- 挿入 ---------- */
/** lo〜hi を挿入ソートする */
function insertRange(r: Rec, lo: number, hi: number): void {
  for (let i = lo + 1; i <= hi; i++) {
    const k = r.get(i);
    let j = i - 1;
    while (j >= lo && r.cmpv(j, k) > 0) {
      r.set(j + 1, r.get(j));
      j--;
    }
    r.set(j + 1, k);
  }
}
const insertion: Fn = (r) => {
  for (let i = 1; i < r.n; i++) {
    const k = r.get(i);
    r.pval(k);
    let j = i - 1;
    while (j >= 0 && r.cmpv(j, k) > 0) {
      r.set(j + 1, r.get(j));
      j--;
    }
    r.set(j + 1, k);
  }
  r.pval(-1);
};
/** lo〜j−1 が整列済みのとき、a[j] を二分探索で入れる */
function binaryInsert(r: Rec, lo0: number, j: number): void {
  const k = r.get(j);
  let lo = lo0,
    hi = j;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (r.cmpv(m, k) > 0) hi = m;
    else lo = m + 1;
  }
  for (let q = j; q > lo; q--) r.set(q, r.get(q - 1));
  r.set(lo, k);
}
const binsert: Fn = (r) => {
  for (let i = 1; i < r.n; i++) {
    r.pval(r.a[i]);
    binaryInsert(r, 0, i);
  }
  r.pval(-1);
};
/** Ciura の増分。要素数は 1024 までなので 701 で足りる */
const CIURA = [701, 301, 132, 57, 23, 10, 4, 1];
const shell: Fn = (r) => {
  const n = r.n;
  for (const g of CIURA) {
    if (g >= n) continue;
    r.info(g);
    for (let i = g; i < n; i++) {
      const k = r.get(i);
      let j = i;
      while (j >= g && r.cmpv(j - g, k) > 0) {
        r.set(j, r.get(j - g));
        j -= g;
      }
      r.set(j, k);
    }
  }
};

/* ---------- マージ ---------- */
/** 左の並びを補助配列へ写し、前から併合する */
function mergeRange(r: Rec, lo: number, mid: number, hi: number): void {
  r.range(lo, hi);
  for (let k = lo; k <= mid; k++) r.aset(k, r.get(k));
  let i = lo,
    j = mid + 1,
    k = lo;
  while (i <= mid && j <= hi) {
    if (r.cmpv(j, r.x[i]) < 0) r.set(k++, r.get(j++));
    else r.set(k++, r.aget(i++));
  }
  while (i <= mid) r.set(k++, r.aget(i++));
  r.aclr(lo, mid);
}
const merge: Fn = (r) => {
  r.auxNew(r.n);
  const go = (lo: number, hi: number): void => {
    if (lo >= hi) return;
    const m = (lo + hi) >> 1;
    go(lo, m);
    go(m + 1, hi);
    mergeRange(r, lo, m, hi);
  };
  go(0, r.n - 1);
  r.range(-1, -1);
};
const bmerge: Fn = (r) => {
  const n = r.n;
  r.auxNew(n);
  for (let w = 1; w < n; w *= 2)
    for (let lo = 0; lo + w < n; lo += 2 * w) mergeRange(r, lo, lo + w - 1, Math.min(lo + 2 * w - 1, n - 1));
  r.range(-1, -1);
};
/** 最初の小さなランの長さ（ティムソートの minrun） */
function minRun(n: number): number {
  let m = n,
    c = 0;
  while (m >= 32) {
    c |= m & 1;
    m >>= 1;
  }
  return m + c;
}
/** i から始まるランを見つけ（降順なら反転し）、minrun まで挿入で伸ばす。次のランの頭を返す */
function nextRun(r: Rec, i: number, minrun: number): number {
  const n = r.n;
  let j = i + 1;
  if (j < n) {
    const up = r.cmp(j - 1, j) <= 0;
    j++;
    if (up) {
      while (j < n && r.cmp(j - 1, j) <= 0) j++;
    } else {
      while (j < n && r.cmp(j - 1, j) > 0) j++;
      for (let a = i, b = j - 1; a < b; a++, b--) r.swap(a, b);
    }
  }
  const e = Math.min(i + minrun, n);
  r.range(i, Math.max(e, j) - 1);
  for (; j < e; j++) binaryInsert(r, i, j);
  return j;
}
const tim: Fn = (r) => {
  const n = r.n,
    minrun = minRun(n),
    st: [number, number][] = [];
  r.auxNew(n);
  const mergeAt = (k: number): void => {
    const a = st[k],
      b = st[k + 1];
    mergeRange(r, a[0], a[0] + a[1] - 1, b[0] + b[1] - 1);
    a[1] += b[1];
    st.splice(k + 1, 1);
  };
  let i = 0;
  while (i < n) {
    const j = nextRun(r, i, minrun);
    st.push([i, j - i]);
    i = j;
    while (st.length > 1) {
      const t = st.length;
      if (t > 2 && st[t - 3][1] <= st[t - 2][1] + st[t - 1][1]) {
        if (st[t - 3][1] < st[t - 1][1]) mergeAt(t - 3);
        else mergeAt(t - 2);
      } else if (st[t - 2][1] <= st[t - 1][1]) mergeAt(t - 2);
      else break;
    }
  }
  while (st.length > 1) mergeAt(st.length - 2);
  r.range(-1, -1);
};
/** ラン 2 つの境目の深さ（Munro と Wild の node power） */
function nodePower(s1: number, n1: number, n2: number, n: number): number {
  const a = (s1 + n1 / 2) / n,
    b = (s1 + n1 + n2 / 2) / n;
  let l = 0,
    p = 1;
  while (Math.floor(a * p) === Math.floor(b * p)) {
    l++;
    p *= 2;
  }
  return l;
}
const power: Fn = (r) => {
  const n = r.n,
    minrun = minRun(n),
    /** [頭, 長さ, 右の境目の深さ] */
    st: [number, number, number][] = [];
  r.auxNew(n);
  let s = 0,
    e = nextRun(r, 0, minrun);
  while (e < n) {
    const e2 = nextRun(r, e, minrun),
      p = nodePower(s, e - s, e2 - e, n);
    while (st.length && st[st.length - 1][2] > p) {
      const [ts, tl] = st.pop() as [number, number, number];
      mergeRange(r, ts, ts + tl - 1, e - 1);
      s = ts;
    }
    st.push([s, e - s, p]);
    s = e;
    e = e2;
  }
  while (st.length) {
    const [ts, tl] = st.pop() as [number, number, number];
    mergeRange(r, ts, ts + tl - 1, n - 1);
  }
  r.range(-1, -1);
};
/** a〜m−1 と m〜b−1 を、補助配列なしで併合する（SymMerge） */
function symMerge(r: Rec, a: number, m: number, b: number): void {
  if (m - a === 1) {
    let i = m,
      j = b;
    while (i < j) {
      const h = (i + j) >> 1;
      if (r.cmp(h, a) < 0) i = h + 1;
      else j = h;
    }
    for (let k = a; k < i - 1; k++) r.swap(k, k + 1);
    return;
  }
  if (b - m === 1) {
    let i = a,
      j = m;
    while (i < j) {
      const h = (i + j) >> 1;
      if (r.cmp(m, h) >= 0) i = h + 1;
      else j = h;
    }
    for (let k = m; k > i; k--) r.swap(k, k - 1);
    return;
  }
  const mid = (a + b) >> 1,
    n = mid + m;
  let start: number, hi: number;
  if (m > mid) {
    start = n - b;
    hi = mid;
  } else {
    start = a;
    hi = m;
  }
  const p = n - 1;
  while (start < hi) {
    const c = (start + hi) >> 1;
    if (r.cmp(p - c, c) >= 0) start = c + 1;
    else hi = c;
  }
  const end = n - start;
  if (start < m && m < end) rotate(r, start, m, end);
  if (a < start && start < mid) symMerge(r, a, start, mid);
  if (mid < end && end < b) symMerge(r, mid, end, b);
}
/** a〜m−1 と m〜b−1 を入れ替える（3 回の反転） */
function rotate(r: Rec, a: number, m: number, b: number): void {
  const rev = (lo0: number, hi0: number): void => {
    for (let lo = lo0, hi = hi0; lo < hi; lo++, hi--) r.swap(lo, hi);
  };
  rev(a, m - 1);
  rev(m, b - 1);
  rev(a, b - 1);
}
const inplaceMerge: Fn = (r) => {
  const n = r.n;
  for (let w = 1; w < n; w *= 2)
    for (let lo = 0; lo + w < n; lo += 2 * w) {
      const hi = Math.min(lo + 2 * w, n);
      r.range(lo, hi - 1);
      symMerge(r, lo, lo + w, hi);
    }
  r.range(-1, -1);
};

/* ---------- 分割 ---------- */
/** 末尾の要素をピボットにして分割する（Lomuto）。ピボットの位置を返す */
function lomuto(r: Rec, lo: number, hi: number): number {
  r.pivot(hi);
  let i = lo;
  for (let j = lo; j < hi; j++)
    if (r.cmp(j, hi) < 0) {
      if (i !== j) r.swap(i, j);
      i++;
    }
  if (i !== hi) r.swap(i, hi);
  r.pivot(-1);
  r.fix(i, i);
  return i;
}
const quickLast: Fn = (r) => {
  const go = (lo: number, hi: number): void => {
    if (lo > hi) return;
    if (lo === hi) {
      r.fix(lo, lo);
      return;
    }
    r.range(lo, hi);
    const p = lomuto(r, lo, hi);
    go(lo, p - 1);
    go(p + 1, hi);
  };
  go(0, r.n - 1);
  r.range(-1, -1);
};
const quickMid: Fn = (r) => {
  const go = (lo: number, hi: number): void => {
    if (lo >= hi) {
      if (lo === hi) r.fix(lo, lo);
      return;
    }
    r.range(lo, hi);
    const p = r.get((lo + hi) >> 1);
    r.pval(p);
    let i = lo,
      j = hi;
    while (i <= j) {
      while (r.cmpv(i, p) < 0) i++;
      while (r.cmpv(j, p) > 0) j--;
      if (i <= j) {
        if (i !== j) r.swap(i, j);
        i++;
        j--;
      }
    }
    go(lo, j);
    go(i, hi);
  };
  go(0, r.n - 1);
  r.pval(-1);
  r.range(-1, -1);
};
/** 先頭・中央・末尾の中央値を末尾へ運ぶ */
function med3(r: Rec, lo: number, hi: number): void {
  const m = (lo + hi) >> 1;
  if (r.cmp(m, lo) < 0) r.swap(m, lo);
  if (r.cmp(hi, lo) < 0) r.swap(hi, lo);
  if (r.cmp(hi, m) < 0) r.swap(hi, m);
  r.swap(m, hi);
}
const quickMed: Fn = (r) => {
  const go = (lo: number, hi: number): void => {
    if (lo > hi) return;
    if (lo === hi) {
      r.fix(lo, lo);
      return;
    }
    r.range(lo, hi);
    if (hi - lo >= 2) med3(r, lo, hi);
    const p = lomuto(r, lo, hi);
    go(lo, p - 1);
    go(p + 1, hi);
  };
  go(0, r.n - 1);
  r.range(-1, -1);
};
const quick3: Fn = (r) => {
  const go = (lo: number, hi: number): void => {
    if (lo >= hi) {
      if (lo === hi) r.fix(lo, lo);
      return;
    }
    r.range(lo, hi);
    const p = r.get((lo + hi) >> 1);
    r.pval(p);
    let lt = lo,
      gt = hi,
      i = lo;
    while (i <= gt) {
      const c = r.cmpv(i, p);
      if (c < 0) {
        if (lt !== i) r.swap(lt, i);
        lt++;
        i++;
      } else if (c > 0) {
        if (i !== gt) r.swap(i, gt);
        gt--;
      } else i++;
    }
    r.fix(lt, gt);
    go(lo, lt - 1);
    go(gt + 1, hi);
  };
  go(0, r.n - 1);
  r.pval(-1);
  r.range(-1, -1);
};
const dual: Fn = (r) => {
  const go = (lo: number, hi: number): void => {
    if (lo >= hi) {
      if (lo === hi) r.fix(lo, lo);
      return;
    }
    r.range(lo, hi);
    if (r.cmp(lo, hi) > 0) r.swap(lo, hi);
    r.pivot(lo);
    r.pivot2(hi);
    let l = lo + 1,
      g = hi - 1,
      k = l;
    while (k <= g) {
      if (r.cmp(k, lo) < 0) {
        if (k !== l) r.swap(k, l);
        l++;
      } else if (r.cmp(k, hi) >= 0) {
        while (k < g && r.cmp(g, hi) > 0) g--;
        if (k !== g) r.swap(k, g);
        g--;
        if (r.cmp(k, lo) < 0) {
          if (k !== l) r.swap(k, l);
          l++;
        }
      }
      k++;
    }
    l--;
    g++;
    if (l !== lo) r.swap(lo, l);
    if (g !== hi) r.swap(hi, g);
    r.pivot(-1);
    r.pivot2(-1);
    r.fix(l, l);
    r.fix(g, g);
    go(lo, l - 1);
    go(l + 1, g - 1);
    go(g + 1, hi);
  };
  go(0, r.n - 1);
  r.range(-1, -1);
};
const intro: Fn = (r) => {
  const go = (lo0: number, hi0: number, d0: number): void => {
    let hi = hi0,
      d = d0;
    while (hi - lo0 >= 16) {
      if (d === 0) {
        r.range(lo0, hi);
        heapRange(r, lo0, hi, false);
        return;
      }
      d--;
      r.range(lo0, hi);
      med3(r, lo0, hi);
      const p = lomuto(r, lo0, hi);
      go(p + 1, hi, d);
      hi = p - 1;
    }
  };
  go(0, r.n - 1, 2 * Math.floor(Math.log2(r.n)));
  r.range(-1, -1);
  insertRange(r, 0, r.n - 1);
};
/** 簡略版の pdqsort: 分岐の少ない分割は使わず、順序の検出・等しい要素の分離・ヒープへの切り替えを残す */
const pdq: Fn = (r) => {
  /** 先頭をピボットにして分割し、ピボットの位置と、交換せずに済んだかを返す */
  const partRight = (lo: number, hi: number): [number, boolean] => {
    const p = r.get(lo);
    r.pval(p);
    let i = lo + 1,
      j = hi;
    while (i <= hi && r.cmpv(i, p) < 0) i++;
    while (j >= i && r.cmpv(j, p) >= 0) j--;
    const already = i > j;
    while (i < j) {
      r.swap(i, j);
      i++;
      j--;
      while (r.cmpv(i, p) < 0) i++;
      while (r.cmpv(j, p) >= 0) j--;
    }
    if (j !== lo) r.swap(lo, j);
    return [j, already];
  };
  /** ピボットと等しい要素を左へ集め、その右端を返す */
  const partLeft = (lo: number, hi: number): number => {
    const p = r.get(lo);
    r.pval(p);
    let i = lo + 1,
      j = hi;
    while (j >= i && r.cmpv(j, p) > 0) j--;
    while (i <= j && r.cmpv(i, p) <= 0) i++;
    while (i < j) {
      r.swap(i, j);
      j--;
      i++;
      while (r.cmpv(j, p) > 0) j--;
      while (i <= j && r.cmpv(i, p) <= 0) i++;
    }
    if (j !== lo) r.swap(lo, j);
    return j;
  };
  /** 挿入を 8 回の移動まで試す。終わったら true */
  const partialInsert = (lo: number, hi: number): boolean => {
    let moved = 0;
    for (let i = lo + 1; i <= hi; i++) {
      if (r.cmp(i, i - 1) >= 0) continue;
      const k = r.get(i);
      let j = i - 1;
      while (j >= lo && r.cmpv(j, k) > 0) {
        r.set(j + 1, r.get(j));
        j--;
        moved++;
      }
      r.set(j + 1, k);
      if (moved > 8) return false;
    }
    return true;
  };
  const go = (lo0: number, hi: number, bad0: number, left0: boolean): void => {
    let lo = lo0,
      bad = bad0,
      leftmost = left0;
    for (;;) {
      const size = hi - lo + 1;
      if (size < 24) {
        r.range(lo, hi);
        insertRange(r, lo, hi);
        return;
      }
      r.range(lo, hi);
      /* 3 値の中央値を先頭へ */
      const m = lo + (size >> 1);
      if (r.cmp(m, lo) < 0) r.swap(m, lo);
      if (r.cmp(hi, lo) < 0) r.swap(hi, lo);
      if (r.cmp(hi, m) < 0) r.swap(hi, m);
      r.swap(lo, m);
      if (!leftmost && r.cmp(lo - 1, lo) >= 0) {
        lo = partLeft(lo, hi) + 1;
        continue;
      }
      const [p, already] = partRight(lo, hi),
        ls = p - lo,
        rs = hi - p;
      r.fix(p, p);
      if (ls < size >> 3 || rs < size >> 3) {
        if (--bad === 0) {
          heapRange(r, lo, hi, false);
          return;
        }
        /* 偏った分割のあとは、要素を入れ替えて形を崩す */
        if (ls >= 24) {
          r.swap(lo, lo + (ls >> 2));
          r.swap(p - 1, p - (ls >> 2));
        }
        if (rs >= 24) {
          r.swap(p + 1, p + 1 + (rs >> 2));
          r.swap(hi, hi - (rs >> 2));
        }
      } else if (already && partialInsert(lo, p - 1) && partialInsert(p + 1, hi)) return;
      go(lo, p - 1, bad, leftmost);
      lo = p + 1;
      leftmost = false;
    }
  };
  go(0, r.n - 1, Math.floor(Math.log2(r.n)), true);
  r.pval(-1);
  r.range(-1, -1);
};

/* ---------- 非比較 ---------- */
/** key の順に補助配列へ写して戻す（計数の 1 パス）。各キーの頭の位置（lo からの相対）を返す */
function countPass(r: Rec, lo: number, hi: number, key: (v: number) => number, m: number): Int32Array {
  const cnt = new Int32Array(m + 1);
  for (let i = lo; i <= hi; i++) cnt[key(r.get(i)) + 1]++;
  for (let i = 0; i < m; i++) cnt[i + 1] += cnt[i];
  const st = cnt.slice();
  for (let i = lo; i <= hi; i++) {
    const v = r.get(i);
    r.aset(lo + cnt[key(v)]++, v);
  }
  for (let i = lo; i <= hi; i++) r.set(i, r.aget(i));
  r.aclr(lo, hi);
  return st;
}
const counting: Fn = (r) => {
  r.auxNew(r.n);
  countPass(r, 0, r.n - 1, (v) => r.key(v), r.km + 1);
};
const radixLsd: Fn = (r) => {
  r.auxNew(r.n);
  for (let s = 0, d = 1; r.km >> s > 0; s += 2, d++) {
    r.info(d);
    countPass(r, 0, r.n - 1, (v) => (r.key(v) >> s) & 3, 4);
  }
};
const radixMsd: Fn = (r) => {
  r.auxNew(r.n);
  let top = 0;
  while (r.km >> (top + 2) > 0) top += 2;
  const go = (lo: number, hi: number, s: number): void => {
    if (lo >= hi || s < 0) return;
    r.range(lo, hi);
    r.info((top - s) / 2 + 1);
    const st = countPass(r, lo, hi, (v) => (r.key(v) >> s) & 3, 4);
    for (let i = 0; i < 4; i++) go(lo + st[i], lo + st[i + 1] - 1, s - 2);
  };
  go(0, r.n - 1, top);
  r.range(-1, -1);
};
/** 基数 4 の MSD を、補助配列なしで置換して行う */
const americanFlag: Fn = (r) => {
  let top = 0;
  while (r.km >> (top + 2) > 0) top += 2;
  const go = (lo: number, hi: number, s: number): void => {
    if (lo >= hi || s < 0) return;
    r.range(lo, hi);
    r.info((top - s) / 2 + 1);
    const digit = (v: number): number => (r.key(v) >> s) & 3,
      cnt = [0, 0, 0, 0];
    for (let i = lo; i <= hi; i++) cnt[digit(r.get(i))]++;
    const head = [lo, 0, 0, 0],
      tail = [lo + cnt[0], 0, 0, 0];
    for (let b = 1; b < 4; b++) {
      head[b] = tail[b - 1];
      tail[b] = head[b] + cnt[b];
    }
    const from = head.slice();
    for (let b = 0; b < 4; b++)
      while (head[b] < tail[b]) {
        const d = digit(r.get(head[b]));
        if (d === b) head[b]++;
        else r.swap(head[b], head[d]++);
      }
    for (let b = 0; b < 4; b++) go(from[b], tail[b] - 1, s - 2);
  };
  go(0, r.n - 1, top);
  r.range(-1, -1);
};
const bucket: Fn = (r) => {
  const n = r.n,
    m = Math.max(2, Math.floor(Math.sqrt(n)));
  r.auxNew(n);
  const st = countPass(r, 0, n - 1, (v) => Math.min(m - 1, Math.floor((r.key(v) * m) / (r.km + 1))), m);
  for (let b = 0; b < m; b++) {
    if (st[b] >= st[b + 1] - 1) continue;
    r.range(st[b], st[b + 1] - 1);
    insertRange(r, st[b], st[b + 1] - 1);
  }
  r.range(-1, -1);
};
/** 値の範囲を約 0.43n の区分に分けて飛ばしてから、挿入ソートで仕上げる（Neubert） */
const flash: Fn = (r) => {
  const n = r.n;
  let mn = r.get(0),
    mx = mn,
    imx = 0;
  for (let i = 1; i < n; i++) {
    const v = r.get(i);
    if (v < mn) mn = v;
    if (v > mx) {
      mx = v;
      imx = i;
    }
  }
  if (mn === mx) return;
  const m = Math.max(2, Math.floor(0.43 * n)),
    cls = (v: number): number => Math.floor(((m - 1) * (v - mn)) / (mx - mn)),
    L = new Int32Array(m);
  for (let i = 0; i < n; i++) L[cls(r.get(i))]++;
  for (let k = 1; k < m; k++) L[k] += L[k - 1];
  if (imx !== 0) r.swap(imx, 0);
  let moved = 0,
    j = 0,
    k = m - 1;
  while (moved < n - 1) {
    while (j > L[k] - 1) {
      j++;
      k = cls(r.get(j));
    }
    let fl = r.get(j);
    r.pval(fl);
    while (j !== L[k]) {
      k = cls(fl);
      const hold = r.get(L[k] - 1);
      r.set(L[k] - 1, fl);
      fl = hold;
      r.pval(fl);
      L[k]--;
      moved++;
    }
  }
  r.pval(-1);
  insertRange(r, 0, n - 1);
};
/** 高い段から順に、段のビーズを右へ寄せる */
const bead: Fn = (r) => {
  const n = r.n,
    h = Int32Array.from(r.a);
  for (let lv = r.vm; lv >= 1; lv--) {
    r.info(lv);
    let c = 0;
    for (let i = 0; i < n; i++) {
      r.get(i);
      if (h[i] >= lv) c++;
    }
    for (let i = 0; i < n; i++) {
      const was = h[i] >= lv ? 1 : 0,
        now = i >= n - c ? 1 : 0;
      if (was !== now) r.set(i, r.a[i] + now - was);
    }
  }
};

/* ---------- ソーティングネットワーク ---------- */
const bitonic: Fn = (r) => {
  const cs = (i: number, j: number, up: boolean): void => {
    const c = r.cmp(i, j);
    if (up ? c > 0 : c < 0) r.swap(i, j);
  };
  const mg = (lo: number, n: number, up: boolean): void => {
    if (n < 2) return;
    let m = 1;
    while (m * 2 < n) m *= 2;
    for (let i = lo; i < lo + n - m; i++) cs(i, i + m, up);
    mg(lo, m, up);
    mg(lo + m, n - m, up);
  };
  const go = (lo: number, n: number, up: boolean): void => {
    if (n < 2) return;
    const m = n >> 1;
    r.range(lo, lo + n - 1);
    go(lo, m, !up);
    go(lo + m, n - m, up);
    r.range(lo, lo + n - 1);
    mg(lo, n, up);
  };
  go(0, r.n, true);
  r.range(-1, -1);
};
const batcher: Fn = (r) => {
  const n = r.n;
  for (let p = 1; p < n; p *= 2) {
    r.info(p);
    for (let k = p; k >= 1; k >>= 1)
      for (let j = k % p; j <= n - 1 - k; j += 2 * k)
        for (let i = 0; i <= Math.min(k - 1, n - j - k - 1); i++)
          if (Math.floor((i + j) / (2 * p)) === Math.floor((i + j + k) / (2 * p)))
            if (r.cmp(i + j, i + j + k) > 0) r.swap(i + j, i + j + k);
  }
};
const pairwise: Fn = (r) => {
  const n = r.n,
    cs = (i: number, j: number): void => {
      if (r.cmp(i, j) > 0) r.swap(i, j);
    };
  let a = 1;
  for (; a < n; a *= 2) {
    r.info(a);
    let c = 0;
    for (let b = a; b < n; ) {
      cs(b - a, b);
      c = (c + 1) % a;
      b++;
      if (c === 0) b += a;
    }
  }
  a = Math.floor(a / 4);
  for (let e = 1; a > 0; a = Math.floor(a / 2), e = 2 * e + 1) {
    r.info(a);
    for (let d = e; d > 0; d = Math.floor(d / 2)) {
      let c = 0;
      for (let b = (d + 1) * a; b < n; ) {
        cs(b - d * a, b);
        c = (c + 1) % a;
        b++;
        if (c === 0) b += a;
      }
    }
  }
};

/* ---------- 遅い ---------- */
const stooge: Fn = (r) => {
  const go = (lo: number, hi: number): void => {
    if (r.cmp(lo, hi) > 0) r.swap(lo, hi);
    if (hi - lo + 1 > 2) {
      const t = Math.floor((hi - lo + 1) / 3);
      r.range(lo, hi);
      go(lo, hi - t);
      go(lo + t, hi);
      go(lo, hi - t);
    }
  };
  go(0, r.n - 1);
  r.range(-1, -1);
};
const slow: Fn = (r) => {
  const go = (lo: number, hi: number): void => {
    if (lo >= hi) return;
    const m = (lo + hi) >> 1;
    r.range(lo, hi);
    go(lo, m);
    go(m + 1, hi);
    if (r.cmp(m, hi) > 0) r.swap(m, hi);
    go(lo, hi - 1);
  };
  go(0, r.n - 1);
  r.range(-1, -1);
};
/** 再現できるよう、種を固定した乱数 */
const lcg = (): (() => number) => {
  let s = 12345;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
};
const inOrder = (r: Rec): boolean => {
  for (let i = 0; i + 1 < r.n; i++) if (r.cmp(i, i + 1) > 0) return false;
  return true;
};
const bogo: Fn = (r) => {
  const rnd = lcg();
  while (!inOrder(r))
    for (let i = r.n - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      if (i !== j) r.swap(i, j);
    }
};
const bozo: Fn = (r) => {
  const rnd = lcg();
  while (!inOrder(r)) {
    /* 異なる 2 つを選ぶ（Gruber らの bozo-sort+） */
    const i = Math.floor(rnd() * r.n),
      j = Math.floor(rnd() * (r.n - 1));
    r.swap(i, j < i ? j : j + 1);
  }
};

/* ---------- 一覧 ---------- */
export interface Alg {
  id: string;
  /** 選択肢の名前 */
  s: string;
  /** 見出しの名前 */
  f: string;
  /** 分類 */
  g: string;
  fn: Fn;
  /** 計算量（HTML） */
  b: string;
  a: string;
  w: string;
  /** 補助メモリ（HTML） */
  m: string;
  /** 安定か */
  st: boolean;
  /** ピボットの印の名前 */
  pv?: string;
  /** 範囲の印の名前 */
  rg?: string;
  /** ギャップなどの印の名前 */
  inf?: string;
  /** 操作の回数の上限 */
  lim?: number;
}

const NL = 'n log n',
  N2 = 'n²',
  NL2 = 'n log²n',
  UNK = '不明',
  BOGO_LIMIT = 200000;

const A = (
  id: string,
  s: string,
  f: string,
  g: string,
  fn: Fn,
  [b, a, w, m]: readonly [string, string, string, string],
  st: boolean,
  o: Pick<Alg, 'pv' | 'rg' | 'inf' | 'lim'> = {},
): Alg => ({ id, s, f, g, fn, b, a, w, m, st, ...o });

export const GROUPS = ['交換', '選択', '挿入', 'マージ', '分割', '非比較', 'ネットワーク', '遅い'] as const;

export const ALGS: readonly Alg[] = [
  A('bubble', 'バブル', 'バブルソート', '交換', bubble, ['n', N2, N2, '1'], true),
  A('shaker', 'シェーカー', 'シェーカーソート', '交換', shaker, ['n', N2, N2, '1'], true),
  A('comb', 'コム', 'コムソート', '交換', comb, [NL, UNK, N2, '1'], false, { inf: 'ギャップ' }),
  A('gnome', 'ノーム', 'ノームソート', '交換', gnome, ['n', N2, N2, '1'], true),
  A('oddeven', '奇偶転置', '奇偶転置ソート', '交換', oddeven, ['n', N2, N2, '1'], true),
  A('selection', '選択', '選択ソート', '選択', selection, [N2, N2, N2, '1'], false, { pv: '最小' }),
  A('dselection', '双方向選択', '双方向選択ソート', '選択', dselection, [N2, N2, N2, '1'], false, { pv: '最小・最大' }),
  A('heap', 'ヒープ', 'ヒープソート', '選択', heap, [NL, NL, NL, '1'], false, { rg: 'ヒープ' }),
  A('smooth', 'スムース', 'スムースソート', '選択', smooth, ['n', NL, NL, '1'], false),
  A('cycle', 'サイクル', 'サイクルソート', '選択', cycle, [N2, N2, N2, '1'], false, { pv: '運ぶ値' }),
  A('pancake', 'パンケーキ', 'パンケーキソート', '選択', pancake, [N2, N2, N2, '1'], false, { pv: '最大' }),
  A('insertion', '挿入', '挿入ソート', '挿入', insertion, ['n', N2, N2, '1'], true, { pv: 'キー' }),
  A('binsert', '二分挿入', '二分挿入ソート', '挿入', binsert, [NL, N2, N2, '1'], true, { pv: 'キー' }),
  A('shell', 'シェル', 'シェルソート', '挿入', shell, [NL, UNK, UNK, '1'], false, { inf: 'ギャップ' }),
  A('merge', 'マージ', 'マージソート', 'マージ', merge, [NL, NL, NL, 'n'], true),
  A('bmerge', 'ボトムアップ', 'ボトムアップマージソート', 'マージ', bmerge, [NL, NL, NL, 'n'], true),
  A('tim', 'ティム', 'ティムソート（簡略版）', 'マージ', tim, ['n', NL, NL, 'n'], true, { rg: 'ラン' }),
  A('power', 'パワー', 'パワーソート（簡略版）', 'マージ', power, ['n', NL, NL, 'n'], true, { rg: 'ラン' }),
  A(
    'inplace',
    'インプレース',
    'インプレースマージソート（SymMerge）',
    'マージ',
    inplaceMerge,
    [NL, NL2, NL2, 'log n'],
    true,
  ),
  A(
    'quick-last',
    'クイック（末尾）',
    'クイックソート（末尾をピボット）',
    '分割',
    quickLast,
    [NL, NL, N2, 'log n'],
    false,
    {
      pv: 'ピボット',
    },
  ),
  A(
    'quick-mid',
    'クイック（中央）',
    'クイックソート（中央をピボット）',
    '分割',
    quickMid,
    [NL, NL, N2, 'log n'],
    false,
    {
      pv: 'ピボット',
    },
  ),
  A(
    'quick-med',
    'クイック（中央値）',
    'クイックソート（3 値の中央値をピボット）',
    '分割',
    quickMed,
    [NL, NL, N2, 'log n'],
    false,
    { pv: 'ピボット' },
  ),
  A('quick3', '3 分割クイック', '3 分割クイックソート', '分割', quick3, ['n', NL, N2, 'log n'], false, {
    pv: 'ピボット',
  }),
  A('dual', 'デュアルピボット', 'デュアルピボットクイックソート', '分割', dual, [NL, NL, N2, 'log n'], false, {
    pv: 'ピボット',
  }),
  A('intro', 'イントロ', 'イントロソート', '分割', intro, [NL, NL, NL, 'log n'], false, { pv: 'ピボット' }),
  A('pdq', 'pdq', 'pdqsort（簡略版）', '分割', pdq, ['n', NL, NL, 'log n'], false, { pv: 'ピボット' }),
  A('counting', '計数', '計数ソート', '非比較', counting, ['n + k', 'n + k', 'n + k', 'n + k'], true),
  A('radix-lsd', '基数（LSD）', '基数ソート（LSD・基数 4）', '非比較', radixLsd, ['dn', 'dn', 'dn', 'n'], true, {
    inf: '桁',
  }),
  A('radix-msd', '基数（MSD）', '基数ソート（MSD・基数 4）', '非比較', radixMsd, ['dn', 'dn', 'dn', 'n'], true, {
    inf: '桁',
  }),
  A(
    'flag',
    'アメリカンフラッグ',
    'アメリカンフラッグソート（基数 4）',
    '非比較',
    americanFlag,
    ['dn', 'dn', 'dn', 'log n'],
    false,
    { inf: '桁' },
  ),
  A('bucket', 'バケット', 'バケットソート（√n 個）', '非比較', bucket, ['n', 'n√n', N2, 'n'], true, { rg: 'バケット' }),
  A('flash', 'フラッシュ', 'フラッシュソート', '非比較', flash, ['n', 'n', N2, 'n'], false, { pv: '運ぶ値' }),
  A('bead', 'ビーズ', 'ビーズソート', '非比較', bead, ['nk', 'nk', 'nk', 'n'], false, { inf: '段' }),
  A('bitonic', 'バイトニック', 'バイトニックソート', 'ネットワーク', bitonic, [NL2, NL2, NL2, 'log n'], false),
  A('batcher', '奇偶マージ', 'バッチャーの奇偶マージソート', 'ネットワーク', batcher, [NL2, NL2, NL2, '1'], false, {
    inf: '段',
  }),
  A('pairwise', 'ペアワイズ', 'ペアワイズソート', 'ネットワーク', pairwise, [NL2, NL2, NL2, '1'], false, { inf: '段' }),
  A(
    'stooge',
    'ストゥージ',
    'ストゥージソート',
    '遅い',
    stooge,
    ['n<sup>2.71</sup>', 'n<sup>2.71</sup>', 'n<sup>2.71</sup>', 'log n'],
    false,
  ),
  A(
    'slow',
    'スロー',
    'スローソート',
    '遅い',
    slow,
    ['n<sup>log n</sup>', 'n<sup>log n</sup>', 'n<sup>log n</sup>', 'n'],
    false,
  ),
  A('bogo', 'ボゴ', 'ボゴソート', '遅い', bogo, ['n', 'n·n!', '∞', '1'], false, { lim: BOGO_LIMIT }),
  A('bozo', 'ボゾ', 'ボゾソート', '遅い', bozo, ['n', 'n!〜n·n!', '∞', '1'], false, { lim: BOGO_LIMIT }),
];

const byId = new Map(ALGS.map((a) => [a.id, a]));
/** id のアルゴリズム（保存した値などで、ないときは undefined） */
export const findAlg = (id: string): Alg | undefined => byId.get(id);
export const algOf = (id: string): Alg => {
  const a = byId.get(id);
  if (!a) throw new Error(`unknown algorithm: ${id}`);
  return a;
};
