/**
 * ギターから出力までの機材の並び（DOM に依存しない）:
 * 弦 → ピックアップ → ペダル（アンプの前）→ アンプ → キャビネット → ペダル（マイクの後ろ）→ 出力。
 * ペダルは 1 台ずつ fx.ts の処理を持ち、並べた順に通す。スルーのペダルは何もせずに通す。
 * ピックアップの電気回路は、コイル（R + sL）と並列の容量・ボリュームのポット・トーン・アンプの入力の 3 次（Paiva ほか 2012）。
 * アンプのトーンは '59 Bassman の回路（Yeh・Smith 2006）。キャビネットの値はこのツールで決めた目安。
 * フィードバックはキャビネットの音を少し遅らせて弦へ戻す
 */
import { bilinear, clamp, Delay, dbToG, IIR, OnePole, type Poly, rbj, Shaper } from './filters';
import { type Fx, makeFx, type PedalVals } from './fx';
import { defaults, FIXED, type Kind } from './pedals';
import {
  damp,
  makeVoice,
  PITCH_STEP,
  type PluckOpt,
  type Sense,
  stepPitch,
  stepVoice,
  swing,
  type Voice,
} from './strings';

/* ---------- 機材の設定 ---------- */
export type Coil = 'single' | 'hum';
export type PuSel = 'neck' | 'nm' | 'mid' | 'bridge' | 'nb';
export type AmpType = 'clean' | 'crunch' | 'high';
export type CabType = 'off' | '1x12' | '4x12';

/** ペダル 1 台: 番号・種類・オンかスルーか・設定 */
export interface Pedal {
  id: number;
  k: Kind;
  on: boolean;
  v: PedalVals;
}
/** 機材の設定。つまみは 0〜1、ケーブルは m。ペダルはアンプの前（pre）とマイクの後ろ（post）に並べた順 */
export interface Rack {
  pu: { coil: Coil; sel: PuSel; vol: number; tone: number; cable: number };
  amp: { type: AmpType; gain: number; bass: number; mid: number; treble: number; master: number };
  cab: { type: CabType; mic: 'center' | 'edge'; level: number; fb: number };
  pre: Pedal[];
  post: Pedal[];
}
/** アンプの前とマイクの後ろに置けるペダルの数 */
export const MAX_PEDALS = 5;
export const DEFAULT_RACK: Rack = {
  pu: defaults(FIXED.pu) as Rack['pu'],
  amp: defaults(FIXED.amp) as Rack['amp'],
  cab: defaults(FIXED.cab) as Rack['cab'],
  pre: [],
  post: [{ id: 1, k: 'spring', on: true, v: { decay: 0.5, mix: 0.22 } }],
};
export const cloneRack = (R: Rack): Rack => JSON.parse(JSON.stringify(R)) as Rack;
/** 段の名前: ギター 'pu'・アンプ 'amp'・キャビネット 'cab'・ペダル 'p<番号>' */
export type StageId = string;
export const pedalStage = (p: Pedal): StageId => `p${p.id}`;
/** 信号の通る順の段 */
export const stagesOf = (R: Rack): StageId[] => [
  'pu',
  ...R.pre.map(pedalStage),
  'amp',
  'cab',
  ...R.post.map(pedalStage),
];

/* ---------- ピックアップ ---------- */
/** ピックアップの位置（駒からの距離 [m]） */
export const PU_POS = { neck: 0.158, mid: 0.098, bridge: 0.042 } as const;
export type PuPos = keyof typeof PU_POS;
export const PU_SEL: Record<PuSel, readonly PuPos[]> = {
  neck: ['neck'],
  nm: ['neck', 'mid'],
  mid: ['mid'],
  bridge: ['bridge'],
  nb: ['neck', 'bridge'],
};
/**
 * コイルの値: インダクタンス L [H]・抵抗 R [Ω]・自己容量 C [F]、拾う幅 w [m]、2 つのコイルの間隔 gap [m]、
 * 出力の目安 k [V/(m/s)]、ポットの抵抗 [Ω]、トーンのコンデンサ [F]
 */
