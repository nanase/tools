/**
 * SPI の 1 回の通信を模擬する。機器はどれも 8 ビットのシフトレジスタで、SCK の片方の辺で入力を読み、反対の辺で次のビットを出す。
 * 線は機器が直接 High・Low に駆動する（プッシュプル）ので電圧は追わず、辺の時刻と遅れだけを数える
 */
import type { IconId } from './icons';

const NS = 1e-9;
/** マスタの出力の遅れ・入力のセットアップ時間とホールド時間 [s] */
export const TCO = 3 * NS,
  TSU = 4 * NS,
  TH = 4 * NS;
/** 配線を信号が伝わる遅れ [s/m]（LAN ケーブルの例 5.38 ns/m を丸めた） */
export const VP = 5.4 * NS;

export interface Dev {
  k: IconId;
  name: string;
  mode: Mode;
  /** SCK の辺から出力が確定するまでの遅れ [s] */
  tv: number;
}
/** 個別の CS でつなぐ機器と、返す 2 バイト */
export const DEVS: readonly (Dev & { rep: readonly number[] })[] = [
  { k: 'mem', name: 'フラッシュメモリ', mode: 0, tv: 6 * NS, rep: [0xef, 0x40] },
  { k: 'acc', name: '加速度センサ', mode: 3, tv: 40 * NS, rep: [0xe5, 0x0a] },
  { k: 'adc', name: 'AD 変換器', mode: 1, tv: 50 * NS, rep: [0x0b, 0x6e] },
];
/** デイジーチェーンでつなぐ LED ドライバと、初めに入っている値 */
export const LEDS: readonly (Dev & { init: number })[] = [
  { k: 'led', name: 'LED 1', mode: 0, tv: 25 * NS, init: 0x81 },
  { k: 'led', name: 'LED 2', mode: 0, tv: 25 * NS, init: 0x3c },
  { k: 'led', name: 'LED 3', mode: 0, tv: 25 * NS, init: 0x18 },
];

export type Mode = 0 | 1 | 2 | 3;
export type Conn = 'cs' | 'chain';
export interface Config {
  mode: Mode;
  /** ビットの順（マスタだけ。機器はどれも MSB から） */
  order: 'msb' | 'lsb';
  /** クロック [Hz] */
  f: number;
  /** 配線の長さ [m] */
  len: number;
  conn: Conn;
  /** 宛先（DEVS の番号） */
  dest: number;
  /** 宛先と次の機器の CS を同時に下げる */
  both: boolean;
  /** 送る 3 バイト（個別の CS では前の 2 バイト） */
  data: readonly number[];
}

/** 読み取ったビット。src はそのビットを送り出した機器（-1 は誰でもない） */
export interface Bit {
  v: 0 | 1;
  src: number;
  /** 読み取りの前後で線が変わった・誰も出していない・2 台が出している・まだ出していない */
  why?: 'race' | 'z' | 'x' | 'idle';
  /** 正しい値と違う */
  wrong?: boolean;
  /** CPHA 1 の機器が最初の辺の前に出している意味のない値 */
  idle?: boolean;
}
export type Level = 0 | 1 | 'z' | 'x';
/** 線の変化。b は線に乗っているビット */
export interface Change {
  t: number;
  v: Level;
  b: Bit | null;
}
export type EvKind = 'init' | 'cs' | 'shift' | 'sample' | 'up';
/** 機器の出来事の後の写し */
export interface Snap {
  t: number;
  kind: EvKind;
  reg: Bit[];
  o: Bit | null;
  cnt: number;
}
export interface DevSim {
  i: number;
  name: string;
  mode: Mode;
  msb: boolean;
  snaps: Snap[];
  /** 8 ビットごとに受け取った値とそのビット */
  got: number[];
  gotBits: Bit[][];
}
export interface Edge {
  t: number;
  rise: boolean;
  j: number;
}
export interface Sample {
  i: number;
  t: number;
  b: Bit;
  e: Edge;
}
export interface Sim {
  c: Config;
  T: number;
  h: number;
  /** 片道の遅れ */
  d: number;
  tCs: number;
  tUp: number;
  dur: number;
  edges: Edge[];
  devs: DevSim[];
  /** 機器ごとの出力の履歴（機器の端子で見た時刻） */
  out: Change[][];
  sel: number[];
  chain: boolean;
  /** バイト数 */
  nb: number;
  samples: Sample[];
  /** マスタの側で見た線 */
  lines: { sck: Change[]; mosi: Change[]; miso: Change[]; cs: Change[][] };
  /** MISO の往復の遅れと、読み取りまでの余裕 */
  rt: number;
  margin: number;
  /** 読む辺の向きが宛先とそろっているか */
  modeOk: boolean;
  /** マスタ・機器の受け取りの誤り */
  errM: boolean;
  errS: boolean;
  /** 正しく受け取ったときの値（機器の番号 → バイト） */
  want: Map<number, number[]>;
}

