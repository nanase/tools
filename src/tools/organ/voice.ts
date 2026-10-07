/**
 * 管の整音と調律の結果（DOM に依存しない）: 管を鳴らして周波数を測り、管の長さ（リード管は舌の固有振動数）を直す。
 * 調律したあとの定常の音から、倍音（図に表示する管の中の音圧）・立ち上がり・1 m 先の音圧の実効値を求める。
 * 既定の設定での調律の結果は tuned.ts（scripts/organ-tune.ts で作る）にあり、調律法と A4 を変えたときは、
 * 管の音響的な長さ（リード管は舌の固有振動数と共鳴管の長さ）を目標の周波数の比で伸び縮みさせて使う
 */
import { FluePipe, type FlueSpec, ReedPipe, type ReedSpec } from './pipes';
import { divOf, OPT0, type PipeDef, type PipeOpt, type Stop } from './stops';
import { measSec, measureF0, sound, tuneFlue, tuneReed, tuneSec } from './tune';

/** 調律した管 1 本 */
export interface Voiced {
  kind: 'flue' | 'reed';
  spec: FlueSpec | ReedSpec;
  /** 目標と、測った周波数 [Hz] */
  f: number;
  fMeas: number;
  /** 管の中の音圧の倍音（最大を 1）と位相 [rad]（第 1〜HARM 倍音） */
  amp: number[];
  ph: number[];
  /** 立ち上がり（定常の −3 dB まで） [s]・定常の 1 m 先の音圧の実効値 [Pa] */
  rise: number;
  rms: number;
}

/** 図に表示する倍音の数 */
export const HARM = 8;

/** x[s..s+N) の周波数 f の成分（複素振幅） */
function comp(x: Float64Array, s: number, N: number, f: number, fs: number): [number, number] {
  const w = (2 * Math.PI * f) / fs;
  let re = 0,
    im = 0;
  for (let i = 0; i < N; i++) {
    re += x[s + i] * Math.cos(w * (s + i));
    im -= x[s + i] * Math.sin(w * (s + i));
  }
  return [(2 * re) / N, (2 * im) / N];
}

/** 定常の音を解析する: 倍音（音圧から管の中の圧力の目安へ直す）、立ち上がり、実効値 */
export function analyze(x: Float64Array, f: number, fs: number, kind: 'flue' | 'reed', stopped: boolean) {
  const tail = measSec(f),
    P = fs / f,
    N = Math.round(Math.max(1, Math.floor((tail * fs) / P)) * P),
    s = x.length - N;
  let e = 0;
  for (let i = s; i < x.length; i++) e += x[i] * x[i];
  const rms = Math.sqrt(e / N),
    amp: number[] = [],
    ph: number[] = [];
  for (let k = 1; k <= HARM; k++) {
    const [re, im] = comp(x, s, N, k * f, fs);
    /* 放射される音圧は体積速度の微分なので、管の中の圧力の目安には倍音の番号で割る */
    amp.push(Math.hypot(re, im) / k);
    ph.push(Math.atan2(im, re));
  }
  const top = Math.max(...amp, 1e-12);
  for (let k = 0; k < HARM; k++) amp[k] /= top;
  void kind;
  void stopped;
  /* 立ち上がり: 1 周期の実効値が定常の −3 dB に届く時刻 */
  const Pi = Math.max(4, Math.round(P)),
    hop = Math.max(1, Math.round(Pi / 4)),
    ref = rms * 10 ** (-3 / 20);
  let rise = Number.NaN;
  for (let i = 0; i + Pi <= x.length; i += hop) {
    let q = 0;
    for (let j = i; j < i + Pi; j++) q += x[j] * x[j];
    if (Math.sqrt(q / Pi) >= ref) {
      rise = (i + Pi) / fs;
      break;
    }
  }
  return { amp, ph, rise, rms };
}

/** 管を鳴らして解析する */
export function measure(d: PipeDef, fs: number, wind: number): Omit<Voiced, 'kind' | 'spec' | 'f'> {
  const pipe = d.kind === 'flue' ? new FluePipe(d.spec, fs) : new ReedPipe(d.spec, fs),
    x = sound(pipe, fs, tuneSec(d.f), wind),
    r = measureF0(x, fs, d.f / 2, d.f * 2, measSec(d.f)),
    fMeas = Number.isFinite(r.f) ? r.f : d.f;
  return { fMeas, ...analyze(x, fMeas, fs, d.kind, d.kind === 'flue' && (d.spec as FlueSpec).stopped) };
}

/** 管を調律して解析する */
export function voice(d: PipeDef, fs: number, wind: number): Voiced {
  let spec: FlueSpec | ReedSpec;
  if (d.kind === 'flue') spec = tuneFlue(d.spec, d.f, fs, wind).spec;
  else spec = tuneReed(d.spec, d.f, fs, wind).spec;
  const m = measure({ ...d, spec } as PipeDef, fs, wind);
  return { kind: d.kind, spec, f: d.f, ...m };
}

/** 風箱の圧力 [Pa] */
export const windOf = (s: Stop, o: PipeOpt): number => o.wind * divOf(s.div).windK;

/** 表の 1 本ぶん（既定の設定で調律した値） */
export interface TunedRow {
  /** フルー管は音響的な長さの比（調律後 ÷ 調律前）、リード管は舌の固有振動数の比と共鳴管の長さの比 */
  k: number;
  res: number;
  /** 測った周波数 ÷ 目標、立ち上がり [s]、実効値 [Pa]、倍音の大きさ [dB]（最大を 0）と位相 [1/64 回転] */
  fr: number;
  rise: number;
  rms: number;
  db: number[];
  ph: number[];
}

/** 表の値を、条件 o で作った管に当てはめる（調律法と A4 が違えば、伸び縮みさせる） */
export function applyRow(d: PipeDef, row: TunedRow): Voiced {
  let spec: FlueSpec | ReedSpec;
  if (d.kind === 'flue') {
    const s = d.spec,
      p = new FluePipe(s, 48000),
      corr = p.info.Lac - s.l;
    spec = { ...s, l: row.k * p.info.Lac - corr };
  } else {
    const s = d.spec;
    spec = { ...s, fr: row.k * s.fr, L: row.res * s.L, Vs: row.res * s.Vs };
  }
  return {
    kind: d.kind,
    spec,
    f: d.f,
    fMeas: row.fr * d.f,
    amp: row.db.map((x) => 10 ** (x / 20)),
    ph: row.ph.map((x) => (x / 64) * 2 * Math.PI),
    rise: row.rise,
    rms: row.rms,
  };
}

/** 調律の結果から表の 1 本ぶんを作る（d は調律前、v は調律後） */
export function rowOf(d: PipeDef, v: Voiced): TunedRow {
  let k: number, res: number;
  if (d.kind === 'flue') {
    const a = new FluePipe(d.spec, 48000).info,
      b = new FluePipe(v.spec as FlueSpec, 48000).info;
    k = b.Lac / a.Lac;
    res = 1;
  } else {
    k = (v.spec as ReedSpec).fr / d.spec.fr;
    res = (v.spec as ReedSpec).L / d.spec.L;
  }
  return {
    k,
    res,
    fr: v.fMeas / v.f,
    rise: v.rise,
    rms: v.rms,
    db: v.amp.map((a) => Math.max(-90, Math.round(20 * Math.log10(Math.max(a, 1e-9))))),
    ph: v.ph.map((p) => Math.round((p / (2 * Math.PI)) * 64) & 63),
  };
}

export { OPT0 };
