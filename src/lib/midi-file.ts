/**
 * MIDI ファイルを楽器のページで演奏するための共通の処理（DOM に依存しない）。
 * ファイルの音をトラックとチャンネルの組（パート）に分け、楽器の音域へオクターブ単位で移す。
 * 移し方は 2 段: 選んだパート全体を同じ幅で移して最も多くの音を音域に入れ、それでも外れた音だけを 1 オクターブずつ寄せる
 */
import { GM_NAMES } from '../tools/fm-synthesizer/gm';
import { OFF, ON, PC, type Smf } from './smf';

/** パートの音: 開始と長さ（4 分音符を 1 とする拍）、ノート番号、ベロシティ（1〜127） */
export interface FNote {
  t: number;
  d: number;
  n: number;
  v: number;
}

/** パート: 1 つのトラックの 1 つのチャンネルの音 */
export interface FilePart {
  /** `${tr}:${ch}` */
  id: string;
  tr: number;
  /** 0〜15（9 が打楽器） */
  ch: number;
  name: string;
  drum: boolean;
  /** 開始の順 */
  notes: FNote[];
  /** いちばん低い音・高い音・平均の高さ */
  lo: number;
  hi: number;
  mean: number;
}

const DRUM_CH = 9;

/** 音のあるパートを、トラック → チャンネルの順に返す。名前はトラック名、なければ GM の音色名（打楽器は「打楽器」） */
export function partsOf(smf: Smf): FilePart[] {
  const parts = new Map<string, FilePart>(),
    prog = new Map<string, number>(),
    open = new Map<string, FNote[]>();
  for (const e of smf.ev) {
    const id = `${e.tr}:${e.ch}`;
    if (e.k === PC) {
      if (!prog.has(id)) prog.set(id, e.a);
      continue;
    }
    const key = `${id}:${e.a}`;
    if (e.k === ON) {
      let p = parts.get(id);
      if (!p) {
        p = { id, tr: e.tr, ch: e.ch, name: '', drum: e.ch === DRUM_CH, notes: [], lo: 127, hi: 0, mean: 0 };
        parts.set(id, p);
      }
      const x = { t: e.b, d: 1, n: e.a, v: e.v };
      p.notes.push(x);
      const l = open.get(key) ?? [];
      l.push(x);
      open.set(key, l);
    } else if (e.k === OFF) {
      const x = open.get(key)?.shift();
      if (x) x.d = Math.max(0, e.b - x.t);
    }
  }
  const out = [...parts.values()].sort((a, b) => a.tr - b.tr || a.ch - b.ch);
  for (const p of out) {
    p.name = p.drum ? '打楽器' : smf.names[p.tr] || GM_NAMES[prog.get(p.id) ?? 0];
    let s = 0;
    for (const x of p.notes) {
      p.lo = Math.min(p.lo, x.n);
      p.hi = Math.max(p.hi, x.n);
      s += x.n;
    }
    p.mean = s / p.notes.length;
  }
  return out;
}

/** 音域に収まる音の数 */
const inside = (notes: readonly FNote[], lo: number, hi: number, sh: number) =>
  notes.reduce((c, x) => c + (x.n + sh >= lo && x.n + sh <= hi ? 1 : 0), 0);

/**
 * 1 段目の幅 [半音]: −48〜+48 の 12 の倍数で、音域に入る音の数が最も多いもの。
 * 同じ数なら移す幅の小さい方、さらに同じなら上へ移す方。groups はパートごとの音と、そのパートを弾く音域
 */
export function octaveShift(groups: readonly { notes: readonly FNote[]; lo: number; hi: number }[]): number {
  let best = 0,
    bestN = -1;
  for (const sh of [0, 12, -12, 24, -24, 36, -36, 48, -48]) {
    const n = groups.reduce((c, g) => c + inside(g.notes, g.lo, g.hi, sh), 0);
    if (n > bestN) {
      best = sh;
      bestN = n;
    }
  }
  return best;
}

/** 2 段目: 外れた音を 1 オクターブずつ音域へ寄せる（音域が 1 オクターブより狭く、入らなければ端に寄せる） */
export function fold(n: number, lo: number, hi: number): number {
  let x = n;
  while (x < lo) x += 12;
  while (x > hi) x -= 12;
  return x < lo ? lo : x;
}

/** 1 段目で移した後に音域に収まる割合 */
export function fitRatio(notes: readonly FNote[], lo: number, hi: number): number {
  if (!notes.length) return 0;
  return inside(notes, lo, hi, octaveShift([{ notes, lo, hi }])) / notes.length;
}

/** 1 パートしか弾けない楽器の既定のパート: 打楽器を除き、収まる割合が最も高いもの。同じなら平均の高さが高いもの（旋律を優先） */
export function pickSingle(parts: readonly FilePart[], lo: number, hi: number): string | null {
  let best: FilePart | null = null,
    bestR = -1;
  for (const p of parts) {
    if (p.drum) continue;
    const r = fitRatio(p.notes, lo, hi);
    if (r > bestR + 1e-9 || (Math.abs(r - bestR) <= 1e-9 && best && p.mean > best.mean)) {
      best = p;
      bestR = r;
    }
  }
  return best?.id ?? null;
}

/** 移した幅の文（移さないときは ''） */
export function shiftLabel(semi: number): string {
  if (!semi) return '';
  return `${Math.abs(semi / 12)} オクターブ${semi > 0 ? '上げて' : '下げて'}演奏`;
}

/**
 * 小節の頭の拍（Smf.starts）から、拍子の変化 [拍, 1 小節の拍の数] を作る。
 * 最後の小節は途中で終わることがあるので、その前の小節の長さ（なければ 4）とする
 */
export function meterOf(starts: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < starts.length; i++) {
    const len = i + 1 < starts.length ? starts[i + 1] - starts[i] : (out[out.length - 1]?.[1] ?? 4);
    if (!out.length || Math.abs(out[out.length - 1][1] - len) > 1e-6) out.push([starts[i], len]);
  }
  return out;
}
