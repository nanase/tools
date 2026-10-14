/**
 * 曲の演奏の規則（DOM に依存しない）: 声部ごとの楽譜の音を、弦ごとの音符の列と強弱の曲線にする（無伴奏の曲のため）。
 *  - 時刻: 全声部の音の出だしを「出来事」とし、出来事ごとにテンポ・楽句の弧・楽句の終わりの延びを掛けて秒にする
 *    （Friberg ほか 2006 の Phrase arch と Punctuation）。楽句は決まった拍数で区切る
 *  - 和音: 3 音以上が同時に始まる出来事は分散して弾く。3 音は下の 2 音 → 上の 2 音（真ん中の音は続ける）、
 *    4 音は下の 2 音 → 上の 2 音。下の部分は 0.11 s（出来事が短ければそれ以下）。和音の音は次の出来事で離す
 *  - 2 音までの重なりは重音として隣の弦で弾く。弓を返す出来事では、続いている音も弾き直す
 *  - arpeggio の区間: 8 分音符ごとに、鳴っている音を 32 分音符 4 つで分散する（中・低・高・低。楽譜に書き出された
 *    最初の形と同じ。2 音ずつスラー）。4 音のときは、中の音を 8 分音符ごとに入れ替える
 *  - 弦: 単音は低いポジション（開放弦より上で最も高い弦）、重音・和音は隣り合う弦（できなければ間を空ける）
 *  - トリル: 上の隣の音（調号に合わせる）から始め、速さを上げてから終わりで少し落とす
 *  - 強弱: 予定の折れ線に、楽句の弧・長い音の中のふくらみ・高い音ほど大きく（High loud）を足す
 *  - 弓を返す音の出だしを少しばらつかせる（Noise の規則）
 */
import type { ScoreNote } from './scores/types';

/** 開放弦の音の高さ（0 = E 線 … 3 = G 線） */
export const OPEN = [76, 69, 62, 55] as const;
/** 音の高さから選ぶ弦（開放弦より上で、最も高い弦） */
export const stringOf = (n: number): number => (n >= 76 ? 0 : n >= 69 ? 1 : n >= 62 ? 2 : 3);
/** 強弱の記号 → 音量の目安 [dB]（mf = 0） */
export const DYN_DB: Record<string, number> = {
  ppp: -16,
  pp: -12,
  p: -7,
  mp: -3,
  mf: 0,
  f: 5,
  ff: 9,
  fff: 12,
  fz: 6,
  sf: 6,
  sfz: 6,
};

/** 弦で弾く音 */
export interface RNote {
  /** 開始 [s]・長さ [s]・音の高さ（MIDI） */
  t: number;
  d: number;
  n: number;
  /** 弦（0 = E 線 … 3 = G 線） */
  si: number;
  /** 前の音からスラーで続ける（弓を返さない） */
  slur?: boolean;
  /** ビブラートの幅の倍率（0 = なし） */
  vib?: number;
  /** 楽句の終わりの音 */
  end?: boolean;
  /** スラーで前の音から移るときの、音の高さの移り変わりの時間 [s]（既定 30 ms） */
  glide?: number;
  /** その時点で最も高い音（ビブラートと強弱の目安に使う） */
  lead?: boolean;
  voice: number;
  trill?: boolean;
  /** 3 音以上の和音の音（和音の前では弓を離して弓の位置を直す） */
  chord?: boolean;
}

