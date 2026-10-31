/**
 * src/tools/fm-synth/scores/*.ts（FM 音源で演奏する曲の音符）を、同じディレクトリの *.mid から作る。
 * bun run fm-scores で実行する。
 *
 * MIDI は Mutopia Project の楽譜を LilyPond で変換したもの。トラックは譜表（弦楽四重奏はパート）ごとで、上から h = 0, 1 …
 * にする。どのパートもページの同じ音色で弾くので、同じ時刻・同じ高さの音はパートが違っても 1 つにまとめる。
 * FM 音源の模型は鍵を押す強さで音が変わらないので、ベロシティは使わない
 */
import { build, type Kind, type Piece } from './score-midi';

const kind: Kind = {
  dir: new URL('../src/tools/fm-synth/scores/', import.meta.url),
  path: 'src/tools/fm-synth/scores',
  script: 'scripts/fm-scores.ts',
  staves: [
    { name: '1 段目', lo: 12, hi: 120 },
    { name: '2 段目', lo: 12, hi: 120 },
    { name: '3 段目', lo: 12, hi: 120 },
    { name: '4 段目', lo: 12, hi: 120 },
  ],
  mergeAcross: true,
  dynamics: false,
};

const mutopia = (id: number) => `https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=${id}`;
/** 加工の段落の終わり。テンポと強弱の扱いは、MIDI の中身に合わせて score-midi.ts が書き足す */
const common = '時刻と長さを 4 分音符の 1/480 に寄せ、同じ時刻の同じ高さの音を 1 つにまとめた。';
/** ピアノの 2 段の譜表 */
const PIANO: [number, number][] = [
  [1, 0],
  [2, 1],
];

const pieces: Piece[] = [
  {
    name: 'kv331',
    title: 'W. A. モーツァルト「ピアノ・ソナタ 第 11 番 イ長調 K. 331」より 第 3 楽章「トルコ行進曲」',
    source: [
      '音符は Mutopia Project の楽譜（Rune Zedeler・Chris Sawer 作成、底本 IMSLP、Mutopia-2015/08/13-108、',
      `${mutopia(108)}）の .ly から LilyPond 2.24.4 で作った MIDI から変換した。`,
      'Mutopia の MIDI は反復を展開していないので、.ly を convert-ly で 2.24 に直し、\\unfoldRepeats を付けた MIDI だけの',
      '\\score を足して作った。終わりの区間の手書きの反復（Score.repeatCommands。第 1 括弧が rightcoa、第 2 括弧が rightcoat）も',
      '2 回弾くように並べ、左手は leftc を 2 回にした。テンポは ♩ = 120 にした（元の \\midi は既定の ♩ = 60）。',
    ],
    changes: [`変更: ${common}`],
    license: 'pd',
    tracks: PIANO,
    meter: [2, 4],
    pickup: 1,
  },
  {
    name: 'entertainer',
    title: 'S. ジョプリン「ジ・エンターテイナー」',
    source: [
      '音符は Mutopia Project の楽譜（Chris Sawer 作成、底本 1902 年の初版の複製、Mutopia-2016/11/25-263、',
      `${mutopia(263)}）の MIDI から変換した。MIDI は反復を展開している。`,
    ],
    changes: [`変更: ${common}`],
    license: 'pd',
    tracks: PIANO,
    meter: [2, 4],
    pickup: 0,
  },
  {
    name: 'maple',
    title: 'S. ジョプリン「メイプル・リーフ・ラグ」',
    source: [
      '音符は Mutopia Project の楽譜（Chris Sawer 作成、底本 1899 年の初版の複製、Mutopia-2011/11/13-23、',
      `${mutopia(23)}）の MIDI から変換した。MIDI は反復を展開している。`,
    ],
    changes: [`変更: ${common}`],
    license: 'pd',
    tracks: PIANO,
    meter: [2, 4],
    pickup: 0.5,
  },
  {
    name: 'mountain-king',
    title: 'E. グリーグ「ペール・ギュント 第 1 組曲」より「山の魔王の宮殿にて」（作曲者によるピアノ独奏版）',
    source: [
      '音符は Mutopia Project の楽譜（Coyau 作成、底本 The University Society 1918、Mutopia-2013/12/07-1888、',
      `${mutopia(1888)}）の MIDI から変換した。`,
      'MIDI は反復を展開し、\\articulate でスタッカートなどを音の長さにしている。',
    ],
    changes: [`変更: ${common}`],
    license: 'pd',
    tracks: PIANO,
    meter: [4, 4],
    pickup: 0,
  },
  {
    name: 'bwv779',
    title: 'J. S. バッハ「インヴェンション 第 8 番 ヘ長調 BWV 779」',
    source: [
      '音符は Mutopia Project の楽譜（Allen Garvin 作成、底本 Bach-Gesellschaft、Mutopia-2008/06/15-61、',
      `${mutopia(61)}）の MIDI から変換した。`,
    ],
    changes: [`変更: ${common}`],
    license: 'pd',
    tracks: PIANO,
    meter: [3, 4],
    pickup: 0,
  },
  {
    name: 'kv525',
    title: 'W. A. モーツァルト「アイネ・クライネ・ナハトムジーク K. 525」より 第 1 楽章',
    source: [
      '音符は Mutopia Project の弦楽四重奏の楽譜（作成者は匿名、底本 IMSLP、Mutopia-2007/01/01-900、',
      `${mutopia(900)}）の MIDI から変換した。MIDI は反復を展開し、トリルとトレモロを音符にしている。`,
      'トラックは第 1 ヴァイオリン・第 2 ヴァイオリン・ヴィオラ・チェロの順で、h = 0〜3 にした。',
    ],
    changes: [`変更: ${common}`],
    license: 'pd',
    tracks: [
      [1, 0],
      [2, 1],
      [3, 2],
      [4, 3],
    ],
    meter: [4, 4],
    pickup: 0,
  },
  {
    name: 'fur-elise',
    title: 'L. v. ベートーヴェン「エリーゼのために WoO 59」',
    source: [
      '音符は Mutopia Project の楽譜（Stelios Samelis 作成、底本 Breitkopf & Härtel 1888、Mutopia-2015/08/18-931、',
      `${mutopia(931)}）の .ly から LilyPond 2.24.4 で作った MIDI から変換した。`,
      'Mutopia の MIDI は反復を展開していないので、.ly を convert-ly で 2.24 に直し、\\score の PianoStaff に \\unfoldRepeats を',
      '付け、\\layout を除いて作った。',
    ],
    changes: [`変更: ${common}`],
    license: 'pd',
    tracks: PIANO,
    meter: [3, 8],
    pickup: 0.5,
  },
];

for (const p of pieces) build(p, kind);
