/**
 * src/tools/organ/scores/*.ts（パイプオルガンの物理モデルで演奏する曲の音符）を、同じディレクトリの *.mid から作る。
 * bun run organ-scores で実行する。
 *
 * 鍵盤は譜表で分ける: 右手の譜表を h = 0（第 1 手鍵盤）、左手の譜表を h = 1（第 2 手鍵盤）、ペダルを h = 2。
 * 実際には両手とも同じ手鍵盤で弾くことが多い曲でも、データは譜表で分けておく。
 * 同じ時刻・同じ高さの音は同じ鍵盤の中でだけ 1 つにまとめ、2 つの手鍵盤で同時に鳴る同じ音は両方残す
 */
import { PIECES } from '../src/tools/organ/score';
import { build, DIV, type Kind, type Midi, type Note, noteName, type Piece, type RawNote } from './score-midi';

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

/**
 * BWV 578 の MIDI（Pierre Gouin 作成）の 3 トラックは、0 がテンポ、1 が両手（音色はオルガン）、2 がペダル（ファゴット）。
 * 両手は 1 つのトラックなので、譜表に分けずに h = 0 に入れる。ペダルは 16' の響きを出すために、すべての音を 1 オクターブ下の
 * 音と同時に鳴らす（組の高いほうが譜面の高さ）。1 にも、ペダルの組の低いほうと同じ時刻・同じ高さの音が入っていて、
 * 小節 63 からは、さらに 1 オクターブ下（32'）の音も入る。ペダルは組の高いほうだけを使い、1 からは、ペダルの音と同じ時刻に
 * 始まる、その 1・2 オクターブ下の音を除く（16' はレジストレーションのサブバスで鳴らす）。
 * テンポは最初の時刻に 2 つあり（♩ = 88.00 と 87.95）、後ろのほうを基本にする
 */
function gouin(m: Midi, log: (s: string) => void): RawNote[] {
  const P = m.notes.filter((x) => x.tr === 2),
    pair = (x: RawNote, d: number) => P.some((y) => y.t0 === x.t0 && y.n === x.n + d),
    hi = P.filter((x) => pair(x, -12)),
    lo = P.filter((x) => pair(x, 12));
  if (hi.length + lo.length !== P.length) throw new Error('bwv578: ペダルに 1 オクターブ下の組のない音があります');
  const copy = (x: RawNote) => hi.some((y) => y.t0 === x.t0 && (y.n - x.n === 12 || y.n - x.n === 24)),
    M = m.notes.filter((x) => x.tr === 1),
    gone = M.filter(copy);
  log(
    `ペダルの組の低いほう ${lo.length} 音と、両手のトラックのペダルの写し ${gone.length} 音` +
      `（うち 2 オクターブ下 ${gone.filter((x) => hi.some((y) => y.t0 === x.t0 && y.n - x.n === 24)).length}）を除いた`,
  );
  const t0 = m.tempo.filter((x) => x.t === 0);
  m.tempo = [...t0.slice(-1), ...m.tempo.filter((x) => x.t > 0)];
  return [...M.filter((x) => !copy(x)), ...hi];
}

/**
 * 装飾。LilyPond の MIDI には \trill・\prall・\mordent などの装飾が展開されないので、Mutopia で MIDI と並んで公開されている
 * .ly の原本（bwv645.ly・bwv582.ly）で、装飾の付いた音の位置と種類を調べてここに書き、
 * 音符に展開する。[拍（反復を展開する前、4 分音符を 1 とする）, h, 主音, 種類, 補助音, 下の補助音（turn だけ）]。
 * 補助音は調号と、同じ小節の同じ声部の臨時記号に従う隣の音。
 * - trill: 上の補助音から始めて主音と交互に弾き、主音で終える（J. S. バッハ「W. F. バッハのためのクラヴィーア小曲集」の
 *   装飾の表の Trillo、C. P. E. バッハ『正しいクラヴィーア奏法』）。\trill のほか、バッハの記譜で Trillo にあたる
 *   \prall・\prallprall もこれ
 * - turn: trill の終わりを、下の補助音と主音（後打音）にする（\prallup）
 * - mordent: 主音・下の補助音・主音（Mordant）
 * 1 音の長さは、その位置のテンポで 1/12〜1/8 秒（1 秒に 8〜12 音）に入るように、元の音の長さを偶数に等分して決める
 */
type Orn = readonly [beat: number, h: number, n: number, kind: 'trill' | 'turn' | 'mordent', aux: number, low?: number];
/** 装飾の 1 音の長さの目安 [s] と範囲 */
const ORN_S = 0.1,
  ORN_MIN = 1 / 12,
  ORN_MAX = 1 / 8;

/** 曲 v の拍 b での 1 拍の長さ [s]（曲の標準のテンポと、区間ごとのテンポの比から） */
function spbOf(v: string, b: number): number {
  const pc = PIECES.find((x) => x.v === v);
  if (!pc) throw new Error(`${v}: 曲の設定がありません`);
  let r = 1;
  for (const [at, k] of pc.tempoMap) if (at <= b) r = k;
  return 60 / (pc.bpm * r);
}

