/**
 * MIDI ファイルの音からコード進行を推す（DOM に依存しない）。
 * 調は小節ごとに前後 8 小節の音名の量を Krumhansl–Kessler の調の表と比べ、変わるたびに罰点を付けて最もよい並びを選ぶ。
 * 和音は小節（4 拍以上の偶数拍の小節は半分ずつ）ごとに、鳴っている音名の量と和音の型を比べる。
 * 根音に低い音があれば加点し、調の中の和音にも少し加点する。和音が変わるたびに罰点を付けて最もよい並びを選ぶ
 */
import type { FNote } from '../../lib/midi-file';
import { nearestPlace, newId, type Place, type SChord } from './song';
import { inKey, type Key, md, QUALS, type Qual } from './theory';

/** 推した和音 1 つ。b・e は拍（4 分音符が 1） */
export interface Seg {
  b: number;
  e: number;
  r: number;
  q: Qual;
  key: Key;
}

/** 調の表（長調・短調。主音から 0〜11 半音の重み） */
const KK = {
  maj: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
  min: [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
} as const;
/** 調を推す範囲: 前 KEY_BACK 小節から後ろ KEY_AHEAD 小節まで */
const KEY_BACK = 3,
  KEY_AHEAD = 4;
/** 調が変わるときの罰点（相関係数の単位） */
const KEY_SWITCH = 0.8;
/** 比べる和音の型と、その型の事前の加点（よく使う型ほど大きい） */
const CANDS: readonly (readonly [Qual, number])[] = [
  ['M', 0],
  ['m', 0],
  ['7', -0.08],
  ['m7', -0.1],
  ['M7', -0.12],
  ['dim', -0.15],
  ['m7b5', -0.18],
  ['sus4', -0.2],
  ['dim7', -0.22],
  ['aug', -0.3],
];
/** 和音が変わるときの罰点 */
const CHORD_SWITCH = 0.08;
/** 型の音のうち、ほとんど鳴っていない音 1 つあたりの罰点 */
const MISS = 0.12;
/** 根音がいちばん低い音のときの加点 */
const BASS = 0.12;
/** 調の中の和音の加点 */
const IN_KEY = 0.05;

const corr = (a: readonly number[], b: readonly number[]): number => {
  const ma = a.reduce((s, x) => s + x, 0) / 12,
    mb = b.reduce((s, x) => s + x, 0) / 12;
  let n = 0,
    da = 0,
    db = 0;
  for (let i = 0; i < 12; i++) {
    n += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da > 0 && db > 0 ? n / Math.sqrt(da * db) : 0;
};

/** 区間 [b, e) に鳴っている音の音名ごとの量（重なる長さ × ベロシティ）と、いちばん低い音 */
function chroma(notes: readonly FNote[], b: number, e: number): { w: number[]; low: number } {
  const w = new Array<number>(12).fill(0);
  let low = 999;
  for (const x of notes) {
    if (x.t >= e) break;
    const o = Math.min(e, x.t + x.d) - Math.max(b, x.t);
    if (o <= 0) continue;
    /* 区間の中で鳴り始めた音は、前から伸びている音より少し重く見る */
    w[x.n % 12] += o * (x.v / 127) * (x.t >= b - 1e-6 ? 1.2 : 1);
    low = Math.min(low, x.n);
  }
  return { w, low };
}

/** 最もよい並び（Viterbi）。score[s][c] は区間 s で候補 c を選んだときの点、sw は候補が変わるときの罰点 */
function viterbi(score: readonly (readonly number[])[], sw: number): number[] {
  if (!score.length) return [];
  const C = score[0].length,
    back: Int32Array[] = [];
  let prev = score[0].slice();
  for (let s = 1; s < score.length; s++) {
    let bi = 0;
    for (let c = 1; c < C; c++) if (prev[c] > prev[bi]) bi = c;
    const cur = new Array<number>(C),
      bk = new Int32Array(C);
    for (let c = 0; c < C; c++) {
      const stay = prev[c],
        move = prev[bi] - sw;
      if (stay >= move) {
        cur[c] = stay + score[s][c];
        bk[c] = c;
      } else {
        cur[c] = move + score[s][c];
        bk[c] = bi;
      }
    }
    back.push(bk);
    prev = cur;
  }
  let last = 0;
  for (let c = 1; c < C; c++) if (prev[c] > prev[last]) last = c;
  const path = [last];
  for (let s = back.length - 1; s >= 0; s--) path.unshift(back[s][path[0]]);
  return path;
}

const KEYS: readonly Key[] = [...Array(24)].map((_, i) => ({ t: i % 12, m: i < 12 ? 'maj' : 'min' }));

/** 小節ごとの調。starts は小節の頭の拍、end は曲の終わりの拍 */
export function keysOf(notes: readonly FNote[], starts: readonly number[], end: number): Key[] {
  const n = starts.length;
  if (!n) return [];
  const bars = starts.map((b, k) => chroma(notes, b, starts[k + 1] ?? end).w),
    score = bars.map((_, k) => {
      const w = new Array<number>(12).fill(0);
      for (let j = Math.max(0, k - KEY_BACK); j <= Math.min(n - 1, k + KEY_AHEAD); j++)
        for (let i = 0; i < 12; i++) w[i] += bars[j][i];
      return KEYS.map((key) => {
        const p = KK[key.m];
        return corr(
          w,
          p.map((_, i) => p[md(i - key.t)]),
        );
      });
    });
  return viterbi(score, KEY_SWITCH).map((c) => KEYS[c]);
}

/** 和音を推す区間: 4 拍以上の偶数拍の小節は半分ずつ、ほかは 1 小節 */
function slots(starts: readonly number[], end: number): { b: number; e: number; bar: number }[] {
  const out: { b: number; e: number; bar: number }[] = [];
  starts.forEach((b, k) => {
    const e = starts[k + 1] ?? end,
      len = e - b;
    if (len <= 0) return;
    if (len >= 4 && Math.abs(len / 2 - Math.round(len / 2)) < 1e-6) {
      out.push({ b, e: b + len / 2, bar: k }, { b: b + len / 2, e, bar: k });
    } else out.push({ b, e, bar: k });
  });
  return out;
}

/**
 * コード進行を推す。notes は解析に使うパートの音（開始の順）。
 * 音のない区間は前の和音を伸ばす（曲の頭の休みは最初の和音に含める）。続く同じ和音はまとめる
 */
export function analyze(notes: readonly FNote[], starts: readonly number[], end: number): Seg[] {
  const ns = [...notes].sort((a, b) => a.t - b.t),
    keys = keysOf(ns, starts, end),
    sl = slots(starts, end),
    cands: { r: number; q: Qual; iv: readonly number[]; prior: number }[] = [];
  for (let r = 0; r < 12; r++) for (const [q, prior] of CANDS) cands.push({ r, q, iv: QUALS[q].iv, prior });
  const empty = sl.map(() => false),
    score = sl.map((s, k) => {
      const { w, low } = chroma(ns, s.b, s.e),
        tot = w.reduce((a, x) => a + x, 0),
        key = keys[s.bar];
      if (tot <= 0) {
        empty[k] = true;
        return cands.map(() => 0);
      }
      return cands.map((c) => {
        let inS = 0,
          miss = 0;
        for (const i of c.iv) {
          const x = w[(c.r + i) % 12];
          inS += x;
          if (x < tot * 0.04) miss++;
        }
        let v = inS / tot - MISS * miss + c.prior;
        if (low < 999 && low % 12 === c.r) v += BASS;
        if (inKey({ d: md(c.r - key.t), q: c.q, inv: 0 }, key)) v += IN_KEY;
        return v;
      });
    });
  const first = empty.indexOf(false);
  if (first < 0) return [];
  /* 音のない区間は前の和音を伸ばし、曲の頭の休みは最初の和音にする */
  const path = viterbi(score, CHORD_SWITCH);
  for (let k = 0; k < path.length; k++) if (empty[k]) path[k] = k < first ? path[first] : path[k - 1];
  const out: Seg[] = [];
  sl.forEach((s, k) => {
    const c = cands[path[k]],
      key = keys[s.bar],
      last = out[out.length - 1];
    if (last && last.r === c.r && last.q === c.q && last.key.t === key.t && last.key.m === key.m) last.e = s.e;
    else out.push({ b: s.b, e: s.e, r: c.r, q: c.q, key });
  });
  if (out.length) out[0].b = 0;
  return out;
}

/** 推した和音を曲の和音の並びにする。地図の三角形は前の和音に近い所、調が変わる和音には転調を付ける */
export function chordsOf(segs: readonly Seg[]): { key: Key; chords: SChord[] } {
  let prev: Place | null = null,
    key: Key = segs[0]?.key ?? { t: 0, m: 'maj' };
  const first = key,
    chords = segs.map((s, k): SChord => {
      const at = nearestPlace(s.r, s.q, prev),
        mod = k > 0 && (s.key.t !== key.t || s.key.m !== key.m) ? s.key : null;
      if (mod) key = mod;
      prev = at;
      return { id: newId(), r: s.r, q: s.q, b: s.e - s.b, at, mod };
    });
  return { key: first, chords };
}
