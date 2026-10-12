/**
 * エンジンの音を作る AudioWorklet。audio.ts が ?worker&url で読み込み、'engine-model' として使う。
 * EngineSim を標本ごとに回し、排気口から 0.5 m の音圧 [Pa] をそのまま出す（音量は主スレッドの GainNode）。
 * サイクルが終わるたびに集計（CycleStat）を送る（1 秒に 30 回まで）。
 * 波形の表示を頼まれている間は、燃焼の上死点をトリガにして、クランク角で 2 サイクル分の音圧を、角度の区間ごとの
 * 最小と最大の対にまとめて送る（1 秒に 15 回まで）。回転数によらず、同じ角度が同じ位置に並ぶ
 */
import { type CycleStat, EngineSim } from './engine';
import { type EngineId, type MufflerId, specOf } from './spec';
import { WAVE_DEG, WAVE_NB } from './wave';

/* AudioWorkletGlobalScope の名前（TypeScript の DOM の型にはない） */
declare const sampleRate: number;
declare const currentTime: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

/** 運転の設定（init で全部、set で変わったものだけ） */
export interface RunSet {
  /** スロットルの開き（0〜1） */
  throttle?: number;
  /** 'drive' は走行（クラッチと変速機と車体）、'hold' は回転数を保つ（台上） */
  mode?: 'drive' | 'hold';
  /** 保つ回転数 [rpm] */
  rpm?: number;
  /** アイドリング・燃料を切る回転数 [rpm] */
  idle?: number;
  cut?: number;
  /** 機械音の重み（倍） */
  mech?: number;
  /** 走行: 勾配 [%]・ブレーキ（0〜1）・総質量 [kg] */
  slope?: number;
  brake?: number;
  mass?: number;
}

/** 主スレッドから送るもの */
export type EngMsg =
  | { type: 'init'; eng: EngineId; muf: MufflerId; set: RunSet; keep?: boolean }
  | { type: 'set'; set: RunSet }
  | { type: 'shift'; dir: 1 | -1 }
  | { type: 'scope'; on: boolean }
  | { type: 'stop' };

/** トリガを掛けた波形: 燃焼の上死点から WAVE_DEG を WAVE_NB に分けた区間ごとの音圧 [Pa] の最小と最大の対 */
export interface WaveMsg {
  type: 'wave';
  mm: Float32Array;
}

/** 主スレッドへ送るもの */
export interface StatMsg {
  type: 'stat';
  s: CycleStat;
  /** 今の回転数 [rpm] とスロットル（0〜1）、AudioContext の時刻 [s] */
  rpm: number;
  throttle: number;
  t: number;
  /** 走行: 車速 [m/s]・走行距離 [m]・使った燃料 [kg]・ギア（0 が N）・変速の途中か・クラッチのトルク [N·m] */
  v: number;
  dist: number;
  fuel: number;
  gear: number;
  shifting: boolean;
  clutch: number;
}

