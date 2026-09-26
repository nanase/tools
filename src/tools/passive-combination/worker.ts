/** 探索の Worker。本数ごとに開始（s）・途中経過（p）・終了（e）を返す。例外は x */
import { createSearch, type Found, type Reason } from './search';

export interface ToWorker {
  t: number;
  v: number[];
  stop: number | null;
  ns: readonly number[];
  K: number;
}
export type FromWorker =
  | { k: 's'; n: number }
  | { k: 'p'; n: number; p: number; list: Found[] | null }
  | { k: 'e'; n: number; r: Reason; list: Found[] }
  | { k: 'x'; msg: string };

const post = (m: FromWorker) => postMessage(m);

addEventListener('message', (e: MessageEvent<ToWorker>) => {
  const d = e.data;
  try {
    const s = createSearch(d);
    for (const n of d.ns) {
      post({ k: 's', n });
      const [r, list] = s.run(n, (p, l) => post({ k: 'p', n, p, list: l }));
      post({ k: 'e', n, r, list });
    }
  } catch (err) {
    post({ k: 'x', msg: String(err) });
  }
});