export interface PolyOpt {
  /** 拍 b でのテンポ（4 分音符 / 分） */
  qpm: (b: number) => number;
  /** 楽句の長さと最初の楽句の始まり [拍] */
  phraseLen: number;
  phraseOff: number;
  /** 強弱の予定: [拍, dB（mf = 0）] の折れ線 */
  plan: readonly (readonly [number, number])[];
  /** arpeggio で弾く区間 [拍, 拍) */
  arp: readonly (readonly [number, number])[];
  /** 拍 b の調号（♭ の数。負なら ♯） */
  flats: (b: number) => number;
  /** 節の終わり [拍]。直前の 3 拍を少し遅くする */
  sectionEnds?: readonly number[];
  /** 最初の音の前の時間 [s] */
  lead?: number;
  /** 楽句の弧の大きさ: 音量 [dB]・テンポ（中ほどで速く、両端で遅くする割合） */
  archDb?: number;
  archTempo?: number;
  /** 楽句の最後の音を延ばす割合 */
  phraseEnd?: number;
  /** 曲の終わりの 2 拍を遅くする割合 */
  finalRit?: number;
  /** 長い音の中のふくらみ [dB] と、音の高さによる音量 [dB/オクターブ] */
  swellDb?: number;
  highLoud?: number;
  /** 弓を返す音の出だしの時刻のばらつき [s] */
  jitter?: number;
  /** 和音の下の部分の長さ [s] */
  chordGap?: number;
  seed?: number;
}

export interface PolyPerf {
  notes: RNote[];
  /** 時刻 [s] の音量の目安 [dB] */
  level: (t: number) => number;
  end: number;
  /** 拍 → 秒、秒 → 拍 */
  sec: (b: number) => number;
  beat: (t: number) => number;
}

/** 調号（♭ の数。負なら ♯）から、音階の段ごとの半音のずれ */
export function keyAlt(flats: number): number[] {
  const alt = [0, 0, 0, 0, 0, 0, 0],
    FL = [6, 2, 5, 1, 4, 0, 3],
    SH = [3, 0, 4, 1, 5, 2, 6];
  if (flats > 0) for (let k = 0; k < flats; k++) alt[FL[k]] = -1;
  else for (let k = 0; k < -flats; k++) alt[SH[k]] = 1;
  return alt;
}
const SEMI = [0, 2, 4, 5, 7, 9, 11];
/** 音 n の、調の中での上の隣の音（臨時記号の付いた音は、最も近い段として扱う） */
export function upperNeighbor(n: number, alt: readonly number[]): number {
  const pc = ((n % 12) + 12) % 12;
  let step = 0,
    best = 99;
  for (let k = 0; k < 7; k++) {
    const q = (((SEMI[k] + alt[k]) % 12) + 12) % 12,
      d = Math.min((pc - q + 12) % 12, (q - pc + 12) % 12);
    if (d < best) {
      best = d;
      step = k;
    }
  }
  const up = (step + 1) % 7,
    target = (((SEMI[up] + alt[up]) % 12) + 12) % 12;
  let u = n + 1;
  while (((u % 12) + 12) % 12 !== target) u++;
  return u;
}

/** 楽句の弧: x ∈ [0,1] で 0 から上がり、0.65 で最大 1、1 で 0 に戻る（頂点を後ろに寄せた正弦） */
const arch = (x: number) => Math.sin(Math.PI * Math.min(1, Math.max(0, x)) ** 1.61);
const sm = (y: number) => (y <= 0 ? 0 : y >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * y));

/**
 * 和音の音（低い順）に弦を割り当てる。低い音ほど低い弦（番号が大きい）。隣り合う弦を優先し、
 * だめなら間を空けてよい。指の届く幅（押さえる音のポジションの差）は 6 半音まで。できなければ null
 */
export function chordStrings(ns: readonly number[]): number[] | null {
  const k = ns.length;
  let best: number[] | null = null,
    bestCost = 1e9;
  const pick = (ss: number[], gapPenalty: number) => {
    const pos = ns.map((n, j) => n - OPEN[ss[j]]);
    if (pos.some((p) => p < 0)) return;
    const fing = pos.filter((p) => p > 0),
      span = fing.length ? Math.max(...fing) - Math.min(...fing) : 0;
    if (span > 6) return;
    const cost = Math.max(0, ...pos) + 0.5 * span + gapPenalty;
    if (cost < bestCost) {
      bestCost = cost;
      best = ss;
    }
  };
  /* 弦の組（降順に並べた k 本）を全部試す */
  const combos = (from: number, left: number, acc: number[]): void => {
    if (left === 0) {
      const ss = [...acc].reverse(),
        gaps = acc.length > 1 ? acc[0] - acc[acc.length - 1] - (acc.length - 1) : 0;
      pick(ss, 3 * gaps);
      return;
    }
    for (let q = from; q <= 3; q++) combos(q + 1, left - 1, [...acc, q]);
  };
  combos(0, k, []);
  return best;
}

