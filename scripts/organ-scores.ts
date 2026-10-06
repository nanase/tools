/**
 * src/tools/organ/scores/*.ts（パイプオルガンの物理モデルで演奏する曲の音符）を、同じディレクトリの *.mid から作る。
 * bun run organ-scores で実行する。
 *
 * 鍵盤は譜表で分ける: 右手の譜表を h = 0（第 1 手鍵盤）、左手の譜表を h = 1（第 2 手鍵盤）、ペダルを h = 2。
 * 実際には両手とも同じ手鍵盤で弾くことが多い曲でも、データは譜表で分けておく。
 * 同じ時刻・同じ高さの音は同じ鍵盤の中でだけ 1 つにまとめ、2 つの手鍵盤で同時に鳴る同じ音は両方残す。
 * BWV 578 は IMSLP の MIDI（Pierre Gouin、CC BY-SA 4.0）を bwv578.mid に置けば作り、なければ飛ばす
 */
import { build, type Kind, type Midi, noteName, type Piece, type RawNote } from './score-midi';

const kind: Kind = {
  dir: new URL('../src/tools/organ/scores/', import.meta.url),
  path: 'src/tools/organ/scores',
  script: 'scripts/organ-scores.ts',
  staves: [
    { name: '第 1 手鍵盤', lo: 36, hi: 84 },
    { name: '第 2 手鍵盤', lo: 36, hi: 84 },
    { name: 'ペダル', lo: 36, hi: 67 },
  ],
  mergeAcross: false,
};

interface Span {
  t: number;
  e: number;
  n: number;
}

/** LilyPond 2.8 の MIDI と同じく、同じトラックで重なる同じ高さの音を 1 つにつなぐ（最初の開始から最後の終わりまで） */
function joinSame(ns: Span[]): Span[] {
  const held = new Map<number, Span>(),
    out: Span[] = [];
  for (const x of [...ns].sort((a, b) => a.t - b.t || b.e - a.e)) {
    const h = held.get(x.n);
    if (h && h.e > x.t) {
      h.e = Math.max(h.e, x.e);
      continue;
    }
    const y = { ...x };
    out.push(y);
    held.set(x.n, y);
  }
  return out;
}

/**
 * BWV 582 の MIDI の 9 トラックは、0 が全体、1・3・5 が右手・左手・ペダルの 8'、2・4 が右手・左手を 1 オクターブ上げた 4'、
 * 6・7 がペダルの 16'・4'、8 がテンポ。.ly の \score { \midi } では 4' の譜表に名前がなく、複製の声部が \change Staff
 * （\staffdown・\staffup・\std・\stu）で譜表を移ると、名前のある 8' の譜表（right・left）へ移ったまま戻らない。
 * 移るのは alt が小節 21 の 3 拍目、tenor が小節 31、bass が小節 144 の 3 拍目から（sopran と altzwei は譜表を移らない）。
 * そのため 1・3 には、移った声部の音の 1 オクターブ上の複製が混じる。さらに LilyPond 2.8 は同じトラックで重なる
 * 同じ高さの音を 1 つにつなぐので、本物の音と複製がつながって見えなくなる箇所もある。
 *
 * 1・3 の本物の音を次のように決める（1 と 2、3 と 4 を組にして扱う）。
 * 1. 2・4 に残った複製（譜表を移っていない声部の音）を 1 オクターブ下げたものは本物（N）
 * 2. 1・3 の音を低いほうから見て、N でも、すでに決めた移った声部の本物（M）の複製でもない音は M。
 *    ただし手鍵盤の音域より上の音や、下の高さで鳴り続ける音があって自分の複製が見えない音は、
 *    下の音に隠れた M の複製とみなし、下の高さに M を置く
 * 3. N や M の複製で説明できる音でも、すぐ上のオクターブに説明できない音があり、その上のオクターブにはないなら、
 *    その高さにも M が重なっている（上の音がその複製）とみなす
 * 4. N・M・M の複製を LilyPond と同じ規則でつないだ結果が、1・3 と同じになることを確かめる
 */
