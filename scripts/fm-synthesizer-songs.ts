/**
 * FMシンセサイザの同梱曲（src/tools/fm-synthesizer/songs/*.mid）を作る。bun scripts/fm-synthesizer-songs.ts で実行する。
 *
 * - fm-groove.mid: このサイトのために作った曲（打楽器入りの 7 パート、ニ短調、♩ = 108、29 小節）。
 *   パッドの 8 つ（キック・スネア・タム・ハイハット・オープン・シンバル・ラテン・小物）がどれも鳴るように打楽器を書く
 * - kv525.mid: FM音源のページの MIDI（Mutopia の弦楽四重奏、パートごとにチャンネルとプログラムが分かれている）をそのまま写す
 */
import { copyFileSync, writeFileSync } from 'node:fs';

const DIR = new URL('../src/tools/fm-synthesizer/songs/', import.meta.url);
const PPQ = 480;

/* ---------- SMF を書く ---------- */
interface Ev {
  /** 拍 */
  b: number;
  /** 並べる順（同じ拍では小さいほど先） */
  o: number;
  bytes: number[];
}
const vlq = (v: number): number[] => {
  const out = [v & 0x7f];
  for (let x = v >> 7; x > 0; x >>= 7) out.unshift((x & 0x7f) | 0x80);
  return out;
};
const u32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const text = (s: string) => [...new TextEncoder().encode(s)];
function track(evs: Ev[]): number[] {
  evs.sort((x, y) => x.b - y.b || x.o - y.o);
  const out: number[] = [];
  let t = 0;
  for (const e of evs) {
    const tk = Math.round(e.b * PPQ);
    out.push(...vlq(tk - t), ...e.bytes);
    t = tk;
  }
  out.push(0, 0xff, 0x2f, 0);
  return [...text('MTrk'), ...u32(out.length), ...out];
}
function smf(tracks: Ev[][]): Uint8Array {
  const head = [...text('MThd'), ...u32(6), 0, 1, 0, tracks.length, PPQ >> 8, PPQ & 255];
  return new Uint8Array([...head, ...tracks.flatMap(track)]);
}

/* ---------- 曲 ---------- */
/** 決まった乱数（ベロシティのゆらぎ） */
let seed = 7;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

interface Part {
  name: string;
  ch: number;
  prog: number;
  vol: number;
  pan: number;
  ev: Ev[];
}
const part = (name: string, ch: number, prog: number, vol: number, pan: number): Part => {
  const ev: Ev[] = [{ b: 0, o: 0, bytes: [0xff, 0x03, ...vlq(text(name).length), ...text(name)] }];
  if (ch !== 9) ev.push({ b: 0, o: 1, bytes: [0xc0 | ch, prog] });
  ev.push({ b: 0, o: 2, bytes: [0xb0 | ch, 7, vol] }, { b: 0, o: 2, bytes: [0xb0 | ch, 10, pan] });
  return { name, ch, prog, vol, pan, ev };
};
/** 音を足す。b は拍、d は長さ（拍）、v はベロシティ（ゆらぎを足す） */
const note = (p: Part, b: number, d: number, n: number, v: number) => {
  const vel = Math.max(1, Math.min(127, Math.round(v + (rnd() - 0.5) * 10)));
  p.ev.push({ b, o: 4, bytes: [0x90 | p.ch, n, vel] }, { b: b + d, o: 3, bytes: [0x80 | p.ch, n, 0] });
};

const BAR = 4;
/* 和音: [ベースの根音, 鍵盤の和音] */
const CH: Record<string, [number, number[]]> = {
  Dm7: [38, [62, 65, 69, 72]],
  Bb: [34, [58, 62, 65, 69]],
  C: [36, [60, 64, 67, 72]],
  Am7: [33, [57, 60, 64, 67]],
  Gm7: [43, [55, 58, 62, 65]],
  C7: [36, [58, 60, 64, 67]],
  F: [41, [53, 57, 60, 64]],
  A7: [45, [57, 61, 64, 67]],
};
const A_PROG = ['Dm7', 'Bb', 'C', 'Am7'];
const B_PROG = ['Gm7', 'C7', 'F', 'A7'];

