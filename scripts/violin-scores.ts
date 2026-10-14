/**
 * src/tools/violin/scores/*.ts（ヴァイオリンの物理モデルで演奏する曲の音符）を、同じディレクトリの *.ly から作る。
 * bun scripts/violin-scores.ts で実行する。
 *
 * .ly は Mutopia Project の楽譜。LilyPond で MIDI にせず、.ly の声部を scripts/score-ly.ts で直接読む
 * （スラー・トリル・フェルマータ・強弱の記号を残すため）。反復は演奏順に展開し、装飾音は除く。
 * 時刻と長さは 4 分音符の 1/960 に丸める。小節線（|）の時刻も残す（なければ拍子から作る）
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DYNS, HAIRS, TICKS } from '../src/tools/violin/scores/types';
import { type LyNote, readLy } from './score-ly';

const DIR = new URL('../src/tools/violin/scores/', import.meta.url);

interface Src {
  /** 出力の名前（scores/<out>.ts） */
  out: string;
  ly: string;
  /** 読む声部の変数 */
  voices: string[];
  /** 1 小節の拍数（小節線が書かれていないとき） */
  meter: number;
  /** ファイルの先頭のコメント */
  title: string;
  mutopia: { id: number; footer: string; by: string; base: string };
  license: 'by-sa-3.0' | 'pd';
}

const BACH = 'Bach-Gesellschaft Edition 1879 Band 27.1';
const SRCS: Src[] = [
  {
    out: 'bwv1004-1',
    ly: 'bwv1004-1.ly',
    voices: ['melodyOne', 'melodyTwo'],
    meter: 4,
    title: 'J. S. バッハ「無伴奏ヴァイオリンのためのパルティータ 第 2 番 ニ短調 BWV 1004」より アルマンド',
    mutopia: { id: 1423, footer: 'Mutopia-2010/02/03-1423', by: 'Hajo Dezelski', base: BACH },
    license: 'by-sa-3.0',
  },
  {
    out: 'bwv1004-2',
    ly: 'bwv1004-2.ly',
    voices: ['melody'],
    meter: 3,
    title: 'J. S. バッハ「無伴奏ヴァイオリンのためのパルティータ 第 2 番 ニ短調 BWV 1004」より クーラント',
    mutopia: { id: 1424, footer: 'Mutopia-2008/05/18-1424', by: 'Hajo Dezelski', base: BACH },
    license: 'by-sa-3.0',
  },
  {
    out: 'bwv1004-3',
    ly: 'bwv1004-3.ly',
    voices: ['sarabanda'],
    meter: 3,
    title: 'J. S. バッハ「無伴奏ヴァイオリンのためのパルティータ 第 2 番 ニ短調 BWV 1004」より サラバンド',
    mutopia: { id: 1427, footer: 'Mutopia-2008/10/29-1427', by: 'Benjamin D. Esham', base: BACH },
    license: 'by-sa-3.0',
  },
  {
    out: 'bwv1004-4',
    ly: 'bwv1004-4.ly',
    voices: ['giga'],
    meter: 6,
    title: 'J. S. バッハ「無伴奏ヴァイオリンのためのパルティータ 第 2 番 ニ短調 BWV 1004」より ジーグ',
    mutopia: { id: 1428, footer: 'Mutopia-2008/05/28-1428', by: 'Benjamin D. Esham', base: BACH },
    license: 'by-sa-3.0',
  },
  {
    out: 'bwv1004-5',
    ly: 'bwv1004-5.ly',
    voices: ['melodyOne', 'melodyTwo', 'melodyThree', 'melodyFour'],
    meter: 3,
    title: 'J. S. バッハ「無伴奏ヴァイオリンのためのパルティータ 第 2 番 ニ短調 BWV 1004」より シャコンヌ',
    mutopia: { id: 1426, footer: 'Mutopia-2019/05/30-1426', by: 'Hajo Dezelski', base: BACH },
    license: 'by-sa-3.0',
  },
  {
    out: 'bwv1006-1',
    ly: 'bwv1006-1.ly',
    voices: ['melodyOne', 'melodyTwo'],
    meter: 3,
    title: 'J. S. バッハ「無伴奏ヴァイオリンのためのパルティータ 第 3 番 ホ長調 BWV 1006」より 前奏曲',
    mutopia: { id: 1469, footer: 'Mutopia-2008/07/13-1469', by: 'Hajo Dezelski', base: BACH },
    license: 'by-sa-3.0',
  },
  {
    out: 'bwv1001-1',
    ly: 'bwv1001-1.ly',
    voices: ['melodyOne', 'melodyTwo', 'melodyThree'],
    meter: 4,
    title: 'J. S. バッハ「無伴奏ヴァイオリンのためのソナタ 第 1 番 ト短調 BWV 1001」より アダージョ',
    mutopia: { id: 1429, footer: 'Mutopia-2008/06/01-1429', by: 'Hajo Dezelski', base: BACH },
    license: 'by-sa-3.0',
  },
  {
    out: 'eccles-1',
    ly: 'eccles.ly',
    voices: ['violingrave'],
    meter: 4,
    title: 'H. エクルズ「ソナタ ト短調」より グラーヴェ（ヴァイオリンの声部）',
    mutopia: {
      id: 540,
      footer: 'Mutopia-2015/09/01-540',
      by: 'Benjamin Crowell',
      base: 'J. Salmon による 1914 年のヴァイオリンとピアノの編曲',
    },
    license: 'pd',
  },
  {
    out: 'eccles-3',
    ly: 'eccles.ly',
    voices: ['violinadagio'],
    meter: 6,
    title: 'H. エクルズ「ソナタ ト短調」より アダージョ（ヴァイオリンの声部）',
    mutopia: {
      id: 540,
      footer: 'Mutopia-2015/09/01-540',
      by: 'Benjamin Crowell',
      base: 'J. Salmon による 1914 年のヴァイオリンとピアノの編曲',
    },
    license: 'pd',
  },
];

