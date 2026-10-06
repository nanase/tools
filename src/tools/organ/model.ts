/**
 * オルガン 1 台の模型（DOM に依存しない）: ストップと鍵から管を作って調律した結果（tuner.ts が Worker で作る）を、
 * 音を作る部分へ渡す形と、図・計算結果に出す形にまとめる
 */
import type { PipeMsg } from './engine';
import type { PipeGeo } from './keys';
import { AIR, CP, FluePipe, type FlueSpec, ReedPipe, type ReedSpec } from './pipes';
import { divOf, type Stop, stopOf } from './stops';
import type { Voiced } from './voice';

/** オルガンの設定（調律に効くもの） */
export interface OrganSpec {
  /** 調律法と A4 [Hz] */
  temp: string;
  a4: number;
  /** ストップごとの整音の上書き（スケールの偏差 [半音]・カットアップ ÷ 口の幅） */
  voicing: Record<string, { scale?: number; cut?: number }>;
}

/** 調律した管 */
export interface Tuned extends Voiced {
  id: string;
  stop: string;
  key: number;
  rank: number;
}

/** 管の番号 */
export const pipeId = (stop: string, key: number, rank: number): string => `${stop}:${key}:${rank}`;

/** 音を作る部分へ渡す形 */
export const pipeMsg = (t: Tuned, pan: number): PipeMsg => ({
  id: t.id,
  chest: divOf(stopOf(t.stop).div).chest,
  kind: t.kind,
  spec: t.spec,
  pan,
});

/** 管の形（図に描く） */
export function geoOf(t: Tuned): PipeGeo {
  if (t.kind === 'flue') {
    const s = t.spec as FlueSpec;
    return { l: s.l, d: s.d, kind: s.stopped ? 'stopped' : 'open' };
  }
  const s = t.spec as ReedSpec;
  return { l: s.L, d: s.d1, d0: s.d0, kind: s.bore };
}

/** 計算結果に出す値。chest は風箱の圧力 [Pa] */
export function flueView(t: Tuned, chest: number) {
  const s = t.spec as FlueSpec,
    info = new FluePipe(s, 48000).info,
    pFoot = chest * s.toe,
    Uj = Math.sqrt((2 * pFoot) / AIR.rho);
  return { s, pFoot, Uj, tau: s.W / (CP * Uj), theta: Uj / (t.fMeas * s.W), M: info.M, Lac: info.Lac };
}
export function reedView(t: Tuned) {
  const s = t.spec as ReedSpec,
    info = new ReedPipe(s, 48000).info;
  return { s, fRes: info.fRes, pc: info.pc };
}

/**
 * 管の定位（−1 が左、1 が右）。鍵盤ごとに受け持つ幅を決め、風箱の上で C 側と C♯ 側（全音ずつ）に左右へ分け、
 * 低い管を外側に置く（オルガンの管の並べ方の目安。模型には基づかない）
 */
export function panOf(s: Stop, key: number, rank: number): number {
  const d = divOf(s.div),
    u = (key - d.lo) / Math.max(1, d.hi - d.lo),
    side = key % 2 ? 1 : -1,
    spread = s.div === 'P' ? 0.85 : s.div === 'II' ? 0.35 : 0.6,
    center = s.div === 'II' ? 0.1 : 0;
  return center + side * spread * (1 - 0.8 * u) + 0.03 * rank * side;
}