/* 小節の並び: 前奏 4・A 8・B 8・A' 8・終わり 1 */
type Sec = 'in' | 'A' | 'B' | 'A2' | 'end';
const bars: { sec: Sec; ch: string; i: number }[] = [];
for (let i = 0; i < 4; i++) bars.push({ sec: 'in', ch: A_PROG[i], i });
for (let i = 0; i < 8; i++) bars.push({ sec: 'A', ch: A_PROG[i % 4], i });
for (let i = 0; i < 8; i++) bars.push({ sec: 'B', ch: B_PROG[i % 4], i });
for (let i = 0; i < 8; i++) bars.push({ sec: 'A2', ch: A_PROG[i % 4], i });
bars.push({ sec: 'end', ch: 'Dm7', i: 0 });

/* 旋律 [拍, 長さ, 音] の 8 小節ずつ */
const MEL_B: [number, number, number][][] = [
  [
    [0, 1.5, 74],
    [1.5, 0.5, 77],
    [2, 1, 79],
    [3, 1, 82],
  ],
  [
    [0, 2, 81],
    [2, 0.5, 79],
    [2.5, 0.5, 77],
    [3, 1, 76],
  ],
  [
    [0, 1, 77],
    [1, 1, 81],
    [2, 2, 84],
  ],
  [
    [0, 1, 85],
    [1, 1, 81],
    [2, 1, 79],
    [3, 1, 76],
  ],
  [
    [0, 1.5, 79],
    [1.5, 0.5, 82],
    [2, 1, 86],
    [3, 1, 84],
  ],
  [
    [0, 1, 82],
    [1, 1, 81],
    [2, 1, 79],
    [3, 1, 76],
  ],
  [
    [0, 1, 77],
    [1, 0.5, 76],
    [1.5, 0.5, 77],
    [2, 2, 81],
  ],
  [
    [0, 2, 85],
    [2, 2, 76],
  ],
];
const MEL_A: [number, number, number][][] = [
  [
    [0, 1, 74],
    [1, 0.5, 77],
    [1.5, 0.5, 81],
    [2, 2, 84],
  ],
  [
    [0, 1, 82],
    [1, 1, 81],
    [2, 2, 77],
  ],
  [
    [0, 1, 79],
    [1, 0.5, 76],
    [1.5, 0.5, 79],
    [2, 2, 84],
  ],
  [
    [0, 3, 81],
    [3, 1, 79],
  ],
  [
    [0, 1, 77],
    [1, 1, 81],
    [2, 1, 86],
    [3, 1, 84],
  ],
  [
    [0, 2, 82],
    [2, 1, 81],
    [3, 1, 77],
  ],
  [
    [0, 1, 79],
    [1, 1, 84],
    [2, 1, 88],
    [3, 1, 84],
  ],
  [
    [0, 2, 81],
    [2, 2, 76],
  ],
];

