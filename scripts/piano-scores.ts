/**
 * src/tools/piano/scores/*.ts（ピアノの物理モデルで演奏する曲の音符）を、同じディレクトリの *.mid から作る。
 * bun scripts/piano-scores.ts で実行する。
 *
 * MIDI は Mutopia Project の楽譜を LilyPond で変換したもの。トラックは譜表ごとで、右手の譜表を h = 0、
 * 左手の譜表を h = 1 にする（\change Staff で譜表を移った音は、移った先の譜表に入っている）。
 * LilyPond の MIDI は反復を展開しないので、.ly の \repeat volta・\alternative・D.C. を読んで、
 * 演奏順の小節の範囲を曲ごとに書く。MIDI にペダル（CC64）はなく、データにも入れない。
 *
 * ベロシティは、LilyPond が強弱記号から付けたものがある曲（ジムノペディ）と、MIDI を編集して 2 つ以上の値にした曲で入れる。
 * Mutopia のままの MIDI は、ジムノペディのほかはすべての音が同じ値（90 か 127）で、強弱の情報がない。
 * テンポも、MIDI に変化を入れた曲だけ入れる（Mutopia のままの MIDI は最初の値だけ）。入れた曲では、score.ts の tempoMap
 * （このツールで付けた終わりの rit. など）の代わりに、MIDI の変化で演奏する
 */
import { pieceOf } from '../src/tools/piano/score';
import { build, type Kind, type Midi, noteName, type Piece, type RawNote } from './score-midi';

const kind: Kind = {
  dir: new URL('../src/tools/piano/scores/', import.meta.url),
  path: 'src/tools/piano/scores',
  script: 'scripts/piano-scores.ts',
  staves: [
    { name: '右手の譜表', lo: 21, hi: 108 },
    { name: '左手の譜表', lo: 21, hi: 108 },
  ],
  mergeAcross: true,
  dynamics: true,
};

/**
 * LilyPond 2.10 の MIDI は、同じ譜表のほかの声部で同じ高さの音が鳴っているうちに始まり、それより先に終わる音を落とす。
 * 月光 第 1 楽章では、右手の旋律の E4（4 分音符）と重なる 3 連符の E4（.ly の topsecondary の「gis, b e」の e）が、
 * 小節 9 と 46 の 1 拍目の 3 つ目で落ちている（独立に作られた別の MIDI と比べて、落ちているのはこの 2 音だけ）。
 * [小節, 音の高さ]
 */
const DROPPED_M1: [number, number][] = [
  [9, 64],
  [46, 64],
];

/** 月光 第 1 楽章の、MIDI で落ちた 3 連符の音を戻す（右手の譜表、小節の 1 拍目の 3 つ目の 3 連符の 8 分音符） */
function restoreTriplets(m: Midi, log: (s: string) => void): RawNote[] {
  const q = m.ppq,
    out = [...m.notes];
  if (q % 3) throw new Error(`4 分音符の tick 数 ${q} が 3 で割り切れません`);
  for (const [bar, n] of DROPPED_M1) {
    const t0 = (bar - 1) * 4 * q + (2 * q) / 3,
      t1 = t0 + q / 3;
    if (out.some((x) => x.tr === 1 && x.n === n && x.t0 === t0))
      throw new Error(`小節 ${bar} の ${noteName(n)} はすでにあります`);
    if (!out.some((x) => x.tr === 1 && x.n === n && x.t0 < t0 && x.t1 >= t1))
      throw new Error(`小節 ${bar} で、${noteName(n)} を落とす原因の同じ高さの音がありません`);
    out.push({ tr: 1, n, t0, t1 });
  }
  log(`MIDI で落ちていた 3 連符の音を戻した: ${DROPPED_M1.map(([b, n]) => `小節 ${b} の ${noteName(n)}`).join('、')}`);
  return out;
}

