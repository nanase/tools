/**
 * 演奏する曲（著作権の切れた曲の電子楽譜から変換したもの）と、曲ごとのレジストレーション（DOM に依存しない）。
 * 音符のデータは scores/ にあり、曲を選んだときに読み込む。譜表 h は 0 = 右手、1 = 左手、2 = ペダル
 */
import type { ScoreNote } from './scores/types';

export type { ScoreNote };

/** 鍵盤（風箱）: 第 1 手鍵盤・第 2 手鍵盤・ペダル */
export type Div = 'I' | 'II' | 'P';
export type Coupler = 'II/I' | 'I/P' | 'II/P';

/** レジストレーション: 入れるストップ（ストップの id）とカプラー */
export interface Registration {
  stops: readonly string[];
  couplers: readonly Coupler[];
  /** 譜表ごとに弾く鍵盤（右手・左手・ペダル）。手を別の鍵盤へ移す切り替え（エコーなど）。なければ曲の hands */
  hands?: readonly [Div, Div, Div];
}

/** 曲のデータ */
export interface PieceData {
  notes: ScoreNote[];
  /** テンポの変化 [拍, 基本のテンポに対する比] */
  tempo: readonly (readonly [number, number])[];
  /** 拍子の変化 [拍, 1 小節の拍の数]（なければ Piece.bar） */
  meter?: readonly (readonly [number, number])[];
  /** レジストレーションの切り替え [拍, 番号]（番号は Piece.regs） */
  reg?: readonly (readonly [number, number])[];
}

export interface Piece {
  v: string;
  name: string;
  by: string;
  /** 1 分あたりの 4 分音符の数（標準のテンポ） */
  bpm: number;
  /** 速さの表記（出典の枠に出す） */
  tempo: string;
  /** 1 小節の拍（4 分音符）の数・弱起の拍 */
  bar: number;
  pickup: number;
  /** 譜表ごとに弾く鍵盤（右手・左手・ペダル） */
  hands: readonly [Div, Div, Div];
  /** 使うストップ（ストップの id）とカプラー（演奏の始めのレジストレーション） */
  stops: readonly string[];
  couplers: readonly Coupler[];
  /** 演奏中に切り替えるレジストレーション（曲のデータの REG の番号ごと） */
  regs?: Readonly<Record<number, Registration>>;
  /** テンポの変化 [拍, 標準のテンポに対する比]（曲のデータの TEMPO より先に使う。空ならデータのもの） */
  tempoMap: readonly (readonly [number, number])[];
  load: () => Promise<PieceData>;
}

/** オルガノ・プレノ: 第 1 手鍵盤のプリンシパルの合唱（16' から ミクスチュアまで）と、ペダルの 16'・8'・4' とポザウネ */
const PLENUM = ['bd16', 'p8', 'p4', 'q3', 'p2', 'mix', 'pb16', 'sb16', 'ob8', 'cb4', 'po16'];

/**
 * BWV 565 の演奏の MIDI の Main Piston（ジェネラル・ピストン）の 5 つの番号に当てるレジストレーション。番号が大きいほど強い
 * 並びで、区間の音楽から決めた（MIDI には中身がない）。
 * 3: エコーの区間とフーガの始め（第 2 手鍵盤の弱い合唱と、第 1 手鍵盤の 8'・4'）
 * 4: ペダルの入る区間とフーガの中ほど（2' までの合唱）
 * 6: プレノ（16' からミクスチュアまで。第 2 手鍵盤も合唱）
 * 8: プレノにリード（トランペット・オーボエ）。トッカータとフーガの終わりの区間
 * 9: 最後の和音のトゥッティ（第 1 手鍵盤の全部）
 */
const SWELL_CHORUS = ['gp8', 'g8', 'f4', 'n3', 'fl2'],
  PLENO565 = [...PLENUM, ...SWELL_CHORUS],
  REED565 = [...PLENO565, 'tr8', 'hb8', 'ptr8'],
  REGS565: Record<number, Registration> = {
    3: { stops: ['p8', 'p4', 'gp8', 'g8', 'f4', 'sb16', 'ob8'], couplers: [] },
    4: { stops: ['p8', 'p4', 'p2', 'gp8', 'g8', 'f4', 'fl2', 'sb16', 'ob8', 'cb4'], couplers: [] },
    6: { stops: PLENO565, couplers: [] },
    8: { stops: REED565, couplers: [] },
    9: { stops: [...REED565, 'hf8', 'wf4', 'cor'], couplers: [] },
  };