function groove(): Uint8Array {
  const ep = part('Electric Piano', 0, 4, 96, 50),
    bass = part('Bass', 1, 33, 110, 64),
    str = part('Strings', 2, 48, 84, 80),
    brass = part('Brass', 3, 61, 92, 40),
    fl = part('Flute', 4, 73, 100, 72),
    mar = part('Vibraphone', 5, 11, 80, 92),
    dr = part('Drums', 9, 0, 110, 64);
  const parts = [ep, bass, str, brass, fl, mar, dr];
  /* テンポと拍子 */
  const us = Math.round(60e6 / 108),
    cond: Ev[] = [
      { b: 0, o: 0, bytes: [0xff, 0x03, ...vlq(text('FM Groove').length), ...text('FM Groove')] },
      { b: 0, o: 0, bytes: [0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255] },
      { b: 0, o: 0, bytes: [0xff, 0x58, 4, 4, 2, 24, 8] },
    ];
  const K = 36,
    S = 38,
    HH = 42,
    OH = 46,
    CR = 49,
    RD = 51,
    SPL = 55,
    TAMB = 54,
    COW = 56,
    CONGA = [62, 63, 64],
    TOMS = [50, 48, 47, 45, 43, 41];
  bars.forEach((x, k) => {
    const b0 = k * BAR,
      [root, chord] = CH[x.ch],
      last = x.i === 7 || (x.sec === 'in' && x.i === 3);
    /* 鍵盤 */
    if (x.sec === 'A' || x.sec === 'A2')
      for (const [o, d, v] of [
        [0, 0.9, 84],
        [1.5, 0.4, 70],
        [2.5, 0.4, 72],
        [3, 0.9, 78],
      ])
        for (const n of chord) note(ep, b0 + o, d, n, v);
    else if (x.sec === 'B') for (const o of [0, 2]) for (const n of chord) note(ep, b0 + o, 1.9, n, 72);
    /* ベース */
    if (x.sec === 'in' && x.i >= 2) note(bass, b0, 3.8, root, 90);
    else if (x.sec === 'A' || x.sec === 'A2' || x.sec === 'B') {
      const pat: [number, number, number][] =
        x.sec === 'B'
          ? [
              [0, 1.4, 0],
              [1.5, 0.45, 7],
              [2, 0.9, 0],
              [3, 0.45, 12],
              [3.5, 0.45, 10],
            ]
          : [
              [0, 0.45, 0],
              [0.5, 0.45, 0],
              [1, 0.45, 12],
              [1.5, 0.45, 0],
              [2, 0.45, 7],
              [2.5, 0.45, 0],
              [3, 0.45, 10],
              [3.5, 0.45, 12],
            ];
      for (const [o, d, iv] of pat) note(bass, b0 + o, d, root + iv, o % 1 ? 82 : 100);
    }
    /* ストリングス: 前奏・B・A' に全音符 */
    if (x.sec === 'in' || x.sec === 'B' || x.sec === 'A2')
      for (const n of chord) note(str, b0, 3.9, n + 12, x.sec === 'A2' ? 64 : 76);
    /* ブラス: A と A' の裏拍に短く */
    if ((x.sec === 'A' && x.i % 2 === 1) || x.sec === 'A2')
      for (const o of [1.5, 3]) for (const n of chord.slice(1)) note(brass, b0 + o, 0.3, n + 12, 96);
    /* フルート: B と A' の旋律 */
    if (x.sec === 'B') for (const [o, d, n] of MEL_B[x.i]) note(fl, b0 + o, d * 0.95, n, 92);
    if (x.sec === 'A2') for (const [o, d, n] of MEL_A[x.i]) note(fl, b0 + o, d * 0.95, n, 96);
    /* ビブラフォン: B で和音の分散 */
    if (x.sec === 'B') {
      const arp = [...chord, chord[0] + 12, ...chord.slice(1).reverse()];
      for (let s = 0; s < 8; s++) note(mar, b0 + s * 0.5, 0.45, arp[s % arp.length] + 12, s % 2 ? 60 : 76);
    }
    /* 打楽器 */
    if (x.sec === 'in') {
      for (let s = 0; s < 8; s++) note(dr, b0 + s * 0.5, 0.1, HH, s % 2 ? 50 : 70);
      if (x.i === 3) for (const [j, t] of TOMS.entries()) note(dr, b0 + 2.5 + j * 0.25, 0.1, t, 90 + j * 4);
      else note(dr, b0, 0.1, K, 90);
    } else if (x.sec === 'A' || x.sec === 'A2') {
      if (x.i === 0) note(dr, b0, 0.1, x.sec === 'A' ? CR : SPL, 110);
      for (const o of [0, 1.5, 2.5]) note(dr, b0 + o, 0.1, K, o ? 96 : 112);
      for (const o of [1, 3]) note(dr, b0 + o, 0.1, S, 108);
      for (let s = 0; s < 8; s++) if (s !== 7) note(dr, b0 + s * 0.5, 0.1, HH, s % 2 ? 58 : 80);
      note(dr, b0 + 3.5, 0.4, OH, 84);
      for (const o of [1, 3]) note(dr, b0 + o, 0.1, TAMB, 60);
      if (last) {
        note(dr, b0 + 3.25, 0.1, S, 70);
        note(dr, b0 + 3.75, 0.1, S, 86);
      }
    } else if (x.sec === 'B') {
      if (x.i === 0) note(dr, b0, 0.1, CR, 110);
      for (const o of [0, 2]) note(dr, b0 + o, 0.1, K, 104);
      for (const o of [1, 3]) note(dr, b0 + o, 0.1, S, 100);
      note(dr, b0 + 2.75, 0.1, S, 44);
      for (let s = 0; s < 4; s++) note(dr, b0 + s, 0.1, RD, 76);
      for (const [o, c] of [
        [0.5, 1],
        [1, 2],
        [1.5, 0],
        [2.5, 1],
        [3, 2],
        [3.5, 1],
      ])
        note(dr, b0 + o, 0.1, CONGA[c], 70);
      if (x.i % 4 === 3) note(dr, b0 + 3.5, 0.1, COW, 74);
      if (last) for (const [j, t] of TOMS.entries()) note(dr, b0 + 2.5 + j * 0.25, 0.1, t, 92 + j * 3);
    } else {
      /* 終わり: 全員で 1 つ鳴らして伸ばす */
      note(dr, b0, 0.1, CR, 118);
      note(dr, b0, 0.1, K, 120);
      for (const n of chord) {
        note(ep, b0, 3.5, n, 96);
        note(str, b0, 3.8, n + 12, 80);
      }
      note(bass, b0, 3, root, 110);
      note(fl, b0, 3.5, 74, 92);
      note(brass, b0, 0.6, 81, 100);
      note(brass, b0, 0.6, 77, 100);
    }
  });
  return smf([cond, ...parts.map((p) => p.ev)]);
}

