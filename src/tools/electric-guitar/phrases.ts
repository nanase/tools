/**
 * フレーズ（このツールのために作ったもの）と音色のプリセット、フレーズを拍に合わせて弾く進行（DOM に依存しない）。
 * フレーズは同じ小節をくり返す。出来事は拍 b と、拍に足す秒 dt（かき鳴らしで弦を順に弾くずれ）で並べる
 */
import { defaults, KINDS, type Kind } from './pedals';
import { cloneRack, DEFAULT_RACK, type Pedal, type Rack } from './rig';

/** フレーズの出来事 */
export type Ev = { b: number; dt?: number } & (
  | { k: 'pluck'; si: number; fr: number; amp: number; mute?: boolean; ghost?: boolean; harm?: number; lead?: boolean }
  /** 弦を止める */
  | { k: 'stop'; si: readonly number[] }
  /** チョーキング: semi 半音まで dur 拍で（0 で戻す） */
  | { k: 'bend'; si: number; semi: number; dur: number }
  /** ビブラート: depth 半音（0 で止める） */
  | { k: 'vib'; si: number; depth: number }
);

type Fr = (number | null)[];
interface StrumOpt {
  up?: boolean;
  /** 弦を順に弾く間隔 [s] */
  sp?: number;
  amp?: number;
  mute?: boolean;
  ghost?: boolean;
  harm?: number;
  /** 弾く前にすべての弦を止める */
  cut?: boolean;
  /** この拍数の後に止める（短く切る） */
  len?: number;
}
const ALL = [0, 1, 2, 3, 4, 5] as const;
/** 6 弦から 1 弦の順のフレット（null は弾かない）の和音を、弾く順の出来事に */
function strum(b: number, f6: Fr, o: StrumOpt = {}): Ev[] {
  const ev: Ev[] = [],
    idx: { si: number; fr: number }[] = [];
  f6.forEach((fr, k) => {
    if (fr !== null) idx.push({ si: 5 - k, fr });
  });
  if (o.up) idx.reverse();
  if (o.cut) ev.push({ b, dt: -0.003, k: 'stop', si: ALL });
  idx.forEach((e, j) => {
    ev.push({
      b,
      dt: j * (o.sp ?? 0.009),
      k: 'pluck',
      si: e.si,
      fr: e.fr,
      amp: (o.amp ?? 1) * (o.up ? 0.75 : 1) * (1 - 0.04 * j),
      mute: o.mute,
      ghost: o.ghost,
      harm: o.harm,
    });
  });
  if (o.len) ev.push({ b: b + o.len, k: 'stop', si: idx.map((e) => e.si) });
  return ev;
}
/** 単音（弦は 1〜6）。lead は他の弦を止める */
const note = (
  b: number,
  str: number,
  fr: number,
  o: { amp?: number; lead?: boolean; harm?: number; mute?: boolean } = {},
): Ev => ({
  b,
  k: 'pluck',
  si: str - 1,
  fr,
  amp: o.amp ?? 0.9,
  lead: o.lead ?? true,
  harm: o.harm,
  mute: o.mute,
});
const bend = (b: number, str: number, semi: number, dur: number): Ev => ({ b, k: 'bend', si: str - 1, semi, dur });
const vib = (b: number, str: number, depth: number): Ev => ({ b, k: 'vib', si: str - 1, depth });

const CH: Record<string, Fr> = {
  Em: [0, 2, 2, 0, 0, 0],
  C: [null, 3, 2, 0, 1, 0],
  G: [3, 2, 0, 0, 0, 3],
  D: [null, null, 0, 2, 3, 2],
  Am: [null, 0, 2, 2, 1, 0],
  F7: [null, null, 3, 2, 1, 0],
  GB: [null, 2, 0, 0, 3, 3],
  E5: [0, 2, 2, null, null, null],
  F5: [1, 3, 3, null, null, null],
  Fs5: [2, 4, 4, null, null, null],
  G5: [3, 5, 5, null, null, null],
  A5: [5, 7, 7, null, null, null],
  D5: [null, 5, 7, 7, null, null],
  C5: [null, 3, 5, 5, null, null],
  B5: [null, 2, 4, 4, null, null],
  E9: [null, 7, 6, 7, 7, null],
  Dm7: [null, 5, 7, 5, 6, 5],
  G7: [3, null, 3, 4, 3, null],
  Cmaj7: [null, 3, 5, 4, 5, null],
  A7: [5, null, 5, 6, 5, null],
  AmH: [null, null, null, 5, 5, 5],
  DmH: [null, null, null, 7, 6, 5],
};
const rep = (n: number, f: (i: number) => Ev[]): Ev[] => Array.from({ length: n }, (_, i) => f(i)).flat();
/** ブルースのシャッフル: 根音の開放弦と、1 本上の弦の 2・4 フレットを交互に（裏の拍は 3 連の 3 つ目） */
const shuffle = (i: number): Ev[] => {
  const root = i === 2 ? 4 : 5;
  return rep(4, (k) =>
    [0, 2 / 3].flatMap((sw) => {
      const fr: Fr = [null, null, null, null, null, null];
      fr[6 - root] = 0;
      fr[7 - root] = k % 2 ? 4 : 2;
      return strum(i * 4 + k + sw, fr, { mute: true, sp: 0.006, amp: sw ? 0.7 : 0.9, cut: true });
    }),
  );
};
/** メタルのギャロップ: 8 分と 16 分 2 つ */
const gallop = (b: number): Ev[] => [0, 0.5, 0.75].map((d) => note(b + d, 6, 0, { mute: true, amp: d ? 0.8 : 1 }));

