/**
 * 曲の演奏の規則（DOM に依存しない）: 楽譜の音（1 声部）を、奏者（player.ts）が吹く音の列にする。
 *  - 時刻: 拍ごとにテンポと楽句の弧を掛けて秒にする。楽句の終わりで少し延ばし、曲の終わりの 2 拍を遅くする
 *    （Friberg ほか 2006 の Phrase arch・Punctuation・Final ritardando）。フェルマータは音を 1.75 倍に延ばす
 *  - 長さ: スラーの中は次の音までつなぎ、舌で区切る音は楽譜の長さの 0.85 倍、スタッカートは 0.5 倍、テヌートは 0.97 倍
 *  - 息継ぎ: 楽句の終わりで休符もスラーもなく次の音へ続くときは、音を短くして息を吸う間を作る
 *  - 強弱: 楽譜の記号と松葉（または曲ごとの予定）に、楽句の弧と、高い音ほど大きく（High loud）を足す。
 *    dB（mf = 0）を、奏者の強弱（0 = pp 〜 1 = ff）に直す。行き先の記号のない松葉は、その間だけ ±4 dB 動いて元の段へ戻る
 *  - 舌: アクセントとスタッカートは「タ」、弱い音・テヌート・遅い曲は「ダ」。同じ高さの音へのスラーはタイとしてつなぐ
 *  - トリル: 調号に合わせた上の隣の音から、1 秒に 8 音で音の 3/4 まで交互に吹き、残りを元の音で延ばす
 *  - 舌で吹き始める音の出だしを少しばらつかせる（Noise の規則）
 */
import { DYN_DB, keyAlt, upperNeighbor } from '../violin/perform';
import { HIGH, LOW } from './notes';
import type { PNote } from './player';
import type { Piece, PieceData } from './score';
import type { ScoreNote } from './scores/types';

/** 表情: 楽譜どおり（テンポと強弱の目安だけ）か、楽句の弧と揺らぎを付けるか */
export type Expr = 'plain' | 'phrase';

export interface Performance {
  notes: PNote[];
  /** 秒 → 拍、拍 → 秒（曲の頭を 0 s とする） */
  beatAt: (sec: number) => number;
  secAt: (beat: number) => number;
}

/** 最初の音の前の時間 [s] */
const LEAD = 0.3;
/** 舌で区切る音・スタッカート・テヌートの長さの割合 */
const R_TONGUE = 0.85,
  R_STACC = 0.5,
  R_TEN = 0.97;
/** 鳴らす長さの下限 [s]、舌で区切るときの音の間の下限 [s] */
const D_MIN = 0.05,
  GAP_MIN = 0.02;
/** 息を吸う間 [s]（音の長さの 1/3 まで） */
const BREATH = 0.16;
/** 強弱 dB（mf = 0）→ 奏者の強弱（pp −12 dB が 0.04、mf 0 dB が 0.55、ff +9 dB が 0.97。params.ts の DYNS に合わせた） */
export const dynOfDb = (db: number): number => Math.min(1, Math.max(0.03, 0.55 + (db < 0 ? 0.0425 : 0.047) * db));

/**
 * 楽譜の強弱の記号と松葉から、拍 b の強弱 [dB（mf = 0）] を返す関数を作る。記号のところでは 0.25 拍かけて段を移る。
 * 松葉は、終わりから 1 拍以内に記号があればその段へ直線で移り、なければ松葉の間に ±4 dB 動いて、終わりから 0.5 拍で元の段へ戻る
 */
export function levelOfMarks(ns: readonly ScoreNote[]): (b: number) => number {
  const marks: [number, number][] = [];
  for (const x of ns) if (x.dyn && DYN_DB[x.dyn] !== undefined) marks.push([x.t, DYN_DB[x.dyn]]);
  const base = (b: number): number => {
    let v = 0;
    for (const [t, db] of marks) {
      if (b >= t) v = db;
      else {
        if (b > t - 0.25) v += ((db - v) * (b - (t - 0.25))) / 0.25;
        break;
      }
    }
    return v;
  };
  /* 松葉: 始まり、終わり、向き、行き先の記号の段（なければ null） */
  const hp: { ts: number; te: number; dir: number; to: number | null }[] = [];
  let open: { ts: number; dir: number } | null = null;
  const close = (te: number) => {
    const o = open;
    if (!o) return;
    const m = marks.find(([t]) => t > o.ts + 1e-6 && t <= te + 1 + 1e-6);
    hp.push({ ts: o.ts, te: Math.max(o.ts + 0.25, m ? m[0] : te), dir: o.dir, to: m ? m[1] : null });
    open = null;
  };
  for (const x of [...ns].sort((a, b) => a.t - b.t)) {
    if (x.hair === '<' || x.hair === '>') {
      close(x.t);
      open = { ts: x.t, dir: x.hair === '<' ? 1 : -1 };
    } else if (x.hair === '!') close(x.t + x.d);
  }
  return (b: number): number => {
    for (const h of hp) {
      if (b < h.ts || b > h.te + 0.5) continue;
      const v0 = base(h.ts),
        goal = h.to ?? v0 + 4 * h.dir;
      if (b <= h.te) return v0 + ((goal - v0) * (b - h.ts)) / (h.te - h.ts);
      if (h.to === null) return goal + ((base(b) - goal) * (b - h.te)) / 0.5;
    }
    return base(b);
  };
}

