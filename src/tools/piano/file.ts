/**
 * 手持ちの MIDI ファイルを、ピアノの曲（Piece・PieceData）に直す（DOM に依存しない）。
 * 音・長さ・ベロシティはそのまま使い、CC 64 があればペダルの記録にする。右手と左手は C4 で分ける
 */
import { type FilePart, fold, meterOf } from '../../lib/midi-file';
import { CC, type Smf } from '../../lib/smf';
import type { Piece, PieceData, ScoreNote } from './score';

/** ピアノの音域（A0〜C8） */
export const LO = 21,
  HI = 108;
/** 右手と左手を分ける高さ（C4） */
const SPLIT = 60;

/** 選んだパート parts を、1 段目の幅 shift で移してピアノの曲にする。name は曲の欄に出すファイル名 */
export function fileSong(
  smf: Smf,
  parts: readonly FilePart[],
  shift: number,
  name: string,
): { piece: Piece; data: PieceData } {
  const one = parts.length === 1,
    notes: ScoreNote[] = parts
      .flatMap((p) =>
        p.notes.map((x) => ({
          t: x.t,
          d: x.d,
          n: fold(x.n + shift, LO, HI),
          h: (one ? x.n : p.mean) >= SPLIT ? 0 : 1,
          v: x.v,
        })),
      )
      .sort((a, b) => a.t - b.t || a.n - b.n);
  /* ペダル: 選んだパートのトラックとチャンネルの CC 64（64 以上で踏む）。同じ状態が続く出来事は捨てる */
  const ids = new Set(parts.map((p) => p.id)),
    pedal: [number, number][] = [];
  for (const e of smf.ev) {
    if (e.k !== CC || e.a !== 64 || !ids.has(`${e.tr}:${e.ch}`)) continue;
    const on = e.v >= 64 ? 1 : 0;
    if ((pedal[pedal.length - 1]?.[1] ?? 0) !== on) pedal.push([e.b, on]);
  }
  const data: PieceData = {
    notes,
    tempo: smf.tempo,
    meter: meterOf(smf.starts),
    ...(pedal.length ? { pedal } : {}),
  };
  const piece: Piece = {
    v: 'file',
    name,
    by: '',
    bpm: smf.bpm,
    tempo: '',
    bar: smf.starts.length > 1 ? smf.starts[1] - smf.starts[0] : 4,
    pickup: 0,
    lv: 1,
    tempoMap: [],
    load: async () => data,
  };
  return { piece, data };
}