/**
 * 楽譜の強弱の記号と松葉から、強弱の予定の折れ線を作る。記号のところで 0.25 拍かけて段を移り、
 * 松葉は次の記号まで直線で移る（次の記号がなければ 4 dB 上げ下げする）
 */
export function planFromMarks(ns: readonly ScoreNote[], first = 0): [number, number][] {
  const plan: [number, number][] = [[-1e9, first]];
  let cur = first,
    hair: { t: number; dir: number } | null = null;
  for (const x of [...ns].sort((a, b) => a.t - b.t)) {
    if (x.dyn && DYN_DB[x.dyn] !== undefined) {
      const v = DYN_DB[x.dyn];
      if (!hair) plan.push([x.t - 0.25, cur]);
      plan.push([x.t, v]);
      cur = v;
      hair = null;
    }
    if (x.hair === '<' || x.hair === '>') {
      plan.push([x.t, cur]);
      hair = { t: x.t, dir: x.hair === '<' ? 1 : -1 };
    } else if (x.hair === '!' && hair) {
      cur += 4 * hair.dir;
      plan.push([x.t + x.d, cur]);
      hair = null;
    }
  }
  plan[0][0] = Math.min(plan.length > 1 ? plan[1][0] : 0, 0) - 1;
  return plan;
}

