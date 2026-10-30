/** 波形と分布をメインスレッドの外で計算する（放電路や聞き手を動かすたびに 100 ms ほどかかる） */

import { Reverb } from '../../lib/reverb';
import { type Branch, type ChannelSet, makeChannel, strokeTimes } from './channel';
import { arrivalHistogram, elements, firstArrival, type Scene, Via } from './path';
import { surroundSpec } from './surround';
import { render, spectrum } from './synth';
import { terrainTail } from './terrain';

export interface Job {
  id: number;
  ch: ChannelSet;
  scene: Scene;
  fs: number;
  /** 分布の箱の幅 [s] */
  dt: number;
  /** 周囲の反響（surround.ts の SURROUNDS） */
  env: string;
  /** 地形の反響（terrain.ts の TERRAINS） */
  terrain: string;
}
export interface Reply {
  id: number;
  branches: Branch[];
  /** 放電の時刻 [s]（最初が 0） */
  strokes: number[];
  first: number;
  /** 聞き手の左右の耳の音圧 [Pa]（周囲と地形の反響を含む。反響なしなら同じ） */
  y: Float32Array;
  yr: Float32Array;
  fs: number;
  t0: number;
  /** 響きを足す前の音圧の最大 [Pa] */
  peak: number;
  /** y の絶対値の最大 [Pa] */
  ypk: number;
  /** 鳴らす大きさを決める値 [Pa]: 0.4 s ごとの実効値の最大（100 Hz より上・全帯域） */
  loud: number;
  full: number;
  /** 同じ雷を 1 km 先（山なし）で聞いたときの最大の音圧 [Pa]（大きさを相対の dB で出すため） */
  ref: number;
  /** 直接の音が届き始める時刻と届き終わる時刻 [s] */
  d0: number;
  d1: number;
  /** 分布: 経路ごと、時刻 h0 から dt ごと */
  hist: Float64Array[];
  h0: number;
  dt: number;
  /** 要素の届く時刻 [s]・その放電が光ってからの届く時刻 [s]・中点 x, z [m]・経路（図で放電路を届く時刻で塗る） */
  et: Float64Array;
  er: Float64Array;
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

/**
 * 周囲の反響と地形の反響を足す（左右で響きが違う）。尾の分だけ長くする。
 * 地形の反響は、周囲の反響を足す前の音から作る
 */
function surround(y: Float32Array, fs: number, env: string, terrain: string): [Float32Array, Float32Array] {
  const spec = surroundSpec(env),
    tail = terrainTail(y, fs, terrain);
  if (spec.off && !tail) return [y, y];
  const n = Math.max(y.length + (spec.off ? 0 : Math.ceil((spec.t60 + spec.pre) * fs)), tail ? tail[0].length : 0),
    L = new Float32Array(n),
    R = new Float32Array(n),
    rv = new Reverb(fs);
  L.set(y);
  R.set(y);
  rv.set(spec);
  rv.process(L, R, 0, n);
  if (tail)
    for (let i = 0; i < tail[0].length; i++) {
      L[i] += tail[0][i];
      R[i] += tail[1][i];
    }
  return [L, R];
}

/** 2 次の高域通過（Butterworth）を通した y の、窓 win [s] ごとの実効値の最大 */
function loudness(y: Float32Array, fs: number, fc: number, win: number): number {
  const w = (2 * Math.PI * fc) / fs,
    c = Math.cos(w),
    al = Math.sin(w) / Math.SQRT2,
    a0 = 1 + al,
    b0 = (1 + c) / 2 / a0,
    b1 = -(1 + c) / a0,
    a1 = (-2 * c) / a0,
    a2 = (1 - al) / a0,
    m = Math.max(1, Math.round(win * fs)),
    sq = new Float64Array(y.length);
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = 0; i < y.length; i++) {
    const x = y[i],
      v = fc > 0 ? b0 * x + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2 : x;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = v;
    sq[i] = v * v;
  }
  let acc = 0,
    best = 0;
  for (let i = 0; i < sq.length; i++) {
    acc += sq[i];
    if (i >= m) acc -= sq[i - m];
    if (acc > best) best = acc;
  }
  return Math.sqrt(best / Math.min(m, sq.length));
}

export function run(j: Job): Reply {
  const branches = makeChannel(j.ch),
    el = elements(branches, j.scene),
    w = render(el, j.scene.air, j.fs),
    [y, yr] = surround(w.y, w.fs, j.env, j.terrain),
    t1 = w.t0 + y.length / w.fs,
    hist = arrivalHistogram(el, w.t0, t1, j.dt),
    sp = spectrum(y, w.fs),
    exz = new Float32Array(2 * el.n),
    er = new Float64Array(el.n);
  let d0 = Number.POSITIVE_INFINITY,
    d1 = 0;
  for (let i = 0; i < el.n; i++) {
    exz[2 * i] = el.xyz[3 * i];
    exz[2 * i + 1] = el.xyz[3 * i + 2];
    er[i] = el.t[i] - branches[el.br[i]].t;
    if (el.via[i] === Via.Direct) {
      d0 = Math.min(d0, el.t[i]);
      d1 = Math.max(d1, el.t[i]);
    }
  }
  let ypk = 0;
  for (let i = 0; i < y.length; i++) ypk = Math.max(ypk, Math.abs(y[i]), Math.abs(yr[i]));
  return {
    id: j.id,
    branches,
    strokes: strokeTimes(branches),
    first: firstArrival(el),
    y,
    yr,
    fs: w.fs,
    t0: w.t0,
    peak: w.peak,
    ypk,
    loud: loudness(y, w.fs, 100, 0.4),
    full: loudness(y, w.fs, 0, 0.4),
    ref: refPeak(j, branches),
    d0,
    d1,
    hist,
    h0: w.t0,
    dt: j.dt,
    et: el.t,
    er,
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
    const bufs = [r.y.buffer, r.et.buffer, r.er.buffer, r.exz.buffer, r.ev.buffer];
    if (r.yr !== r.y) bufs.push(r.yr.buffer);
    postMessage(r, { transfer: bufs });
  };
