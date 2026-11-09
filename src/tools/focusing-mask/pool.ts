/**
 * 星の像の計算を複数の Worker へ分ける。依頼は lane ごとに、新しい依頼が来たら古い依頼の
 * 結果は捨てる（その lane の最後の依頼だけが解決し、捨てた依頼は null で解決する）
 */
import { addInto, type Scene } from './engine';
import type { Img } from './optics';
import type { Job, Msg, Reply } from './worker';

/** FFT が 2048 以上の点像を分ける Worker の数の上限（1 つの Worker が約 100 MB を使う） */
const BIG_K = 3;

export class Pool {
  private ws: Worker[] = [];
  private seq = 0;
  /** 次に使い始める Worker（1 つだけの依頼を偏らせない） */
  private rr = 0;
  private wait = new Map<number, { lane: string; left: number; out: unknown[]; done: (v: unknown[] | null) => void }>();

  /** k は Worker の数（省略時は論理コア数 − 1、1〜6） */
  constructor(k = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 2) - 1))) {
    for (let i = 0; i < k; i++) {
      const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<Reply>) => this.got(e.data);
      this.ws.push(w);
    }
  }

  private got(r: Reply): void {
    const job = this.wait.get(r.id);
    if (!job) return;
    job.out[r.i] = r.out;
    if (--job.left === 0) {
      this.wait.delete(r.id);
      job.done(job.out);
    }
  }

  /** 依頼を Worker に 1 つずつ配る（k 個までの Worker に順に）。後から同じ lane に別の依頼が来たら null */
  run<T>(lane: string, ms: { m: Msg; tr?: Transferable[] }[], k = this.ws.length): Promise<T[] | null> {
    const id = ++this.seq;
    for (const [old, job] of this.wait)
      if (job.lane === lane) {
        this.wait.delete(old);
        job.done(null);
      }
    const n = Math.max(1, Math.min(k, this.ws.length)),
      r0 = this.rr;
    this.rr = (this.rr + ms.length) % this.ws.length;
    return new Promise((done) => {
      this.wait.set(id, { lane, left: ms.length, out: [], done: done as (v: unknown[] | null) => void });
      ms.forEach(({ m, tr }, i) => {
        this.ws[(n === this.ws.length ? r0 + i : i) % n].postMessage({ id, i, m } satisfies Job, {
          transfer: tr ?? [],
        });
      });
    });
  }

  /** 1 枚の点像（帯をすべて足したもの）。後から同じ lane に別の依頼が来たら null */
  async render(s: Scene, lane = ''): Promise<Img | null> {
    /* 帯を交互に配る（短い波長ほど瞳の標本が多く遅いので、続きの区間で分けると偏る） */
    const k = Math.min(this.ws.length, s.nb, s.N >= 2048 ? BIG_K : Infinity),
      parts = await this.run<Img>(
        lane,
        Array.from({ length: k }, (_, i) => ({ m: { t: 'psf', p: { s, i0: i, di: k } } as Msg })),
        k,
      );
    return parts ? parts.reduce((a, b) => addInto(a, b)) : null;
  }

  close(): void {
    for (const w of this.ws) w.terminate();
    this.ws = [];
  }
}
