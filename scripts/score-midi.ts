/**
 * scripts/piano-scores.ts と scripts/organ-scores.ts で共通に使う、MIDI（SMF）から曲のデータ（.ts）を作る処理。
 *
 * 音の高さ・時刻・長さと、どのトラック（譜表・鍵盤）の音かだけを使う。ベロシティ、コントロールチェンジ、
 * テンポ（指定した曲の変化を除く）は使わない。時刻と長さは 4 分音符の 1/DIV に寄せ、反復を展開し、
 * 音符を 64 文字の符号で固定長に詰めて書く
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/** 1 拍（4 分音符）の分割 */
export const DIV = 480;

/** SMF の音。時刻は元の tick */
export interface RawNote {
  /** トラックの番号（0 から） */
  tr: number;
  n: number;
  t0: number;
  t1: number;
}

export interface Midi {
  /** 4 分音符の tick 数 */
  ppq: number;
  notes: RawNote[];
  /** テンポの変化。時刻は tick、us は 4 分音符の長さ（マイクロ秒） */
  tempo: { t: number; us: number }[];
  /** 拍子の変化。時刻は tick */
  meter: { t: number; num: number; den: number }[];
  /** トラックの名前 */
  names: string[];
  /** コントロールチェンジの番号ごとの数 */
  cc: Map<number, number>;
}

/** SMF を読み、すべてのトラックの音（時刻は tick）とテンポ・拍子を返す */
export function readMidi(buf: Uint8Array): Midi {
  let p = 0;
  const u32 = () => ((buf[p++] << 24) | (buf[p++] << 16) | (buf[p++] << 8) | buf[p++]) >>> 0,
    u16 = () => (buf[p++] << 8) | buf[p++],
    tag = () => String.fromCharCode(buf[p++], buf[p++], buf[p++], buf[p++]),
    vlq = () => {
      let v = 0,
        b: number;
      do {
        b = buf[p++];
        v = v * 128 + (b & 0x7f);
      } while (b & 0x80);
      return v;
    };
  if (tag() !== 'MThd') throw new Error('SMF ではありません');
  const hl = u32(),
    h0 = p;
  u16();
  const ntr = u16(),
    ppq = u16();
  if (ppq & 0x8000) throw new Error('SMPTE の時間単位には対応していません');
  p = h0 + hl;
  const m: Midi = { ppq, notes: [], tempo: [], meter: [], names: [], cc: new Map() };
  for (let k = 0; k < ntr; k++) {
    if (tag() !== 'MTrk') throw new Error(`トラック ${k} が壊れています`);
    const end = u32() + p;
    let t = 0,
      run = 0;
    const on = new Map<number, number[]>();
    m.names.push('');
    while (p < end) {
      t += vlq();
      let st = buf[p];
      if (st & 0x80) p++;
      else st = run;
      if (st === 0xff) {
        const ty = buf[p++],
          len = vlq(),
          d = buf.subarray(p, p + len);
        p += len;
        if (ty === 0x03) m.names[k] = new TextDecoder().decode(d);
        else if (ty === 0x51) m.tempo.push({ t, us: (d[0] << 16) | (d[1] << 8) | d[2] });
        else if (ty === 0x58) m.meter.push({ t, num: d[0], den: 2 ** d[1] });
        continue;
      }
      /* システムエクスクルーシブは読み飛ばす */
      if (st === 0xf0 || st === 0xf7) {
        p += vlq();
        continue;
      }
      run = st;
      const ty = st & 0xf0,
        ch = st & 0x0f,
        a = buf[p++],
        b = ty === 0xc0 || ty === 0xd0 ? 0 : buf[p++],
        key = ch * 128 + a;
      if (ty === 0x90 && b > 0) {
        const l = on.get(key) ?? [];
        l.push(t);
        on.set(key, l);
      } else if (ty === 0x80 || ty === 0x90) {
        const t0 = on.get(key)?.shift();
        if (t0 !== undefined) m.notes.push({ tr: k, n: a, t0, t1: t });
      } else if (ty === 0xb0) m.cc.set(a, (m.cc.get(a) ?? 0) + 1);
    }
    p = end;
  }
  m.tempo.sort((a, b) => a.t - b.t);
  m.meter.sort((a, b) => a.t - b.t);
  return m;
}