const q = (x: number) => Math.round(x * TICKS);

/** 1 声部を文字列にする（types.ts の decodeVoice の逆） */
function encode(ns: LyNote[]): string {
  let prev = 0;
  return ns
    .map((x) => {
      const t = q(x.t),
        d = q(x.t + x.d) - t,
        hair = x.hair ? HAIRS.indexOf(x.hair) + 1 : 0,
        dyn = x.dyn ? DYNS.indexOf(x.dyn as (typeof DYNS)[number]) + 1 : 0,
        f =
          (x.slurOn ? 1 : 0) | (x.slurOff ? 2 : 0) | (x.trill ? 4 : 0) | (x.fermata ? 8 : 0) | (hair << 4) | (dyn << 6);
      if (dyn < 0) throw new Error(`強弱 ${x.dyn} を表せません`);
      const s = `${t - prev},${d},${f},${x.n.join(',')}`;
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
  const src = readFileSync(new URL(s.ly, DIR), 'utf8'),
    bars: number[] = [],
    voices = s.voices.map((v, k) => readLy(src, v, k === 0 ? bars : []).filter((x) => x.d > 0));
  const end = Math.max(...voices.flat().map((x) => x.t + x.d));
  /* 小節線: 同じ時刻の重複を除き、最後（曲の終わり）は除く。書かれていなければ拍子から */
  let bl = [...new Set(bars.map(q))].filter((b) => b > 0 && b < q(end) - 1).sort((a, b) => a - b);
  if (!bl.length) {
    bl = [];
    for (let b = s.meter; b < end - 1e-6; b += s.meter) bl.push(q(b));
  }
  const n = voices.reduce((m, v) => m + v.length, 0),
    lic =
      s.license === 'pd'
        ? ' * 原作はパブリックドメイン（Mutopia の表記は Public Domain）。このファイルと元の .ly も著作権を主張しない。'
        : ' * このファイルと元の .ly は原作と同じ Creative Commons Attribution-ShareAlike 3.0 Unported\n' +
          ' * （https://creativecommons.org/licenses/by-sa/3.0/）で公開する。リポジトリのほかのファイルの MIT ライセンスは適用しない。\n' +
          ' *\n * SPDX-License-Identifier: CC-BY-SA-3.0';
  const body = `/**
 * ${s.title}の音符。
 * scripts/violin-scores.ts で ${s.ly} から作る（直接編集しない）。
 *
 * 音符は Mutopia Project の楽譜（${s.mutopia.by} 作成、底本 ${s.mutopia.base}、${s.mutopia.footer}、
 * https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=${s.mutopia.id}）の .ly の声部（${s.voices.join('・')}）を読んだもの。
 * 変更: 反復を演奏順に展開し、装飾音を除いた。時刻と長さを 4 分音符の 1/960 に丸めた。
 *
${lic}
 */
import { decodeVoice, type ScoreNote, TICKS } from './types';

/** 声部ごとの音（${n} 音。形式は types.ts の decodeVoice） */
const VOICES = [
${voices.map((v) => split(encode(v), '  ')).join(',\n')},
];

/** 小節線の時刻（1/960 拍） */
const BARS = [${bl.join(', ')}];

export const voices = (): ScoreNote[][] => VOICES.map(decodeVoice);
export const bars = (): number[] => BARS.map((b) => b / TICKS);
`;
  writeFileSync(new URL(`${s.out}.ts`, DIR), body);
  console.log(`${s.out}: ${voices.map((v) => v.length).join(' + ')} 音、${end.toFixed(2)} 拍、小節線 ${bl.length}`);
}
/* 書いたファイルをリポジトリの書式にそろえる */
spawnSync(
  process.execPath,
  ['x', 'biome', 'format', '--write', ...SRCS.map((s) => fileURLToPath(new URL(`${s.out}.ts`, DIR)))],
  {
    stdio: 'inherit',
  },
);