function octaves(m: Midi, log: (s: string) => void): RawNote[] {
  const HI = 84,
    q = m.ppq,
    bar = (tick: number) => {
      const b = tick / q - 1,
        k = Math.floor(b / 3) + 1;
      return `${k} 小節 ${+(b - (k - 1) * 3 + 1).toFixed(3)} 拍目`;
    },
    key = (t: number, n: number) => `${t}/${n}`;
  const out: RawNote[] = m.notes.filter((x) => x.tr !== 1 && x.tr !== 3);
  let removed = 0,
    restored = 0,
    naiveWrong = 0,
    naiveMissed = 0;
  for (const [tr, copy] of [
    [1, 2],
    [3, 4],
  ]) {
    const U: Span[] = m.notes.filter((x) => x.tr === tr).map((x) => ({ t: x.t0, e: x.t1, n: x.n })),
      N: Span[] = m.notes.filter((x) => x.tr === copy).map((x) => ({ t: x.t0, e: x.t1, n: x.n - 12 }));
    const Ui = new Map(U.map((x) => [key(x.t, x.n), x])),
      Ni = new Map(N.map((x) => [key(x.t, x.n), x])),
      byN = new Map<number, Span[]>();
    for (const x of U) byN.set(x.n, [...(byN.get(x.n) ?? []), x]);
    /** 時刻 t に高さ n で鳴っている 1・3 の音（t で始まる音を含む） */
    const sounding = (t: number, n: number) => byN.get(n)?.find((y) => y.t <= t && y.e > t),
      /** 時刻 t に始まる高さ n の音のうち、N で説明できないもの */
      unexplained = (t: number, n: number) => (Ni.has(key(t, n)) ? undefined : Ui.get(key(t, n)));
    const M = new Map<string, Span>();
    for (const x of [...U].sort((a, b) => a.n - b.n || a.t - b.t)) {
      if (!Ni.has(key(x.t, x.n)) && !M.has(key(x.t, x.n - 12))) {
        if (x.n > HI || (sounding(x.t, x.n - 12) && !sounding(x.t, x.n + 12)))
          M.set(key(x.t, x.n - 12), { t: x.t, e: x.e, n: x.n - 12 });
        else M.set(key(x.t, x.n), x);
        continue;
      }
      const up = unexplained(x.t, x.n + 12);
      if (up && !M.has(key(x.t, x.n)) && (x.n + 12 > HI || !unexplained(x.t, x.n + 24)))
        M.set(key(x.t, x.n), { t: x.t, e: up.e, n: x.n });
    }
    const Mv = [...M.values()];
    /* LilyPond と同じ規則でつなぎ、元のトラックと同じになることを確かめる */
    const sim = new Map(
      joinSame([...N, ...Mv, ...Mv.map((x) => ({ ...x, n: x.n + 12 }))]).map((x) => [key(x.t, x.n), x]),
    );
    const bad = U.filter((x) => sim.get(key(x.t, x.n))?.e !== x.e);
    if (bad.length || sim.size !== U.length)
      throw new Error(
        `トラック ${tr} を再現できません: ${bad.map((x) => `${bar(x.t)} ${noteName(x.n)}`).join('、')}（${sim.size} / ${U.length}）`,
      );
    const real = new Map<string, Span>();
    for (const x of [...N, ...Mv]) {
      const y = real.get(key(x.t, x.n));
      if (!y || y.e < x.e) real.set(key(x.t, x.n), x);
    }
    const gone = U.filter((x) => !real.has(key(x.t, x.n)));
    /* 複製は、譜表を移る最初の時刻（alt が小節 21 の 3 拍目）より前にはない */
    const first = Math.min(...gone.map((x) => x.t));
    if (first < 63 * q) throw new Error(`トラック ${tr} の ${bar(first)} に複製があります`);
    removed += gone.length;
    restored += [...real.values()].filter((x) => !Ui.has(key(x.t, x.n))).length;
    /* 「1 オクターブ下に同時刻・同じ長さの音がある上の音を消す」だけの規則と比べる */
    const naive = new Set(U.filter((x) => U.some((y) => y.t === x.t && y.e === x.e && y.n === x.n - 12)));
    naiveWrong += [...naive].filter((x) => real.has(key(x.t, x.n))).length;
    naiveMissed += gone.filter((x) => !naive.has(x)).length;
    log(`トラック ${tr}: 複製 ${gone.length} 音を除いた（最初は ${bar(first)}）`);
    for (const x of real.values()) out.push({ tr, n: x.n, t0: x.t, t1: x.e });
  }
  log(`複製を除き ${removed} 音、つながって見えなかった本物の音 ${restored} 音を戻した`);
  log(
    `同時刻・同じ長さの 1 オクターブ下の音がある上の音を消すだけなら、本物 ${naiveWrong} 音を消し、複製 ${naiveMissed} 音を残していた`,
  );
  return out;
}

