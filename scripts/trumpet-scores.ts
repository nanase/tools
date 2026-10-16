/**
 * src/tools/trumpet/scores/*.ts（トランペットの物理モデルで演奏する曲の音符）を、同じディレクトリの *.ly から作る。
 * bun scripts/trumpet-scores.ts で実行する。
 *
 * .ly の旋律の声部を scripts/score-ly.ts で直接読む（スラー・トリル・フェルマータ・強弱・スタッカート・アクセント・テヌートを残すため）。
 * 音の高さは実音にする（B♭ 管の記譜で書かれた譜は長 2 度下げる）。反復は演奏順に展開し、装飾音は除く。
 * 時刻と長さは 4 分音符の 1/960 に丸める。小節線は拍子から作る（楽譜の小節線 | とずれれば止める）
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ACCENT, DYNS, HAIRS, STACC, TENUTO, TICKS } from '../src/tools/trumpet/scores/types';
import { type LyNote, type LyOpt, readLy } from './score-ly';

const DIR = new URL('../src/tools/trumpet/scores/', import.meta.url);
const file = (name: string) => readFileSync(new URL(name, DIR), 'utf8');

/** \context Staff = name { … } の中身を、変数 name として読めるようにする */
function staff(src: string, name: string): string {
  const at = src.search(new RegExp(`Staff\\s*=\\s*"?${name}"?\\s*\\{`));
  if (at < 0) throw new Error(`譜表 ${name} がありません`);
  let j = src.indexOf('{', at),
    depth = 0;
  const a = j;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    if (src[j] === '}') depth--;
    if (depth === 0) break;
  }
  return `${name} = ${src.slice(a, j + 1)}\n`;
}

interface Src {
  /** 出力の名前（scores/<out>.ts） */
  out: string;
  /** 読む .ly（ファイルの先頭のコメントに書く） */
  ly: string[];
  /** 読む文字列と、旋律の変数 */
  src: () => string;
  voice: string;
  opt?: LyOpt;
  /** 1 小節の拍数 */
  meter: number;
  /** 楽譜の音から実音へのずれ [半音] */
  shift: number;
  /** 弾く部分 [始まり, 終わり]（楽譜の拍）を並べた順に弾く。start は最初の部分を置く拍（既定は最初の部分の始まり） */
  order?: [number, number][];
  start?: number;
  /** 音のない小節（全休符の小節）を除く */
  dropRests?: boolean;
  /** ファイルの先頭のコメント: 曲名、出典、音の高さ、変更 */
  title: string;
  source: string;
  pitch: string;
  changes: string;
  license: 'pd' | 'cc-by-3.0';
}

