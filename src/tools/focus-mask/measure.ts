/**
 * 光条の位置を像から測る（DOM に依存しない）。向きの分かった光条ごとに、光条に直交する断面の
 * 明るさの重心を、中心から離れた区間で求めて、光条の中心線の位置（像の中心からの符号付きの距離）にする
 */

/**
 * 像 I（n×n）の、向き a（rad、x 軸から反時計回り、y は上）の光条の中心線の位置（画素）。
 * 原点は画素 (n/2 − c0, n/2 − c0) の中心（点像の格子は c0 = 0、カメラの画素は 0.5 で画素の角）
 */
export function spikeOffset(
  I: ArrayLike<number>,
  n: number,
  a: number,
  r0: number,
  r1: number,
  half: number,
  c0 = 0,
): number {
  const c = Math.cos(a),
    s = Math.sin(a),
    h = n / 2;
  /* 中心線の法線 (−s, c) の向きの距離 q を、重心で求める */
  let sw = 0,
    sq = 0;
  const at = (x: number, y: number) => {
    /* 画素 (i, j) の中心を (i − h + c0, h − c0 − j) とし、双一次で補間する */
    const fx = x + h - c0,
      fy = h - c0 - y,
      x0 = Math.floor(fx),
      y0 = Math.floor(fy);
    if (x0 < 0 || y0 < 0 || x0 >= n - 1 || y0 >= n - 1) return 0;
    const tx = fx - x0,
      ty = fy - y0,
      o = y0 * n + x0;
    return (1 - ty) * ((1 - tx) * I[o] + tx * I[o + 1]) + ty * ((1 - tx) * I[o + n] + tx * I[o + n + 1]);
  };
  for (const sg of [-1, 1])
    for (let t = r0; t <= r1; t += 0.5) {
      /* 断面の地の明るさ（両端）を引く */
      const bx = sg * t * c,
        by = sg * t * s,
        bg = (at(bx - s * half, by + c * half) + at(bx + s * half, by - c * half)) / 2;
      for (let q = -half; q <= half; q += 0.5) {
        const v = at(bx - s * q, by + c * q) - bg;
        if (v <= 0) continue;
        sw += v;
        sq += v * q;
      }
    }
  return sw > 0 ? sq / sw : 0;
}

export interface BahtinovFit {
  /** 中央の光条の位置（法線の向き、画素） */
  mid: number;
  /** X の交点の、中央の光条の法線の向きの位置（画素） */
  cross: number;
  /** ずれ = mid − cross（画素） */
  off: number;
}

/**
 * バーティノフの 3 本の光条の位置を測る。rot はマスクの回転（中央の光条の向き）、th は斜めの格子の角度
 */
export function fitBahtinov(
  I: ArrayLike<number>,
  n: number,
  rot: number,
  th: number,
  r0: number,
  r1: number,
  half: number,
  c0 = 0,
): BahtinovFit {
  const mid = spikeOffset(I, n, rot, r0, r1, half, c0),
    qa = spikeOffset(I, n, rot + th, r0, r1, half, c0),
    qb = spikeOffset(I, n, rot - th, r0, r1, half, c0);
  /* 2 本の斜めの直線 n_a·p = qa、n_b·p = qb の交点を、中央の光条の座標（u: 沿う向き、v: 法線）で */
  const na = [-Math.sin(th), Math.cos(th)],
    nb = [Math.sin(th), Math.cos(th)],
    det = na[0] * nb[1] - na[1] * nb[0],
    u = (qa * nb[1] - na[1] * qb) / det,
    v = (na[0] * qb - qa * nb[0]) / det;
  void u;
  return { mid, cross: v, off: mid - v };
}