/*
 * ほかの曲のレジストレーションの部品。MIDI には切り替えの情報がないので、切り替える拍（[拍, 番号]）は、楽譜の強弱記号
 * （MIDI のベロシティ）の変わり目・テンポや拍子の変わり目・曲の形（エコー、ペダルの休む独奏の区間）から、このツールで決めた
 */
const I84 = ['p8', 'hf8', 'p4'],
  I_PLENO = ['bd16', 'p8', 'p4', 'q3', 'p2', 'mix'],
  I_REED = [...I_PLENO, 'tr8'],
  /* 全体の強さ。16'・ミクスチュアの多い列・コルネを足すと、和音の厚い曲で同時に鳴る管が 150 本を超え、計算が間に合わない */
  I_GRAND = ['p8', 'p4', 'p2', 'mix', 'tr8'],
  P_SOFT = ['sb16', 'gb8'],
  P_MF = ['sb16', 'ob8'],
  P_F = ['pb16', 'sb16', 'ob8', 'cb4'],
  P_FF = [...P_F, 'po16'],
  P_TUTTI = [...P_FF, 'ptr8'];
type Hands = readonly [Div, Div, Div];
const ON_I: Hands = ['I', 'I', 'P'],
  ON_II: Hands = ['II', 'II', 'P'],
  SPLIT: Hands = ['I', 'II', 'P'];
const reg = (stops: readonly string[], hands?: Hands, couplers: readonly Coupler[] = []): Registration => ({
  stops,
  couplers,
  ...(hands ? { hands } : {}),
});
/** 演奏の始めのレジストレーション（Piece の stops・couplers。鍵盤は Piece の hands） */
const first = (r: Registration) => ({ stops: r.stops, couplers: r.couplers });
/** 強弱の 4 段（1 = p は第 2 手鍵盤、2 = mf・3 = f・4 = ff は第 1 手鍵盤） */
const DYN: Record<number, Registration> = {
  1: reg(['gp8', 'g8', 'f4', ...P_SOFT], ON_II),
  2: reg([...I84, ...P_MF], ON_I),
  3: reg([...I_PLENO, ...P_F], ON_I),
  4: reg([...I_GRAND, 'hb8', ...P_FF], ON_I, ['II/I']),
};
/** 楽譜の強弱（MIDI のベロシティ）の変わり目。結婚行進曲: 95 = 2、101 = 3、なし（90、トリオ）= 1、127 = 4 */
const WEDDING: readonly [number, number][] = [
  [0, 2],
  [56, 3],
  [376, 1],
  [486, 2],
  [553, 3],
  [581, 4],
  [649, 3],
  [721, 2],
  [737, 3],
];
/**
 * スタンリー: アダージョはディアパソン（1）、アンダンテ（88 拍から）は右手のトランペットと左手の第 2 手鍵盤（2）。
 * 直前の句をそのまま繰り返す句（エコー）は、右手を第 2 手鍵盤のオーボエへ、左手を第 1 手鍵盤の弱い 8' へ移す（3）
 */
const STANLEY: Record<number, Registration> = {
    1: reg(['p8', 'hf8'], ON_I),
    2: reg(['tr8', 'gp8', 'g8'], SPLIT),
    3: reg(['hf8', 'g8', 'hb8'], ['II', 'I', 'P']),
  },
  STANLEY_AT: readonly [number, number][] = [
    [0, 1],
    [88, 2],
    ...[
      [93.5, 1.5],
      [117.5, 1.5],
      [178.5, 2],
      [244.5, 4],
      [250.5, 1.5],
      [305.5, 1.5],
      [453.5, 1.5],
      [461.5, 1.5],
    ].flatMap(([b, d]): [number, number][] => [
      [b, 3],
      [b + d, 2],
    ]),
  ];
/**
 * ヴィドール 第 6 番: fff（126）= 4、pp（33）= 1、ff（112）= 5、f（94）= 3。両手とも和音が厚いので、手鍵盤は 1 鍵 4 本まで
 * （ミクスチュアなし）
 */
