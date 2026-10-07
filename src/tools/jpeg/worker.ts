/** 符号化・復号・画質の計算をメインスレッドの外で行う。画像は 1 度だけ受け取って持っておく */
import type { Up } from './color';
import { decode } from './decoder';
import { type EncOpts, type Encoded, encode } from './encoder';
import { psnr } from './metrics';

/** 画像を渡す */
export interface ImgJob {
  kind: 'img';
  img: number;
  w: number;
  h: number;
  rgba: Uint8ClampedArray;
}
/** 符号化して、自前の復号器で戻す */
export interface EncJob {
  kind: 'enc';
  id: number;
  img: number;
  opts: EncOpts;
  up: Up;
}
export type Job = ImgJob | EncJob;

export interface Result {
  enc: Encoded;
  /** 復号した画像（RGBA） */
  dec: Uint8ClampedArray;
  psnrY: number;
  psnrRgb: number;
}
export interface Reply {
  id: number;
  img: number;
  r: Result | null;
}

/** 1 回の符号化と復号（Worker を使えないときはメインスレッドで呼ぶ） */
export function run(rgba: Uint8ClampedArray, w: number, h: number, opts: EncOpts, up: Up): Result {
  const enc = encode(rgba, w, h, opts),
    dec = decode(enc.bytes, up).rgba;
  return { enc, dec, psnrY: psnr(rgba, dec, 'y'), psnrRgb: psnr(rgba, dec, 'rgb') };
}

/** 結果の中の配列（移して渡す） */
export function buffers(r: Result): ArrayBuffer[] {
  const s = new Set<ArrayBuffer>([
    r.dec.buffer as ArrayBuffer,
    r.enc.bytes.buffer as ArrayBuffer,
    r.enc.map.buffer as ArrayBuffer,
  ]);
  for (const c of r.enc.comps) for (const a of [c.plane.d, c.coef, c.bits]) s.add(a.buffer as ArrayBuffer);
  return [...s];
}

/* Worker の中でだけ受け付ける */
if (typeof document === 'undefined') {
  let cur: ImgJob | null = null;
  self.onmessage = (e: MessageEvent<Job>) => {
    const j = e.data;
    if (j.kind === 'img') {
      cur = j;
      return;
    }
    let r: Result | null = null;
    if (cur && cur.img === j.img)
      try {
        r = run(cur.rgba, cur.w, cur.h, j.opts, j.up);
      } catch {
        r = null;
      }
    postMessage({ id: j.id, img: j.img, r } satisfies Reply, { transfer: r ? buffers(r) : [] });
  };
}
