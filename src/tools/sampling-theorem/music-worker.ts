/** サンプル音源を 44.1 kHz・4 秒・モノラルで作るワーカー（混ぜた音で 0.5 秒ほどかかるため主スレッドで作らない） */

import { type MusicName, makeMusic } from '../pcm/music';
import { MUSIC_DUR, MUSIC_RATE } from './music';

export interface MusicOut {
  name: MusicName;
  x: Float32Array;
}

self.onmessage = (e: MessageEvent<MusicName>) => {
  const name = e.data,
    ch = makeMusic(name, MUSIC_RATE, MUSIC_DUR),
    x = ch.length === 1 ? ch[0] : Float32Array.from(ch[0], (v, i) => (v + ch[1][i]) / 2);
  (self as unknown as Worker).postMessage({ name, x } satisfies MusicOut, [x.buffer]);
};
