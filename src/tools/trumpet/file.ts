/**
 * 手持ちの MIDI ファイルを、トランペットの曲（Piece・PieceData）に直す（DOM に依存しない）。
 * トランペットは 1 音ずつなので、同時に始まる音はいちばん高い音だけを残し、重なる音は前の音を次の音の始まりで切る。
 * スラーと強弱はヴァイオリン（violin/file.ts）と同じ規則で付ける。拍の頭では舌で区切る
 */
import { type FNote, fold } from '../../lib/midi-file';
import type { Smf } from '../../lib/smf';
import { dynOf, qpmMapOf, slurs } from '../violin/file';
import { HIGH, LOW } from './notes';
import type { Piece, PieceData } from './score';
import type { ScoreNote } from './scores/types';

const EPS = 1e-6;

/** 1 音ずつにする: 同時に始まる音は最も高い音、重なる音は前の音を次の音の始まりで切る */
export function monophonic(notes: readonly FNote[]): FNote[] {
  const out: FNote[] = [];
  for (const x of [...notes].sort((a, b) => a.t - b.t || b.n - a.n)) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.t - x.t) < EPS) continue;
    if (last && last.t + last.d > x.t + EPS) last.d = x.t - last.t;
    out.push({ ...x });
  }
  return out;
}

/** 1 音ずつの音を楽譜の音にし、スラーと強弱記号を付ける */
export function voiceOf(notes: readonly FNote[]): ScoreNote[] {
  let cur = '';
  const v = monophonic(notes).map((x): ScoreNote => {
    const d = dynOf(x.v),
      y: ScoreNote = {
        t: x.t,
        d: x.d,
        n: x.n,
        slurOn: false,
        slurOff: false,
        trill: false,
        fermata: false,
        stacc: false,
        accent: false,
        tenuto: false,
        ...(d !== cur ? { dyn: d } : {}),
      };
    cur = d;
    return y;
  });
  slurs(v);
  return v;
}

/** 選んだ 1 パートの音 notes を、1 段目の幅 shift で移してトランペットの曲にする */
export function fileSong(
  smf: Smf,
  notes: readonly FNote[],
  shift: number,
  name: string,
): { piece: Piece; data: PieceData } {
  const voice = voiceOf(notes.map((x) => ({ ...x, n: fold(x.n + shift, LOW, HIGH) })));
  const piece: Piece = {
    v: 'file',
    file: '',
    name,
    by: '',
    qpm: smf.bpm,
    tempo: '',
    meter: smf.starts.length > 1 ? smf.starts[1] - smf.starts[0] : 4,
    phraseBars: 4,
    flats: 0,
    marks: true,
    license: 'pd',
    ...(smf.tempo.length ? { qpmMap: qpmMapOf(smf) } : {}),
  };
  /* 演奏の位置の欄は最初の音を頭とするので、それより前の小節線（パートが途中から入るとき）は捨てる */
  const head = voice[0]?.t ?? 0;
  return { piece, data: { voices: [voice], bars: smf.starts.filter((b) => b > head + EPS) } };
}
