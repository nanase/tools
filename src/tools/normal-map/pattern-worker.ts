/** 模様の高さ・法線マップ・色とつやを、画面を止めずに作る（重い模様は 0.5 秒ほどかかる） */
import { type Computed, heightMap, normalMap } from './heights';
import { materialMap } from './materials';

self.onmessage = (e: MessageEvent<{ id: Computed }>) => {
  const { id } = e.data,
    h = heightMap(id),
    nm = normalMap(h),
    col = materialMap(id, h);
  (self as unknown as Worker).postMessage({ id, h, nm, col }, [h.buffer, nm.buffer, col.buffer]);
};