/**
 * 各トラックの頭にプログラムチェンジを足す（音色のない MIDI に楽器を当てる）。progs はチャンネル → プログラム。
 * トラックのチャンネルは、そのトラックで最初のチャンネルのメッセージで決める
 */
function withPrograms(src: Uint8Array, progs: Record<number, number>): Uint8Array {
  const out: number[] = [...src.subarray(0, 14)];
  let p = 14;
  while (p + 8 <= src.length) {
    const len = (src[p + 4] << 24) | (src[p + 5] << 16) | (src[p + 6] << 8) | src[p + 7],
      body = src.subarray(p + 8, p + 8 + len),
      ch = body.findIndex((b, i) => i > 0 && b >= 0x80 && b < 0xf0 && body[i - 1] < 0x80),
      c = ch >= 0 ? body[ch] & 0x0f : -1,
      add = c >= 0 && progs[c] !== undefined ? [0, 0xc0 | c, progs[c]] : [];
    out.push(...text('MTrk'), ...u32(len + add.length), ...add, ...body);
    p += 8 + len;
  }
  return new Uint8Array(out);
}

const MU = 'https://www.mutopiaproject.org/ftp/';
async function get(path: string): Promise<Uint8Array> {
  const r = await fetch(MU + path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

writeFileSync(new URL('fm-groove.mid', DIR), groove());
copyFileSync(new URL('../src/tools/fm-synth/scores/kv525.mid', import.meta.url), new URL('kv525.mid', DIR));
/* ベートーヴェン「行進曲 WoO 29」（Mutopia 991）: 音色はもとの MIDI のまま（イングリッシュホルン・ファゴット・クラリネット） */
writeFileSync(new URL('woo29.mid', DIR), await get('BeethovenLv/WoO29/marsch_woo29/marsch_woo29.mid'));
/* ペツェル「ソナタ 第 24 番」（Mutopia 1648）: ソプラノ・テノール・バスの 3 声にトランペット・トロンボーン・チューバを当てる */
writeFileSync(
  new URL('pezel24.mid', DIR),
  withPrograms(await get('PezeliusJ/PezeliusJ-sonata24/PezeliusJ-sonata24.mid'), { 0: 56, 1: 57, 2: 58 }),
);
console.log('songs written');
