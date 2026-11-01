/** Adam7 のインターレース（PNG 仕様 8.1）: 8×8 の区画を 7 つのパスに分け、粗い格子から順に送る */

/** パス 1〜7 の始まりの位置と間隔 */
export const ADAM7 = [
  { x0: 0, y0: 0, dx: 8, dy: 8 },
  { x0: 4, y0: 0, dx: 8, dy: 8 },
  { x0: 0, y0: 4, dx: 4, dy: 8 },
  { x0: 2, y0: 0, dx: 4, dy: 4 },
  { x0: 0, y0: 2, dx: 2, dy: 4 },
  { x0: 1, y0: 0, dx: 2, dy: 2 },
  { x0: 0, y0: 1, dx: 1, dy: 2 },
] as const;

/** 1 つのパス（インターレースなしは pass 0 で、間隔 1 の 1 つのパスとみなす） */
export interface Pass {
  /** 0: インターレースなし、1〜7: Adam7 のパス */
  pass: number;
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  /** パスの画像の幅と高さ（0 ならこのパスは送らない） */
  w: number;
  h: number;
}

/** 幅 width・高さ height の画像の 7 つのパス（空のパスも含む） */
export function adam7Passes(width: number, height: number): Pass[] {
  return ADAM7.map((p, i) => ({
    pass: i + 1,
    ...p,
    w: width > p.x0 ? Math.ceil((width - p.x0) / p.dx) : 0,
    h: height > p.y0 ? Math.ceil((height - p.y0) / p.dy) : 0,
  }));
}

/** インターレースなしの 1 つのパス */
export const singlePass = (width: number, height: number): Pass => ({
  pass: 0,
  x0: 0,
  y0: 0,
  dx: 1,
  dy: 1,
  w: width,
  h: height,
});

/** パスの中の画素 (px, py) の元の画像での位置 */
export const passToImage = (p: Pass, px: number, py: number): [number, number] => [p.x0 + px * p.dx, p.y0 + py * p.dy];

/** 画素 (x, y) が送られるパス 1〜7 */
export function adam7PassOf(x: number, y: number): number {
  const ix = x & 7,
    iy = y & 7;
  for (let i = 6; i >= 0; i--) {
    const p = ADAM7[i];
    if (ix % p.dx === p.x0 && iy % p.dy === p.y0) return i + 1;
  }
  return 1;
}