export const COILS = {
  single: { L: 2.4, R: 6000, C: 110e-12, w: 0.0035, gap: 0, k: 0.07, pot: 250e3, ct: 47e-9 },
  hum: { L: 4.2, R: 8200, C: 150e-12, w: 0.004, gap: 0.018, k: 0.13, pot: 500e3, ct: 22e-9 },
} as const;
/** ケーブルの容量 [F/m]・アンプの入力抵抗 [Ω] */
const CABLE_C = 100e-12,
  AMP_IN = 1e6;
/** 弦とポールピースの間の距離 [m]（磁束の非線形） */
const PU_D0 = 0.0028;

/**
 * ピックアップの電気回路の伝達関数（s の昇べき）。起電力 e がコイル（R + sL）を通り、
 * 並列の容量（コイル＋ケーブル）・ボリュームのポット＋アンプの入力・トーン（R_t + 1/sC_t）にかかる
 */
export function pickupPoly(coil: Coil, cableM: number, tone: number): Poly {
  const c = COILS[coil],
    Cp = c.C + CABLE_C * cableM,
    G = 1 / c.pot + 1 / AMP_IN,
    Rt = c.pot * clamp(tone, 0, 1) ** 2.2 + 300,
    tau = Rt * c.ct,
    { R, L } = c;
  return {
    b: [1, tau],
    a: [1 + R * G, tau + R * (Cp + G * tau + c.ct) + L * G, R * Cp * tau + L * (Cp + G * tau + c.ct), L * Cp * tau],
  };
}

/* ---------- アンプ ---------- */
/**
 * アンプの種類: 増幅の段の数、ゲインの範囲（g0〜g1）、段の間の減衰、2 段目の前の高域通過 [Hz]、段の後の低域通過 [Hz]、
 * ゲインが低いときのブライト [dB]、トーンの後の補い
 */
export const AMPS = {
  clean: { stages: 1, g0: 1.5, g1: 20, inter: 1, tight: 30, lp: 9000, bright: 6, mk: 1 },
  crunch: { stages: 2, g0: 6, g1: 120, inter: 0.6, tight: 60, lp: 7500, bright: 3, mk: 1.4 },
  high: { stages: 3, g0: 20, g1: 500, inter: 0.45, tight: 160, lp: 6500, bright: 0, mk: 2.6 },
} as const;
/** アンプのトーン（ベース l・ミドル m・トレブル t、0〜1）の伝達関数。'59 Bassman 5F6-A の値（Yeh・Smith 2006） */
export function toneStackPoly(t: number, m: number, lRaw: number): Poly {
  const C1 = 250e-12,
    C2 = 20e-9,
    C3 = 20e-9,
    R1 = 250e3,
    R2 = 1e6,
    R3 = 25e3,
    R4 = 56e3,
    /* ベースのポットは対数の目盛り */
    l = Math.exp((lRaw - 1) * 3.4),
    C123 = C1 * C2 * C3;
  const b1 = t * C1 * R1 + m * C3 * R3 + l * (C1 * R2 + C2 * R2) + (C1 * R3 + C2 * R3);
  const b2 =
    t * (C1 * C2 * R1 * R4 + C1 * C3 * R1 * R4) -
    m * m * (C1 * C3 * R3 * R3 + C2 * C3 * R3 * R3) +
    m * (C1 * C3 * R1 * R3 + C1 * C3 * R3 * R3 + C2 * C3 * R3 * R3) +
    l * (C1 * C2 * R1 * R2 + C1 * C2 * R2 * R4 + C1 * C3 * R2 * R4) +
    l * m * (C1 * C3 * R2 * R3 + C2 * C3 * R2 * R3) +
    (C1 * C2 * R1 * R3 + C1 * C2 * R3 * R4 + C1 * C3 * R3 * R4);
  const b3 =
    l * m * (C123 * R1 * R2 * R3 + C123 * R2 * R3 * R4) -
    m * m * (C123 * R1 * R3 * R3 + C123 * R3 * R3 * R4) +
    m * (C123 * R1 * R3 * R3 + C123 * R3 * R3 * R4) +
    t * C123 * R1 * R3 * R4 -
    t * m * C123 * R1 * R3 * R4 +
    t * l * C123 * R1 * R2 * R4;
  const a1 = C1 * R1 + C1 * R3 + C2 * R3 + C2 * R4 + C3 * R4 + m * C3 * R3 + l * (C1 * R2 + C2 * R2);
  const a2 =
    m * (C1 * C3 * R1 * R3 - C2 * C3 * R3 * R4 + C1 * C3 * R3 * R3 + C2 * C3 * R3 * R3) +
    l * m * (C1 * C3 * R2 * R3 + C2 * C3 * R2 * R3) -
    m * m * (C1 * C3 * R3 * R3 + C2 * C3 * R3 * R3) +
    l * (C1 * C2 * R2 * R4 + C1 * C2 * R1 * R2 + C1 * C3 * R2 * R4 + C2 * C3 * R2 * R4) +
    (C1 * C2 * R1 * R4 +
      C1 * C3 * R1 * R4 +
      C1 * C2 * R3 * R4 +
      C1 * C2 * R1 * R3 +
      C1 * C3 * R3 * R4 +
      C2 * C3 * R3 * R4);
  const a3 =
    l * m * (C123 * R1 * R2 * R3 + C123 * R2 * R3 * R4) -
    m * m * (C123 * R1 * R3 * R3 + C123 * R3 * R3 * R4) +
    m * (C123 * R3 * R3 * R4 + C123 * R1 * R3 * R3 - C123 * R1 * R3 * R4) +
    l * C123 * R1 * R2 * R4 +
    C123 * R1 * R3 * R4;
  return { b: [0, b1, b2, b3], a: [1, a1, a2, a3] };
}