const MU = 'https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=';
const SHAMIM = 'Shamim Mohamed';
const SRCS: Src[] = [
  {
    out: 'hwv351',
    ly: ['hwv351.ly'],
    src: () => file('hwv351.ly'),
    voice: 'trompette',
    meter: 4,
    shift: -4,
    /* 前半（弱起から 9 小節目の 8 分休符の前まで）を 2 回、後半（弱起から）を 1 回。弱起の前の休みは除く */
    order: [
      [3.5, 35.5],
      [3.5, 35.5],
      [39.5, 80],
    ],
    start: -0.5,
    title: 'G. F. ヘンデル「王宮の花火の音楽 HWV 351」より ラ・レジュイサンス（トランペットの声部）',
    source: `Mutopia Project の楽譜（Cyprien Lecourt 作成、底本 IMSLP、Mutopia-2013/09/01-1864、\n * ${MU}1864）の .ly の声部（trompette）`,
    pitch:
      '楽譜はトランペットを \\transpose d c（B♭ 管の記譜でハ長調）、オルガンを \\transpose d bes, で刷るので、' +
      'ニ長調で書かれた声部を長 3 度下げて変ロ長調の実音にした。',
    changes:
      '最初の小節の休み（7/8 小節）を除いて 8 分音符の弱起にし、前半の終わりの反復記号（:|）を展開した。' +
      '後半の最初の小節の休み（7/8 小節）を除き、後半の弱起を前半の終わりの 8 分休符の位置に置いた。',
    license: 'pd',
  },
  {
    out: 'bwv-anh114',
    ly: ['bwv-anh114.ly'],
    src: () => staff(file('bwv-anh114.ly'), 'staffA'),
    voice: 'staffA',
    meter: 3,
    shift: 0,
    title: 'C. ペツォルト（伝 J. S. バッハ）「メヌエット ト長調 BWV Anh. 114」（2 本のトランペットの編曲の第 1 声部）',
    source: `Mutopia Project の楽譜（${SHAMIM} 編曲・作成、Mutopia-2011/06/19-258、\n * ${MU}258）の .ly の上の譜表（staffA）`,
    pitch: '楽譜に移調の指示はなく、書かれた音（原曲と同じト長調）をそのまま実音とした。',
    changes: '反復を演奏順に展開した。',
    license: 'pd',
  },
  {
    out: 'ave-maria',
    ly: ['ave-maria.ly'],
    src: () => staff(file('ave-maria.ly'), 'staffA'),
    voice: 'staffA',
    meter: 4,
    shift: 0,
    order: [[16, 1e9]],
    start: 0,
    title: 'C. グノー「アヴェ・マリア（バッハの前奏曲 第 1 番による瞑想曲）」（トランペットの編曲）',
    source: `Mutopia Project の楽譜（${SHAMIM} 編曲・作成、Mutopia-2013/01/06-256、\n * ${MU}256）の .ly の譜表（staffA）`,
    pitch: '楽譜に移調の指示はなく、書かれた音（ヘ長調）をそのまま実音とした。',
    changes: '最初の 4 小節の休み（前奏）を除いた。',
    license: 'pd',
  },
  {
    out: 'bwv508',
    ly: ['bwv508.ly'],
    src: () => staff(file('bwv508.ly'), 'staffA'),
    voice: 'staffA',
    meter: 3,
    shift: 0,
    title:
      'G. H. シュテルツェル（伝 J. S. バッハ）「御身がともにあるならば（Bist du bei mir）BWV 508」（トランペットの編曲）',
    source: `Mutopia Project の楽譜（${SHAMIM} 編曲・作成、Mutopia-2007/07/08-257、\n * ${MU}257）の .ly の譜表（staffA）`,
    pitch: '楽譜に移調の指示はなく、書かれた音（ハ長調）をそのまま実音とした。',
    changes: '',
    license: 'pd',
  },
  {
    out: 'napolitaine',
    ly: ['napolitaine.ly'],
    src: () => file('napolitaine.ly'),
    voice: 'trompette',
    opt: { lang: 'it' },
    meter: 2,
    shift: 0,
    order: [[2, 1e9]],
    start: 0,
    title: 'P. I. チャイコフスキー「白鳥の湖」より ナポリの踊り（L. Sardain の編曲のトランペットの声部）',
    source: `Mutopia Project の楽譜（Laurence Sardain 編曲・作成、Mutopia-2006/12/22-896、\n * ${MU}896）の .ly の声部（trompette）`,
    pitch:
      "声部は変ホ長調の実音で書かれ、楽譜では \\transpose sib do' で B♭ 管の記譜（ヘ長調）にして刷るので、書かれた音をそのまま実音とした。",
    changes: '最初の 1 小節の休み（前奏）を除いた。',
    license: 'pd',
  },
  {
    out: 'hwv56',
    ly: ['hwv56-tromba.ily', 'hwv56-global.ily'],
    /* 弱起（\partial 4）は global.ily にあるので、声部の前に足す */
    src: () => `tromba = { \\partial 4 ${file('hwv56-tromba.ily')} }\n`,
    voice: 'tromba',
    opt: { lang: 'it', absolute: true },
    meter: 3,
    shift: 0,
    /* A の部分（Fine まで）。トランペットが休む小節は除く */
    order: [[-1, 467]],
    dropRests: true,
    title: 'G. F. ヘンデル「メサイア HWV 56」より ラッパは鳴り響き（The trumpet shall sound）のトランペットの声部',
    source:
      'Mutopia Project の楽譜（Nicolas Sceaux 作成、底本 Chrysander 編のドイツ・ヘンデル協会版 第 45 巻（1902 年）、' +
      `Mutopia-2009/12/15-1732、\n * ${MU}1732）の Messiah-lys.zip の CDairBass/tromba.ily（拍子と弱起は CDairBass/global.ily）`,
    pitch: 'D 管のトランペットの声部はニ長調の実音で書かれているので、書かれた音をそのまま実音とした。',
    changes:
      'アリアの A の部分（Fine まで）だけを弾き、B の部分（トランペットは休み）とダル・セーニョの繰り返しは除いた。' +
      'トランペットが休む小節（全休符の小節）は除いた。',
    license: 'cc-by-3.0',
  },
  {
    out: 'taps',
    ly: ['taps.ly'],
    src: () => file('taps.ly'),
    voice: 'taps',
    meter: 4,
    shift: -2,
    title: '消灯ラッパ（Taps、米軍のビューグルの号令）',
    source:
      'Wikimedia Commons の楽譜「File:Bugle Calls Taps.svg」（Jazzmanian 作、2007 年、パブリックドメイン、\n' +
      ' * https://commons.wikimedia.org/wiki/File:Bugle_Calls_Taps.svg）を手で写した taps.ly',
    pitch:
      'ハ調のビューグルの記譜（G4 C5 E5 G5）を、B♭ 管のトランペットがピストンを押さずに吹く実音（F4 B♭4 D5 F5）へ長 2 度下げた。',
    changes: '',
    license: 'pd',
  },
];

