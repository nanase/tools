/** 波形と分布をメインスレッドの外で計算する（放電路や聞き手を動かすたびに 100 ms ほどかかる） */
import { type Branch, type ChannelSet, makeChannel } from './channel';
import { arrivalHistogram, elements, firstArrival, type Scene, Via } from './path';
import { render, spectrum } from './synth';

export interface Job {
  id: number;
  ch: ChannelSet;
  scene: Scene;
  fs: number;
  /** 分布の箱の幅 [s] */
  dt: number;
}
export interface Reply {
  id: number;
  branches: Branch[];
  first: number;
  y: Float32Array;
  fs: number;
  t0: number;
  peak: number;
  /** 同じ雷を 1 km 先（山なし）で聞いたときの最大の音圧 [Pa]（大きさを相対の dB で出すため） */
  ref: number;
  /** 直接の音が届き始める時刻と届き終わる時刻 [s] */
  d0: number;
  d1: number;
  /** 分布: 経路ごと、時刻 h0 から dt ごと */
  hist: Float64Array[];
  h0: number;
  dt: number;
  /** 要素の届く時刻 [s]・中点 x, z [m]・経路（図で放電路を届く時刻で塗る） */
  et: Float64Array;
  exz: Float32Array;
  ev: Uint8Array;
  sf: Float64Array;
  sdb: Float64Array;
}

/** 1 km 先の大きさは、聞き手の距離と山に依らないので覚えておく */
const refs = new Map<string, number>();
function refPeak(j: Job, branches: Branch[]): number {
  const key = JSON.stringify([j.ch, { ...j.scene, dist: 0, hillH: 0 }, j.fs]);
  let p = refs.get(key);
  if (p === undefined) {
    const s = { ...j.scene, dist: 1000, hillH: 0 };
    p = render(elements(branches, s), s.air, j.fs).peak;
    if (refs.size > 32) refs.clear();
    refs.set(key, p);
  }
  return p;
}

export function run(j: Job): Reply {
  const branches = makeChannel(j.ch),
    el = elements(branches, j.scene),
    w = render(el, j.scene.air, j.fs),
    t1 = w.t0 + w.y.length / w.fs,
    hist = arrivalHistogram(el, w.t0, t1, j.dt),
    sp = spectrum(w.y, w.fs),
    exz = new Float32Array(2 * el.n);
  let d0 = Number.POSITIVE_INFINITY,
    d1 = 0;
  for (let i = 0; i < el.n; i++) {
    exz[2 * i] = el.xyz[3 * i];
    exz[2 * i + 1] = el.xyz[3 * i + 2];
    if (el.via[i] === Via.Direct) {
      d0 = Math.min(d0, el.t[i]);
      d1 = Math.max(d1, el.t[i]);
    }
  }
  return {
    id: j.id,
    branches,
    first: firstArrival(el),
    y: w.y,
    fs: w.fs,
    t0: w.t0,
    peak: w.peak,
    ref: refPeak(j, branches),
    d0,
    d1,
    hist,
    h0: w.t0,
    dt: j.dt,
    et: el.t,
    exz,
    ev: el.via,
    sf: sp.f,
    sdb: sp.db,
  };
}

/* Worker の中でだけ受け付ける */
if (typeof document === 'undefined' && typeof self !== 'undefined' && 'postMessage' in self)
  self.onmessage = (e: MessageEvent<Job>) => {
    const r = run(e.data);
    postMessage(r, { transfer: [r.y.buffer, r.et.buffer, r.exz.buffer, r.ev.buffer] });
  };
