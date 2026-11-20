/** 模様の高さと法線マップを、画面を止めずに作る（重い模様は 0.5 秒ほどかかる） */
import { heightMap, normalMap, type PatId } from './heights';

self.onmessage = (e: MessageEvent<{ id: Exclude<PatId, 'text'> }>) => {
  const { id } = e.data,
    h = heightMap(id),
    nm = normalMap(h);
  (self as unknown as Worker).postMessage({ id, h, nm }, [h.buffer, nm.buffer]);
};