/** 装飾 list を音符に展開する手直し。主音は、その時刻に始まるか、その時刻に鳴っている（タイの続き）音 */
function ornaments(v: string, list: readonly Orn[]) {
  return (ns: Note[], log: (s: string) => void): Note[] => {
    const out = [...ns],
      count = { trill: 0, turn: 0, mordent: 0 };
    for (const [beat, h, n, kind, aux, low] of list) {
      const T = Math.round(beat * DIV),
        x = out.find((y) => y.h === h && y.n === n && y.t <= T + 1 && y.t + y.d > T + 1);
      if (!x) throw new Error(`${v}: ${beat} 拍の ${noteName(n)}（h = ${h}）がありません`);
      const end = x.t + x.d,
        D = end - Math.max(T, x.t),
        t0 = end - D,
        sec = (D / DIV) * spbOf(v, beat),
        seq: [number, number][] = [];
      if (kind === 'mordent') {
        /* 主音と下の補助音を 1 音ぶんずつ、残りを主音で */
        const l = Math.min(Math.round(D / 3), Math.round((ORN_S * DIV) / spbOf(v, beat)));
        seq.push([n, l], [aux, l], [n, D - 2 * l]);
      } else {
        let N = Math.max(2, 2 * Math.round(sec / ORN_S / 2));
        while (sec / N > ORN_MAX) N += 2;
        while (N > 2 && sec / N < ORN_MIN) N -= 2;
        if (kind === 'turn') N = Math.max(4, N);
        const pitch = (k: number) => (kind === 'turn' && k === N - 2 ? (low as number) : k % 2 ? n : aux);
        for (let k = 0; k < N; k++) seq.push([pitch(k), Math.round(((k + 1) * D) / N) - Math.round((k * D) / N)]);
      }
      /* タイの続きに付いた装飾は、元の音を装飾の前で切る */
      if (t0 > x.t) x.d = t0 - x.t;
      else out.splice(out.indexOf(x), 1);
      let t = t0;
      for (const [p, d] of seq) {
        out.push({ t, d, n: p, h, odd: false });
        t += d;
      }
      count[kind]++;
    }
    log(`装飾 ${list.length} 個を展開した（trill ${count.trill}・turn ${count.turn}・mordent ${count.mordent}）`);
    return out;
  };
}

/**
 * BWV 645 の装飾（bwv645.ly）。上の譜表（h = 0）は \trill 11・\prallprall 2・\prallup 1、下の譜表（コラールの旋律、
 * h = 1）は \trill 5・\prallprall 1。タイの続きに付いた \trill（拍 163.5・167.5・203.5・207.5）は、タイの後ろの 16 分音符で弾く。
 * 拍 163.5 の G の上の補助音は、同じ小節の A（ナチュラル）
 */
const ORN645: readonly Orn[] = [
  [32, 0, 75, 'turn', 77, 74],
  [33.5, 0, 70, 'trill', 72],
  [41.5, 0, 62, 'trill', 63],
  [45.5, 0, 57, 'trill', 58],
  [71.5, 1, 60, 'trill', 62],
  [109.5, 0, 70, 'trill', 72],
  [117.5, 0, 62, 'trill', 63],
  [121.5, 0, 57, 'trill', 58],
  [126.5, 0, 58, 'trill', 60],
  [127.5, 1, 53, 'trill', 55],
  [137.5, 1, 53, 'trill', 55],
  [146.5, 1, 56, 'trill', 58],
  [163.5, 0, 67, 'trill', 69],
  [167.5, 0, 60, 'trill', 62],
  [171.5, 0, 58, 'trill', 60],
  [185.5, 1, 65, 'trill', 67],
  [196.5, 0, 68, 'trill', 70],
  [199.5, 1, 53, 'trill', 55],
  [203.5, 0, 63, 'trill', 65],
  [207.5, 0, 68, 'trill', 70],
];
/**
 * BWV 582 の装飾（bwv582.ly）。\prall 16（Trillo）と \mordent 3。拍 756 の A の上の補助音は、同じ小節の H（ナチュラル）
 */
const ORN582: readonly Orn[] = [
  [59, 0, 67, 'mordent', 65],
  [68, 0, 59, 'trill', 60],
  [117, 0, 62, 'trill', 63],
  [129, 0, 80, 'trill', 82],
  [132, 0, 71, 'trill', 72],
  [141, 0, 74, 'trill', 75],
  [189, 0, 62, 'trill', 63],
  [216, 0, 63, 'trill', 65],
  [216, 1, 60, 'mordent', 59],
  [324, 1, 47, 'trill', 48],
  [355, 0, 63, 'mordent', 62],
  [414, 0, 71, 'trill', 72],
  [429, 0, 71, 'trill', 72],
  [570, 0, 69, 'trill', 70],
  [588, 0, 74, 'trill', 75],
  [756, 0, 69, 'trill', 71],
  [764.5, 0, 82, 'trill', 84],
  [841, 0, 71, 'trill', 72],
  [858, 0, 74, 'trill', 75],
];