/* ---------- キャビネット ---------- */
/** スピーカーと箱: 低い共振 [Hz] と Q、中域の山、分割振動の谷 [Hz]、高域の下限 [Hz]、補い（このツールで決めた目安） */
export const CABS = {
  '1x12': { fr: 95, q: 1.1, mid: 1600, midDb: 3, notch: 3800, lp: 4800, g: 1.1 },
  '4x12': { fr: 80, q: 1.7, mid: 1100, midDb: 4, notch: 3200, lp: 4200, g: 1.0 },
} as const;
/** マイクの位置: 中心は高い音が多く、端は少ない */
export const MIC_LP = { center: 1.25, edge: 0.72 } as const;
/** キャビネットの双 2 次の並び */
export function cabFilters(type: Exclude<CabType, 'off'>, mic: 'center' | 'edge', fs: number): Poly[] {
  const c = CABS[type],
    k = MIC_LP[mic];
  return [
    rbj('hp', c.fr, c.q, fs),
    rbj('pk', c.mid, 1, fs, c.midDb),
    rbj('pk', c.notch, 3, fs, -6),
    rbj('lp', c.lp * k, 0.75, fs),
    rbj('lp', c.lp * k * 1.15, 0.6, fs),
  ];
}

/* ---------- フィードバック ---------- */
/** スピーカーから弦までの遅れ [s]（1.2 m と、出力の遅れの目安） */
const FB_DELAY = 0.006;
/** キャビネットのレベル（マイクの音量）の幅 [dB]（つまみ 0〜10 で ±LEVEL_DB/2） */
const LEVEL_DB = 24;
/** フィードバックの強さ（つまみ 1 のとき。キャビネットの出力 1 で弦のモードへ足す変位 [m/サンプル]） */
export const FB_K = 1.5e-7;

/* ---------- 機材の並び ---------- */
/** 同時に鳴らす声の上限 */
const MAX_VOICES = 18;

export class Rig {
  R: Rack = cloneRack(DEFAULT_RACK);
  voices: Voice[] = [];
  /** 信号の通る順の段と、段ごとの出口の値（最新の 1 サンプル。左右の平均） */
  stages: StageId[] = stagesOf(this.R);
  tap = new Float64Array(this.stages.length);
  /** 弾く位置（駒からの距離 [m]） */
  pickPos = 0.1;
  /** MIDI のピッチベンド [半音] とモジュレーションのビブラート [半音] */
  wheelBend = 0;
  wheelVib = 0;
  /** 弾いた弦とフレット（画面へ送るまでためる） */
  readonly plucked: { si: number; fret: number }[] = [];