export const hex = (v: number): string => `0x${v.toString(16).toUpperCase().padStart(2, '0')}`;
export const bin = (v: number): string => v.toString(2).padStart(8, '0');
/** 読む辺が立ち上がりか（モード 0・3 は立ち上がりで読む） */
export const sampleRising = (m: Mode): boolean => ((m >> 1) ^ (m & 1)) === 0;
/** 時刻 t の値（arr は時刻の順） */
export function valAt<T extends { t: number }>(arr: readonly T[], t: number): T {
  let r = arr[0];
  for (const e of arr) {
    if (e.t <= t) r = e;
    else break;
  }
  return r;
}

interface Live {
  i: number;
  mode: Mode;
  tv: number;
  msb: boolean;
  reg: Bit[];
  o: Bit | null;
  queue: number[];
  cnt: number;
  d: DevSim;
}
const load = (v: number, msb: boolean, src: number): Bit[] =>
  Array.from({ length: 8 }, (_, k) => ({ v: ((v >> (msb ? 7 - k : k)) & 1) as 0 | 1, src }));
const IDLE: Bit = { v: 1, src: 0, idle: true };

export function simulate(c: Config): Sim {
  const T = 1 / c.f,
    h = T / 2,
    d = c.len * VP,
    chain = c.conn === 'chain',
    nb = chain ? 3 : 2,
    cpol = c.mode >> 1;
  const tCs = 2 * h;
  const edges: Edge[] = [];
  for (let j = 0; j < 16 * nb; j++) edges.push({ t: tCs + h + j * h, rise: (j % 2 === 0 ? 1 - cpol : cpol) === 1, j });
  const tUp = edges[edges.length - 1].t + h,
    dur = tUp + 2 * h;
  const slaves: readonly Dev[] = chain ? LEDS : DEVS;
  const sel = chain ? [0, 1, 2] : c.both ? [c.dest, (c.dest + 1) % 3] : [c.dest];

  const mk = (i: number, name: string, mode: Mode, tv: number, msb: boolean, first: number, queue: number[]): Live => {
    const d: DevSim = { i, name, mode, msb, snaps: [], got: [], gotBits: [] };
    return { i, mode, tv, msb, reg: load(first, msb, i), o: null, queue, cnt: 0, d };
  };
  const devs: Live[] = [
    mk(0, 'マスタ', c.mode, TCO, c.order === 'msb', c.data[0], c.data.slice(1, nb)),
    ...slaves.map((s, k) => {
      const first = chain ? (s as (typeof LEDS)[number]).init : (s as (typeof DEVS)[number]).rep[0];
      const rest = chain ? [] : (s as (typeof DEVS)[number]).rep.slice(1);
      return mk(k + 1, s.name, s.mode, s.tv, true, first, [...rest]);
    }),
  ];

  /* 出力の履歴（端子で見た時刻） */
  const out: Change[][] = devs.map((_, i) => [i ? { t: -1, v: 'z', b: null } : { t: -1, v: 1, b: IDLE }]);
  const push = (arr: Change[], t: number, v: Level, b: Bit | null) => {
    let k = arr.length;
    while (k > 0 && arr[k - 1].t > t) k--;
    arr.splice(k, 0, { t, v, b });
  };
  const setOut = (dv: Live, t: number, b: Bit | null) => {
    dv.o = b;
    push(out[dv.i], t + dv.tv, b ? b.v : 'z', b);
  };
  const csSeen = (i: number) => (i === 0 ? 0 : d);
  /** 機器 i の入力を出している機器と遅れ */
  const inputOf = (i: number): [number, number][] => {
    if (i === 0) return chain ? [[3, d]] : sel.map((s) => [s + 1, d]);
    if (chain && i > 1) return [[i - 1, 0]];
    return [[0, d]];
  };
  const readIn = (i: number, t: number): { v: Level; b: Bit | null } => {
    const src = inputOf(i).map(([k, dl]) => valAt(out[k], t - dl));
    const live = src.filter((e) => e.v !== 'z');
    if (!live.length) return { v: 'z', b: null };
    if (live.some((e) => e.v !== live[0].v)) return { v: 'x', b: null };
    return live[0];
  };
  const samples: Sample[] = [];
  const snap = (dv: Live, t: number, kind: EvKind) =>
    dv.d.snaps.push({ t, kind, reg: dv.reg.slice(), o: dv.o, cnt: dv.cnt });

  /* 出来事: 同じ時刻なら CS・出す辺・読む辺・CS の解除の順 */
  type Ev = [number, number, Live, EvKind, Edge | null];
  const ev: Ev[] = [];
  const active = (i: number) => i === 0 || sel.includes(i - 1);
  for (const dv of devs) {
    snap(dv, -1, 'init');
    if (!active(dv.i)) continue;
    ev.push([tCs + csSeen(dv.i), 0, dv, 'cs', null]);
    const sr = sampleRising(dv.mode);
    for (const e of edges)
      ev.push([e.t + csSeen(dv.i), e.rise === sr ? 2 : 1, dv, e.rise === sr ? 'sample' : 'shift', e]);
    ev.push([tUp + csSeen(dv.i), 3, dv, 'up', null]);
  }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2].i - b[2].i);
  for (const [t, , dv, kind, e] of ev) {
    if (kind === 'cs') {
      if ((dv.mode & 1) === 0) setOut(dv, t, dv.reg[0]);
      else if (dv.i) setOut(dv, t, { v: 1, src: dv.i, idle: true });
    } else if (kind === 'shift') setOut(dv, t, dv.reg[0]);
    else if (kind === 'sample' && e) {
      const r = readIn(dv.i, t),
        idle = !!r.b?.idle;
      const why = r.v === 'z' ? 'z' : r.v === 'x' ? 'x' : idle ? 'idle' : undefined;
      const b: Bit = { v: r.v === 1 ? 1 : 0, src: r.b && !idle ? r.b.src : -1, ...(why ? { why } : {}) };
      samples.push({ i: dv.i, t, b, e });
      dv.reg = [...dv.reg.slice(1), b];
      dv.cnt++;
      if (dv.cnt % 8 === 0) {
        const bits = dv.reg.slice();
        dv.d.gotBits.push(bits);
        dv.d.got.push(bits.reduce((s, x, k) => s | (x.v << (dv.msb ? 7 - k : k)), 0));
        const nx = dv.queue.shift();
        if (nx !== undefined) dv.reg = load(nx, dv.msb, dv.i);
      }
    } else if (kind === 'up') setOut(dv, t, dv.i ? null : IDLE);
    snap(dv, t, kind);
  }
  /* 読み取りの前後で入力が変わったビットは不定にする */
  for (const s of samples) {
    if (s.b.why) continue;
    for (const [k, dl] of inputOf(s.i))
      for (const x of out[k]) {
        const ta = x.t + dl;
        if (ta > s.t - TSU && ta < s.t + TH) s.b.why = 'race';
      }
  }
  /* 正しい値と比べる */
  const want = new Map<number, number[]>();
  if (chain) {
    want.set(0, [LEDS[2].init, LEDS[1].init, LEDS[0].init]);
    want.set(1, [c.data[2]]);
    want.set(2, [c.data[1]]);
    want.set(3, [c.data[0]]);
  } else {
    want.set(0, DEVS[c.dest].rep.slice(0, 2));
    for (const s of sel) want.set(s + 1, c.data.slice(0, 2));
  }
  /** 比べるバイト（デイジーチェーンの機器は最後の 1 バイトだけ） */
  const judged = (i: number) => {
    const dv = devs[i].d;
    return chain && i ? { got: dv.got.slice(-1), bits: dv.gotBits.slice(-1) } : { got: dv.got, bits: dv.gotBits };
  };
  let errM = false,
    errS = false;
  for (const [i, w] of want) {
    const dv = devs[i],
      { got, bits } = judged(i);
    let bad = got.length < w.length;
    got.forEach((v, n) => {
      bits[n].forEach((x, k) => {
        if (x.v !== ((w[n] >> (dv.msb ? 7 - k : k)) & 1)) x.wrong = true;
        if (x.why) bad = true;
      });
      if (v !== w[n]) bad = true;
    });
    if (i === 0) errM = bad;
    else if (bad) errS = true;
  }

  /* マスタの側で見た線 */
  const sck: Change[] = [
    { t: -1, v: cpol as Level, b: null },
    ...edges.map((e) => ({ t: e.t, v: (e.rise ? 1 : 0) as Level, b: null })),
  ];
  const mosi = out[0].slice();
  const misoSrc = chain ? [3] : sel.map((s) => s + 1);
  const times = [...new Set(misoSrc.flatMap((k) => out[k].map((x) => x.t + d)))].sort((a, b) => a - b);
  const miso: Change[] = times.map((t) => ({ t, ...readIn(0, t) }));
  const cs = [0, 1, 2].map((k): Change[] =>
    (chain ? k === 0 : sel.includes(k))
      ? [
          { t: -1, v: 1, b: null },
          { t: tCs, v: 0, b: null },
          { t: tUp, v: 1, b: null },
        ]
      : [{ t: -1, v: 1, b: null }],
  );
  const rt = 2 * d + (chain ? LEDS.reduce((s, x) => s + x.tv, 0) : DEVS[c.dest].tv);
  const modeOk = (chain ? LEDS : sel.map((s) => DEVS[s])).every((x) => sampleRising(x.mode) === sampleRising(c.mode));
  return {
    c,
    T,
    h,
    d,
    tCs,
    tUp,
    dur,
    edges,
    devs: devs.map((x) => x.d),
    out,
    sel,
    chain,
    nb,
    samples,
    lines: { sck, mosi, miso, cs },
    rt,
    margin: h - rt - TSU,
    modeOk,
    errM,
    errS,
    want,
  };
}

/** 機器の時刻 pt の状態（最後の出来事の後の写し） */
export const stateAt = (dv: DevSim, pt: number): Snap => valAt(dv.snaps, pt);
/** 機器が t0 以降、pt までに読み取ったか */
export const sampledSince = (dv: DevSim, t0: number, pt: number): boolean =>
  dv.snaps.some((x) => x.kind === 'sample' && x.t >= t0 && x.t <= pt);
/** 結果の種類 */
export type Res = 'ok' | 'both' | 'mode' | 'late' | 'order' | 'bad';
export function resultOf(s: Sim): Res {
  if (!s.chain && s.c.both) return 'both';
  if (!s.errM && !s.errS) return 'ok';
  if (!s.modeOk || s.samples.some((x) => x.b.why === 'idle')) return 'mode';
  if (s.margin < 0) return 'late';
  if (s.c.order === 'lsb') return 'order';
  return s.samples.some((x) => x.b.why === 'race') ? 'mode' : 'bad';
}
