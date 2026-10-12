/**
 * 全開のトルクの曲線を求める Worker（主スレッドを止めないため）。回転数を保ったまま全開で回し、
 * 24 サイクル回して最後の 8 サイクルの正味トルクを平均する（排気管の波が落ち着くまで待つ）
 */
import { EngineSim } from './engine';
import { type EngineId, type MufflerId, specOf } from './spec';

export interface CurveJob {
  id: number;
  eng: EngineId;
  muf: MufflerId;
  /** 燃料を切る回転数 [rpm]（曲線の右端） */
  cut: number;
}
export interface CurveReply {
  id: number;
  rpm: number[];
  torque: number[];
}

const FS = 48000;

/** 全開・回転数 rpm の正味トルク [N·m] */
export function torqueAt(eng: EngineId, muf: MufflerId, rpm: number): number {
  const e = new EngineSim(specOf(eng, muf), FS, rpm);
  e.mode = 'hold';
  e.throttle = 1;
  e.cutRpm = 1e9;
  const n = Math.round((FS * 120 * 24) / rpm),
    t: number[] = [];
  let c = e.last;
  for (let i = 0; i < n; i++) {
    e.step();
    if (e.last !== c && e.last) {
      c = e.last;
      t.push(c.torque);
    }
  }
  const l = t.slice(-8);
  return l.reduce((s, v) => s + v, 0) / l.length;
}

const scope = globalThis as unknown as {
  onmessage: ((e: MessageEvent<CurveJob>) => void) | null;
  postMessage: (m: CurveReply) => void;
};
scope.onmessage = (e) => {
  const j = e.data,
    rpm: number[] = [],
    torque: number[] = [];
  for (let r = 1500; r <= Math.min(9000, j.cut); r += 250) {
    rpm.push(r);
    torque.push(torqueAt(j.eng, j.muf, r));
  }
  scope.postMessage({ id: j.id, rpm, torque });
};
