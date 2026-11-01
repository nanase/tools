/**
 * 符号化・ファイルの読み取り・フィルタの比較をメインスレッドの外で行う。画像は 1 度だけ受け取って持っておく。
 * 結果は 2 回に分けて返す（先に本体、あとからフィルタの比較）
 */
import { type Compare, compare, type EncOpts, encodeModel, type Fail, fileModel, type Model } from './model';

/** 画像を渡す */
export interface ImgJob {
  kind: 'img';
  img: number;
  w: number;
  h: number;
  rgba: Uint8ClampedArray;
}
/** 画像を符号化する */
export interface EncJob {
  kind: 'enc';
  id: number;
  img: number;
  opts: EncOpts;
}
/** PNG ファイルをそのまま読む */
export interface FileJob {
  kind: 'file';
  id: number;
  img: number;
  bytes: Uint8Array;
}
export type Job = ImgJob | EncJob | FileJob;

export type Reply =
  | { kind: 'model'; id: number; img: number; m: Model | null; fail?: Fail; colors?: number }
  | { kind: 'cmp'; id: number; img: number; c: Compare };

/** フィルタの比較に使う圧縮レベル（ファイルをそのまま読むとき） */
export const FILE_CMP_LEVEL = 6;

/** 1 回分の計算（Worker を使えないときはメインスレッドで呼ぶ）。返事は reply に 2 回渡す */
export function run(j: EncJob | FileJob, cur: ImgJob | null, reply: (r: Reply, tr: ArrayBuffer[]) => void): void {
  let m: Model | null = null;
  try {
    const r = j.kind === 'file' ? fileModel(j.bytes) : cur ? encodeModel(cur.rgba, cur.w, cur.h, j.opts) : null;
    if (r && 'fail' in r) {
      reply(
        {
          kind: 'model',
          id: j.id,
          img: j.img,
          m: null,
          fail: r.fail,
          colors: 'colors' in r ? (r.colors as number | undefined) : undefined,
        },
        [],
      );
      return;
    }
    m = r;
  } catch {
    m = null;
  }
  reply({ kind: 'model', id: j.id, img: j.img, m }, []);
  if (!m) return;
  const c = compare(m.layout, m.raw, j.kind === 'enc' ? j.opts.level : FILE_CMP_LEVEL);
  reply(
    { kind: 'cmp', id: j.id, img: j.img, c },
    c.data.map((d) => d.buffer as ArrayBuffer),
  );
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
    run(j, cur && cur.img === j.img ? cur : null, (r, tr) => postMessage(r, { transfer: tr }));
  };
}