const mutopia = (id: number) => `https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=${id}`;
const common =
  '時刻と長さを 4 分音符の 1/480 に寄せ、同じ鍵盤で同じ時刻の同じ高さの音を 1 つにまとめた。強弱とテンポは使わない。';

const pieces: Piece[] = [
  {
    name: 'bwv565',
    title: 'J. S. バッハ「トッカータとフーガ ニ短調 BWV 565」',
    source: [
      '音符は Mutopia Project の楽譜（Anonymous 作成、底本 Bach-Gesellschaft Ausgabe, 1867、Mutopia-2011/09/11-1780、',
      `${mutopia(1780)}）の MIDI から変換した。`,
    ],
    changes: [`変更: ${common}`],
    license: 'pd',
    tracks: [
      [1, 0],
      [2, 1],
      [3, 2],
    ],
    meter: [4, 4],
    pickup: 0,
  },
  {
    name: 'bwv645',
    title: 'J. S. バッハ「目覚めよと呼ぶ声あり BWV 645」（シューブラー・コラール集 第 1 曲）',
    source: [
      '音符は Mutopia Project の楽譜（Bart Golsteijn 作成、底本 Bach-Gesellschaft, Leipzig、Mutopia-2006/06/29-601、',
      `${mutopia(601)}）の MIDI から変換した。`,
    ],
    changes: [
      '変更: 反復と第 1・第 2 括弧を演奏順に展開した（弱起と小節 1〜22、2〜20、23〜55。第 1 括弧の 2 小節目（小節 22）は',
      '小節 1 と同じ形で、反復は小節 2 に戻る）。上の譜表（upper）を h = 0、下の譜表（lower、コラールの旋律）を h = 1、',
      'ペダルを h = 2 にした。前打音は MIDI では本音符の少し前から元の長さで鳴り、本音符と重なるので、本音符の開始で切った。',
      common,
    ],
    license: 'cc-by-sa-2.5',
    tracks: [
      [1, 0],
      [2, 1],
      [3, 2],
    ],
    meter: [4, 4],
    pickup: 0.5,
    order: [
      [0, 22],
      [2, 20],
      [23, 55],
    ],
    grace: true,
  },
  {
    name: 'bwv582',
    title: 'J. S. バッハ「パッサカリアとフーガ ハ短調 BWV 582」',
    source: [
      '音符は Mutopia Project の楽譜（Urs Metzger 作成、底本 8656, C. F. Peters, Leipzig、Mutopia-2006/04/21-741、',
      `${mutopia(741)}）の MIDI から変換した。`,
    ],
    changes: [
      "変更: MIDI の 8' の 3 トラック（右手・左手・ペダル）を使い、4'・16' の複製のトラックは使わない。8' の右手・左手の",
      'トラックには、譜表を移った複製の声部の音（1 オクターブ上）が混じるので除いた。前打音は MIDI では本音符の少し前から',
      '元の長さで鳴り本音符と重なるので、本音符の開始で切った。テンポは MIDI の変化（♩ = 72 が基本）を、基本に対する比として',
      'TEMPO に入れた。時刻と長さを 4 分音符の 1/480 に寄せ、同じ鍵盤で同じ時刻の同じ高さの音を 1 つにまとめた。強弱は使わない。',
    ],
    license: 'pd',
    tracks: [
      [1, 0],
      [3, 1],
      [5, 2],
    ],
    meter: [3, 4],
    pickup: 1,
    grace: true,
    tempo: true,
    fix: octaves,
  },
  {
    /* IMSLP の MIDI を入手したら、トラックの割り当て・拍子・出典の URL を確かめる */
    name: 'bwv578',
    title: 'J. S. バッハ「フーガ ト短調 BWV 578」（小フーガ）',
    source: ['音符は IMSLP の MIDI（Pierre Gouin 作成）から変換した。'],
    changes: [`変更: ${common}`],
    license: 'cc-by-sa-4.0',
    tracks: [
      [1, 0],
      [2, 1],
      [3, 2],
    ],
    meter: [4, 4],
    pickup: 0,
  },
];

for (const p of pieces) build(p, kind);
