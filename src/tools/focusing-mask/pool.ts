/**
 * 星の像の計算を、波長の帯ごとに複数の Worker へ分ける。依頼は lane ごとに、新しい依頼が来たら古い依頼の
 * 結果は捨てる（その lane の最後の依頼だけが解決し、捨てた依頼は null で解決する）
 */
import { addInto, type Scene } from './engine';
import type { Img } from './optics';
import type { Job, Reply } from './worker';

export class Pool {
  private ws: Worker[] = [];
  private seq = 0;
  private wait = new Map<number, { lane: string; left: number; acc: Img | null; done: (v: Img | null) => void }>();

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
    const img: Img = { n: r.n, px: r.px, r: r.r, g: r.g, b: r.b };
    job.acc = job.acc ? addInto(job.acc, img) : img;
    if (--job.left === 0) {
      this.wait.delete(r.id);
      job.done(job.acc);
    }
  }

  /** 1 枚の点像（帯をすべて足したもの）。後から同じ lane に別の依頼が来たら null */
  render(s: Scene, lane = ''): Promise<Img | null> {
    const id = ++this.seq;
    for (const [old, job] of this.wait)
      if (job.lane === lane) {
        this.wait.delete(old);
        job.done(null);
      }
    const k = Math.min(this.ws.length, s.nb);
    return new Promise((done) => {
      this.wait.set(id, { lane, left: k, acc: null, done });
      /* 帯を交互に配る（短い波長ほど瞳の標本が多く遅いので、続きの区間で分けると偏る） */
      for (let i = 0; i < k; i++) this.ws[i].postMessage({ id, p: { s, i0: i, di: k } } satisfies Job);
    });
  }

  close(): void {
    for (const w of this.ws) w.terminate();
    this.ws = [];
  }
}
