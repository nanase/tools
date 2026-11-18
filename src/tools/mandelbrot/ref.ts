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

/** Worker を待つ間に古い基準を使い続ける、中心からの離れ具合の上限（span の倍数）。これより遠いと単精度の差が画素の差を消す */
const WAIT_FAR = 1e3;

interface Job {
  cx: bigint;
  cy: bigint;
  span: number;
  f: Formula;
  mi: number;
}

export class RefSource {
  ref: Ref | null = null;
  /** Worker の結果が届いたら呼ぶ */
  onReady: () => void = () => {};
  private worker: Worker | null = null;
  private seq = 0;
  /** この番号以下の返事は捨てる（その場で計算した基準より古い） */
  private floor = 0;
  /** Worker が計算中か。計算中の依頼は 1 件だけにし、新しい依頼は next に置いて最新の 1 件だけ残す */
  private busy = false;
  private next: Job | null = null;

  /** 使える基準を返す。作り直しが要り、その場で作れないときは Worker に頼み、届くまでは近くの古い基準（式が同じなら）か null */
  get(cx: bigint, cy: bigint, span: number, f: Formula, mi: number): Ref | null {
    if (!refStale(this.ref, cx, cy, span, f, mi)) return this.ref;
    if (wantFor(mi) <= SYNC_MAX || typeof Worker === 'undefined') {
      this.floor = this.seq;
      this.next = null;
      this.ref = pickRef(cx, cy, span, f, mi);
      return this.ref;
    }
    const job: Job = { cx, cy, span, f: { ...f }, mi };
    if (this.busy) this.next = job;
    else this.post(job);
    const r = this.ref;
    return r && r.key === fkey(f) && Math.hypot(fromFix(cx - r.x), fromFix(cy - r.y)) <= WAIT_FAR * span ? r : null;
  }

  private post(job: Job): void {
    this.worker ??= this.spawn();
    this.busy = true;
    this.worker.postMessage({ id: ++this.seq, ...job });
  }

  private spawn(): Worker {
    const w = new Worker(new URL('./ref-worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<Reply>) => {
      const r = e.data;
      this.busy = false;
      /* 途中の依頼の返事も、式が同じで近ければ使える。使えるかは get の refStale が決める */
      if (r.id > this.floor)
        this.ref = { x: r.x, y: r.y, orbit: { data: r.data, len: r.len }, want: r.want, key: r.key };
      const job = this.next;
      this.next = null;
      /* 待っている依頼は、届いた基準で足りなければ送る */
      if (job && refStale(this.ref, job.cx, job.cy, job.span, job.f, job.mi)) this.post(job);
      if (r.id > this.floor) this.onReady();
    };
    return w;
  }
}
