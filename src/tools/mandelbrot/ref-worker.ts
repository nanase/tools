/** 深い所の基準の軌道を、描画を止めずに計算する */
import type { Formula } from './formula';
import { pickRef } from './ref';

interface Job {
  id: number;
  cx: bigint;
  cy: bigint;
  span: number;
  f: Formula;
  mi: number;
}

self.onmessage = (e: MessageEvent<Job>) => {
  const { id, cx, cy, span, f, mi } = e.data;
  const r = pickRef(cx, cy, span, f, mi);
  const data = r.orbit.data;
  (self as unknown as Worker).postMessage({ id, x: r.x, y: r.y, data, len: r.orbit.len, want: r.want, key: r.key }, [
    data.buffer,
  ]);
};