const mutopia = (id: number) => `https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=${id}`;
/** 加工の段落の終わり。テンポと強弱の扱いは、MIDI の中身に合わせて score-midi.ts が書き足す */
const common = '時刻と長さを 4 分音符の 1/480 に寄せ、同じ時刻の同じ高さの音を 1 つにまとめた。';
/** ベロシティを入れる曲の加工 */
const commonVel = [
  '時刻と長さを 4 分音符の 1/480 に寄せ、同じ時刻の同じ高さの音を 1 つにまとめた。',
  'ベロシティは、LilyPond が強弱記号と松葉から付けた値を残し、強弱記号のない声部の既定の値（90）は、',
  '同じ小節の最も弱い値にそろえた。',
];
/** LilyPond が、強弱記号のない声部の音に付けるベロシティ */
const LILY_VEL = 90;
const satie = (n: number, id: number, date: string): Piece => ({
  name: `gymnopedie${n}`,
  title: `E. サティ「ジムノペディ 第 ${n} 番」`,
  source: [
    `音符は Mutopia Project の楽譜（Evin Robertson 作成、底本 Dover Edition、Mutopia-${date}-${id}、`,
    `${mutopia(id)}）の MIDI から変換した。`,
  ],
  changes: ['変更:', ...commonVel],
  license: 'pd',
  tracks: [
    [1, 0],
    [2, 1],
  ],
  meter: [3, 4],
  pickup: 0,
  vel: LILY_VEL,
});
/** グノシエンヌ。楽譜に小節線はなく、MIDI の拍子（.ly が音符を並べるのに使う拍子）で小節を数える */
const gnossienne = (n: number, id: number, date: string, by: string, src: string, meter: [number, number]): Piece => ({
  name: `gnossienne${n}`,
  title: `E. サティ「グノシエンヌ 第 ${n} 番」`,
  source: [
    `音符は Mutopia Project の楽譜（${by} 作成、底本 ${src}、`,
    `Mutopia-${date}-${id}、${mutopia(id)}）の MIDI から変換した。`,
  ],
  changes: [`変更: ${common}`],
  license: 'cc-by-sa-4.0',
  tracks: [
    [1, 0],
    [2, 1],
  ],
  meter,
  pickup: 0,
});

/**
 * MuseScore で CC0 として公開された楽譜の MIDI（PDMX に収録されたもの）。MuseScore が書き出した MIDI で、
 * トラックは譜表ごと（0 = 右手、1 = 左手、2 = 3 段目）。投稿者が付けたテンポの変化・ベロシティ・ペダル（CC64）があり、
 * テンポとベロシティを使う。4 分音符は 480 tick なので、時刻と長さは寄せない（7 連符などの細かい時刻を残す）
 */
const musescore = (
  name: string,
  title: string,
  id: number,
  date: string,
  meter: [number, number],
  changes: string[],
  /** 作成者と、MuseScore の利用者の番号 */
  [by, user]: [string, number] = ['venson72150', 33306646],
): Piece => ({
  name,
  title,
  source: [
    `音符は MuseScore で CC0 として公開された楽譜（${by} 作成、${date}、`,
    `https://musescore.com/user/${user}/scores/${id}）の MIDI から変換した。MIDI は PDMX（Long ほか 2024、`,
    'https://zenodo.org/records/15571083）に収録されたものを使った。',
  ],
  changes: changes.length
    ? [...changes, '同じ時刻の同じ高さの音を 1 つにまとめた。']
    : ['変更: 同じ時刻の同じ高さの音を 1 つにまとめた。'],
  license: 'cc0',
  /* 3 段目の譜表は左手の譜表にまとめる */
  tracks: changes.length
    ? [
        [0, 0],
        [1, 1],
        [2, 1],
      ]
    : [
        [0, 0],
        [1, 1],
      ],
  meter,
  meters: true,
  exact: true,
  pickup: 0,
});

/**
 * アラベスク 第 1 番の小節 38 の E5（全音符）は、楽譜（Durand 1904）では小節 39 の最初の 3 連符の E5 へタイでつながる。
 * MuseScore の楽譜はタイがなく、小節 39 で打ち直しているので、2 つを 1 音にする
 */