const WIDOR6: Record<number, Registration> = {
    1: reg(['gp8', 'g8', 'sal8', ...P_SOFT], ON_II),
    3: reg([...I84, ...P_F], ON_I),
    4: reg(['p8', 'p4', 'p2', 'tr8', 'sb16', 'ob8', 'po16'], ON_I),
    5: reg(['p8', 'p4', 'tr8', 'sb16', 'ob8', 'po16'], ON_I),
  },
  WIDOR6_AT: readonly [number, number][] = [
    [0, 4],
    [397, 1],
    [684, 5],
    [807, 3],
    [850, 5],
    [866, 3],
  ];
/** ジグー: p（49）は第 2 手鍵盤の合唱（1）、f（96）はプレノ（2）、ff（112）はリードとカプラー（3） */
const GIGOUT: Record<number, Registration> = {
    1: reg([...SWELL_CHORUS, ...P_MF], ON_II),
    2: reg([...I_PLENO, ...P_F], ON_I),
    3: DYN[4],
  },
  GIGOUT_AT: readonly [number, number][] = [
    [0, 1],
    [144, 2],
    [266, 3],
  ];
/**
 * エルガー: pp（33）は第 2 手鍵盤の弦の音（1）、f（96）の前のクレッシェンド（48 拍から）で第 2 手鍵盤に 8'・4' を足し（2）、
 * f は第 1 手鍵盤の 8'・4' に第 2 手鍵盤を重ねる（3。リードとミクスチュアは入れない）
 */
const POMP: Record<number, Registration> = {
    1: reg(['g8', 'sal8', 'vc8', ...P_SOFT], ON_II),
    2: reg(['gp8', 'g8', 'sal8', 'vc8', 'f4', ...P_MF], ON_II),
    3: reg([...I84, 'g8', 'f4', ...P_F], ON_I, ['II/I']),
  },
  POMP_AT: readonly [number, number][] = [
    [0, 1],
    [48, 2],
    [56, 3],
  ];
/** ダンドリュー: 4/4 の序奏（60 拍まで）はプラン・ジュ（1）、2/2 のフーガはトランペットとコルネのグラン・ジュ（2） */
const DANDRIEU: Record<number, Registration> = {
    1: reg(I_PLENO, ON_I),
    2: reg(['bd16', 'p8', 'p4', 'tr8', 'cor'], ON_I),
  },
  DANDRIEU_AT: readonly [number, number][] = [
    [0, 1],
    [60, 2],
  ];
/** ブクステフーデ: 4/4 の部分はプレノ（1）、3/4 のフーガ（248 拍から）は第 2 手鍵盤の合唱（2）、最後の 4/4 はリード（3） */
const BUX155: Record<number, Registration> = {
    1: reg([...I_PLENO, ...P_FF], ON_I),
    2: reg([...SWELL_CHORUS, ...P_F], ON_II),
    3: reg([...I_REED, ...P_TUTTI], ON_I),
  },
  BUX155_AT: readonly [number, number][] = [
    [0, 1],
    [248, 2],
    [470, 3],
  ];
/** カノン: 8 小節（32 拍）ごとにストップを足していく */
const CANON: Record<number, Registration> = {
    1: reg(['g8', 'sal8', ...P_SOFT], ON_II),
    2: reg(['g8', 'sal8', 'vc8', 'f4', ...P_SOFT], ON_II),
    3: reg(['p8', 'hf8', 'g8', 'f4', ...P_MF], SPLIT),
    4: reg([...I84, 'g8', 'f4', ...P_MF], SPLIT),
    5: reg([...I84, 'p2', 'g8', 'f4', ...P_F], SPLIT),
    6: reg([...I_PLENO, ...SWELL_CHORUS, ...P_F], SPLIT, ['II/I']),
  },
  CANON_AT: readonly [number, number][] = [
    [0, 1],
    [32, 2],
    [64, 3],
    [96, 4],
    [128, 5],
    [160, 6],
  ];
/**
 * BWV 593: ペダルの休む独奏の区間（小節 17〜21・26〜36・49〜54・67〜68・88〜90）は両手を第 2 手鍵盤の合唱へ（2）、
 * ほかの総奏（リトルネッロ）は第 1 手鍵盤のプレノ（1）。バッハの自筆譜の Oberwerk と Rückpositiv の弾き分けにならった
 */
