/**
 * src/tools/guitar/chaconne.ts（ギター音響モデルで演奏するシャコンヌの音符と運指）を、
 * src/tools/guitar/chaconne.mid から作る。bun run chaconne で実行する。
 *
 * chaconne.mid の音（どのトラック・チャンネルでもよい）の高さ・時刻・長さを使い、弦とフレットは
 * このツールの運指（score.ts の finger、標準の調弦）で付ける。時刻と長さは 4 分音符の 1/480 に丸める（和音をずらして弾く細かい時刻も残す）。
 * テンポは、MIDI に変化があれば、ページの標準のテンポ（score.ts の bpm）に対する比として TEMPO に入れる（MIDI の値のとおりに鳴る）。ベロシティは、MIDI に 2 つ以上の値があれば
 * 音符に入れる（弾く強さになる）。どちらも、Mutopia から作ったままの MIDI にはない（MIDI を編集して付ける）
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { finger, PIECES } from '../src/tools/guitar/score';
import { noteName, setOf, tuningOf } from '../src/tools/guitar/strings';
import { readMidi, tempoSteps } from './score-midi';

const SRC = new URL('../src/tools/guitar/chaconne.mid', import.meta.url),
  OUT = new URL('../src/tools/guitar/chaconne.ts', import.meta.url);
/** 1 拍の分割、弱起の拍、1 小節の拍 */
const DIV = 480,
  PICKUP = 2,
  BAR = 3;
const open = tuningOf('std').notes,
  frets = setOf('nylon').frets;

const where = (t: number) => {
  const b = t / DIV - PICKUP,
    bar = Math.floor(b / BAR) + 1;
  return `${bar} 小節 ${(b - (bar - 1) * BAR + 1).toFixed(2)} 拍目`;
};

const midi = readMidi(readFileSync(SRC)),
  { ppq, notes: raw } = midi;
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
    return { t, d: Math.max(1, q(x.t1) - t), n: x.n, v: x.v ?? 64 };
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
  .map((x, i) => ({ ...x, t: ns[i].t, d: ns[i].d, v: ns[i].v }))
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
/* ベロシティは、2 つ以上の値があるときだけ入れる */
const vels = notes.map((x) => x.v),
  hasVel = new Set(vels).size > 1,
  width = hasVel ? 11 : 9;
let data = '',
  prev = 0;
for (const x of notes) {
  if (x.n < 40) throw new Error(`${where(x.t)}: 低すぎる音 ${noteName(x.n)}`);
  data += enc(x.t - prev, 3) + enc(x.d, 3) + enc(x.n - 40, 1) + enc(x.s * 24 + x.f, 2) + (hasVel ? enc(x.v, 2) : '');
  prev = x.t;
}
/* テンポの変化（ページの標準のテンポに対する比） */
const base = 60e6 / (PIECES.find((p) => p.v === 'bwv1004')?.bpm ?? 60),
  tempo = tempoSteps(
    midi.tempo.map((x) => [q(x.t), Math.round((base / x.us) * 10000) / 10000]),
    null,
  ).map(([t, r]) => [t / DIV, r]);
/* 書き出す .ts の、テンポと強弱の説明（入れたときだけ）、テンポの表、ベロシティを読む行 */
const edits = [
    ...(tempo.length
      ? [
          `\n * テンポは、chaconne.mid の変化（♩ = ${+(60e6 / base).toFixed(2)} が基本）を、基本に対する比として TEMPO に入れた。`,
        ]
      : []),
    ...(hasVel ? ['\n * ベロシティは chaconne.mid の値をそのまま入れた（弾く強さになる）。'] : []),
  ].join(''),
  tempoSrc = tempo.length ? `[\n${tempo.map(([t, r]) => `  [${t}, ${r}],`).join('\n')}\n]` : '[]',
  velSrc = hasVel ? '\n      v: v(DATA.slice(i + 9, i + 11)),' : '';
const lines = data.match(new RegExp(`.{1,${width * 12}}`, 'g')) ?? [],
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
 * 弦とフレットは、このツールの運指（score.ts の finger、標準の調弦・${frets} フレット）で付けた。${edits}
 *
 * このファイルと chaconne.mid は原作と同じ Creative Commons Attribution-ShareAlike 3.0 Unported
 * （https://creativecommons.org/licenses/by-sa/3.0/）で公開する。リポジトリのほかのファイルの MIT ライセンスは適用しない。
 *
 * SPDX-License-Identifier: CC-BY-SA-3.0
 */
import type { Placed } from './score';

/** 1 拍（4 分音符）を ${DIV} に分けた時刻・長さ。1 音 ${width} 文字: 前の音からの間（3）、長さ（3）、音の高さ − 40（1）、弦 × 24 + フレット（2）${hasVel ? '、ベロシティ（2）' : ''} */
const DATA =
${lines.map((l) => `  '${l}'`).join(' +\n')};

const A = '${A}';
const v = (s: string) => [...s].reduce((x, c) => x * 64 + A.indexOf(c), 0);

/** テンポの変化: [拍, 基本のテンポに対する比]。最初の項より前の比は 1 */
export const TEMPO: readonly [number, number][] = ${tempoSrc};

/** 音符と運指（${notes.length} 音、${bars} 小節あまり。最初の ${PICKUP} 拍は弱起） */
export function chaconne(): Placed[] {
  const out: Placed[] = [];
  let t = 0;
  for (let i = 0; i < DATA.length; i += ${width}) {
    t += v(DATA.slice(i, i + 3));
    const sf = v(DATA.slice(i + 7, i + 9));
    out.push({
      t: t / ${DIV},
      d: v(DATA.slice(i + 3, i + 6)) / ${DIV},
      n: v(DATA[i + 6]) + 40,
      s: Math.floor(sf / 24),
      f: sf % 24,${velSrc}
    });
  }
  return out;
}
`;
writeFileSync(OUT, src);
console.log(
  `wrote src/tools/guitar/chaconne.ts（${notes.length} 音${rounded ? `、時刻・長さを 1/${DIV} 拍に丸めた箇所 ${rounded}` : ''}` +
    `${tempo.length ? `、テンポの変化 ${tempo.length} 個` : ''}${hasVel ? `、ベロシティ ${Math.min(...vels)}〜${Math.max(...vels)}` : ''}）`,
);
