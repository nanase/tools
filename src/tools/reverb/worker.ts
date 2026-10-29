/** インパルス応答と指標をメインスレッドの外で計算する（部屋を動かすたびに数十〜数百 ms かかる） */
import { type Echo, echoes, type Params, params, type SynthOpts, synth } from './ir';
import { NB, type Room } from './room';

export interface Job {
  id: number;
  room: Room;
  o: SynthOpts;
}
export interface Reply {
  id: number;
  h: Float32Array;
  t0: number;
  tTail: number;
  tailT60: number[];
  /** 鏡像: 届く時刻 [s]・反射の回数・500 Hz の振幅・位置（x, y, z） */
  it: Float64Array;
  io: Uint16Array;
  ia: Float64Array;
  ip: Float64Array;
  p: Params;
  ec: Echo[];
}

export function run(j: Job): Reply {
  const s = synth(j.room, j.o),
    { im } = s,
    ia = new Float64Array(im.n),
    ip = new Float64Array(3 * im.n);
  for (let i = 0; i < im.n; i++) {
    ia[i] = im.amp[i * NB + 2];
    ip[3 * i] = im.x[i];
    ip[3 * i + 1] = im.y[i];
    ip[3 * i + 2] = im.z[i];
  }
  return {
    id: j.id,
    h: s.h,
    t0: s.t0,
    tTail: s.tTail,
    tailT60: s.tailT60,
    it: im.t,
    io: im.order,
    ia,
    ip,
    p: params(s.h, s.fs, s.t0),
    ec: echoes(s.h, s.fs, s.t0),
  };
}

/* Worker の中でだけ受け付ける */
if (typeof document === 'undefined' && typeof self !== 'undefined' && 'postMessage' in self)
  self.onmessage = (e: MessageEvent<Job>) => {
    const r = run(e.data);
    postMessage(r, { transfer: [r.h.buffer, r.it.buffer, r.io.buffer, r.ia.buffer, r.ip.buffer] });
  };