/** スラーで同じ高さの音へ休みなく続く音（タイ）を 1 つの音にまとめる */
function mergeTies(src: readonly ScoreNote[]): ScoreNote[] {
  const out: ScoreNote[] = [];
  let inSlur = false;
  for (const x of src) {
    const p = out[out.length - 1];
    if (p && inSlur && !p.slurOff && p.n === x.n && x.t <= p.t + p.d + 1e-6) {
      out[out.length - 1] = { ...p, d: x.t + x.d - p.t, slurOff: x.slurOff, fermata: p.fermata || x.fermata };
    } else out.push(x);
    if (x.slurOn) inSlur = true;
    if (x.slurOff) inSlur = false;
  }
  return out;
}

/** 楽句の弧: x ∈ [0,1] で 0 から上がり、0.65 で最大 1、1 で 0 に戻る（頂点を後ろに寄せた正弦） */
const arch = (x: number) => Math.sin(Math.PI * Math.min(1, Math.max(0, x)) ** 1.61);

/** 折れ線 [x, y] の x での値 */
function lin(pl: readonly (readonly [number, number])[], x: number): number {
  if (x <= pl[0][0]) return pl[0][1];
  for (let i = 1; i < pl.length; i++)
    if (x <= pl[i][0]) {
      const [x0, y0] = pl[i - 1],
        [x1, y1] = pl[i];
      return x1 > x0 ? y0 + ((y1 - y0) * (x - x0)) / (x1 - x0) : y1;
    }
  return pl[pl.length - 1][1];
}

/** 音域に入るように、オクターブを移す */
const inRange = (n: number): number => {
  while (n < LOW) n += 12;
  while (n > HIGH) n -= 12;
  return n;
};