const BWV593: Record<number, Registration> = {
    1: reg([...I_PLENO, ...SWELL_CHORUS, ...P_F], ON_I),
    2: reg([...I_PLENO, ...SWELL_CHORUS, ...P_F], ON_II),
  },
  BWV593_AT: readonly [number, number][] = [
    [0, 1],
    [64, 2],
    [84, 1],
    [100, 2],
    [144, 1],
    [192, 2],
    [216, 1],
    [264, 2],
    [272, 1],
    [348, 2],
    [360, 1],
  ];

export const PIECES: readonly Piece[] = [
  {
    v: 'bwv565',
    name: 'トッカータとフーガ ニ短調 BWV 565',
    by: 'J. S. バッハ（伝）',
    bpm: 50,
    tempo: '♩ = 50（演奏のテンポの変化に従う。♩ = 18〜115）',
    bar: 4,
    pickup: 0,
    /* 演奏の MIDI の Great・Swell・Pedal を、第 1 手鍵盤・第 2 手鍵盤・ペダルで弾く */
    hands: ['I', 'II', 'P'],
    stops: PLENO565,
    couplers: [],
    regs: REGS565,
    tempoMap: [],
    load: () =>
      import('./scores/bwv565').then((m) => ({ notes: m.notes(), tempo: m.TEMPO, meter: m.METER, reg: m.REG })),
  },
  {
    v: 'bwv645',
    name: '目覚めよと呼ぶ声あり BWV 645',
    by: 'J. S. バッハ（シューブラー・コラール集）',
    bpm: 66,
    tempo: '♩ = 66',
    bar: 4,
    pickup: 0.5,
    hands: ['II', 'I', 'P'],
    stops: ['g8', 'f4', 'tr8', 'sb16', 'ob8'],
    couplers: [],
    tempoMap: [],
    load: () => import('./scores/bwv645').then((m) => ({ notes: m.notes(), tempo: m.TEMPO })),
  },
  {
    v: 'bwv582',
    name: 'パッサカリアとフーガ ハ短調 BWV 582',
    by: 'J. S. バッハ',
    bpm: 66,
    tempo: '♩ = 66（終わりは MIDI のテンポの変化に従う）',
    bar: 3,
    pickup: 1,
    hands: ['I', 'I', 'P'],
    stops: PLENUM,
    couplers: [],
    tempoMap: [],
    load: () => import('./scores/bwv582').then((m) => ({ notes: m.notes(), tempo: m.TEMPO })),
  },
  {
    v: 'bwv578',
    name: 'フーガ ト短調 BWV 578（小フーガ）',
    by: 'J. S. バッハ',
    bpm: 88,
    tempo: '♩ = 88（終わりは MIDI のテンポの変化に従う）',
    bar: 4,
    pickup: 0,
    /* 両手は 1 つのトラックなので、どちらも第 1 手鍵盤で弾く */
    hands: ['I', 'I', 'P'],
    /* プリンシパルの合唱（8'・4'・2'・ミクスチュア）と、ペダルの 16'・8' */
    stops: ['p8', 'p4', 'p2', 'mix', 'sb16', 'ob8'],
    couplers: [],
    tempoMap: [],
    load: () => import('./scores/bwv578').then((m) => ({ notes: m.notes(), tempo: m.TEMPO })),
  },
  {
    v: 'wedding',
    name: '結婚行進曲（真夏の夜の夢）',
    by: 'F. メンデルスゾーン（T. デュボワ編）',
    bpm: 130,
    tempo: '♩ = 130',
    bar: 4,
    pickup: 1,
    hands: ON_I,
    ...first(DYN[2]),
    regs: DYN,
    tempoMap: [],
    load: () => import('./scores/wedding').then((m) => ({ notes: m.notes(), tempo: m.TEMPO, reg: WEDDING })),
  },
  {
    v: 'stanley65',
    name: 'トランペット・ヴォランタリー ニ長調 作品 6 第 5 番',
    by: 'J. スタンリー',
    bpm: 72,
    tempo: '♩ = 72（アンダンテは ♩ = 110）',
    bar: 4,
    pickup: 0,
    hands: ON_I,
    ...first(STANLEY[1]),
    regs: STANLEY,
    tempoMap: [],
    load: () => import('./scores/stanley65').then((m) => ({ notes: m.notes(), tempo: m.TEMPO, reg: STANLEY_AT })),
  },
  {
    v: 'widor6',
    name: 'オルガン交響曲 第 6 番 より フィナーレ',
    by: 'C.-M. ヴィドール',
    bpm: 184,
    tempo: '♩ = 184（終わりは MIDI のテンポの変化に従う）',
    bar: 4,
    pickup: 1,
    hands: ON_I,
    ...first(WIDOR6[4]),
    regs: WIDOR6,
    tempoMap: [],
    load: () =>
      import('./scores/widor6').then((m) => ({ notes: m.notes(), tempo: m.TEMPO, meter: m.METER, reg: WIDOR6_AT })),
  },
  {
    v: 'widor5',
    name: 'オルガン交響曲 第 5 番 より アダージョ',
    by: 'C.-M. ヴィドール',
    bpm: 32,
    tempo: '♪ = 63（楽譜の指示）',
    bar: 4,
    pickup: 0,
    /* 楽譜の指示: 右手は Récit のガンバとヴォワ・セレスト、左手は Grand-orgue の 8'・16' の基音、ペダルは 4' */
    hands: ['II', 'I', 'P'],
    stops: ['sal8', 'vc8', 'bd16', 'hf8', 'cb4'],
    couplers: [],
    tempoMap: [],
    load: () => import('./scores/widor5').then((m) => ({ notes: m.notes(), tempo: m.TEMPO })),
  },
  {
    v: 'gigout',
    name: 'トッカータ ロ短調',
    by: 'E. ジグー',
    bpm: 120,
    tempo: '♩ = 120',
    bar: 2,
    pickup: 0,
    hands: ON_II,
    ...first(GIGOUT[1]),
    regs: GIGOUT,
    tempoMap: [],
    load: () => import('./scores/gigout').then((m) => ({ notes: m.notes(), tempo: m.TEMPO, reg: GIGOUT_AT })),
  },
  {
    v: 'pomp',
    name: '威風堂々 第 1 番 より トリオ',
    by: 'E. エルガー（オルガン独奏用の編曲）',
    bpm: 80,
    tempo: '♩ = 80',
    bar: 2,
    pickup: 0,
    hands: ON_II,
    ...first(POMP[1]),
    regs: POMP,
    tempoMap: [],
    load: () => import('./scores/pomp').then((m) => ({ notes: m.notes(), tempo: m.TEMPO, reg: POMP_AT })),
  },
  {
    v: 'dandrieu',
    name: 'オフェルトワール',
    by: 'J.-F. ダンドリュー',
    bpm: 40,
    tempo: '♩ = 40（フーガは 2 分音符 = 92）',
    bar: 4,
    pickup: 0,
    hands: ON_I,
    ...first(DANDRIEU[1]),
    regs: DANDRIEU,
    tempoMap: [],
    load: () =>
      import('./scores/dandrieu').then((m) => ({ notes: m.notes(), tempo: m.TEMPO, meter: m.METER, reg: DANDRIEU_AT })),
  },
  {
    v: 'buxwv155',
    name: 'トッカータ ニ短調 BuxWV 155',
    by: 'D. ブクステフーデ',
    bpm: 72,
    tempo: '♩ = 72',
    bar: 4,
    pickup: 0,
    hands: ON_I,
    ...first(BUX155[1]),
    regs: BUX155,
    tempoMap: [],
    load: () =>
      import('./scores/buxwv155').then((m) => ({ notes: m.notes(), tempo: m.TEMPO, meter: m.METER, reg: BUX155_AT })),
  },
  {
    v: 'canon',
    name: 'カノン ニ長調',
    by: 'J. パッヘルベル（B. Rodriguez 編）',
    bpm: 70,
    tempo: '♩ = 70',
    bar: 4,
    pickup: 0,
    hands: ON_II,
    ...first(CANON[1]),
    regs: CANON,
    tempoMap: [],
    load: () => import('./scores/canon').then((m) => ({ notes: m.notes(), tempo: m.TEMPO, reg: CANON_AT })),
  },
  {
    v: 'bwv593',
    name: '協奏曲 イ短調 BWV 593 より 第 1 楽章',
    by: 'J. S. バッハ（A. ヴィヴァルディの原曲による）',
    bpm: 92,
    tempo: '♩ = 92（終わりは MIDI のテンポの変化に従う）',
    bar: 4,
    pickup: 0,
    hands: ON_I,
    ...first(BWV593[1]),
    regs: BWV593,
    tempoMap: [],
    load: () => import('./scores/bwv593').then((m) => ({ notes: m.notes(), tempo: m.TEMPO, reg: BWV593_AT })),
  },
  {
    v: 'bwv525',
    name: 'トリオ・ソナタ 第 1 番 BWV 525 より 第 1 楽章',
    by: 'J. S. バッハ',
    bpm: 75,
    tempo: '♩ = 75（終わりは MIDI のテンポの変化に従う）',
    bar: 4,
    pickup: 0,
    /* トリオ: 右手は第 1 手鍵盤の 8'・4'、左手は第 2 手鍵盤のフルートとナザール */
    hands: SPLIT,
    stops: ['p8', 'wf4', 'g8', 'f4', 'n3', ...P_MF],
    couplers: [],
    tempoMap: [],
    load: () => import('./scores/bwv525').then((m) => ({ notes: m.notes(), tempo: m.TEMPO })),
  },
  {
    v: 'bwv639',
    name: '主イエス・キリストよ、われ汝を呼ぶ BWV 639',
    by: 'J. S. バッハ（オルガン小曲集）',
    bpm: 25,
    tempo: '♩ = 25',
    bar: 4,
    pickup: 1,
    /* 旋律は第 2 手鍵盤のオーボエ、伴奏は第 1 手鍵盤の弱い 8' */
    hands: ['II', 'I', 'P'],
    stops: ['hb8', 'g8', 'hf8', ...P_SOFT],
    couplers: [],
    tempoMap: [],
    load: () => import('./scores/bwv639').then((m) => ({ notes: m.notes(), tempo: m.TEMPO, meter: m.METER })),
  },
  {
    v: 'bwv564',
    name: 'トッカータ ハ長調 BWV 564',
    by: 'J. S. バッハ（トッカータ、アダージョとフーガ より）',
    bpm: 72,
    tempo: '♩ = 72（MIDI のテンポの変化に従う）',
    bar: 4,
    pickup: 0,
    hands: ON_I,
    stops: [...I_PLENO, ...P_FF],
    couplers: [],
    tempoMap: [],
    load: () => import('./scores/bwv564').then((m) => ({ notes: m.notes(), tempo: m.TEMPO })),
  },
  {
    v: 'bwv542',
    name: '幻想曲 ト短調 BWV 542',
    by: 'J. S. バッハ（幻想曲とフーガ より）',
    bpm: 36,
    tempo: '♩ = 36',
    bar: 4,
    pickup: 0,
    /* 楽譜の forte の声部は第 1 手鍵盤のプレノ、piano の声部は第 2 手鍵盤の合唱 */
    hands: SPLIT,
    stops: [...I_PLENO, ...SWELL_CHORUS, ...P_F],
    couplers: [],
    tempoMap: [],
    load: () => import('./scores/bwv542').then((m) => ({ notes: m.notes(), tempo: m.TEMPO })),
  },
];
export const pieceOf = (v: string): Piece => PIECES.find((p) => p.v === v) ?? PIECES[0];

