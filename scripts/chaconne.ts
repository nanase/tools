/**
 * src/tools/guitar/chaconne.ts（ギター音響モデルで演奏するシャコンヌの音符と運指）を、
 * src/tools/guitar/chaconne.mid から作る。bun run chaconne で実行する。
 *
 * chaconne.mid の音（どのトラック・チャンネルでもよい）の高さ・時刻・長さだけを使い、弦とフレットは
 * このツールの運指（score.ts の finger、標準の調弦）で付ける。時刻と長さは 4 分音符の 1/480 に丸める（和音をずらして弾く細かい時刻も残す）。ベロシティは使わない
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { finger } from '../src/tools/guitar/score';
import { noteName, setOf, tuningOf } from '../src/tools/guitar/strings';

const SRC = new URL('../src/tools/guitar/chaconne.mid', import.meta.url),
  OUT = new URL('../src/tools/guitar/chaconne.ts', import.meta.url);
/** 1 拍の分割、弱起の拍、1 小節の拍 */
const DIV = 480,
  PICKUP = 2,
  BAR = 3;
const open = tuningOf('std').notes,
  frets = setOf('nylon').frets;

interface Raw {
  n: number;
  t0: number;
  t1: number;
}

/** SMF を読み、すべてのトラックの音（時刻は tick）と、4 分音符の tick 数を返す */
function readMidi(buf: Uint8Array): { ppq: number; notes: Raw[] } {
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
  const notes: Raw[] = [];
  for (let k = 0; k < ntr; k++) {
    if (tag() !== 'MTrk') throw new Error(`トラック ${k + 1} が壊れています`);
    const end = u32() + p;
    let t = 0,
      run = 0;
    const on = new Map<number, number[]>();
    while (p < end) {
      t += vlq();
      let st = buf[p];
      if (st & 0x80) p++;
      else st = run;
      /* メタイベント（種類の 1 バイトを飛ばす）とシステムエクスクルーシブは読み飛ばす */
      if (st === 0xff || st === 0xf0 || st === 0xf7) {
        if (st === 0xff) p++;
        const len = vlq();
        p += len;
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
        if (t0 !== undefined) notes.push({ n: a, t0, t1: t });
      }
    }
    p = end;
  }
  return { ppq, notes };
}

const where = (t: number) => {
  const b = t / DIV - PICKUP,
    bar = Math.floor(b / BAR) + 1;
  return `${bar} 小節 ${(b - (bar - 1) * BAR + 1).toFixed(2)} 拍目`;
};

const { ppq, notes: raw } = readMidi(readFileSync(SRC));
const errs: string[] = [];
let rounded = 0;
const q = (tick: number) => {
  const v = (tick * DIV) / ppq;
  if (Math.abs(v - Math.round(v)) > 1e-9) rounded++;
  return Math.round(v);
};
const ns = raw
  .map((x) => {
    const t = q(x.t0);
    return { t, d: Math.max(1, q(x.t1) - t), n: x.n };
  })
  .sort((a, b) => a.t - b.t || a.n - b.n);
/*
 * 少しずらして弾く和音（前の音が鳴っているうちに ROLL 以内で続く音。同じ高さは含めない）は、
 * 運指では同時の和音として別の弦に置く。時刻は運指を求めたあとで戻す
 */
const ROLL = DIV / 10,
  at = ns.map((x) => x.t);
for (let i = 1, g = 0; i < ns.length; i++) {
  /* 同時の音は前の音と同じ扱い */
  if (ns[i].t === ns[i - 1].t) at[i] = at[i - 1];
  else if (ns[i].t - ns[g].t <= ROLL && ns.slice(g, i).every((y) => y.t + y.d > ns[i].t && y.n !== ns[i].n))
    at[i] = ns[g].t;
  else g = i;
}
/* 運指は拍の単位で求める */
const notes = finger(
  ns.map((x, i) => ({ t: at[i] / DIV, d: x.d / DIV, n: x.n })),
  open,
  frets,
)
  .map((x, i) => ({ ...x, t: ns[i].t, d: ns[i].d }))
  .sort((a, b) => a.t - b.t || a.s - b.s);
