/**
 * 基板の計算のワーカー。1 回の計算に 2〜3 秒かかるため主スレッドで回さない。
 * 進めた分を 0.1 秒ごとに送り、新しい依頼が来たら古い計算をやめる
 */
import { type BoardIn, boardSim } from './board';

export interface BoardReq {
  id: number;
  cfg: BoardIn;
}
export interface BoardChunk {
  id: number;
  /** 初めの 1 回だけ: 銅箔の升・番号 */
  cu?: Uint8Array;
  idx?: Int32Array;
  dl: number;
  tEff: number;
  times: number[];
  frames: Float32Array[];
  R: number[];
  Ion: number[];
  maxT: number[];
  bal: { gen: number; conv: number; rad: number; term: number }[];
  cutAt: Float64Array;
  tOpen: number | null;
  tOff: number | null;
  V: Float64Array;
  sq: Float64Array;
  t: number;
  done: boolean;
}

let cur = 0;
self.onmessage = (e: MessageEvent<BoardReq>) => {
  const { id, cfg } = e.data;
  cur = id;
  const s = boardSim(cfg);
  let sent = 0,
    first = true;
  const tick = () => {
    if (cur !== id) return;
    s.step(100);
    const c: BoardChunk = {
      id,
      dl: s.dl,
      tEff: s.tEff,
      times: s.times.slice(sent),
      frames: s.frames.slice(sent),
      R: s.R.slice(sent),
      Ion: s.Ion.slice(sent),
      maxT: s.maxT.slice(sent),
      bal: s.bal.slice(sent),
      cutAt: Float64Array.from(s.cutAt),
      tOpen: s.tOpen,
      tOff: s.tOff,
      V: Float64Array.from(s.V),
      sq: Float64Array.from(s.sq),
      t: s.t,
      done: s.done,
    };
    if (first) {
      c.cu = s.cu;
      c.idx = s.idx;
      first = false;
    }
    sent = s.times.length;
    (self as unknown as Worker).postMessage(c);
    if (!s.done) setTimeout(tick, 0);
  };
  tick();
};