/** 拍子の変化の列で、拍 b の小節の番号（1 から。弱起は 0）。meter は [拍, 1 小節の拍の数] */
export function barOf(meter: readonly (readonly [number, number])[], pickup: number, b: number): number {
  if (b < pickup) return 0;
  let k = 0;
  for (let i = 0; i < meter.length; i++) {
    const s0 = Math.max(meter[i][0], pickup),
      len = meter[i][1],
      e0 = i + 1 < meter.length ? meter[i + 1][0] : Infinity;
    if (b < e0) return k + Math.floor((b - s0) / len) + 1;
    k += Math.round(Math.max(0, e0 - s0) / len);
  }
  return k;
}

/** 拍子の変化の列で、小節 1, 2 … の頭の拍（barOf と同じ番号。弱起は含めない）。end は曲の終わりの拍 */
export function barStarts(meter: readonly (readonly [number, number])[], pickup: number, end: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < meter.length; i++) {
    const s0 = Math.max(meter[i][0], pickup),
      len = meter[i][1],
      e0 = Math.min(end, i + 1 < meter.length ? meter[i + 1][0] : Infinity);
    for (let b = s0; b < e0 - 1e-6; b += len) out.push(b);
  }
  return out;
}

export { TempoMap } from '../../lib/tempo';
