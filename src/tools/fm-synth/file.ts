/**
 * 手持ちの MIDI ファイルを、このページの曲（Piece・PieceData）に直す（DOM に依存しない）。
 * どのパートも今の音色で弾くので、音域で移さない。音・長さ・ベロシティはそのまま使う
 */
import type { FilePart } from '../../lib/midi-file';
import type { Smf } from '../../lib/smf';
import type { Piece, PieceData } from './score';

/** 選んだパート parts を曲にする。name は曲の欄に出すファイル名 */
export function fileSong(smf: Smf, parts: readonly FilePart[], name: string): { piece: Piece; data: PieceData } {
  const data: PieceData = {
    notes: parts
      .flatMap((p) => p.notes.map((x) => ({ t: x.t, d: x.d, n: x.n, h: 0, v: x.v })))
      .sort((a, b) => a.t - b.t || a.n - b.n),
    tempo: smf.tempo,
    starts: smf.starts,
  };
  const piece: Piece = {
    v: 'file',
    name,
    by: '',
    bpm: smf.bpm,
    tempo: '',
    bar: smf.starts.length > 1 ? smf.starts[1] - smf.starts[0] : 4,
    pickup: 0,
    load: async () => data,
  };
  return { piece, data };
}
