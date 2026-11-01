/**
 * GIF のページの見本。どれも式か文字の図から描き、毎回同じ画素になる。
 * - ドット絵: 16×16・5 色。1 符号ずつ追える大きさ
 * - 縞: 同じ模様の繰り返し。辞書の列が長く育つ
 * - 写真風: 色が多く、減色と誤差拡散の差が出る（PNG の見本を縮める）
 */
import { PHOTO_H, PHOTO_W, photo } from '../png/samples';

const hex = (h: string): [number, number, number] => [
  Number.parseInt(h.slice(0, 2), 16),
  Number.parseInt(h.slice(2, 4), 16),
  Number.parseInt(h.slice(4, 6), 16),
];

/** 文字の図を RGBA へ。「.」は透明 */
function fromArt(art: readonly string[], colors: Record<string, string>): Uint8ClampedArray {
  const h = art.length,
    w = art[0].length,
    d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = art[y][x];
      if (c === '.') continue;
      d.set([...hex(colors[c]), 255], (y * w + x) * 4);
    }
  return d;
}

/** ドット絵（ロケット） */
const ROCKET = [
  '.......rr.......',
  '......rrrr......',
  '.....rrrrrr.....',
  '.....wwwwww.....',
  '.....wwbbww.....',
  '.....wbccbw.....',
  '.....wbccbw.....',
  '.....wwbbww.....',
  '.....wwwwww.....',
  '....rwwwwwwr....',
  '...rrwwwwwwrr...',
  '...rrwwwwwwrr...',
  '...rr.bbbb.rr...',
  '......yyyy......',
  '.......yy.......',
  '.......yy.......',
];
const ROCKET_C = { r: 'd6503c', w: 'eef0ea', b: '2f5f8f', c: '8fd0e8', y: 'f2b632' };

export const SPRITE_W = 16;
export const SPRITE_H = 16;
export const sprite = (): Uint8ClampedArray => fromArt(ROCKET, ROCKET_C);

export const STRIPE_W = 96;
export const STRIPE_H = 64;
/** 斜めの縞と市松の繰り返し */
export function stripes(): Uint8ClampedArray {
  const w = STRIPE_W,
    h = STRIPE_H,
    d = new Uint8ClampedArray(w * h * 4),
    C = ['1f3a5f', 'f2b632', 'eef0ea', 'd6503c'].map(hex);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = y < h / 2 ? Math.floor((x + y) / 6) % 3 : (Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? 3 : 2;
      d.set([...C[v], 255], (y * w + x) * 4);
    }
  return d;
}

export const SOFT_W = PHOTO_W / 2;
export const SOFT_H = PHOTO_H / 2;
/** 写真風: PNG の見本を 2×2 の平均で半分にする */
export function soft(): Uint8ClampedArray {
  const s = photo(),
    w = SOFT_W,
    h = SOFT_H,
    d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let a = 0;
        for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) a += s[((y * 2 + j) * PHOTO_W + x * 2 + i) * 4 + c];
        d[(y * w + x) * 4 + c] = a / 4;
      }
      d[(y * w + x) * 4 + 3] = 255;
    }
  return d;
}
