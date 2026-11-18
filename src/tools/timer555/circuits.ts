/**
 * 555 の応用回路 9 種の計算（理想素子）: 入力の値から、しきい値・時定数・式の時間、
 * 各所の電圧（配線の色）と枝の電流（粒）を決める。図は schematic.ts
 */

import type { Key } from './params';
import type { Env, Kind, Sim } from './sim';

export type Vals = Record<Key, number>;
export type CirId = 'astable' | 'diode' | 'pwm' | 'alt' | 'vco' | 'dark' | 'mono' | 'bistable' | 'schmitt';
/** 図で押しているもの */
export interface Live {
  power: boolean;
  trig: boolean;
  rst: boolean;
}
/** 式の値。osc は tH・tL・T・first（電源を入れて最初の H）、mono は tp */
export interface Timing {
  tH?: number;
  tL?: number;
  T?: number;
  first?: number;
  tp?: number;
}
/** その瞬間の各所の電圧 [V]（名前は図の配線の data-n）と枝の電流 [A]（図の枝の名前） */
export interface State {
  n: Record<string, number>;
  I: Record<string, number>;
}

export interface Circuit {
  id: CirId;
  name: string;
  /** 使われる所 */
  use: string[];
  kind: Kind;
  /** 使う入力 */
  keys: Key[];
  /** 既定値（回路ごと） */
  def: Partial<Vals>;
  /** CH2 の名前（HTML） */
  ch2: string;
  env(v: Vals, live: Live): Env;
  timing(v: Vals): Timing;
  state(v: Vals, s: Sim, live: Live): State;
}

const LN2 = Math.LN2,
  LN3 = Math.log(3);
/** LED の順方向電圧と直列の抵抗 */
export const VF = 2,
  RL = 1e3;
/** 引き上げ抵抗・可変抵抗（固定の値） */
export const RPU = 10e3,
  RVR = 10e3;
/** 暗くなると点滅: RST の引き上げ抵抗、RST が効く電圧（LM555 の Reset Voltage の標準値）、CdS の抵抗（10 lx で 20 kΩ、γ = 0.7） */
export const R3 = 47e3,
  VRST = 0.5;
export const ldr = (lux: number) => 20e3 * (lux / 10) ** -0.7;

const ledI = (on: boolean, V: number) => (on ? Math.max(0, (V - VF) / RL) : 0);
/** OUT → 抵抗 → LED → GND の電圧と電流 */
function outLed(n: State['n'], I: State['I'], q: boolean, V: number): void {
  const i = ledI(q, V);
  I.out = i;
  n.out = q ? V : 0;
  n.la = i > 0 ? VF : n.out;
}

/** 発振の回路の共通部分（R1 から入って C1 を充電し、R2 から DIS へ放電する） */
interface OscOpt {
  /** 充電・放電の抵抗 */
  rc: (v: Vals) => number;
  rd: (v: Vals) => number;
  /** 電源を切ったときに C1 が抜ける抵抗 */
  roff: (v: Vals) => number;
  /** 上のしきい値 */
  U?: (v: Vals) => number;
  reset?: (v: Vals) => boolean;
}
function osc(o: OscOpt) {
  const U = (v: Vals) => (o.U ? o.U(v) : (2 * v.vcc) / 3);
  return {
    kind: 'osc' as const,
    env(v: Vals, live: Live): Env {
      return {
        kind: 'osc',
        vcc: v.vcc,
        U: U(v),
        hi: [v.vcc, o.rc(v) * v.c1],
        lo: [0, o.rd(v) * v.c1],
        off: o.roff(v) * v.c1,
        power: live.power,
        reset: o.reset ? o.reset(v) : false,
        trig: false,
        vin: 0,
      };
    },
    timing(v: Vals): Timing {
      const u = U(v),
        V = v.vcc,
        a = o.rc(v) * v.c1;
      if (u >= V) return {};
      const tH = a * Math.log((V - u / 2) / (V - u)),
        tL = o.rd(v) * v.c1 * LN2;
      return { tH, tL, T: tH + tL, first: a * Math.log(V / (V - u)) };
    },
  };
}