registerProcessor(
  'engine-model',
  class extends AudioWorkletProcessor {
    private e: EngineSim | null = null;
    private last: CycleStat | null = null;
    private sent = -1;
    /* 波形の切り出し: 頼まれているか、区間ごとの最小と最大、トリガからの角度 [rad]（−1 は待ち）と標本の数、
       次に待ち始める時刻、直前のサイクルの角度 */
    private scope = false;
    private mm = new Float32Array(2 * WAVE_NB);
    private th = -1;
    private cnt = 0;
    private nextArm = 0;
    private prevPhi = 0;
    constructor() {
      super();
      this.port.onmessage = (ev: MessageEvent<EngMsg>) => {
        const m = ev.data;
        if (m.type === 'init') {
          /* keep: 走行中にエンジン・マフラーを替えたとき、回転と車体の状態を引き継ぐ */
          const o = this.e,
            e = new EngineSim(specOf(m.eng, m.muf), sampleRate, o && m.keep ? o.rpm : undefined);
          if (o && m.keep) {
            e.mode = o.mode;
            e.v = o.v;
            e.dist = o.dist;
            e.fuelUsed = o.fuelUsed;
            e.gear = o.gear;
          }
          this.e = e;
          this.apply(m.set);
        } else if (m.type === 'set') this.apply(m.set);
        else if (m.type === 'shift') this.e?.shift(m.dir);
        else if (m.type === 'scope') {
          this.scope = m.on;
          this.th = -1;
        } else this.e = null;
      };
    }
    private apply(s: RunSet): void {
      const e = this.e;
      if (!e) return;
      if (s.throttle != null) e.throttle = s.throttle;
      if (s.mode) e.mode = s.mode;
      if (s.rpm != null && e.mode === 'hold') e.rpm = s.rpm;
      if (s.idle != null) e.idleRpm = s.idle;
      if (s.cut != null) e.cutRpm = s.cut;
      if (s.mech != null) e.mix.mech = s.mech;
      if (s.slope != null) e.slope = s.slope;
      if (s.brake != null) e.brake = s.brake;
      if (s.mass != null) e.mass = s.mass;
    }
    /** 波形の切り出し: 燃焼の上死点（サイクルの 360°）を越えたら、そこからの角度の区間ごとに最小と最大を集める */
    private capture(e: EngineSim, x: number): void {
      const p0 = this.prevPhi,
        p1 = e.phi,
        span = (WAVE_DEG * Math.PI) / 180;
      this.prevPhi = p1;
      if (this.th >= 0) {
        this.th += p1 >= p0 ? p1 - p0 : p1 + 4 * Math.PI - p0;
        /* 回らなくなったら（1 s を超えたら）やめる */
        if (++this.cnt > sampleRate) {
          this.th = -1;
          return;
        }
        if (this.th >= span) {
          const mm = this.mm;
          this.port.postMessage({ type: 'wave', mm } satisfies WaveMsg, [mm.buffer]);
          this.mm = new Float32Array(2 * WAVE_NB);
          this.th = -1;
          this.nextArm = currentTime + 1 / 15;
          return;
        }
      } else if (currentTime >= this.nextArm && p0 < 2 * Math.PI && p1 >= 2 * Math.PI && p1 >= p0) {
        this.th = p1 - 2 * Math.PI;
        this.cnt = 0;
        const mm = this.mm;
        for (let b = 0; b < WAVE_NB; b++) {
          mm[2 * b] = Number.POSITIVE_INFINITY;
          mm[2 * b + 1] = Number.NEGATIVE_INFINITY;
        }
      } else return;
      const b = Math.min(WAVE_NB - 1, Math.floor((this.th / span) * WAVE_NB)),
        mm = this.mm;
      if (x < mm[2 * b]) mm[2 * b] = x;
      if (x > mm[2 * b + 1]) mm[2 * b + 1] = x;
    }
    process(_in: Float32Array[][], outputs: Float32Array[][]): boolean {
      const out = outputs[0];
      if (!out.length) return true;
      const ch = out[0],
        e = this.e;
      if (!e) {
        ch.fill(0);
      } else {
        for (let i = 0; i < ch.length; i++) {
          const x = e.step();
          ch[i] = x;
          if (this.scope) this.capture(e, x);
        }
        if (e.last && e.last !== this.last) {
          this.last = e.last;
          if (currentTime - this.sent >= 1 / 30) {
            this.sent = currentTime;
            this.port.postMessage({
              type: 'stat',
              s: e.last,
              rpm: e.rpm,
              throttle: e.throttle,
              t: currentTime,
              v: e.v,
              dist: e.dist,
              fuel: e.fuelUsed,
              gear: e.gear,
              shifting: e.shifting,
              clutch: e.clutchT,
            } satisfies StatMsg);
          }
        }
      }
      for (let c = 1; c < out.length; c++) out[c].set(ch);
      return true;
    }
  },
);