/** 曲の設定 */
export interface Piece {
  /** <name>.mid から <name>.ts を作る */
  name: string;
  /** 曲名（作曲者を含む） */
  title: string;
  /** 出典の段落（行に分けたもの） */
  source: string[];
  /** 加工の段落（行に分けたもの） */
  changes: string[];
  license: 'pd' | 'cc-by-sa-2.5' | 'cc-by-sa-4.0';
  /** 使うトラックと、その譜表・鍵盤（h）: [トラックの番号, h] */
  tracks: [number, number][];
  /** 拍子 [分子, 分母]。曲の途中で変わらないこと */
  meter: [number, number];
  /** 弱起の拍（4 分音符を 1 とする） */
  pickup: number;
  /**
   * 反復を展開した演奏順。小節の範囲 [最初, 最後] の列で、0 小節目は弱起。
   * 小節 k（1 以上）は pickup + (k − 1) × 1 小節の拍から始まる。なければ展開しない
   */
  order?: [number, number][];
  /** 反復の区切りが小節線より前にずれる拍（弱起で始まる区切り）。order の範囲の両端をこれだけ前にずらす */
  shift?: number;
  /** 前打音を本音符の開始で切る（LilyPond 2.8 の MIDI は、前打音を本音符の少し前から元の長さで鳴らす） */
  grace?: boolean;
  /** MIDI のテンポの変化を、最初のテンポに対する比として TEMPO に入れる */
  tempo?: boolean;
  /** 曲ごとの手直し。readMidi の結果を受け取り、使う音（時刻は tick）を返す */
  fix?: (m: Midi, log: (s: string) => void) => RawNote[];
}

/** 楽器ごとの設定 */
export interface Kind {
  /** 出力のディレクトリ（<name>.mid もここに置く） */
  dir: URL;
  /** リポジトリのルートからの出力のディレクトリ（表示用） */
  path: string;
  /** このスクリプト（表示用） */
  script: string;
  /** h ごとの名前と、音の高さの範囲 [最低, 最高] */
  staves: { name: string; lo: number; hi: number }[];
  /** 同じ時刻・同じ高さの音を、h が違っても 1 つにまとめる（ピアノは鍵盤が 1 つなので） */
  mergeAcross: boolean;
}

/** 音符。時刻と長さは 1/DIV 拍 */
interface Note {
  t: number;
  d: number;
  n: number;
  h: number;
  /** 元の時刻か終わりが 1/96 拍の格子に乗らない（前打音） */
  odd: boolean;
}

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
/** 音名（C4 = 60） */
export const noteName = (n: number) => NAMES[n % 12] + (Math.floor(n / 12) - 1);

/** 寄せる先として好む拍の分割。前にあるほど好む（5 連符の 2/5・3/5 拍を、近くの 1/48 拍の格子より好む） */
const GRID = [1, 2, 3, 4, 6, 8, 12, 16, 24, 5, 10, 32, 20, 48, 15, 30, 40, 60, 80, 96, 120, 160, 240, DIV];
const level = (c: number) => GRID.findIndex((g) => (c * g) % DIV === 0);

/**
 * 元の tick で表した時刻や長さを 1/DIV 拍に寄せる。LilyPond の MIDI は開始と長さをそれぞれ切り捨てるので
 * （3 連符の長さが 1 tick 短い、5 連符の位置が 1 tick 早いなど）、元の値の ±1 tick の範囲で、拍の分割として
 * 最も単純な値を選ぶ。同じ単純さなら近いほう。終わりは開始と長さを別々に寄せて求める
 */
function snapper(ppq: number) {
  const r = DIV / ppq;
  let inexact = 0,
    moved = 0;
  const snap = (tick: number) => {
    const x = tick * r,
      lo = Math.max(0, Math.ceil((tick - 1) * r)),
      hi = Math.floor((tick + 1) * r);
    let best = Math.round(x),
      bl = level(best);
    for (let c = lo; c <= hi; c++) {
      const l = level(c);
      if (l < bl || (l === bl && Math.abs(c - x) < Math.abs(best - x))) {
        best = c;
        bl = l;
      }
    }
    if (!Number.isInteger(x)) inexact++;
    if (best !== Math.round(x)) moved++;
    return best;
  };
  return { snap, count: () => ({ inexact, moved }) };
}