function tieArabesque(m: Midi, log: (s: string) => void): RawNote[] {
  const bar = (k: number) => (k - 1) * 4 * m.ppq,
    a = m.notes.find((x) => x.tr === 0 && x.n === 76 && x.t0 === bar(38)),
    b = m.notes.find((x) => x.tr === 0 && x.n === 76 && x.t0 === bar(39));
  /* MuseScore の MIDI は、音の終わりを次の音の 1 tick 前にする */
  if (!a || !b || b.t0 - a.t1 > m.ppq / 8) throw new Error('小節 38〜39 の右手の譜表に、続けて鳴る E5 がありません');
  log('小節 38 の E5 と小節 39 の最初の E5 を、楽譜のタイのとおり 1 音にした');
  return m.notes.filter((x) => x !== b).map((x) => (x === a ? { ...x, t1: b.t1 } : x));
}

const pieces: Piece[] = [
  {
    name: 'bwv846',
    title: 'J. S. バッハ「平均律クラヴィーア曲集 第 1 巻」より 前奏曲 第 1 番 ハ長調 BWV 846',
    source: [
      '音符は Mutopia Project の楽譜（Tobias Erbsland 作成、底本 Unknown、Mutopia-2011/09/12-5、',
      `${mutopia(5)}）の MIDI から変換した。.ly の記録では Shay Rojansky が入力し、`,
      'Han-Wen Nienhuys と Tobias Erbsland が編集した。',
    ],
    changes: [`変更: ${common}`],
    license: 'pd',
    /* トラック 1 が左手（lower）、2 が右手（upper） */
    tracks: [
      [2, 0],
      [1, 1],
    ],
    meter: [4, 4],
    pickup: 0,
  },
  {
    name: 'gymnopedie1',
    title: 'E. サティ「ジムノペディ 第 1 番」',
    source: [
      '音符は Mutopia Project の楽譜（Evin Robertson 作成、底本 Dover Edition、Mutopia-2014/12/14-37、',
      `${mutopia(37)}）の MIDI から変換した。`,
    ],
    changes: [
      '変更: 反復（\\repeat volta と 2 つの括弧）を演奏順に展開した（小節 1〜31、32〜39、1〜31、40〜47）。',
      ...commonVel,
    ],
    license: 'pd',
    tracks: [
      [1, 0],
      [2, 1],
    ],
    meter: [3, 4],
    pickup: 0,
    vel: LILY_VEL,
    /* 本体 31 小節、第 1 括弧 32〜39、第 2 括弧 40〜47 */
    order: [
      [1, 31],
      [32, 39],
      [1, 31],
      [40, 47],
    ],
  },
  satie(2, 38, '2012/12/23'),
  satie(3, 39, '2012/12/23'),
  gnossienne(1, 2035, '2015/07/23', 'Knute Snortum', 'Editions Salabert, Paris, 1913', [4, 4]),
  gnossienne(
    2,
    2130,
    '2016/08/17',
    'Frédéric Duperray',
    'Rouart, Lerolle & Cie., Paris, 1913（Plates R.L. 9884-9886）',
    [12, 8],
  ),
  gnossienne(
    3,
    2131,
    '2016/08/17',
    'Frédéric Duperray',
    'Rouart, Lerolle & Cie., Paris, 1913（Plates R.L. 9884-9886）',
    [4, 4],
  ),
  {
    name: 'moonlight1',
    title: 'L. v. ベートーヴェン「ピアノ・ソナタ 第 14 番 嬰ハ短調 作品 27-2（月光）」より 第 1 楽章',
    source: [
      '音符は Mutopia Project の楽譜（Stewart Holmes 作成、底本 Berners, 1908 (edited by A. Winterberger)、',
      `Mutopia-2007/02/11-276、${mutopia(276)}）の MIDI から変換した。`,
    ],
    changes: [
      '変更: LilyPond の MIDI で落ちていた 3 連符の 2 音（小節 9 と 46 の 1 拍目の E4。旋律の同じ高さの音と重なる）を、',
      '.ly のとおりに戻した。',
      common,
    ],
    license: 'cc-by-sa-2.5',
    tracks: [
      [1, 0],
      [2, 1],
    ],
    meter: [2, 2],
    pickup: 0,
    fix: restoreTriplets,
  },
  {
    name: 'moonlight2',
    title: 'L. v. ベートーヴェン「ピアノ・ソナタ 第 14 番 嬰ハ短調 作品 27-2（月光）」より 第 2 楽章',
    source: [
      '音符は Mutopia Project の楽譜（Stewart Holmes 作成、底本 Berners, 1908 (edited by A. Winterberger)、',
      `Mutopia-2007/02/11-276、${mutopia(276)}）の MIDI から変換した。`,
    ],
    changes: [
      '変更: メヌエットの後半、トリオの前半と後半の反復を展開し、トリオのあとにメヌエットを反復なしで繰り返した',
      '（Allegretto D. C.）。反復の区切りはどれも 3 拍目の弱起から始まる。',
      common,
    ],
    license: 'cc-by-sa-2.5',
    tracks: [
      [1, 0],
      [2, 1],
    ],
    meter: [3, 4],
    pickup: 1,
    /* 反復の区切り（小節 16・36・44 の 3 拍目）に合わせ、範囲を 1 拍前にずらす。[1, 16] は弱起から小節 16 の 2 拍目まで */
    shift: 1,
    order: [
      [1, 16],
      [17, 36],
      [17, 36],
      [37, 44],
      [37, 44],
      [45, 60],
      [45, 60],
      [1, 16],
      [17, 36],
    ],
  },
  {
    name: 'moonlight3',
    title: 'L. v. ベートーヴェン「ピアノ・ソナタ 第 14 番 嬰ハ短調 作品 27-2（月光）」より 第 3 楽章',
    source: [
      '音符は Mutopia Project の楽譜（Stewart Holmes 作成、第 3 楽章の .ly の表記では Chris Sawer と Stewart Holmes の',
      '浄書、底本 Berners, 1908 (edited by A. Winterberger)、Mutopia-2007/02/11-276、',
      `${mutopia(276)}）の MIDI から変換した。`,
    ],
    changes: [
      '変更: 演奏の表情を MIDI の編集で付けられるように、元の MIDI を次のように直した MIDI（moonlight3.mid）から作る。',
      '提示部の反復を展開した（小節 1〜65、2〜64、66〜201。小節 1 は反復の外で、第 1 括弧の小節 65 は小節 1 に',
      '和音を加えた形、反復は小節 2 に戻る。66 が第 2 括弧）。',
      '元の MIDI では小節 188 のカデンツァ（装飾音の 30 音）の時刻が崩れ、そのあとの右手の譜表が 0.7135 拍遅れていたので、',
      '遅れを戻し、カデンツァを .ly の音の並びで組み直した（トリルの A5 を 1 拍、8 分音符の装飾音を 1/12 拍、',
      '4 分音符の装飾音を 1/4 拍）。',
      '時刻と長さを 4 分音符の 1/480 に寄せ、同じ時刻の同じ高さの音を 1 つにまとめた。',
      'テンポは Presto agitato の ♩ = 168 で、カデンツァ（♩ = 92.4）と続く Adagio（♩ = 58.8）を入れた。',
      'ベロシティは編集の下地として、.ly の強弱記号から LilyPond 2.24 で付けた（Dynamic_performer を譜表の組に置き、',
      'sf・sfz は marcato、fp は p とアクセントに置き換えて、sf の強さが後ろの音に残らないようにした）。',
      'そのうえで MIDI を手で編集し、ベロシティとテンポの変化で演奏の表情を付け、小節 188 のトリルの A5 を',
      'A5 と Bb5 の 64 分音符（15 音）に書き下した。',
      '同じ高さの長い音の中で打つ左手の譜表の音（カデンツァの G#3）は、ノートオフの対応が崩れないように別のトラックに分けた。',
    ],
    license: 'cc-by-sa-2.5',
    /* トラック 3 は、左手の譜表の同じ高さの音の中で打つ音 */
    tracks: [
      [1, 0],
      [2, 1],
      [3, 1],
    ],
    meter: [4, 4],
    pickup: 0,
    /* 時刻と長さは 1/480 拍に寄せてあるので、寄せ直さない（ずらした装飾音の長さが変わる） */
    exact: true,
    /* MIDI のテンポは、ページの標準のテンポに対する比にする（MIDI の最初の値を変えても、MIDI の値のとおりに鳴る） */
    bpm: pieceOf('moon3').bpm,
  },
  musescore('fantaisie', 'F. ショパン「幻想即興曲 嬰ハ短調 作品 66」', 6219891, '2020/06/23', [2, 2], []),
  musescore(
    'campanella',
    'F. リスト「パガニーニによる大練習曲」より 第 3 番 嬰ト短調「ラ・カンパネラ」',
    6225893,
    '2020/06/27',
    [6, 8],
    [],
  ),
  musescore(
    'jeuxdeau',
    'M. ラヴェル「水の戯れ」',
    6323707,
    '2020/09/02',
    [4, 4],
    ['変更: 終わり近くの 3 段の譜表の中の段（トラック 3）を、左手の譜表にまとめた。'],
  ),
  /*
   * PDMX のアラベスク 第 1 番のピアノ独奏の楽譜のうち、Mutopia の楽譜（id 1777、Durand 1904 が底本）と音が最も合うもの。
   * 違いは、MuseScore のほかの 2 つの楽譜とも合う小節 7・9・77・79 の C#3 などだけ
   */
  {
    ...musescore(
      'arabesque1',
      'C. ドビュッシー「2 つのアラベスク」より 第 1 番 ホ長調',
      5976460,
      '2020/02/19',
      [4, 4],
      [],
      ['The Transcriber', 7789771],
    ),
    /* 2 段の譜表だけなので、musescore の changes でなくここに書く */
    changes: [
      '変更: 小節 38 の E5 と小節 39 の最初の E5 を、楽譜（Durand 1904）のタイのとおり 1 音にした。',
      '同じ時刻の同じ高さの音を 1 つにまとめた。',
    ],
    fix: tieArabesque,
    /* MIDI の最初のテンポ（♩ = 60）は冒頭の加速の始まりなので、基本のテンポ（♩ = 120）を比の基準にする */
    bpm: pieceOf('arabesque1').bpm,
  },
  /*
   * ブゾーニ自身の演奏を記録したピアノロールから起こした MIDI。1 トラックで、テンポは ♩ = 120 の 1 つだけ、
   * 時刻は演奏のとおり（拍と小節は楽譜と合わない）。ベロシティとダンパーペダルもロールから起こしたもの
   */
  {
    name: 'busoni-chaconne',
    title:
      'J. S. バッハ「無伴奏ヴァイオリンのためのパルティータ 第 2 番 ニ短調 BWV 1004」より シャコンヌ（F. ブゾーニ編曲）',
    source: [
      '音符は IMSLP で公開された MIDI（Hammondmania 作成、2012/01/22、ファイル #173118、',
      'https://imslp.org/wiki/Violin_Partita_No.2_in_D_minor,_BWV_1004_(Bach,_Johann_Sebastian)）から変換した。',
      'IMSLP の説明では、ブゾーニが演奏して記録した Duo-Art のピアノロールから起こしたもの。',
    ],
    changes: [
      '変更: 時刻と長さは MIDI の tick のまま 1/480 拍に直した（演奏の表情を崩さない）。同じ時刻の同じ高さの音を 1 つにまとめた。',
      '譜表の分かれていない MIDI なので、C4 から上を右手の譜表、下を左手の譜表にした。',
      '最初の音の前の無音（約 3.8 拍）を除いた。ダンパーペダル（CC64）は PEDAL に入れ、ロールの記録のとおりに踏む。',
    ],
    license: 'cc-by-3.0',
    tracks: [[0, 0]],
    split: 60,
    meter: [4, 4],
    exact: true,
    pickup: 0,
    trim: true,
    pedal: true,
  },
];

for (const p of pieces) build(p, kind);