/** 標準の非安定の電圧と電流（R1・R2 が直列で、間が DIS） */
function stdState(v: Vals, s: Sim, live: Live): State {
  const V = live.power ? v.vcc : 0,
    q = !!s.q && live.power,
    vc = s.vc,
    Rc = v.r1 + v.r2,
    n: State['n'] = { rail: V, gnd: 0, c: vc, cv: (2 * V) / 3 },
    I: State['I'] = {};
  I.ch = q ? Math.max(0, (V - vc) / Rc) : 0;
  I.dr1 = live.power && !q ? V / v.r1 : 0;
  I.dc = live.power && !q ? vc / v.r2 : 0;
  I.off = live.power ? 0 : vc / Rc;
  n.dis = !live.power ? (vc * v.r1) / Rc : q ? vc + I.ch * v.r2 : 0;
  outLed(n, I, q, V);
  return { n, I };
}

const astable: Circuit = {
  id: 'astable',
  name: '非安定',
  use: ['LED の点滅', 'ブザー', 'クロック'],
  keys: ['r1', 'r2', 'c1', 'vcc'],
  def: { r1: 10e3, r2: 10e3, c1: 100e-9, vcc: 5 },
  ch2: 'V<sub>C1</sub>',
  ...osc({ rc: (v) => v.r1 + v.r2, rd: (v) => v.r2, roff: (v) => v.r1 + v.r2 }),
  state: stdState,
};

const diode: Circuit = {
  id: 'diode',
  name: 'ダイオード付き非安定',
  use: ['デューティ比 50 % 未満', 'PWM'],
  keys: ['r1', 'r2', 'c1', 'vcc'],
  def: { r1: 10e3, r2: 22e3, c1: 100e-9, vcc: 5 },
  ch2: 'V<sub>C1</sub>',
  ...osc({ rc: (v) => v.r1, rd: (v) => v.r2, roff: (v) => v.r1 + v.r2 }),
  state(v, s, live) {
    const V = live.power ? v.vcc : 0,
      q = !!s.q && live.power,
      vc = s.vc,
      n: State['n'] = { rail: V, gnd: 0, c: vc, cv: (2 * V) / 3 },
      I: State['I'] = {};
    I.ch = q ? Math.max(0, (V - vc) / v.r1) : 0;
    I.dr1 = live.power && !q ? V / v.r1 : 0;
    I.dc = live.power && !q ? vc / v.r2 : 0;
    I.off = live.power ? 0 : vc / (v.r1 + v.r2);
    n.dis = !live.power ? (vc * v.r1) / (v.r1 + v.r2) : q ? vc : 0;
    outLed(n, I, q, V);
    return { n, I };
  },
};

/** デューティ比可変: 可変抵抗 VR（r2）のつまみ（pos %）で充電側 Ra と放電側 Rb に分ける */
const ra = (v: Vals) => (v.r2 * v.pos) / 100,
  rb = (v: Vals) => (v.r2 * (100 - v.pos)) / 100;
const pwm: Circuit = {
  id: 'pwm',
  name: 'デューティ比可変',
  use: ['LED の明るさ調整', 'モーターの速さ調整'],
  keys: ['r1', 'r2', 'pos', 'c1', 'vcc'],
  def: { r1: 1e3, r2: 100e3, pos: 50, c1: 100e-9, vcc: 5 },
  ch2: 'V<sub>C1</sub>',
  ...osc({ rc: (v) => v.r1 + ra(v), rd: rb, roff: (v) => v.r1 + rb(v) }),
  state(v, s, live) {
    const V = live.power ? v.vcc : 0,
      q = !!s.q && live.power,
      vc = s.vc,
      n: State['n'] = { rail: V, gnd: 0, c: vc, cv: (2 * V) / 3 },
      I: State['I'] = {};
    I.ch = q ? Math.max(0, (V - vc) / (v.r1 + ra(v))) : 0;
    I.dr1 = live.power && !q ? V / v.r1 : 0;
    I.dc = live.power && !q ? vc / rb(v) : 0;
    I.off = live.power ? 0 : vc / (v.r1 + rb(v));
    if (!live.power) {
      n.dis = vc - I.off * rb(v);
      n.pl = n.dis;
      n.pr = vc;
    } else if (q) {
      n.dis = V - I.ch * v.r1;
      n.pl = vc;
      n.pr = n.dis;
    } else {
      n.dis = 0;
      n.pl = 0;
      n.pr = vc;
    }
    outLed(n, I, q, V);
    return { n, I };
  },
};