export function performPoly(voices: readonly (readonly ScoreNote[])[], o: PolyOpt): PolyPerf {
  const lead = o.lead ?? 0.5,
    archDb = o.archDb ?? 3,
    archTempo = o.archTempo ?? 0.06,
    phraseEnd = o.phraseEnd ?? 0.07,
    finalRit = o.finalRit ?? 0.25,
    swellDb = o.swellDb ?? 2,
    highLoud = o.highLoud ?? 2,
    jitter = o.jitter ?? 0.006,
    chordGap = o.chordGap ?? 0.11,
    Q = (x: number) => Math.round(x * 960) / 960;
  let rs = (o.seed ?? 11) >>> 0;
  const rnd = () => {
    rs = (rs * 1664525 + 1013904223) >>> 0;
    return rs / 4294967296;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

  /* 声部の音（拍は 1/960 に丸める。三連符の足し算の誤差を消す） */
  interface VN {
    v: number;
    t: number;
    d: number;
    n: number;
    src: ScoreNote;
    slurIn: boolean;
  }
  const vns: VN[] = [];
  voices.forEach((ns, v) => {
    let inSlur = false;
    for (const x of ns) {
      const t = Q(x.t),
        d = Q(x.t + x.d) - t;
      /* G 線の開放より低い音（楽譜の誤りなど）は、弾けるオクターブまで上げる */
      for (const n0 of x.n) {
        const n = n0 < OPEN[3] ? n0 + 12 * Math.ceil((OPEN[3] - n0) / 12) : n0;
        vns.push({ v, t, d, n, src: x, slurIn: inSlur });
      }
      if (x.slurOn) inSlur = true;
      if (x.slurOff) inSlur = false;
    }
  });
  vns.sort((a, b) => a.t - b.t || a.n - b.n);
  const endBeat = Math.max(...vns.map((x) => x.t + x.d));

  /* 1. 出来事と時刻 */
  const ev = [...new Set(vns.map((x) => x.t))].sort((a, b) => a - b),
    E = ev.length,
    evDur = ev.map((b, k) => (k + 1 < E ? ev[k + 1] : endBeat) - b),
    fermataAt = new Set(vns.filter((x) => x.src.fermata).map((x) => x.t)),
    nPh = Math.max(1, Math.round((endBeat - o.phraseOff) / o.phraseLen)),
    phraseOf = (b: number) => {
      const pi = Math.max(0, Math.min(nPh - 1, Math.floor((b - o.phraseOff + 1e-9) / o.phraseLen))),
        p0 = o.phraseOff + pi * o.phraseLen;
      return [p0, pi === nPh - 1 ? endBeat : p0 + o.phraseLen];
    };
  const durS = new Float64Array(E),
    st = new Float64Array(E + 1);
  st[0] = lead;
  for (let k = 0; k < E; k++) {
    const b = ev[k],
      mid = b + evDur[k] / 2,
      [p0, p1] = phraseOf(b);
    let m = 1 / (1 + archTempo * (arch((mid - p0) / (p1 - p0)) - 0.5));
    if (k + 1 >= E || ev[k + 1] >= p1 - 1e-9) m *= 1 + phraseEnd;
    for (const se of o.sectionEnds ?? []) if (mid > se - 3 && b < se) m *= 1 + 0.15 * Math.min(1, (mid - (se - 3)) / 3);
    if (mid > endBeat - 2) m *= 1 + finalRit * Math.min(1, (mid - (endBeat - 2)) / 2);
    durS[k] = ((evDur[k] * 60) / o.qpm(b)) * m * (fermataAt.has(b) ? 1.6 : 1);
    st[k + 1] = st[k] + durS[k];
  }
  const evIndex = (b: number) => {
    let lo = 0,
      hi = E - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ev[mid] <= b + 1e-9) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const sec = (b: number) => {
    if (b >= endBeat) return st[E];
    if (b <= ev[0]) return st[0] + (b - ev[0]) * (60 / o.qpm(ev[0]));
    const k = evIndex(b);
    return st[k] + ((b - ev[k]) / evDur[k]) * durS[k];
  };
  const beat = (t: number) => {
    if (t <= st[0]) return ev[0];
    if (t >= st[E]) return endBeat;
    let lo = 0,
      hi = E - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (st[mid] <= t) lo = mid;
      else hi = mid - 1;
    }
    return ev[lo] + ((t - st[lo]) / durS[lo]) * evDur[lo];
  };
  const isPhraseEnd = (b: number) => {
    const x = (b - o.phraseOff) / o.phraseLen;
    return b >= endBeat - 1e-6 || Math.abs(x - Math.round(x)) < 1e-6;
  };

  /* 2. 弦ごとの音符 */
  interface Act {
    vn: VN;
    si: number;
    r: RNote;
    chord: boolean;
  }
  const out: RNote[] = [];
  let active: Act[] = [];
  const start = (vn: VN, si: number, ts: number, slur: boolean, chord: boolean): Act => {
    const r: RNote = {
      t: ts,
      d: Math.max(0.01, sec(vn.t + vn.d) - ts),
      n: vn.n,
      si,
      slur,
      vib: 1,
      voice: vn.v,
      end: isPhraseEnd(vn.t + vn.d),
      trill: vn.src.trill,
      ...(chord ? { chord } : {}),
    };
    out.push(r);
    return { vn, si, r, chord };
  };
  const stop = (a: Act, ts: number) => {
    /* まだ始まっていない音（和音のあとで戻る音）は消す */
    if (a.r.t >= ts - 1e-6) a.r.d = 0;
    else a.r.d = Math.max(0.01, Math.min(a.r.d, ts - a.r.t));
  };
  const inArp = (b: number) => o.arp.some(([a0, a1]) => b >= a0 - 1e-9 && b < a1 - 1e-9);
  const byT = new Map<number, VN[]>();
  for (const x of vns) {
    if (!byT.has(x.t)) byT.set(x.t, []);
    byT.get(x.t)?.push(x);
  }
  /* 鳴っている音（声部をまたいで同じ高さは 1 つ） */
  const soundingAt = (b: number) => {
    const s = new Set<number>();
    for (const x of vns) if (x.t <= b + 1e-9 && b < x.t + x.d - 1e-9) s.add(x.n);
    return [...s].sort((p, q) => p - q);
  };
  let lastEnd = -1e9;
  const arpDone = new Set<number>();
  for (let k = 0; k < E; k++) {
    const b = ev[k],
      ts = sec(b);
    /* arpeggio の区間: 始まりで全部を生成する */
    if (inArp(b)) {
      const reg = o.arp.find(([a0, a1]) => b >= a0 - 1e-9 && b < a1 - 1e-9) as readonly [number, number];
      if (!arpDone.has(reg[0])) {
        arpDone.add(reg[0]);
        for (const a of active) stop(a, sec(reg[0]));
        active = [];
        for (let j = 0; reg[0] + 0.5 * j < reg[1] - 1e-9; j++) {
          const bs = reg[0] + 0.5 * j,
            t0 = sec(bs),
            t1 = sec(bs + 0.5),
            snd = soundingAt(bs);
          if (!snd.length) continue;
          let pat: number[];
          if (snd.length === 1) pat = [snd[0]];
          else if (snd.length === 2) pat = [snd[1], snd[0], snd[1], snd[0]];
          else if (snd.length === 3) pat = [snd[1], snd[0], snd[2], snd[0]];
          else pat = [snd[j % 2 ? 2 : 1], snd[0], snd[snd.length - 1], snd[0]];
          const uniq = [...new Set(pat)].sort((p, q) => p - q),
            ss = chordStrings(uniq),
            sOf = (n: number) => (ss ? ss[uniq.indexOf(n)] : stringOf(n)),
            dt = (t1 - t0) / pat.length;
          pat.forEach((n, q) => {
            out.push({
              t: t0 + q * dt,
              d: dt,
              n,
              si: sOf(n),
              slur: q % 2 === 1,
              vib: 1,
              voice: 0,
              end: q === pat.length - 1 && isPhraseEnd(bs + 0.5),
            });
          });
        }
        lastEnd = reg[1];
      }
      continue;
    }
    /* 終わった音を外す */
    active = active.filter((a) => a.vn.t + a.vn.d > b + 1e-9);
    const seen = new Map<number, VN>();
    for (const x of byT.get(b) ?? []) {
      const y = seen.get(x.n);
      if (!y || x.d > y.d) seen.set(x.n, x);
    }
    const nw = [...seen.values()].sort((p, q) => p.n - q.n),
      contiguous = lastEnd >= b - 1e-9;
    for (const x of nw) lastEnd = Math.max(lastEnd, x.t + x.d);
    /* 和音の音は次の出来事で離す */
    for (const a of active) if (a.chord) stop(a, ts);
    active = active.filter((a) => !a.chord);
    if (nw.length >= 3) {
      for (const a of active) stop(a, ts);
      active = [];
      const dS = durS[k];
      let ps = nw;
      if (dS < 0.2) ps = nw.slice(-2);
      let ss = chordStrings(ps.map((x) => x.n));
      while (!ss && ps.length > 2) {
        /* 弾けない和音は、1 音ずつ外して試す（最も高い音は残す） */
        let found: VN[] | null = null;
        for (let j = 0; j < ps.length - 1 && !found; j++) {
          const qs = ps.filter((_, i) => i !== j);
          if (chordStrings(qs.map((x) => x.n))) found = qs;
        }
        ps = found ?? ps.slice(1);
        ss = chordStrings(ps.map((x) => x.n));
      }
      const sOf = (j: number) => (ss ? ss[j] : stringOf(ps[j].n)),
        gap = Math.min(chordGap, 0.35 * dS);
      let dropped: Act[] = [];
      if (ps.length === 2) {
        active = [start(ps[0], sOf(0), ts, false, true), start(ps[1], sOf(1), ts, false, true)];
      } else if (ps.length === 3) {
        const a0 = start(ps[0], sOf(0), ts, false, true),
          a1 = start(ps[1], sOf(1), ts, false, true),
          a2 = start(ps[2], sOf(2), ts + gap, true, true);
        stop(a0, ts + gap);
        active = [a1, a2];
        dropped = [a0];
      } else {
        const a0 = start(ps[0], sOf(0), ts, false, true),
          a1 = start(ps[1], sOf(1), ts, false, true),
          a2 = start(ps[ps.length - 2], sOf(ps.length - 2), ts + gap, true, true),
          a3 = start(ps[ps.length - 1], sOf(ps.length - 1), ts + gap, true, true);
        stop(a0, ts + gap);
        stop(a1, ts + gap);
        active = [a2, a3];
        dropped = [a0, a1];
      }
      /*
       * 上の音が先に終わり、離した下の音の楽譜の長さがまだ残るとき（内声が旋律を続けるとき）は、
       * 上の音の終わりから、その音へ弓を戻して続ける（同じ弓のまま）
       */
      const upEnd = Math.max(...active.map((a) => a.r.t + a.r.d)),
        rest = dropped.map((a) => ({ a, end: sec(a.vn.t + a.vn.d) })).filter((x) => x.end - upEnd > 0.12),
        longest = rest.sort((p, q) => q.end - p.end)[0];
      if (longest) active.push(start(longest.a.vn, longest.a.si, upEnd, true, true));
      continue;
    }
    const slurred = contiguous && nw.every((x) => x.slurIn);
    if (nw.length === 2) {
      for (const a of active) stop(a, ts);
      const ss = chordStrings(nw.map((x) => x.n));
      active = nw.map((x, j) => start(x, ss ? ss[j] : stringOf(x.n), ts, slurred, false));
      if (!ss) {
        /* 重音にできない（同じ弦しかない）ときは高い音だけ */
        stop(active[0], ts + 0.001);
        active = [active[1]];
      }
      continue;
    }
    /* 新しい音が 1 つ: 続いている音のうち最も近い高さの 1 つまで残す */
    const x = nw[0],
      held = active.filter((a) => a.vn.n !== x.n).sort((p, q) => Math.abs(p.vn.n - x.n) - Math.abs(q.vn.n - x.n)),
      keep = held[0];
    for (const a of active) if (a !== keep) stop(a, ts);
    if (!keep) {
      active = [start(x, stringOf(x.n), ts, slurred, false)];
      continue;
    }
    /* 続いている音の隣の弦に置けるか */
    const up = x.n > keep.vn.n,
      cands = [keep.si - 1, keep.si + 1].filter((q) => {
        if (q < 0 || q > 3 || (up ? q > keep.si : q < keep.si) || x.n < OPEN[q]) return false;
        const p1 = x.n - OPEN[q],
          p2 = keep.vn.n - OPEN[keep.si];
        return p1 === 0 || p2 === 0 || Math.abs(p1 - p2) <= 6;
      });
    if (cands.length) {
      const sn = cands.sort((p, q) => x.n - OPEN[p] - (x.n - OPEN[q]))[0];
      let k2 = keep;
      if (!slurred) {
        stop(keep, ts);
        k2 = start(keep.vn, keep.si, ts, false, false);
      }
      active = [k2, start(x, sn, ts, slurred, false)];
    } else {
      stop(keep, ts);
      const pair = [keep.vn, x].sort((p, q) => p.n - q.n),
        ss = chordStrings(pair.map((y) => y.n));
      if (ss) active = pair.map((y, j) => start(y, ss[j], ts, slurred, false));
      else active = [start(x, stringOf(x.n), ts, slurred, false)];
    }
  }

  /* 3. 消した音を除き、同じ弦の重なりを切る */
  for (let j = out.length - 1; j >= 0; j--) if (out[j].d <= 0) out.splice(j, 1);
  out.sort((a, b) => a.t - b.t || a.n - b.n);
  for (let q = 0; q < 4; q++) {
    const on = out.filter((r) => r.si === q);
    for (let j = 0; j + 1 < on.length; j++)
      if (on[j].t + on[j].d > on[j + 1].t) on[j].d = Math.max(0.005, on[j + 1].t - on[j].t);
  }

  /* 4. 弓を返す出来事の出だしを少しばらつかせる（Noise の規則） */
  if (jitter > 0) {
    const startsT = [...new Set(out.filter((r) => !r.slur).map((r) => r.t))].sort((a, b) => a - b);
    for (const t of startsT.slice(1)) {
      const dt = Math.max(-0.02, Math.min(0.02, jitter * gauss()));
      for (const r of out) {
        if (Math.abs(r.t - t) < 1e-9) {
          r.t += dt;
          r.d -= dt;
        } else if (Math.abs(r.t + r.d - t) < 1e-6) r.d += dt;
      }
    }
  }

  /*
   * 5. 最も高い音: 始まりの時点で、鳴っているほかの音より高いもの。和音の下の部分のように、
   *    鳴っている間に 0.15 s 以内に別の弦で高い音が加わるものは除く
   */
  out.sort((a, b) => a.t - b.t || a.n - b.n);
  for (let j = 0; j < out.length; j++) {
    const r = out[j];
    let top = true;
    for (let i = Math.max(0, j - 12); i < Math.min(out.length, j + 12); i++) {
      const y = out[i];
      if (y === r || y.n <= r.n) continue;
      if (y.t <= r.t + 1e-4 && r.t < y.t + y.d - 1e-4) top = false;
      else if (y.t > r.t && y.t < r.t + 0.15 && y.si !== r.si && r.t + r.d > y.t + 1e-3) top = false;
    }
    r.lead = top;
  }

  /* 6. トリル（最も高い音のときだけ） */
  const res: RNote[] = [];
  for (const r of out) {
    if (!r.trill || !r.lead || r.d <= 0.15) {
      res.push(r);
      continue;
    }
    const up = upperNeighbor(r.n, keyAlt(o.flats(beat(r.t)))),
      T = r.d * 0.8,
      rate = (q: number) => 6.5 + 5.5 * sm(q / 0.35) - 2.5 * sm((q - 0.7) / 0.3),
      tt: number[] = [0];
    let tq = 0;
    while (tq < T) {
      tq += 1 / rate(tq / T) / (tt.length === 1 ? 0.75 : 1);
      tt.push(tq);
    }
    let m = tt.length - 1;
    if (m % 2) m--;
    /* 短すぎて上の音と元の音の 1 往復も入らないときは、トリルにしない */
    if (m < 2) {
      res.push(r);
      continue;
    }
    const sc = T / tt[m];
    for (let j = 0; j < m; j++)
      res.push({
        ...r,
        t: r.t + tt[j] * sc,
        d: (tt[j + 1] - tt[j]) * sc,
        n: j % 2 ? r.n : up,
        slur: j > 0 || r.slur,
        vib: 0,
        glide: 0.006,
        trill: false,
      });
    res.push({ ...r, t: r.t + T, d: r.d - T, slur: true, vib: 0.5, glide: 0.006, trill: false });
  }
  res.sort((a, b) => a.t - b.t || a.n - b.n);

  /* 7. 強弱 */
  const leads = res.filter((r) => r.lead),
    lp = leads.map((r) => r.n).sort((a, b) => a - b),
    midPitch = lp[lp.length >> 1],
    leadAt = (t: number) => {
      let lo = 0,
        hi = leads.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (leads[mid].t <= t) lo = mid;
        else hi = mid - 1;
      }
      return leads[lo];
    },
    planAt = (b: number) => {
      const P = o.plan;
      if (b <= P[0][0]) return P[0][1];
      for (let j = 1; j < P.length; j++)
        if (b < P[j][0]) return P[j - 1][1] + ((b - P[j - 1][0]) / (P[j][0] - P[j - 1][0])) * (P[j][1] - P[j - 1][1]);
      return P[P.length - 1][1];
    };
  const level = (t: number) => {
    const b = beat(t),
      [p0, p1] = phraseOf(b),
      x = (b - p0) / (p1 - p0),
      r = leadAt(t),
      u = Math.min(1, Math.max(0, (t - r.t) / r.d)),
      sw = r.d >= 0.8 && t < r.t + r.d ? swellDb * (Math.sin(Math.PI * u ** 0.8) - 0.4) : 0,
      hl = Math.max(-3, Math.min(3, (highLoud * (r.n - midPitch)) / 12));
    return planAt(b) + archDb * (arch(x) - 0.4) + sw + hl;
  };
  const last = res.reduce((m, r) => Math.max(m, r.t + r.d), 0);
  return { notes: res, level, end: last, sec, beat };
}
