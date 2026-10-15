/**
 * 2 次元の複素 FFT（DOM に依存しない）。瞳の光の場から焦点面の光の場を求めるのに使う。
 * 瞳は格子の中央付近にしかないので、0 の行は変換せず、見る範囲の列だけを変換する
 */

interface Plan {
  N: number;
  rev: Uint32Array;
  cs: Float64Array;
  sn: Float64Array;
  /** 1 列分の作業領域 */
  tr: Float64Array;
  ti: Float64Array;
}
const plans = new Map<number, Plan>();
function plan(N: number): Plan {
  const hit = plans.get(N);
  if (hit) return hit;
  const bits = Math.round(Math.log2(N));
  if (2 ** bits !== N) throw new Error(`N must be a power of 2: ${N}`);
  const rev = new Uint32Array(N),
    cs = new Float64Array(N / 2),
    sn = new Float64Array(N / 2);
  for (let i = 0; i < N; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  for (let i = 0; i < N / 2; i++) {
    cs[i] = Math.cos((2 * Math.PI * i) / N);
    sn[i] = -Math.sin((2 * Math.PI * i) / N);
  }
  const p = { N, rev, cs, sn, tr: new Float64Array(N), ti: new Float64Array(N) };
  plans.set(N, p);
  return p;
}

/** 長さ N の列 re・im をその場で変換する（基数 2、時間間引き） */
function fft1(p: Plan, re: Float64Array, im: Float64Array): void {
  const { N, rev, cs, sn } = p;
  for (let i = 0; i < N; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1,
      step = N / size;
    for (let i = 0; i < N; i += size)
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const a = i + j,
          b = a + half,
          wr = cs[k],
          wi = sn[k],
          tr = re[b] * wr - im[b] * wi,
          ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
  }
}

/**
 * N×N の場（行優先、re・im）を 2 次元に変換し、中央の M×M の強度 |E|² を out に足す（重み w）。
 * 場の原点は添字 0（負の座標は末尾に回り込む）とし、out は中央が原点になるよう並べ替える。
 * rows: 0 でない行の半幅（行 0〜rows と N−rows〜N−1 だけ変換する）
 */
export function psfAdd(
  N: number,
  re: Float64Array,
  im: Float64Array,
  rows: number,
  M: number,
  out: Float64Array,
  w: number,
): void {
  const p = plan(N),
    { tr, ti } = p,
    h = M >> 1;
  /* 行（x 方向）: 0 でない行だけ */
  for (let y = 0; y < N; y++) {
    if (y > rows && y < N - rows) continue;
    const o = y * N;
    for (let x = 0; x < N; x++) {
      tr[x] = re[o + x];
      ti[x] = im[o + x];
    }
    fft1(p, tr, ti);
    for (let x = 0; x < N; x++) {
      re[o + x] = tr[x];
      im[o + x] = ti[x];
    }
  }
  /* 列（y 方向）: 見る範囲の周波数 kx（−h〜h−1）だけ */
  for (let c = -h; c < h; c++) {
    const x = (c + N) % N;
    for (let y = 0; y < N; y++) {
      if (y > rows && y < N - rows) {
        tr[y] = 0;
        ti[y] = 0;
      } else {
        tr[y] = re[y * N + x];
        ti[y] = im[y * N + x];
      }
    }
    fft1(p, tr, ti);
    const ox = c + h;
    for (let r = -h; r < h; r++) {
      const y = (r + N) % N;
      out[(r + h) * M + ox] += w * (tr[y] * tr[y] + ti[y] * ti[y]);
    }
  }
}

/** N×N の 2 次元 FFT（その場で、inv なら逆変換で 1/N² を掛ける） */
export function fft2d(N: number, re: Float64Array, im: Float64Array, inv = false): void {
  const p = plan(N),
    { tr, ti } = p,
    s = inv ? -1 : 1;
  for (let y = 0; y < N; y++) {
    const o = y * N;
    for (let x = 0; x < N; x++) {
      tr[x] = re[o + x];
      ti[x] = s * im[o + x];
    }
    fft1(p, tr, ti);
    for (let x = 0; x < N; x++) {
      re[o + x] = tr[x];
      im[o + x] = ti[x];
    }
  }
  const k = inv ? 1 / (N * N) : 1;
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < N; y++) {
      tr[y] = re[y * N + x];
      ti[y] = im[y * N + x];
    }
    fft1(p, tr, ti);
    for (let y = 0; y < N; y++) {
      re[y * N + x] = k * tr[y];
      im[y * N + x] = s * k * ti[y];
    }
  }
}
