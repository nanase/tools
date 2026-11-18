/**
 * 基準の点を選んで軌道を用意する。軽い依頼はその場で、重い依頼は Worker で計算する。
 * 新しい依頼を出したら、古い依頼の結果は捨てる
 */
import { fromFix, toFix } from './fixed';
import type { Formula } from './formula';
import { type Orbit, orbit } from './orbit';

export interface Ref {
  x: bigint;
  y: bigint;
  orbit: Orbit;
  /** 計算を頼んだ長さ（これより短ければ途中で発散した） */
  want: number;
  key: string;
}

/** 軌道が変わる式の要素（べきは整数だけ使う） */
export const fkey = (f: Formula): string => `${Math.round(f.p)},${f.pre},${f.post},${f.conj}`;

/** その場で計算する長さの上限。これを超える依頼は Worker へ回す */
const SYNC_MAX = 8000;
/** 中心から span の何倍まで離れた基準を使い続けるか */
const FAR = 2.5;
/** 中心が早く発散したときに試す点（span 単位） */
const TRIES: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.3, 0],
  [-0.3, 0],
  [0, 0.3],
  [0, -0.3],
  [0.3, 0.3],
  [-0.3, -0.3],
  [0.3, -0.3],
  [-0.3, 0.3],
];

export const wantFor = (mi: number): number => Math.max(mi, 2000) * 2;

/** 基準を作り直す必要があるか（式が違う・長さが足りない・中心から離れた） */
export function refStale(ref: Ref | null, cx: bigint, cy: bigint, span: number, f: Formula, mi: number): boolean {
  if (!ref || ref.key !== fkey(f)) return true;
  if (ref.orbit.len > ref.want && ref.want < mi) return true;
  return Math.hypot(fromFix(cx - ref.x), fromFix(cy - ref.y)) > FAR * span;
}

/** 中心を先に試し、早く発散したら周りの点から最も長く持つ点を選ぶ */
export function pickRef(cx: bigint, cy: bigint, span: number, f: Formula, mi: number): Ref {
  const want = wantFor(mi);
  let best: Ref | null = null;
  for (const [a, b] of TRIES) {
    const x = cx + toFix(a * span),
      y = cy + toFix(b * span),
      o = orbit(x, y, f, want);
    if (!best || o.len > best.orbit.len) best = { x, y, orbit: o, want, key: fkey(f) };
    if (o.len > want) break;
  }
  return best as Ref;
}

interface Reply {
  id: number;
  x: bigint;
  y: bigint;
  data: Float32Array;
  len: number;
  want: number;
  key: string;
}

export class RefSource {
  ref: Ref | null = null;
  /** Worker の結果が届いたら呼ぶ */
  onReady: () => void = () => {};
  private worker: Worker | null = null;
  private seq = 0;
  private waitKey = '';

  /** 使える基準を返す。作り直しが要り、その場で作れないときは Worker に頼み、届くまでは古い基準（式が同じなら）か null */
  get(cx: bigint, cy: bigint, span: number, f: Formula, mi: number): Ref | null {
    if (!refStale(this.ref, cx, cy, span, f, mi)) return this.ref;
    if (wantFor(mi) <= SYNC_MAX || typeof Worker === 'undefined') {
      this.seq++;
      this.waitKey = '';
      this.ref = pickRef(cx, cy, span, f, mi);
      return this.ref;
    }
    const key = `${fkey(f)}|${cx}|${cy}|${span}|${mi}`;
    if (key !== this.waitKey) {
      this.waitKey = key;
      const id = ++this.seq;
      this.worker ??= this.spawn();
      this.worker.postMessage({ id, cx, cy, span, f: { ...f }, mi });
    }
    return this.ref && this.ref.key === fkey(f) ? this.ref : null;
  }

  private spawn(): Worker {
    const w = new Worker(new URL('./ref-worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<Reply>) => {
      const r = e.data;
      if (r.id !== this.seq) return;
      this.waitKey = '';
      this.ref = { x: r.x, y: r.y, orbit: { data: r.data, len: r.len }, want: r.want, key: r.key };
      this.onReady();
    };
    return w;
  }
}