  private readonly uv = new Float64Array(4);
  private readonly o = new Float64Array(2);
  private sense: Sense[] = [];
  private puK = 0;
  private readonly puF = new IIR(3);
  private readonly fx = new Map<number, { k: Kind; fx: Fx }>();
  private readonly ampIn = new IIR();
  private readonly ampBr = new IIR();
  private readonly ampSh = [new Shaper('tube'), new Shaper('tube'), new Shaper('tube')];
  private readonly ampC = [new IIR(), new IIR(), new IIR()];
  private readonly ampL = [new OnePole(), new OnePole(), new OnePole()];
  private readonly ts = new IIR(3);
  private readonly pw = new Shaper('soft');
  private ampDrive = 1;
  private pwG = 1;
  private readonly cabF = [new IIR(), new IIR(), new IIR(), new IIR(), new IIR()];
  private readonly fbD: Delay;
  private n = 0;

  constructor(readonly fs: number) {
    this.fbD = new Delay(fs * FB_DELAY + 4);
    this.update();
  }

  setRack(R: Rack): void {
    this.R = cloneRack(R);
    this.update();
  }

  /** 設定から係数を作り直し、ペダルを足し引きする */
  update(): void {
    const { fs, R } = this,
      coil = COILS[R.pu.coil];
    this.puF.set(bilinear(pickupPoly(R.pu.coil, R.pu.cable, R.pu.tone), fs));
    this.sense = PU_SEL[R.pu.sel].map((k) => ({ x: PU_POS[k], w: coil.w, gap: coil.gap }));
    this.puK = coil.k * (this.sense.length > 1 ? 0.6 : 1);
    const a = R.amp,
      ty = AMPS[a.type];
    this.ampIn.set(rbj('hp', 60, 0.7, fs));
    this.ampDrive = ty.g0 * (ty.g1 / ty.g0) ** a.gain;
    for (let i = 0; i < 3; i++) {
      this.ampC[i].set(rbj('hp', i === 1 ? ty.tight : 30, 0.7, fs));
      this.ampL[i].lp(ty.lp, fs);
    }
    this.ampBr.set(rbj('hs', 1500, 0.7, fs, ty.bright * (1 - a.gain)));
    this.ts.set(bilinear(toneStackPoly(a.treble, a.mid, a.bass), fs));
    this.pwG = 0.3 + 2.5 * a.master * a.master;
    if (R.cab.type !== 'off')
      cabFilters(R.cab.type, R.cab.mic, fs).forEach((p, i) => {
        this.cabF[i].set(p);
      });
    /* ペダル: 新しい番号には処理を作り、外した番号は捨てる */
    const live = new Set<number>();
    for (const p of [...R.pre, ...R.post]) {
      live.add(p.id);
      let f = this.fx.get(p.id);
      if (!f || f.k !== p.k) {
        f = { k: p.k, fx: makeFx(p.k, fs) };
        this.fx.set(p.id, f);
      }
      f.fx.set(p.v);
    }
    for (const id of [...this.fx.keys()]) if (!live.has(id)) this.fx.delete(id);
    const st = stagesOf(R);
    if (st.join() !== this.stages.join()) {
      this.stages = st;
      this.tap = new Float64Array(st.length);
    }
  }

  /** 弦をすべて止め、ペダルとフィードバックに残った音を消す（音色を替えたとき） */
  clear(): void {
    this.voices = [];
    for (const f of this.fx.values()) f.fx.clear();
    this.fbD.clear();
  }