export type Group = 'acc' | 'riff' | 'solo';
export interface Phrase {
  v: string;
  name: string;
  g: Group;
  /** 標準のテンポ [BPM] と小節の数（4/4） */
  bpm: number;
  bars: number;
  ev: Ev[];
}
export const GROUPS: readonly (readonly [Group, string])[] = [
  ['acc', '伴奏'],
  ['riff', 'リフ'],
  ['solo', '単音'],
];
const P = (v: string, name: string, g: Group, bpm: number, bars: number, ev: Ev[]): Phrase => ({
  v,
  name,
  g,
  bpm,
  bars,
  ev,
});
export const PHRASES: readonly Phrase[] = [
  P(
    'chords',
    'コード',
    'acc',
    96,
    4,
    rep(4, (i) => {
      const c = CH[['Em', 'C', 'G', 'D'][i]],
        b = i * 4;
      return [
        ...strum(b, c),
        ...strum(b + 1, c),
        ...strum(b + 1.5, c, { up: true }),
        ...strum(b + 2.5, c, { up: true }),
        ...strum(b + 3, c),
        ...strum(b + 3.5, c, { up: true }),
      ];
    }),
  ),
  P(
    'arp',
    'アルペジオ',
    'acc',
    96,
    4,
    rep(4, (i) => {
      const [c, ord] = (
        [
          ['Am', [4, 2, 1, 0, 1, 2, 3, 2]],
          ['F7', [3, 2, 1, 0, 1, 2, 1, 2]],
          ['C', [4, 2, 1, 0, 1, 2, 3, 2]],
          ['G', [5, 3, 2, 0, 2, 3, 4, 3]],
        ] as const
      )[i];
      return ord.flatMap((si, j): Ev[] => {
        const fr = CH[c][5 - si];
        return fr === null ? [] : [{ b: i * 4 + j * 0.5, k: 'pluck', si, fr, amp: j === 0 ? 1 : 0.7 }];
      });
    }),
  ),
  P(
    'ballad',
    'バラード',
    'acc',
    68,
    4,
    rep(4, (i) => {
      const c = CH[['C', 'GB', 'Am', 'F7'][i]],
        b = i * 4;
      return [
        ...strum(b, c, { sp: 0.035, amp: 0.85 }),
        ...(
          [
            [2, 3],
            [2.5, 2],
            [3, 1],
            [3.5, 2],
          ] as const
        ).flatMap(([d, str]): Ev[] => {
          const fr = c[6 - str];
          return fr === null ? [] : [{ b: b + d, k: 'pluck', si: str - 1, fr, amp: 0.6 }];
        }),
      ];
    }),
  ),
  P(
    'jazz',
    'ジャズ',
    'acc',
    132,
    4,
    rep(4, (i) =>
      rep(4, (k) =>
        strum(i * 4 + k, CH[['Dm7', 'G7', 'Cmaj7', 'A7'][i]], { sp: 0.006, amp: k % 2 ? 0.75 : 0.6, len: 0.45 }),
      ),
    ),
  ),
  P(
    'reggae',
    '裏打ち',
    'acc',
    80,
    2,
    rep(2, (i) =>
      rep(4, (k) => strum(i * 4 + k + 0.5, i ? CH.DmH : CH.AmH, { up: true, sp: 0.004, amp: 1, len: 0.22 })),
    ),
  ),
  P(
    'funk',
    'カッティング',
    'acc',
    100,
    1,
    rep(16, (k) => {
      const c = 'x.gxg.xgx.gxg.xx'[k];
      return c === '.'
        ? []
        : strum(k * 0.25, CH.E9, { up: k % 2 === 1, sp: 0.005, ghost: c === 'g', amp: c === 'g' ? 0.8 : 0.9 });
    }),
  ),
  P('power', 'パワーコード', 'riff', 112, 2, [
    ...rep(6, (k) => strum(k * 0.5, CH.E5, { mute: true, sp: 0.004, amp: 0.9 })),
    ...strum(3, CH.G5, { sp: 0.005, cut: true }),
    ...strum(3.5, CH.E5, { mute: true, sp: 0.004, cut: true }),
    ...rep(4, (k) => strum(4 + k * 0.5, CH.E5, { mute: true, sp: 0.004, amp: 0.9 })),
    ...strum(6, CH.A5, { sp: 0.005, cut: true }),
    ...strum(7, CH.D5, { sp: 0.005, cut: true }),
  ]),
  P('rock', 'ロック', 'riff', 120, 2, [
    ...strum(0, CH.E5, { cut: true }),
    note(1, 6, 0, { amp: 0.8 }),
    ...strum(1.5, CH.G5, { cut: true }),
    note(2, 6, 0, { amp: 0.8 }),
    ...strum(2.5, CH.A5, { cut: true }),
    note(3.5, 6, 0, { amp: 0.8 }),
    ...strum(4, CH.E5, { cut: true }),
    note(4.5, 6, 0, { amp: 0.8 }),
    ...strum(5, CH.D5, { cut: true }),
    ...strum(6, CH.C5, { cut: true }),
    ...strum(6.5, CH.B5, { cut: true, len: 1.2 }),
  ]),
  P('blues', 'ブルース', 'riff', 104, 4, rep(4, shuffle)),
  P('metal', 'メタル', 'riff', 150, 2, [
    ...rep(3, gallop),
    ...strum(3, CH.F5, { cut: true, sp: 0.004 }),
    ...gallop(4),
    ...gallop(5),
    ...strum(6, CH.G5, { cut: true, sp: 0.004 }),
    ...strum(6.5, CH.Fs5, { cut: true, sp: 0.004 }),
    ...strum(7, CH.F5, { cut: true, sp: 0.004 }),
    note(7.5, 6, 0, { mute: true }),
    note(7.75, 6, 0, { mute: true }),
  ]),
  P('lead', '単音', 'solo', 96, 2, [
    ...(
      [
        [0, 2, 15],
        [0.5, 1, 12],
        [1, 2, 15],
        [1.5, 2, 12],
        [2, 3, 14],
        [2.5, 3, 12],
        [3, 4, 14],
        [3.5, 3, 12],
        [4, 3, 14],
        [6, 2, 12],
        [6.5, 2, 15],
        [7, 1, 12],
      ] as const
    ).map(([b, s, f]) => note(b, s, f)),
    vib(4.6, 3, 0.3),
  ]),
  P('run', '速弾き', 'solo', 100, 2, [
    ...(
      [
        [6, 12],
        [6, 15],
        [5, 12],
        [5, 14],
        [4, 12],
        [4, 14],
        [3, 12],
        [3, 14],
        [2, 12],
        [2, 15],
        [1, 12],
        [1, 15],
        [1, 12],
        [2, 15],
        [2, 12],
        [3, 14],
        [3, 12],
        [4, 14],
        [4, 12],
        [5, 14],
        [5, 12],
        [6, 15],
        [6, 12],
        [5, 14],
      ] as const
    ).map(([s, f], k) => note(k * 0.25, s, f, { amp: k % 4 ? 0.75 : 0.95 })),
    note(6, 4, 14, { amp: 1 }),
    vib(6.4, 4, 0.3),
  ]),
  P('bend', 'チョーキング', 'solo', 84, 2, [
    note(0, 3, 14, { amp: 1 }),
    bend(0.3, 3, 2, 0.4),
    vib(1.4, 3, 0.25),
    vib(2.8, 3, 0),
    bend(3, 3, 0, 0.5),
    note(4, 2, 15),
    note(4.5, 2, 12),
    note(5, 3, 14),
    bend(5.2, 3, 1, 0.3),
    bend(5.7, 3, 0, 0.2),
    note(6, 3, 12, { amp: 1 }),
    vib(6.4, 3, 0.35),
  ]),
  P('long', 'ロングトーン', 'solo', 80, 2, [
    ...strum(0, CH.E5, { cut: true }),
    note(4, 3, 14, { amp: 1 }),
    vib(6, 3, 0.25),
  ]),
  P('harm', 'ハーモニクス', 'solo', 76, 2, [
    ...[6, 5, 4, 3, 2, 1].map((s, k) => note(k * 0.5, s, 0, { harm: 2, lead: false, amp: 1 })),
    ...[3, 2, 1].map((s, k) => note(3 + k * 0.5, s, 0, { harm: 3, lead: false, amp: 1 })),
    ...strum(5, [null, null, 0, 0, 0, null], { harm: 4, sp: 0.02, cut: true, amp: 1 }),
    ...strum(6.5, [0, 0, null, null, null, null], { harm: 2, sp: 0.02, amp: 1 }),
  ]),
];
export const phraseOf = (v: string): Phrase => PHRASES.find((p) => p.v === v) ?? PHRASES[0];

