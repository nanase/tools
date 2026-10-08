/**
 * ギターの音を作る AudioWorklet。audio.ts が ?worker&url で読み込み、'guitar-model' として使う。
 * 受け取った撥弦・指を離す・こすれる音を、指定の時刻（AudioContext の時刻）に標本の単位で始める。
 * 出力はステレオ（pan で弦ごとの定位を少しずらす）で、部屋の残響を足す（どちらも再生だけで、表示用の計算には使わない）
 */
import { Reverb, type ReverbSpec } from '../../lib/reverb';
import { type BodyDesc, Engine, type PluckMsg } from './engine';

/* AudioWorkletGlobalScope の名前（TypeScript の DOM の型にはない） */
declare const sampleRate: number;
declare const currentFrame: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

/** 主スレッドから送るもの。at は AudioContext の時刻 [s]（過ぎていればすぐ）、pan は定位（−1 が左、1 が右） */
export type GtMsg =
  | { type: 'body'; d: BodyDesc }
  | { type: 'room'; r: ReverbSpec }
  | { type: 'pluck'; at: number; p: PluckMsg; pan: number; id: number }
  | { type: 'damp'; at: number; si: number; tau: number; id: number }
  | { type: 'noise'; at: number; si: number; buf: Float32Array; pan: number }
  | { type: 'stop'; tau: number };

type Ev = Exclude<GtMsg, { type: 'body' } | { type: 'room' } | { type: 'stop' }>;

registerProcessor(
  'guitar-model',
  class extends AudioWorkletProcessor {
    private readonly e = new Engine(sampleRate, true);
    private readonly rv = new Reverb(sampleRate);
    private q: Ev[] = [];
    /** 右の出力がないときに捨てる先 */
    private readonly spare = new Float32Array(128);
    constructor() {
      super();
      this.port.onmessage = (ev: MessageEvent<GtMsg>) => {
        const m = ev.data;
        if (m.type === 'body') this.e.setBody(m.d);
        else if (m.type === 'room') this.rv.set(m.r);
        else if (m.type === 'stop') {
          this.q = [];
          this.e.dampAll(m.tau);
        } else {
          this.q.push(m);
          this.q.sort((a, b) => a.at - b.at);
        }
      };
    }
    private fire(m: Ev): void {
      if (m.type === 'pluck') this.e.pluck(m.p, m.pan, m.id);
      else if (m.type === 'damp') this.e.damp(m.si, m.tau, m.id);
      else this.e.noise(m.si, m.buf, m.pan);
    }
    process(_in: Float32Array[][], outputs: Float32Array[][]): boolean {
      const out = outputs[0];
      if (!out.length) return true;
      const ch = out[0],
        chR = out[1] ?? this.spare,
        n = ch.length;
      let i = 0;
      while (i < n) {
        /* 次の出来事の標本まで進める */
        let j = n;
        while (this.q.length) {
          const k = Math.round(this.q[0].at * sampleRate) - currentFrame;
          if (k > i) {
            j = Math.min(n, k);
            break;
          }
          this.fire(this.q.shift() as Ev);
        }
        this.e.render(ch, i, j - i, chR);
        i = j;
      }
      /* 残響（なしなら何もしない） */
      this.rv.process(ch, chR, 0, n);
      return true;
    }
  },
);
