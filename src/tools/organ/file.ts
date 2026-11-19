/**
 * 手持ちの MIDI ファイルを、オルガンの曲（Piece・PieceData）に直す（DOM に依存しない）。
 * パートごとに選んだ鍵盤（第 1 手鍵盤・第 2 手鍵盤・ペダル）へ入れる。ベロシティは使わない
 */
import { type FilePart, fold, meterOf } from '../../lib/midi-file';
import type { Smf } from '../../lib/smf';
import type { Div, Piece, PieceData, ScoreNote } from './score';
import { divOf } from './stops';

/** 鍵盤 → 譜表（Piece.hands の並び） */
const STAFF: Record<Div, number> = { I: 0, II: 1, P: 2 };

/**
 * 開いたときの鍵盤: 打楽器を除いて第 1 手鍵盤。打楽器でないパートが 2 つ以上あり、平均の高さが最も低いパートの音が
 * 移す前の高さですべてペダルの音域に収まれば、そのパートをペダルにする
 */
export function fileDefaults(parts: readonly FilePart[]): Map<string, Div> {
  const ps = parts.filter((p) => !p.drum),
    m = new Map<string, Div>(ps.map((p) => [p.id, 'I']));
  if (ps.length >= 2) {
    const low = ps.reduce((a, b) => (b.mean < a.mean ? b : a)),
      P = divOf('P');
    if (low.lo >= P.lo && low.hi <= P.hi) m.set(low.id, 'P');
  }
  return m;
}

/** 選んだパートと鍵盤 choice を、1 段目の幅 shift で移してオルガンの曲にする。レジストレーションは呼ぶ側が入れる */
export function fileSong(
  smf: Smf,
  parts: readonly FilePart[],
  choice: ReadonlyMap<string, Div>,
  shift: number,
  name: string,
): { piece: Piece; data: PieceData } {
  const seen = new Set<string>(),
    notes: ScoreNote[] = [];
  for (const p of parts) {
    const div = choice.get(p.id);
    if (!div) continue;
    const { lo, hi } = divOf(div);
    for (const x of p.notes) {
      const n = fold(x.n + shift, lo, hi),
        key = `${div}:${n}:${x.t}`;
      if (seen.has(key)) {
        /* 同じ鍵盤で同時に始まる同じ高さの音は 1 つにまとめ、長い方を残す */
        const y = notes.find((z) => z.h === STAFF[div] && z.n === n && z.t === x.t);
        if (y) y.d = Math.max(y.d, x.d);
        continue;
      }
      seen.add(key);
      notes.push({ t: x.t, d: x.d, n, h: STAFF[div] });
    }
  }
  notes.sort((a, b) => a.t - b.t || a.n - b.n);
  const data: PieceData = { notes, tempo: smf.tempo, meter: meterOf(smf.starts) };
  const piece: Piece = {
    v: 'file',
    name,
    by: '',
    bpm: smf.bpm,
    tempo: '',
    bar: smf.starts.length > 1 ? smf.starts[1] - smf.starts[0] : 4,
    pickup: 0,
    hands: ['I', 'II', 'P'],
    stops: [],
    couplers: [],
    tempoMap: [],
    load: async () => data,
  };
  return { piece, data };
}