export function performPiece(pc: Piece, data: PieceData, tempo: number, expr: Expr): Performance {
  const phrase = expr === 'phrase',
    raw: ScoreNote[] = [...(data.voices[0] ?? [])].sort((a, b) => a.t - b.t),
    src = mergeTies(raw);
  if (!src.length) return { notes: [], beatAt: () => 0, secAt: () => 0 };
  const qpm = pc.qpm * tempo,
    b0 = src[0].t,
    bEnd = Math.max(...src.map((x) => x.t + x.d)),
    pLen = pc.phraseBars * pc.meter,
    pOff = data.bars.length ? ((data.bars[0] % pc.meter) + pc.meter) % pc.meter : 0,
    /** 拍 b の楽句の中の位置（0〜1） */
    phraseX = (b: number) => ((((b - pOff) % pLen) + pLen) % pLen) / pLen;

  /* ---------- 時刻: 拍 → 秒の表（1/48 拍ごと）。楽句の弧で中ほどを速く、終わりの 2 拍を遅く ---------- */
  const DB = 1 / 48,
    nb = Math.ceil((bEnd - b0) / DB) + 1,
    secs = new Float64Array(nb + 1),
    speed = (b: number): number => {
      let k = 1;
      if (phrase) k *= 1 + 0.04 * (arch(phraseX(b)) - 0.5);
      if (bEnd - b < 2) k *= 1 - 0.25 * (1 - (bEnd - b) / 2);
      return k;
    };
  secs[0] = LEAD;
  for (let i = 1; i <= nb; i++) secs[i] = secs[i - 1] + (60 / qpm / speed(b0 + (i - 0.5) * DB)) * DB;
  /* 止まる時間: フェルマータ（音の 0.75 倍）、楽句の終わり（表情を付けるとき 0.06 s） */
  const pauses: [number, number][] = [];
  const base = (b: number): number => {
    const x = Math.min(nb, Math.max(0, (b - b0) / DB)),
      i = Math.min(nb - 1, Math.floor(x));
    return secs[i] + (secs[i + 1] - secs[i]) * (x - i);
  };
  for (const x of src) if (x.fermata) pauses.push([x.t + x.d, 0.75 * (base(x.t + x.d) - base(x.t))]);
  if (phrase) for (let b = pOff + pLen; b < bEnd - 1e-6; b += pLen) if (b > b0 + 1e-6) pauses.push([b, 0.06]);
  pauses.sort((a, b) => a[0] - b[0]);
  const secAt = (b: number): number => {
    let s = base(b);
    for (const [pb, ps] of pauses) if (pb <= b + 1e-9) s += ps;
    return s;
  };
  const beatAt = (sec: number): number => {
    let lo = b0,
      hi = bEnd;
    if (sec <= secAt(lo)) return lo;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (secAt(mid) <= sec) lo = mid;
      else hi = mid;
    }
    return lo;
  };

  /* ---------- 強弱 [dB（mf = 0）] ---------- */
  const plan = pc.plan ?? [[0, 0]],
    marks = pc.marks ? levelOfMarks(raw) : null,
    level = (b: number, n: number): number => {
      let db = marks ? marks(b) : lin(plan, b);
      if (phrase) db += 2 * arch(phraseX(b)) - 1 + (1.5 * (n - 70)) / 12;
      return db;
    };

  /* ---------- 音 ---------- */
  const alt = keyAlt(pc.flats),
    out: PNote[] = [],
    slow = qpm < 80;
  let inSlur = false,
    seed = 7;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296 - 0.5;
  };
  /** 楽句の境目（拍） */
  const crosses = (a: number, b: number): boolean => {
    const k = Math.floor((b - pOff + 1e-6) / pLen);
    return k > Math.floor((a - pOff + 1e-6) / pLen) && b > b0 + 1e-6;
  };
  for (let i = 0; i < src.length; i++) {
    const x = src[i],
      nx = src[i + 1],
      n = inRange(x.n),
      t = secAt(x.t),
      end = secAt(x.t + x.d),
      dur = end - t,
      next = nx ? secAt(nx.t) : end,
      span = Math.max(dur, next - t);
    if (x.slurOn) inSlur = true;
    /* 次の音へ休符なしで続くか、そこで楽句が変わるか */
    const tied = !!nx && nx.t <= x.t + x.d + 1e-6,
      slurNext = inSlur && !x.slurOff && tied && inRange(nx.n) !== n;
    if (x.slurOff) inSlur = false;
    const prevSlur = out.length > 0 && out[out.length - 1].slur,
      db0 = level(x.t, n) + (x.accent || x.dyn === 'fz' || x.dyn === 'sf' || x.dyn === 'sfz' ? 2 : 0),
      db1 = level(x.t + x.d, n),
      acc = x.accent || x.dyn === 'fz' || x.dyn === 'sf' || x.dyn === 'sfz',
      tongue: 'ta' | 'da' = acc || x.stacc ? 'ta' : db0 <= -5 || x.tenuto || slow ? 'da' : 'ta';
    /* 鳴らす長さ */
    let d: number;
    if (slurNext) d = span;
    else {
      const r = x.stacc ? R_STACC : x.tenuto ? R_TEN : R_TONGUE;
      d = Math.max(D_MIN, Math.min(dur * r, span - GAP_MIN));
      if (!nx) d = dur;
    }
    /* 息継ぎ: 楽句の終わりで、スラーでなく休符もなく次の音へ続くとき */
    if (tied && !slurNext && nx && crosses(x.t, nx.t))
      d = Math.max(D_MIN, Math.min(d, span - Math.min(BREATH, span / 3)));
    const note: PNote = {
      t,
      d,
      span,
      m: n,
      d0: dynOfDb(db0),
      d1: dynOfDb(db1),
      slur: slurNext,
      acc,
      tongue,
    };
    /* トリル: 上の隣の音から始めて交互に、音の 3/4 まで。残りは元の音 */
    if (x.trill && dur > 0.25) {
      const up = inRange(upperNeighbor(x.n, alt)),
        k = Math.max(2, 2 * Math.round((0.75 * dur * 8) / 2)),
        h = (0.75 * dur) / k;
      for (let j = 0; j < k; j++)
        out.push({
          ...note,
          t: t + j * h,
          d: h,
          span: h,
          m: j % 2 ? n : up,
          slur: true,
          tongue: j ? note.tongue : 'ta',
        });
      out.push({ ...note, t: t + k * h, d: Math.max(D_MIN, d - k * h), span: span - k * h });
      continue;
    }
    /* 舌で吹き始める音の出だしのばらつき（標準偏差約 7 ms、±12 ms まで） */
    if (phrase && !prevSlur && i > 0) {
      const j = Math.max(-0.012, Math.min(0.012, 0.014 * (rnd() + rnd() + rnd())));
      note.t += j;
      note.span -= j;
      note.d = Math.min(note.d, note.span);
    }
    out.push(note);
  }
  /* ばらつきで前の音の終わりを越えないように、前の音の span を次の音の頭までにそろえる */
  for (let i = 0; i + 1 < out.length; i++) {
    const a = out[i],
      s = out[i + 1].t - a.t;
    a.span = Math.max(1e-3, s);
    a.d = Math.min(a.d, a.slur ? s : Math.max(D_MIN, s - GAP_MIN));
  }
  return { notes: out, beatAt, secAt };
}