/* ---------- 音色のプリセット ---------- */
type Fixed3 = { [K in 'pu' | 'amp' | 'cab']?: Partial<Rack[K]> };
/** ペダル: 種類・設定（書いていない項目は種類の既定値） */
type PedalSpec = readonly [Kind, Record<string, number | string>?];
export interface Preset {
  v: string;
  name: string;
  phrase: string;
  set: Fixed3;
  pre: readonly PedalSpec[];
  post: readonly PedalSpec[];
}
/** キャビネットのレベルは、それぞれのフレーズで鳴らした大きさがクリーンと 1 dB 以内になる値 */
export const PRESETS: readonly Preset[] = [
  {
    v: 'clean',
    name: 'クリーン',
    phrase: 'arp',
    set: { pu: { coil: 'single', sel: 'nm' }, amp: { type: 'clean', gain: 0.3 }, cab: { type: '1x12' } },
    pre: [['chorus', { rate: 0.35, depth: 0.45, mix: 0.45 }]],
    post: [['spring', { decay: 0.5, mix: 0.28 }]],
  },
  {
    v: 'crunch',
    name: 'クランチ',
    phrase: 'blues',
    set: {
      pu: { coil: 'hum', sel: 'bridge' },
      amp: { type: 'crunch', gain: 0.55, mid: 0.6, master: 0.6 },
      cab: { type: '1x12' },
    },
    pre: [],
    post: [['room', { decay: 0.3, mix: 0.18 }]],
  },
  {
    v: 'heavy',
    name: 'ハイゲイン',
    phrase: 'metal',
    set: {
      pu: { coil: 'hum', sel: 'bridge' },
      amp: { type: 'high', gain: 0.7, treble: 0.65, bass: 0.6, mid: 0.4, master: 0.55 },
      cab: { type: '4x12', level: 0.38 },
    },
    pre: [['od', { gain: 0.1, tone: 0.6, level: 0.75 }]],
    post: [['room', { decay: 0.25, mix: 0.12 }]],
  },
  {
    v: 'lead',
    name: 'リード',
    phrase: 'bend',
    set: {
      pu: { coil: 'hum', sel: 'neck' },
      amp: { type: 'high', gain: 0.6, treble: 0.55, mid: 0.65, master: 0.55 },
      cab: { type: '4x12', level: 0.3 },
    },
    pre: [],
    post: [
      ['dly', { time: 0.42, fb: 0.38, mix: 0.3 }],
      ['room', { decay: 0.7, mix: 0.25 }],
    ],
  },
  {
    v: 'feedback',
    name: 'フィードバック',
    phrase: 'long',
    set: {
      pu: { coil: 'hum', sel: 'bridge' },
      amp: { type: 'high', gain: 0.75, bass: 0.55, mid: 0.6, master: 0.5 },
      cab: { type: '4x12', fb: 0.7, level: 0.21 },
    },
    pre: [['ds', { gain: 0.45, tone: 0.5, level: 0.5 }]],
    post: [['room', { decay: 0.5, mix: 0.2 }]],
  },
  {
    v: 'fuzz',
    name: 'ファズ',
    phrase: 'rock',
    set: {
      pu: { coil: 'single', sel: 'neck' },
      amp: { type: 'clean', gain: 0.3, master: 0.4 },
      cab: { type: '4x12', level: 0.33 },
    },
    pre: [['fuzz', { gain: 0.75, tone: 0.5, level: 0.2 }]],
    post: [['spring', { decay: 0.5, mix: 0.2 }]],
  },
  {
    v: 'funk',
    name: 'ファンク',
    phrase: 'funk',
    set: {
      pu: { coil: 'single', sel: 'mid' },
      amp: { type: 'clean', gain: 0.35, treble: 0.65 },
      cab: { type: '1x12', level: 0.19 },
    },
    pre: [
      ['comp', { sus: 0.55, level: 0.55 }],
      ['wah', { mode: 'auto', sens: 0.6 }],
    ],
    post: [['room', { decay: 0.5, mix: 0.1 }]],
  },
  {
    v: 'jazz',
    name: 'ジャズ',
    phrase: 'jazz',
    set: {
      pu: { coil: 'hum', sel: 'neck', tone: 0.35 },
      amp: { type: 'clean', gain: 0.25, treble: 0.4, bass: 0.6, mid: 0.55, master: 0.45 },
      cab: { type: '1x12', mic: 'edge' },
    },
    pre: [],
    post: [['room', { decay: 0.4, mix: 0.15 }]],
  },
  {
    v: 'space',
    name: '空間系',
    phrase: 'harm',
    set: { pu: { coil: 'single', sel: 'neck' }, amp: { type: 'clean', gain: 0.35 }, cab: { level: 0.41 } },
    pre: [
      ['comp', { sus: 0.4, level: 0.5 }],
      ['phaser', { rate: 0.2, depth: 0.6, mix: 0.5 }],
    ],
    post: [
      ['dly', { time: 0.5, fb: 0.45, mix: 0.35 }],
      ['room', { decay: 0.85, mix: 0.4 }],
    ],
  },
];
export const presetOf = (v: string): Preset => PRESETS.find((p) => p.v === v) ?? PRESETS[0];
/** プリセットの機材の設定。ペダルの番号は 1 から振る */
export function presetRack(v: string): Rack {
  const pr = presetOf(v),
    R = cloneRack(DEFAULT_RACK);
  for (const d of ['pu', 'amp', 'cab'] as const) Object.assign(R[d], pr.set[d] ?? {});
  let id = 0;
  const mk = ([k, v0]: PedalSpec): Pedal => ({ id: ++id, k, on: true, v: { ...defaults(KINDS[k]), ...(v0 ?? {}) } });
  R.pre = pr.pre.map(mk);
  R.post = pr.post.map(mk);
  return R;
}