  /** 弦 si をフレット fret で弾く（同じ弦で鳴っている音は止める） */
  pluck(si: number, fret: number, o: PluckOpt = {}): void {
    this.stopString(si, o.ghost ? 40 : 90);
    this.voices.push(
      makeVoice(this.fs, si, fret, { pos: this.pickPos, bend: this.wheelBend, vib: this.wheelVib, ...o }, this.sense),
    );
    if (this.voices.length > MAX_VOICES) this.voices.shift();
    if (this.plucked.length < 64) this.plucked.push({ si, fret });
  }
  /** 弦 si を止める（sg は足す減衰率 [1/s]） */
  stopString(si: number, sg = 60): void {
    for (const v of this.voices)
      if (v.si === si && !v.dead) {
        damp(v, this.fs, sg);
        v.dead = true;
      }
  }
  /** 鳴っている弦 si（止めていない最後の声） */
  live(si: number): Voice | undefined {
    for (let i = this.voices.length - 1; i >= 0; i--)
      if (this.voices[i].si === si && !this.voices[i].dead) return this.voices[i];
    return undefined;
  }
  /** 弦 si をチョーキングする: semi 半音まで sec 秒で */
  bendString(si: number, semi: number, sec: number): void {
    const v = this.live(si);
    if (!v) return;
    v.bendTo = semi;
    v.bendRate = Math.abs(semi - v.bend) / Math.max(1, sec * this.fs);
  }
  /** 弦 si にビブラートを掛ける（depth 半音、hz） */
  vibString(si: number, depth: number, hz = 5.5): void {
    const v = this.live(si);
    if (!v) return;
    v.vib = depth;
    v.vibHz = hz;
  }
  /** MIDI のホイール: 鳴っているすべての弦へ */
  wheel(bend: number, vib: number): void {
    this.wheelBend = bend;
    this.wheelVib = vib;
    for (const v of this.voices)
      if (!v.dead) {
        v.bendTo = bend;
        v.bendRate = 1 / (0.01 * this.fs);
        v.vib = vib;
      }
  }

  /** ペダルの列を通す（o の左右を書き換える）。tap の i 番から書き、次の番号を返す */
  private chain(list: Pedal[], i: number): number {
    const o = this.o;
    for (const p of list) {
      const f = p.on ? this.fx.get(p.id) : undefined;
      if (f) f.fx.run(o[0], o[1], o);
      this.tap[i++] = 0.5 * (o[0] + o[1]);
    }
    return i;
  }

  /** 1 サンプル進める。out に左右の出力を入れる */
  sample(out: Float64Array): void {
    const { fs, R, uv, tap, o } = this;
    const step = this.n++ % PITCH_STEP === 0,
      force = R.cab.fb > 0 && R.cab.type !== 'off' ? this.fbD.read(fs * FB_DELAY) * R.cab.fb * FB_K : 0;
    /* 弦 → ピックアップ。磁束は距離の 2 乗に反比例するとして、弦が近づくほど大きく拾う */
    let e = 0;
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const v = this.voices[i];
      if (step) stepPitch(v, fs);
      stepVoice(v, v.dead ? 0 : force, uv);
      const g0 = 1 / (1 - clamp(uv[0] / PU_D0, -0.6, 0.6)) ** 2,
        g1 = 1 / (1 - clamp(uv[2] / PU_D0, -0.6, 0.6)) ** 2;
      e += uv[1] * g0 + uv[3] * g1;
      if (++v.age % 4096 === 0 && v.age > fs * 0.5 && swing(v) < 1e-8) this.voices.splice(i, 1);
    }
    let x = this.puF.run(e * this.puK) * R.pu.vol * R.pu.vol;
    tap[0] = x;
    o[0] = x;
    o[1] = x;
    let i = this.chain(R.pre, 1);
    /* アンプ: 増幅の段 → トーン → 出力段 */
    const ty = AMPS[R.amp.type];
    let y = this.ampBr.run(this.ampIn.run(0.5 * (o[0] + o[1])) * this.ampDrive);
    for (let k = 0; k < ty.stages; k++)
      y = this.ampL[k].run(this.ampC[k].run(this.ampSh[k].run(y))) * (k < ty.stages - 1 ? ty.inter : 1);
    x = this.pw.run(this.ts.run(y) * 3 * ty.mk * this.pwG) * 0.9;
    tap[i++] = x;
    /* キャビネットとマイク。フィードバックはスピーカーの音で、マイクのレベルの前 */
    if (R.cab.type !== 'off') {
      for (const f of this.cabF) x = f.run(x);
      x *= CABS[R.cab.type].g;
    }
    this.fbD.push(x);
    x *= dbToG((R.cab.level - 0.5) * LEVEL_DB);
    tap[i++] = x;
    o[0] = x;
    o[1] = x;
    this.chain(R.post, i);
    out[0] = o[0];
    out[1] = o[1];
  }
}