const alt: Circuit = {
  id: 'alt',
  name: 'LED の交互点滅',
  use: ['踏切の警報灯', '交互に光る飾り'],
  keys: ['r1', 'r2', 'c1', 'vcc'],
  def: { r1: 4.7e3, r2: 68e3, c1: 10e-6, vcc: 9 },
  ch2: 'V<sub>C1</sub>',
  ...osc({ rc: (v) => v.r1 + v.r2, rd: (v) => v.r2, roff: (v) => v.r1 + v.r2 }),
  state(v, s, live) {
    const st = stdState(v, s, live),
      V = live.power ? v.vcc : 0,
      q = !!s.q && live.power;
    delete st.I.out;
    delete st.n.la;
    /* LED1: VCC → 抵抗 → LED1 → OUT（L のとき OUT が吸い込む）。LED2: OUT → LED2 → 抵抗 → GND */
    st.I.l1 = ledI(live.power && !q, V);
    st.I.l2 = ledI(q, V);
    st.n.a1 = st.I.l1 > 0 ? V - st.I.l1 * RL : V;
    st.n.b2 = st.I.l2 * RL;
    return st;
  },
};

const vco: Circuit = {
  id: 'vco',
  name: '電圧で周波数を変える',
  use: ['サイレン', '電圧を周波数に変える'],
  keys: ['r1', 'r2', 'cv', 'c1', 'vcc'],
  def: { r1: 10e3, r2: 10e3, cv: 3.3, c1: 100e-9, vcc: 5 },
  ch2: 'V<sub>C1</sub>',
  ...osc({ rc: (v) => v.r1 + v.r2, rd: (v) => v.r2, roff: (v) => v.r1 + v.r2, U: (v) => Math.min(v.cv, v.vcc) }),
  state(v, s, live) {
    const st = stdState(v, s, live),
      V = live.power ? v.vcc : 0;
    st.n.cv = live.power ? Math.min(v.cv, v.vcc) : 0;
    st.I.vr = V / RVR;
    return st;
  },
};

const dark: Circuit = {
  id: 'dark',
  name: '暗くなると点滅',
  use: ['夜だけ光る標識', '常夜灯'],
  keys: ['r1', 'r2', 'c1', 'lux', 'vcc'],
  def: { r1: 4.7e3, r2: 68e3, c1: 10e-6, lux: 10, vcc: 5 },
  ch2: 'V<sub>C1</sub>',
  ...osc({
    rc: (v) => v.r1 + v.r2,
    rd: (v) => v.r2,
    roff: (v) => v.r1 + v.r2,
    reset: (v) => rstV(v) < VRST,
  }),
  state(v, s, live) {
    const st = stdState(v, s, live),
      V = live.power ? v.vcc : 0;
    st.I.dv = V / (R3 + ldr(v.lux));
    st.n.rst = live.power ? rstV(v) : 0;
    return st;
  },
};
/** RST の電圧（R3 と CdS の分圧） */
export const rstV = (v: Vals) => (v.vcc * ldr(v.lux)) / (R3 + ldr(v.lux));