const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const enc = (v: number, w: number) => {
  if (!Number.isInteger(v) || v < 0 || v >= 64 ** w) throw new Error(`符号にできない値 ${v}（${w} 文字）`);
  let s = '';
  for (let k = 0; k < w; k++, v = Math.floor(v / 64)) s = A[v % 64] + s;
  return s;
};

const LICENSE = {
  'cc-by-sa-2.5': {
    name: 'Creative Commons Attribution-ShareAlike 2.5 Generic',
    url: 'https://creativecommons.org/licenses/by-sa/2.5/',
    spdx: 'CC-BY-SA-2.5',
  },
  'cc-by-sa-4.0': {
    name: 'Creative Commons Attribution-ShareAlike 4.0 International',
    url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    spdx: 'CC-BY-SA-4.0',
  },
};

/** 1 曲の .ts を作る。<name>.mid がなければ警告を出して飛ばす */
export function build(p: Piece, k: Kind): void {
  const src = new URL(`${p.name}.mid`, k.dir),
    out = new URL(`${p.name}.ts`, k.dir);
  if (!existsSync(src)) {
    console.warn(`skip ${k.path}/${p.name}.ts: ${k.path}/${p.name}.mid がありません`);
    return;
  }
  const m = readMidi(readFileSync(src)),
    msgs: string[] = [],
    log = (s: string) => msgs.push(s);
  const bar = (p.meter[0] * 4) / p.meter[1];
  /* 拍子は曲の途中で変わらず、設定と同じであること */
  for (const x of m.meter)
    if (x.num !== p.meter[0] || x.den !== p.meter[1])
      throw new Error(`${p.name}: MIDI の拍子 ${x.num}/${x.den}（${x.t / m.ppq} 拍）が設定と違います`);
  if (m.cc.get(64)) log(`CC64（ペダル）が ${m.cc.get(64)} 個あるが使わない`);

  /* 拍の位置を小節と拍で表す（展開前・展開後のどちらの時刻にも使う） */
  const where = (beat: number) => {
    const b = beat - p.pickup,
      k1 = Math.floor(b / bar) + 1;
    return `${k1} 小節 ${+(b - (k1 - 1) * bar + 1).toFixed(3)} 拍目`;
  };

  const raw = p.fix ? p.fix(m, log) : m.notes,
    hOf = new Map(p.tracks);
  for (const [tr] of p.tracks)
    if (tr >= m.names.length) throw new Error(`${p.name}: トラック ${tr} がありません（${m.names.length} 個）`);
  const { snap, count } = snapper(m.ppq),
    g96 = m.ppq / 96;
  let ns: Note[] = [];
  for (const x of raw) {
    const h = hOf.get(x.tr);
    if (h === undefined) continue;
    const t = snap(x.t0);
    ns.push({ t, d: Math.max(1, snap(x.t1 - x.t0)), n: x.n, h, odd: x.t0 % g96 !== 0 || x.t1 % g96 !== 0 });
  }
  ns.sort((a, b) => a.t - b.t || a.h - b.h || a.n - b.n);

  /* 前打音は、同じ譜表・鍵盤でそのあとに始まる音の開始で切る */
  if (p.grace) {
    const cut: string[] = [];
    for (const x of ns) {
      if (!x.odd) continue;
      const next = ns.find((y) => y.h === x.h && y.t > x.t && y.t < x.t + x.d);
      if (!next) continue;
      cut.push(`${where(x.t / DIV)} ${noteName(x.n)}`);
      x.d = next.t - x.t;
    }
    if (cut.length) log(`前打音を本音符の開始で切った ${cut.length} 音: ${cut.join('、')}`);
  }

  /* 同じ時刻・同じ高さの音を 1 つにまとめる（長いほうを残し、同じなら h の小さいほう） */
  const merged = new Map<string, Note>();
  let dup = 0,
    across = 0;
  for (const x of ns) {
    const key = k.mergeAcross ? `${x.t}/${x.n}` : `${x.t}/${x.n}/${x.h}`,
      y = merged.get(key);
    if (!y) {
      merged.set(key, x);
      continue;
    }
    dup++;
    if (y.h !== x.h) across++;
    if (x.d > y.d) merged.set(key, x);
  }
  ns = [...merged.values()];
  if (dup) log(`同じ時刻・同じ高さの音 ${dup} 個をまとめた${across ? `（うち譜表の違う音 ${across}）` : ''}`);

  /* 反復を展開する */
  let length = Math.max(...ns.map((x) => x.t + x.d));
  if (p.order) {
    const shift = Math.round((p.shift ?? 0) * DIV),
      start = (k1: number) => (k1 === 0 ? 0 : Math.round((p.pickup + (k1 - 1) * bar) * DIV)) - shift;
    /* 続いている範囲はつなぐ（つないだ範囲の中では、音を切らない） */
    const segs: [number, number][] = [];
    for (const [a, b] of p.order) {
      if (a > b || a < 0) throw new Error(`${p.name}: 小節の範囲 [${a}, ${b}] が正しくありません`);
      const s = Math.max(0, start(a)),
        e = start(b + 1),
        last = segs[segs.length - 1];
      if (last && last[1] === s) last[1] = e;
      else segs.push([s, e]);
    }
    const out: Note[] = [];
    let off = 0,
      cut = 0,
      lost = 0;
    for (const [i, [s, e]] of segs.entries()) {
      for (const x of ns) {
        if (x.t < s && x.t + x.d > s && i > 0) lost++;
        if (x.t < s || x.t >= e) continue;
        let d = x.d;
        if (x.t + d > e && i < segs.length - 1) {
          d = e - x.t;
          cut++;
        }
        out.push({ ...x, t: x.t - s + off, d });
      }
      off += e - s;
    }
    if (cut) log(`範囲の終わりを越える音 ${cut} 個を、範囲の終わりで切った`);
    if (lost) log(`範囲の前から鳴り続く音 ${lost} 個（展開後は鳴らない）`);
    ns = out;
    length = off;
  }
  ns.sort((a, b) => a.t - b.t || a.h - b.h || a.n - b.n);

  /* 音域と、同じ鍵の音の重なり（前の音が鳴っているうちに同じ高さの音が始まる）を確かめる */
  for (const x of ns) {
    const st = k.staves[x.h];
    if (!st) throw new Error(`${p.name}: h = ${x.h} は使えません`);
    if (x.n < st.lo || x.n > st.hi)
      throw new Error(`${p.name}: ${where(x.t / DIV)} の ${noteName(x.n)} が ${st.name}の音域の外です`);
  }
  const held = new Map<string, number>();
  let overlap = 0;
  for (const x of ns) {
    const key = k.mergeAcross ? `${x.n}` : `${x.n}/${x.h}`,
      e = held.get(key);
    if (e !== undefined && e > x.t) overlap++;
    held.set(key, Math.max(e ?? 0, x.t + x.d));
  }
  if (overlap) log(`同じ鍵で前の音が鳴っているうちに始まる音 ${overlap} 個（そのまま残す）`);

  /* テンポの変化（最初のテンポに対する比） */
  const tempo: [number, number][] = [];
  if (p.tempo) {
    if (p.order) throw new Error(`${p.name}: テンポの変化と反復の展開は同時に使えません`);
    const base = m.tempo[0];
    if (base?.t !== 0) throw new Error(`${p.name}: 最初のテンポがありません`);
    let prev = 1;
    for (const x of m.tempo) {
      const r = Math.round((base.us / x.us) * 10000) / 10000,
        t = snap(x.t) / DIV;
      if (r === prev) continue;
      const last = tempo[tempo.length - 1];
      if (last && last[0] === t) last[1] = r;
      else tempo.push([t, r]);
      prev = r;
    }
    log(`基本のテンポ ♩ = ${+(60e6 / base.us).toFixed(2)}（MIDI の最初の値）`);
  }

  /* 符号にする: 前の音からの間（3）、長さ（3）、音の高さ（2）、h（1） */
  let data = '',
    prev = 0;
  for (const x of ns) {
    data += enc(x.t - prev, 3) + enc(x.d, 3) + enc(x.n, 2) + enc(x.h, 1);
    prev = x.t;
  }
  const lines = data.match(/.{1,108}/g) ?? [],
    end = Math.max(...ns.map((x) => x.t + x.d)) / DIV,
    full = Math.floor((length / DIV - p.pickup) / bar),
    rest = +(length / DIV - p.pickup - full * bar).toFixed(3),
    counts = k.staves.map((_, h) => ns.filter((x) => x.h === h).length);
  const meter = `${p.meter[0]}/${p.meter[1]} 拍子${p.pickup ? `、最初の ${p.pickup} 拍は弱起` : ''}`,
    size = `${full} 小節${rest ? `と ${rest} 拍` : ''}`;

  const lic = p.license === 'pd' ? undefined : LICENSE[p.license],
    license = lic
      ? [
          `このファイルと ${p.name}.mid は原作と同じ ${lic.name}`,
          `（${lic.url}）で公開する。リポジトリのほかのファイルの MIT ライセンスは適用しない。`,
          '',
          `SPDX-License-Identifier: ${lic.spdx}`,
        ]
      : [
          `原作はパブリックドメイン（Mutopia の表記は Public Domain）。このファイルと ${p.name}.mid も著作権を主張しない。`,
        ];
  const head = [
    /* 曲名が半角の文字で終わるときだけ空白を入れる */
    `${p.title}${/[!-~]$/.test(p.title) ? ' ' : ''}の音符。`,
    `${k.script} で ${p.name}.mid から作る（直接編集しない）。`,
    '',
    ...p.source,
    ...p.changes,
    '',
    ...license,
  ];
  const tempoSrc = tempo.length ? `[\n${tempo.map(([t, r]) => `  [${t}, ${r}],`).join('\n')}\n]` : '[]';

  const text = `/**
${head.map((l) => (l ? ` * ${l}` : ' *')).join('\n')}
 */
import type { ScoreNote } from './types';

/** 1 拍（4 分音符）を ${DIV} に分けた時刻・長さ。1 音 9 文字: 前の音からの間（3）、長さ（3）、音の高さ（2）、${k.staves.length > 2 ? '鍵盤' : '譜表'}（1） */
const DATA =
${lines.map((l) => `  '${l}'`).join(' +\n')};

const A = '${A}';
const v = (s: string) => [...s].reduce((x, c) => x * 64 + A.indexOf(c), 0);

/** テンポの変化: [拍, 基本のテンポに対する比]。最初の項より前の比は 1 */
export const TEMPO: readonly [number, number][] = ${tempoSrc};

/** 音符（${ns.length} 音、${size}。${meter}） */
export function notes(): ScoreNote[] {
  const out: ScoreNote[] = [];
  let t = 0;
  for (let i = 0; i < DATA.length; i += 9) {
    t += v(DATA.slice(i, i + 3));
    out.push({
      t: t / ${DIV},
      d: v(DATA.slice(i + 3, i + 6)) / ${DIV},
      n: v(DATA.slice(i + 6, i + 8)),
      h: v(DATA[i + 8]),
    });
  }
  return out;
}
`;
  writeFileSync(out, text);

  const lo = Math.min(...ns.map((x) => x.n)),
    hi = Math.max(...ns.map((x) => x.n)),
    { inexact, moved } = count();
  const endAt = Math.abs((end - p.pickup) / bar - Math.round((end - p.pickup) / bar)) < 1e-9 ? '小節線' : where(end);
  console.log(
    `wrote ${k.path}/${p.name}.ts（${ns.length} 音、${size}、${noteName(lo)}–${noteName(hi)}、` +
      `${k.staves.map((s, h) => `${s.name} ${counts[h]}`).join('・')}、最後の音の終わり ${end} 拍 = ${endAt}）`,
  );
  if (inexact) msgs.push(`1/${DIV} 拍で表せない元の時刻・長さ ${inexact} 個、最も近い値と違う値に寄せた ${moved} 個`);
  for (const s of msgs) console.log(`  ${s}`);
}
