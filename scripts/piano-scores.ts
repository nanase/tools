/**
 * src/tools/piano/scores/*.ts（ピアノの物理モデルで演奏する曲の音符）を、同じディレクトリの *.mid から作る。
 * bun scripts/piano-scores.ts で実行する。
 *
 * MIDI は Mutopia Project の楽譜を LilyPond で変換したもの。トラックは譜表ごとで、右手の譜表を h = 0、
 * 左手の譜表を h = 1 にする（\change Staff で譜表を移った音は、移った先の譜表に入っている）。
 * LilyPond の MIDI は反復を展開しないので、.ly の \repeat volta・\alternative・D.C. を読んで、
 * 演奏順の小節の範囲を曲ごとに書く。MIDI にペダル（CC64）はなく、データにも入れない
 */
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
};

/**
 * 月光 第 3 楽章の小節 188 のカデンツァ（\grace）の音。右手の譜表の 18 音（8 分音符）:
 * gis fis e dis fis cis bis dis a gis fis a e dis fis cis bis dis（G#5 から）
 */
const CADENZA_UP = [80, 78, 76, 75, 78, 73, 72, 75, 69, 68, 66, 69, 64, 63, 66, 61, 60, 63];
/** 左手の譜表の 12 音（8 分音符 9 音と 4 分音符 3 音）: a gis fis a e dis fis cis bis、dis a gis（A3 から） */
const CADENZA_DOWN = [57, 56, 54, 57, 52, 51, 54, 49, 48, 51, 45, 44];

/**
 * 月光 第 3 楽章の小節 188 のカデンツァ（トリルの A5 のあとの \grace の 30 音）を組み直す。LilyPond 2.10 の MIDI では、
 * - トリルの A5 が 1 tick しかない
 * - 右手の譜表の 18 音と左手の譜表の 12 音が、続かずに重なっている
 * - 左手の譜表の G#3 が、左手の和音の同じ高さの全音符が鳴っているため落ちている
 * - そのあとの右手の譜表（トラック 1）の時刻が、最後まで 274 tick（0.7135 拍）遅れている
 * 遅れを戻し、.ly の音の並びのとおりに、A5 を 1 拍、8 分音符の装飾音 27 音を 1/12 拍ずつ、
 * 4 分音符の装飾音 3 音を 1/4 拍ずつ並べて小節の 4 拍に収める
 */
function cadenza(m: Midi, log: (s: string) => void): RawNote[] {
  const q = m.ppq,
    bar = 187 * 4 * q,
    drift = 274;
  if (q % 12) throw new Error(`4 分音符の tick 数 ${q} が 12 で割り切れません`);
  const last = (tr: number) => Math.max(...m.notes.filter((x) => x.tr === tr).map((x) => x.t1));
  if (last(1) - last(2) !== drift) throw new Error(`右手の譜表の遅れが ${last(1) - last(2)} tick です`);
  const isUp = (x: RawNote) => x.tr === 1 && x.t0 >= bar && x.t0 < bar + 3 * q,
    isDown = (x: RawNote) => x.tr === 2 && x.t0 > bar && x.t0 < bar + 3 * q;
  const up = m.notes.filter(isUp).sort((a, b) => a.t0 - b.t0 || a.t1 - b.t1),
    down = m.notes.filter(isDown).sort((a, b) => a.t0 - b.t0);
  const want = [81, ...CADENZA_UP].join(),
    wantDown = CADENZA_DOWN.filter((_, i) => i !== 1).join();
  if (up.map((x) => x.n).join() !== want || down.map((x) => x.n).join() !== wantDown)
    throw new Error(
      `小節 188 の音が .ly と合いません: ${up.map((x) => noteName(x.n))} / ${down.map((x) => noteName(x.n))}`,
    );
  const out = m.notes
    .filter((x) => !isUp(x) && !isDown(x))
    .map((x) => (x.tr === 1 && x.t0 >= bar + 3 * q ? { ...x, t0: x.t0 - drift, t1: x.t1 - drift } : x));
  const e8 = q / 12,
    at = bar + q;
  out.push({ tr: 1, n: 81, t0: bar, t1: bar + q });
  CADENZA_UP.forEach((n, i) => {
    out.push({ tr: 1, n, t0: at + i * e8, t1: at + (i + 1) * e8 });
  });
  CADENZA_DOWN.forEach((n, i) => {
    const t0 = i < 9 ? at + (18 + i) * e8 : at + 27 * e8 + ((i - 9) * q) / 4;
    out.push({ tr: 2, n, t0, t1: i < 9 ? t0 + e8 : t0 + q / 4 });
  });
  log(`小節 188 のカデンツァを組み直し、小節 189 から後の右手の譜表を ${+(drift / q).toFixed(4)} 拍早めた`);
  return out;
}

const mutopia = (id: number) => `https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=${id}`;
const common =
  '時刻と長さを 4 分音符の 1/480 に寄せ、同じ時刻の同じ高さの音を 1 つにまとめた。強弱とテンポは使わない。';

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
      common,
    ],
    license: 'pd',
    tracks: [
      [1, 0],
      [2, 1],
    ],
    meter: [3, 4],
    pickup: 0,
    /* 本体 31 小節、第 1 括弧 32〜39、第 2 括弧 40〜47 */
    order: [
      [1, 31],
      [32, 39],
      [1, 31],
      [40, 47],
    ],
  },
  {
    name: 'moonlight1',
    title: 'L. v. ベートーヴェン「ピアノ・ソナタ 第 14 番 嬰ハ短調 作品 27-2（月光）」より 第 1 楽章',
    source: [
      '音符は Mutopia Project の楽譜（Stewart Holmes 作成、底本 Berners, 1908 (edited by A. Winterberger)、',
      `Mutopia-2007/02/11-276、${mutopia(276)}）の MIDI から変換した。`,
    ],
    changes: [`変更: ${common}`],
    license: 'cc-by-sa-2.5',
    tracks: [
      [1, 0],
      [2, 1],
    ],
    meter: [2, 2],
    pickup: 0,
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
      '変更: 提示部の反復を展開した（小節 1〜65、2〜64、66〜201。小節 1 は反復の外で、第 1 括弧の小節 65 は小節 1 に',
      '和音を加えた形、反復は小節 2 に戻る。66 が第 2 括弧）。',
      'MIDI では小節 188 のカデンツァ（装飾音の 30 音）の時刻が崩れ、そのあとの右手の譜表が 0.7135 拍遅れていたので、',
      '遅れを戻し、カデンツァを .ly の音の並びで組み直した（トリルの A5 を 1 拍、8 分音符の装飾音を 1/12 拍、',
      '4 分音符の装飾音を 1/4 拍）。',
      common,
    ],
    license: 'cc-by-sa-2.5',
    tracks: [
      [1, 0],
      [2, 1],
    ],
    meter: [4, 4],
    pickup: 0,
    order: [
      [1, 65],
      [2, 64],
      [66, 201],
    ],
    fix: cadenza,
  },
];

for (const p of pieces) build(p, kind);
