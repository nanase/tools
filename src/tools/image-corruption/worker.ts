/** 3 形式の符号化と、壊したバイト列の復号をメインスレッドの外で行う。符号化の結果は設定が変わるまで持っておく */
import { ENCODE_DEFAULTS, type EncodeOpts, FMTS, type Fmt, type Source } from './codec';
import { type Base, makeBase, type Outcome, outcome, type Plan } from './model';

/** 画像を渡す */
export interface ImgJob {
  kind: 'img';
  img: number;
  src: Source;
}
/** 壊して戻す */
export interface RunJob {
  kind: 'run';
  id: number;
  img: number;
  enc: EncodeOpts;
  plan: Plan;
  /** 壊したバイト列も返す（ブラウザで開くとき） */
  bytes: boolean;
}
export type Job = ImgJob | RunJob;

export interface Reply {
  id: number;
  img: number;
  /** 壊す前の幅と高さ */
  w: number;
  h: number;
  r: Outcome[];
}

/** 1 回の計算。画像と形式ごとの設定が同じ間は符号化し直さない */
export class Runner {
  private src: Source | null = null;
  private img = -1;
  private readonly bases = new Map<Fmt, { key: string; b: Base }>();

  setImage(img: number, src: Source): void {
    this.img = img;
    this.src = src;
    this.bases.clear();
  }

  run(j: RunJob): Reply | null {
    const s = this.src;
    if (!s || this.img !== j.img) return null;
    const r = FMTS.map((f) => outcome(f, this.base(f, s, j.enc), j.plan, j.bytes));
    return { id: j.id, img: j.img, w: s.w, h: s.h, r };
  }

  private base(f: Fmt, s: Source, o: EncodeOpts): Base {
    const key = f === 'png' ? `${o.filter}:${o.level}` : f === 'jpeg' ? `${o.q}:${o.dri}` : String(o.interlace);
    const c = this.bases.get(f);
    if (c?.key === key) return c.b;
    const b = makeBase(f, s, { ...ENCODE_DEFAULTS, ...o });
    this.bases.set(f, { key, b });
    return b;
  }
}

/** 結果の中の配列（移して渡す） */
export function buffers(r: Reply): ArrayBuffer[] {
  const s = new Set<ArrayBuffer>();
  for (const o of r.r) {
    s.add(o.d.rgba.buffer as ArrayBuffer);
    if (o.bytes) s.add(o.bytes.buffer as ArrayBuffer);
  }
  return [...s];
}

/* Worker の中でだけ受け付ける */
if (typeof document === 'undefined') {
  const R = new Runner();
  self.onmessage = (e: MessageEvent<Job>) => {
    const j = e.data;
    if (j.kind === 'img') {
      R.setImage(j.img, j.src);
      return;
    }
    const r = R.run(j);
    if (r) postMessage(r, { transfer: buffers(r) });
  };
}
