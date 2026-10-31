/** 1 変数の根と極小を探す（DOM に依存しない） */

/** f(lo) と f(hi) の符号が逆の区間を n 回二分して根を出す */
export function bisect(f: (t: number) => number, lo: number, hi: number, n = 24): number {
  const sl = Math.sign(f(lo));
  let a = lo;
  let b = hi;
  for (let k = 0; k < n; k++) {
    const m = (a + b) / 2;
    if (Math.sign(f(m)) === sl) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

/** 黄金分割で [lo, hi] の f の極小を探す */
export function golden(f: (t: number) => number, lo: number, hi: number, n = 50): number {
  const g = (Math.sqrt(5) - 1) / 2;
  let a = lo;
  let b = hi;
  let c = b - g * (b - a);
  let d = a + g * (b - a);
  let fc = f(c);
  let fd = f(d);
  for (let k = 0; k < n; k++) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - g * (b - a);
      fc = f(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + g * (b - a);
      fd = f(d);
    }
  }
  return (a + b) / 2;
}
