/**
 * 手持ちの MIDI ファイルを、ヴァイオリンの曲（Piece・PieceData）に直す（DOM に依存しない）。トランペットも使う。
 *  - 同時に始まる音は和音にする（重音・分散和音は演奏の規則に任せる）
 *  - 伸ばした音の上で始まる音は 2 つ目の声部にし、3 つ目からは前の音を次の音の始まりで切る
 *  - スラー: すき間のない音（すき間が前の音の長さの 1 割未満か、重なる音）を、同じ拍の中でだけつなぐ。拍の頭では弓を返す
 *  - 強弱: ベロシティを最も近い強弱記号にし、記号の変わる音にだけ付ける
 */
import { type FNote, fold } from '../../lib/midi-file';
import type { Smf } from '../../lib/smf';
import type { Piece, PieceData } from './score';
import type { ScoreNote } from './scores/types';

/** ヴァイオリンの音域（G3〜E 線の 24 フレット相当の E7） */
export const LO = 55,
  HI = 100;
const EPS = 1e-6;

/** 強弱記号の目安のベロシティ */
const DYN_VEL: readonly (readonly [string, number])[] = [
  ['ppp', 16],
  ['pp', 33],
  ['p', 49],
  ['mp', 64],
  ['mf', 80],
  ['f', 96],
  ['ff', 112],
  ['fff', 127],
];

/** ベロシティに最も近い強弱記号 */
export function dynOf(v: number): string {
  let best = DYN_VEL[0];
  for (const x of DYN_VEL) if (Math.abs(x[1] - v) < Math.abs(best[1] - v)) best = x;
  return best[0];
}

const blank = (t: number, d: number, n: number[]): ScoreNote => ({
  t,
  d,
  n,
  slurOn: false,
  slurOff: false,
  trill: false,
  fermata: false,
});

/** 音を声部（2 つまで）に分ける。1 つ目の声部には強弱記号を付ける */
export function voicesOf(notes: readonly FNote[]): ScoreNote[][] {
  const groups = new Map<number, FNote[]>();
  for (const x of notes) {
    const k = Math.round(x.t * 960),
      g = groups.get(k) ?? [];
    g.push(x);
    groups.set(k, g);
  }
  const vs: ScoreNote[][] = [[], []],
    vel: number[] = [];
  const endOf = (v: ScoreNote[]) => {
    const y = v[v.length - 1];
    return y ? y.t + y.d : -Infinity;
  };
  for (const k of [...groups.keys()].sort((a, b) => a - b)) {
    const g = groups.get(k) ?? [],
      t = g[0].t,
      x = blank(
        t,
        Math.max(...g.map((y) => y.d)),
        [...new Set(g.map((y) => y.n))].sort((a, b) => a - b),
      ),
      v = Math.max(...g.map((y) => y.v));
    if (endOf(vs[0]) <= t + EPS) {
      vs[0].push(x);
      vel.push(v);
    } else if (endOf(vs[1]) <= t + EPS) vs[1].push(x);
    else {
      /* 3 つ目の重なり: 前の音を次の音の始まりで切る */
      const last = vs[0][vs[0].length - 1];
      last.d = t - last.t;
      vs[0].push(x);
      vel.push(v);
    }
  }
  let cur = '';
  vs[0].forEach((x, i) => {
    const d = dynOf(vel[i]);
    if (d !== cur) x.dyn = d;
    cur = d;
  });
  return vs.filter((v, i) => i === 0 || v.length);
}

/** スラーを付ける: すき間のない音を同じ拍の中でだけつなぐ（ひとつながりが 2 音以上のときだけ） */
export function slurs(voice: ScoreNote[]): void {
  let start = 0;
  const close = (end: number) => {
    if (end > start) {
      voice[start].slurOn = true;
      voice[end].slurOff = true;
    }
  };
  for (let i = 1; i < voice.length; i++) {
    const a = voice[i - 1],
      b = voice[i],
      tied = b.t - (a.t + a.d) < 0.1 * a.d && Math.floor(b.t + EPS) === Math.floor(voice[start].t + EPS);
    if (!tied) {
      close(i - 1);
      start = i;
    }
  }
  if (voice.length) close(voice.length - 1);
}

/** 1 拍目からの小節の長さ（なければ 4） */
const firstBar = (smf: Smf) => (smf.starts.length > 1 ? smf.starts[1] - smf.starts[0] : 4);
/** テンポの比の表を、[拍, 4 分音符 / 分] に直す */
export const qpmMapOf = (smf: Smf): [number, number][] => smf.tempo.map(([b, r]) => [b, smf.bpm * r]);

/** 選んだ 1 パートの音 notes を、1 段目の幅 shift で移してヴァイオリンの曲にする */
export function fileSong(
  smf: Smf,
  notes: readonly FNote[],
  shift: number,
  name: string,
): { piece: Piece; data: PieceData } {
  const voices = voicesOf(notes.map((x) => ({ ...x, n: fold(x.n + shift, LO, HI) })));
  for (const v of voices) slurs(v);
  const piece: Piece = {
    v: 'file',
    file: '',
    name,
    by: '',
    qpm: smf.bpm,
    tempo: '',
    meter: firstBar(smf),
    phraseBars: 4,
    marks: true,
    flats: 0,
    ...(smf.tempo.length ? { qpmMap: qpmMapOf(smf) } : {}),
  };
  return { piece, data: { voices, bars: smf.starts.slice(1) } };
}