const q = (x: number) => Math.round(x * TICKS);
const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const nameOf = (n: number) => `${NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
const mod = (x: number, m: number) => {
  const r = ((x % m) + m) % m;
  return r > m - 1e-6 ? 0 : r;
};

/** 部分 [a, b) から、音のない小節を除いて分ける */
function dropRestBars(ns: LyNote[], order: [number, number][], m: number): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of order) {
    for (let k = Math.floor(a / m); k * m < b; k++) {
      const lo = Math.max(a, k * m),
        hi = Math.min(b, (k + 1) * m);
      if (!ns.some((x) => x.t < hi - 1e-9 && x.t + x.d > lo + 1e-9)) continue;
      const last = out[out.length - 1];
      if (last && Math.abs(last[1] - lo) < 1e-9) last[1] = hi;
      else out.push([lo, hi]);
    }
  }
  return out;
}

/** 部分を並べ直す（音の始まりが部分にある音を、部分の中で切って並べる） */
function arrange(ns: LyNote[], order: [number, number][], start: number, m: number): LyNote[] {
  const out: LyNote[] = [];
  let at = start;
  for (const [a, b] of order) {
    if (mod(at - a, m) > 1e-6) throw new Error(`部分 [${a}, ${b}] の置き場所 ${at} が小節とずれます`);
    for (const x of ns) {
      if (x.t < a - 1e-9 && x.t + x.d > a + 1e-9) throw new Error(`拍 ${a} で音が切れます`);
      if (x.t >= a - 1e-9 && x.t < b - 1e-9) out.push({ ...x, t: x.t - a + at, d: Math.min(x.d, b - x.t) });
    }
    at += b - a;
  }
  return out;
}

/** 1 声部を文字列にする（types.ts の decodeVoice の逆） */
function encode(ns: LyNote[], shift: number): string {
  let prev = 0;
  return ns
    .map((x) => {
      const t = q(x.t),
        d = q(x.t + x.d) - t,
        hair = x.hair ? HAIRS.indexOf(x.hair) + 1 : 0,
        dyn = x.dyn ? DYNS.indexOf(x.dyn as (typeof DYNS)[number]) + 1 : 0,
        f =
          (x.slurOn ? 1 : 0) |
          (x.slurOff ? 2 : 0) |
          (x.trill ? 4 : 0) |
          (x.fermata ? 8 : 0) |
          (hair << 4) |
          (dyn << 6) |
          (x.stacc ? STACC : 0) |
          (x.accent ? ACCENT : 0) |
          (x.tenuto ? TENUTO : 0);
      if (dyn < 0) throw new Error(`強弱 ${x.dyn} を表せません`);
      const s = `${t - prev},${d},${f},${x.n[0] + shift}`;
      prev = t;
      return s;
    })
    .join(' ');
}

/** 長い文字列を、行の長さが 120 字を超えないように分けて連結する式にする */
function split(s: string, indent: string): string {
  const parts: string[] = [];
  for (let i = 0; i < s.length; ) {
    let j = Math.min(s.length, i + 110);
    if (j < s.length) j = s.lastIndexOf(' ', j) + 1 || j;
    parts.push(s.slice(i, j));
    i = j;
  }
  return parts.map((p) => `${indent}'${p}'`).join(' +\n');
}

for (const s of SRCS) {
  const checks: number[] = [],
    raw = readLy(s.src(), s.voice, checks, 'chain', s.opt).filter((x) => x.d > 0);
  if (raw.some((x) => x.n.length > 1)) throw new Error(`${s.out}: 和音があります`);
  /* 楽譜の小節線が拍子の小節と合うか */
  const off = checks.filter((b) => mod(b, s.meter) > 1e-6);
  if (off.length) throw new Error(`${s.out}: 小節線 | が拍子とずれます（拍 ${off.slice(0, 5).join(', ')}）`);
  const end0 = Math.max(...raw.map((x) => x.t + x.d));
  let order = s.order ?? [[Math.min(0, raw[0].t), end0]];
  order = order.map(([a, b]) => [a, Math.min(b, end0)]);
  if (s.dropRests) order = dropRestBars(raw, order, s.meter);
  const ns = arrange(raw, order, s.start ?? order[0][0], s.meter),
    t0 = ns[0].t,
    end = Math.max(...ns.map((x) => x.t + x.d));
  /* 小節線: 最初の音より後で、曲の終わりより前（弱起があれば 0 も含む） */
  const bl: number[] = [];
  for (let b = Math.ceil((t0 + 1e-6) / s.meter) * s.meter; b < end - 1e-6; b += s.meter) bl.push(q(b));
  const ps = ns.map((x) => x.n[0] + s.shift),
    lo = Math.min(...ps),
    hi = Math.max(...ps),
    lic =
      s.license === 'pd'
        ? s.out === 'taps'
          ? ' * 号令はパブリックドメイン（元の楽譜もパブリックドメイン）。このファイルと taps.ly も著作権を主張しない。'
          : ' * 原作はパブリックドメイン（Mutopia の表記は Public Domain）。このファイルと元の .ly も著作権を主張しない。'
        : ' * このファイルと元の .ly・.ily は原作と同じ Creative Commons Attribution 3.0 Unported\n' +
          ' * （https://creativecommons.org/licenses/by/3.0/）で公開する。リポジトリのほかのファイルの MIT ライセンスは適用しない。\n' +
          ' *\n * SPDX-License-Identifier: CC-BY-3.0';
  const body = `/**
 * ${s.title}の音符。
 * scripts/trumpet-scores.ts で ${s.ly.join('・')} から作る（直接編集しない）。
 *
 * 音符は ${s.source}を読んだもの。
 * 音の高さは実音（MIDI）。${s.pitch}
 * 変更: ${s.changes}時刻と長さを 4 分音符の 1/960 に丸めた。
 *
${lic}
 */
import { decodeVoice, type ScoreNote, TICKS } from './types';

/** 声部の音（${ns.length} 音。形式は types.ts の decodeVoice） */
const VOICES = [
${split(encode(ns, s.shift), '  ')},
];

/** 小節線の時刻（1/960 拍） */
const BARS = [${bl.join(', ')}];

export const voices = (): ScoreNote[][] => VOICES.map(decodeVoice);
export const bars = (): number[] => BARS.map((b) => b / TICKS);
`;
  writeFileSync(new URL(`${s.out}.ts`, DIR), body);
  console.log(
    `${s.out}: ${ns.length} 音、${t0} 〜 ${end} 拍、${bl.length + 1} 小節、` +
      `${nameOf(lo)}（${lo}）〜 ${nameOf(hi)}（${hi}）、楽譜の小節線 ${checks.length}`,
  );
}
/* 書いたファイルをリポジトリの書式にそろえる */
spawnSync(
  process.execPath,
  ['x', 'biome', 'format', '--write', ...SRCS.map((s) => fileURLToPath(new URL(`${s.out}.ts`, DIR)))],
  {
    stdio: 'inherit',
  },
);