/* ---------- 進行 ---------- */
/** 進行が弦へ伝える操作（Rig が受ける） */
export interface Hands {
  pluck(
    si: number,
    fret: number,
    o: { amp: number; mute?: boolean; ghost?: boolean; harm?: number; tune?: number },
  ): void;
  stopString(si: number, sg?: number): void;
  bendString(si: number, semi: number, sec: number): void;
  vibString(si: number, depth: number): void;
}

/** フレーズを拍に合わせて弾く。拍はテンポを変えても続くように数える */
export class Seq {
  ph: Phrase | null = null;
  bpm = 96;
  /** 移調 [半音]。上げるときはカポのようにフレットをずらし、下げるときは調弦を下げる */
  key = 0;
  /** 弾き始めてからの拍（くり返しても増え続ける） */
  beat = 0;
  constructor(private readonly hands: Hands) {}
  start(v: string, bpm: number, beat = 0): void {
    this.ph = phraseOf(v);
    this.bpm = bpm;
    /* 弾き始める拍の出来事も、次に進めたときに弾く */
    this.beat = beat - 1e-9;
  }
  stop(): void {
    this.ph = null;
  }
  /** dt 秒進める */
  step(dt: number): void {
    if (!this.ph) return;
    const b0 = this.beat;
    this.beat += (dt * this.bpm) / 60;
    this.fire(b0, this.beat);
  }
  /** 拍 [b0, b1) の出来事を弾く */
  private fire(b0: number, b1: number): void {
    const ph = this.ph;
    if (!ph) return;
    const len = ph.bars * 4,
      spb = 60 / this.bpm;
    for (let L = Math.floor(b0 / len) - 1; L <= Math.floor(b1 / len); L++)
      for (const e of ph.ev) {
        const at = L * len + e.b + (e.dt ?? 0) / spb;
        if (at >= b0 && at < b1) this.act(e, spb);
      }
  }
  private act(e: Ev, spb: number): void {
    const h = this.hands;
    if (e.k === 'stop') for (const s of e.si) h.stopString(s);
    else if (e.k === 'bend') h.bendString(e.si, e.semi, e.dur * spb);
    else if (e.k === 'vib') h.vibString(e.si, e.depth);
    else {
      if (e.lead) for (let s = 0; s < 6; s++) if (s !== e.si) h.stopString(s);
      h.pluck(e.si, e.fr + Math.max(0, this.key), {
        amp: e.amp,
        mute: e.mute,
        ghost: e.ghost,
        harm: e.harm,
        tune: Math.min(0, this.key),
      });
    }
  }
}