const mono: Circuit = {
  id: 'mono',
  name: '単安定',
  use: ['押すと一定時間点く照明', 'チャタリング除去', '遅延'],
  kind: 'mono',
  keys: ['r1', 'c1', 'vcc'],
  def: { r1: 100e3, c1: 10e-6, vcc: 5 },
  ch2: 'V<sub>C1</sub>',
  env(v, live) {
    return {
      kind: 'mono',
      vcc: v.vcc,
      U: (2 * v.vcc) / 3,
      hi: [v.vcc, v.r1 * v.c1],
      /* L の間は DIS が C1 をすぐに 0 V にする */
      lo: [0, v.r1 * v.c1 * 1e-4],
      off: v.r1 * v.c1,
      power: live.power,
      reset: false,
      trig: live.trig,
      vin: 0,
    };
  },
  timing: (v) => ({ tp: LN3 * v.r1 * v.c1 }),
  state(v, s, live) {
    const V = live.power ? v.vcc : 0,
      q = !!s.q && live.power,
      vc = s.vc,
      n: State['n'] = { rail: V, gnd: 0, c: vc, cv: (2 * V) / 3, trig: live.trig ? 0 : V },
      I: State['I'] = {};
    I.ch = q ? Math.max(0, (V - vc) / v.r1) : 0;
    I.dr1 = live.power && !q ? V / v.r1 : 0;
    I.off = live.power ? 0 : vc / v.r1;
    I.pu = live.trig ? V / RPU : 0;
    outLed(n, I, q, V);
    return { n, I };
  },
};

const bistable: Circuit = {
  id: 'bistable',
  name: '双安定',
  use: ['押しボタンで ON・OFF', '1 ビットの記憶'],
  kind: 'latch',
  keys: ['vcc'],
  def: { vcc: 5 },
  ch2: 'TRIG',
  env(v, live) {
    return {
      kind: 'latch',
      vcc: v.vcc,
      U: (2 * v.vcc) / 3,
      hi: [v.vcc, 1],
      lo: [0, 1],
      off: 1,
      power: live.power,
      reset: live.rst,
      trig: live.trig,
      vin: 0,
    };
  },
  timing: () => ({}),
  state(v, s, live) {
    const V = live.power ? v.vcc : 0,
      q = !!s.q && live.power,
      n: State['n'] = { rail: V, gnd: 0, cv: (2 * V) / 3, trig: live.trig ? 0 : V, rst: live.rst ? 0 : V },
      I: State['I'] = { pu1: live.trig ? V / RPU : 0, pu2: live.rst ? V / RPU : 0 };
    outLed(n, I, q, V);
    return { n, I };
  },
};

const schmitt: Circuit = {
  id: 'schmitt',
  name: 'シュミットトリガ',
  use: ['ゆっくり変わる電圧を H・L に', '雑音で暴れない切り替え'],
  kind: 'schmitt',
  keys: ['vin', 'vcc'],
  def: { vin: 2.5, vcc: 5 },
  ch2: 'V<sub>IN</sub>',
  env(v, live) {
    return {
      kind: 'schmitt',
      vcc: v.vcc,
      U: (2 * v.vcc) / 3,
      hi: [v.vcc, 1],
      lo: [0, 1],
      off: 1,
      power: live.power,
      reset: false,
      trig: false,
      vin: Math.min(v.vin, v.vcc),
    };
  },
  timing: () => ({}),
  state(v, s, live) {
    const V = live.power ? v.vcc : 0,
      q = !!s.q && live.power,
      n: State['n'] = { rail: V, gnd: 0, cv: (2 * V) / 3, in: live.power ? Math.min(v.vin, v.vcc) : 0 },
      I: State['I'] = { vr: V / RVR };
    outLed(n, I, q, V);
    return { n, I };
  },
};

export const CIRCUITS: Circuit[] = [astable, diode, pwm, alt, vco, dark, mono, bistable, schmitt];
export const CIR = Object.fromEntries(CIRCUITS.map((c) => [c.id, c])) as Record<CirId, Circuit>;