/**
 * BWV 565 は、OpenGameArt で CC0 として公開された手弾きの演奏の MIDI（TheOuterLinux の投稿「NES - Bach - BWV 565」の
 * zip の中の Bach - BWV 565.mid）を使う。トラックは 0 がテンポ、1 が Swell（第 2 手鍵盤）、2 が Great（第 1 手鍵盤）、
 * 3 が Pedal、4 が Main Piston（チャンネル 8 のプログラムチェンジ 10 個。レジストレーションの切り替え）。
 * 時刻は寄せずに MIDI のまま使い、テンポの変化も使う。拍子は途中で 3/4・8/4 に変わる。
 * Mutopia の楽譜と照らして、明らかに楽譜にない弾き損じだけを除く: 48.3 秒の E5（Great、tick 4397、長さ 9 tick、
 * ベロシティ 35）は、すぐ後（10 tick 後）の E5 の直前に触れた二重の打鍵で、楽譜の 1 つの E5 にあたる。
 * ほかの弱い音（ベロシティ 50 未満）は、オクターブの組の片方、和音の分散、トリルの音で、楽譜にある
 */
function oga565(m: Midi, log: (s: string) => void): RawNote[] {
  const bad = m.notes.filter((x) => x.tr === 2 && x.n === 76 && x.t0 === 4397 && x.t1 === 4406);
  if (bad.length !== 1) throw new Error('bwv565: 除く E5 が見つかりません');
  log(`弾き損じの音を除いた: ${noteName(76)}（tick 4397）`);
  return m.notes.filter((x) => !bad.includes(x));
}

const mutopia = (id: number) => `https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=${id}`;
const common =
  '時刻と長さを 4 分音符の 1/480 に寄せ、同じ鍵盤で同じ時刻の同じ高さの音を 1 つにまとめた。強弱とテンポは使わない。';
/** 装飾の展開の説明（「変更」の段落に足す行） */
const ornNote = (src: string) => [
  `MIDI に展開されていない装飾を、.ly の原本（${src}）の位置と種類で音符に展開した（トリルは上の補助音から`,
  '主音と交互に 1 秒に 8〜12 音で弾いて主音で終え、モルデントは主音・下の補助音・主音）。',
];

const pieces: Piece[] = [
  {
    name: 'bwv565',
    title: 'J. S. バッハ「トッカータとフーガ ニ短調 BWV 565」',
    source: [
      '音符は OpenGameArt で CC0 として公開された、人の演奏を記録した MIDI（TheOuterLinux の投稿「NES - Bach - BWV 565」、',
      '2019、https://opengameart.org/content/nes-bach-bwv-565 の zip の中の Bach - BWV 565.mid）から変換した。',
      '同じデータは 2018 年から作成者の名前なしで出回っており、元の演奏・作成者は分かっていない。',
    ],
    changes: [
      '変更: Great のトラックを h = 0（第 1 手鍵盤）、Swell を h = 1（第 2 手鍵盤）、Pedal を h = 2 にした。',
      '時刻と長さは寄せずに MIDI のまま使い（4 分音符の 1/480 で表す）、テンポの変化（♩ = 50 が基本）を、基本に対する比として',
      'TEMPO に、拍子の変化を METER に、Main Piston のプログラムチェンジ（レジストレーションの切り替え）を REG に入れた。',
      '弾き損じの音 1 つ（48.3 秒の Great の E5。直後の E5 の前に触れた二重の打鍵）を除いた。強弱は使わない。',
    ],
    license: 'cc0',
    tracks: [
      [2, 0],
      [1, 1],
      [3, 2],
    ],
    meter: [4, 4],
    meters: true,
    pickup: 0,
    exact: true,
    tempo: true,
    programs: 4,
    fix: oga565,
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
      ...ornNote('bwv645.ly'),
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
    edit: ornaments('bwv645', ORN645),
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
      ...ornNote('bwv582.ly'),
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
    edit: ornaments('bwv582', ORN582),
  },
  {
    name: 'bwv578',
    title: 'J. S. バッハ「フーガ ト短調 BWV 578」（小フーガ）',
    source: [
      '音符は IMSLP の MIDI（Pierre Gouin 作成、Les Éditions Outremontaises、2017、',
      'https://imslp.org/wiki/File:PMLP153148-Bach_578_Fugue_Gm.mid）から変換した。',
    ],
    changes: [
      '変更: 両手のトラックを h = 0、ペダルのトラックを h = 2 にした。ペダルの 1 オクターブ下の重ねと、両手のトラックに入っていた',
      'ペダルの 1・2 オクターブ下の写しを除いた。テンポは MIDI の変化（♩ = 88 が基本）を、基本に対する比として TEMPO に入れた。',
      '音の長さと時刻の細かなずれ（演奏の表情）は MIDI のまま使い、4 分音符の 1/480 に寄せた。強弱は使わない。',
    ],
    license: 'cc-by-sa-4.0',
    tracks: [
      [1, 0],
      [2, 2],
    ],
    meter: [4, 4],
    pickup: 0,
    tempo: true,
    fix: gouin,
  },
];

for (const p of pieces) build(p, kind);