for (const x of notes) if (x.s < 0) errs.push(`${where(x.t)}: ${noteName(x.n)} はどの弦でも押さえられません`);
if (errs.length) {
  console.error(errs.join('\n'));
  process.exit(1);
}

const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const enc = (v: number, w: number) => {
  if (v < 0 || v >= 64 ** w) throw new Error(`符号にできない値 ${v}`);
  let s = '';
  for (let k = 0; k < w; k++, v = Math.floor(v / 64)) s = A[v % 64] + s;
  return s;
};
let data = '',
  prev = 0;
for (const x of notes) {
  if (x.n < 40) throw new Error(`${where(x.t)}: 低すぎる音 ${noteName(x.n)}`);
  data += enc(x.t - prev, 3) + enc(x.d, 3) + enc(x.n - 40, 1) + enc(x.s * 24 + x.f, 2);
  prev = x.t;
}
const lines = data.match(/.{1,108}/g) ?? [],
  last = Math.max(...notes.map((x) => x.t + x.d)) / DIV,
  bars = Math.floor((last - PICKUP) / BAR);

const src = `/**
 * J. S. バッハ「無伴奏ヴァイオリンのためのパルティータ第 2 番 BWV 1004」より シャコンヌ の音符と運指。
 * scripts/chaconne.ts で chaconne.mid から作る（直接編集しない）。
 *
 * 音符は Mutopia Project の楽譜（Hajo Dezelski 入力、底本 Bach-Gesellschaft Edition 1879 Band 27.1、
 * Mutopia-2019/05/30-1426、https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1426）の MIDI から変換した。
 * 変更: 実音を 1 オクターブ下げてギターの音域に移し、同じ時刻の同じ高さの音を 1 つにまとめ、
 * arpeggio の指示のある和音（小節 89〜120・201〜208）を分散和音に展開した。そのうえで chaconne.mid を手で編集した
 * （分散和音の弾き方、和音をずらして弾く時刻、音の長さなど）。
 * 弦とフレットは、このツールの運指（score.ts の finger、標準の調弦・${frets} フレット）で付けた。
 *
 * このファイルと chaconne.mid は原作と同じ Creative Commons Attribution-ShareAlike 3.0 Unported
 * （https://creativecommons.org/licenses/by-sa/3.0/）で公開する。リポジトリのほかのファイルの MIT ライセンスは適用しない。
 *
 * SPDX-License-Identifier: CC-BY-SA-3.0
 */
import type { Placed } from './score';

/** 1 拍（4 分音符）を ${DIV} に分けた時刻・長さ。1 音 9 文字: 前の音からの間（3）、長さ（3）、音の高さ − 40（1）、弦 × 24 + フレット（2） */
const DATA =
${lines.map((l) => `  '${l}'`).join(' +\n')};

const A = '${A}';
const v = (s: string) => [...s].reduce((x, c) => x * 64 + A.indexOf(c), 0);

/** 音符と運指（${notes.length} 音、${bars} 小節あまり。最初の ${PICKUP} 拍は弱起） */
export function chaconne(): Placed[] {
  const out: Placed[] = [];
  let t = 0;
  for (let i = 0; i < DATA.length; i += 9) {
    t += v(DATA.slice(i, i + 3));
    const sf = v(DATA.slice(i + 7, i + 9));
    out.push({
      t: t / ${DIV},
      d: v(DATA.slice(i + 3, i + 6)) / ${DIV},
      n: v(DATA[i + 6]) + 40,
      s: Math.floor(sf / 24),
      f: sf % 24,
    });
  }
  return out;
}
`;
writeFileSync(OUT, src);
console.log(
  `wrote src/tools/guitar/chaconne.ts（${notes.length} 音${rounded ? `、時刻・長さを 1/${DIV} 拍に丸めた箇所 ${rounded}` : ''}）`,
);
