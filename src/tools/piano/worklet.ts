/**
 * ピアノの音を作る AudioWorklet。audio.ts が ?worker&url で読み込み、'piano-model' として使う。
 * 打鍵・鍵を離す・ペダルを、指定の時刻（AudioContext の時刻）に標本の単位で始める。打鍵の模型は
 * 計算用の Worker（synth.ts）が求めて、MessagePort で直接送ってくる。
 * 出力はステレオで、部屋の残響を足す（再生だけ。表示用の計算には使わない）
 */
import { Reverb, type ReverbSpec } from '../../lib/reverb';
import { type BoardDesc, Engine } from './engine';
import type { StrikeMsg } from './model';

/* AudioWorkletGlobalScope の名前（TypeScript の DOM の型にはない） */
declare const sampleRate: number;
declare const currentFrame: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

/** 主スレッドと計算用の Worker から送るもの。at は AudioContext の時刻 [s]（過ぎていればすぐ） */
export type PnMsg =
  | { type: 'board'; d: BoardDesc }
  | { type: 'room'; r: ReverbSpec }
  | { type: 'port'; port: MessagePort }
  | { type: 'strike'; at: number; p: StrikeMsg; gen: number }
  | { type: 'release'; at: number; key: number }
  | { type: 'pedal'; at: number; on: boolean }
  | { type: 'stop'; tau: number; gen: number };

type Ev = Extract<PnMsg, { at: number }>;

registerProcessor(
  'piano-model',
  class extends AudioWorkletProcessor {
    private readonly e = new Engine(sampleRate, true);
    private readonly rv = new Reverb(sampleRate);
    private q: Ev[] = [];
    private readonly spare = new Float32Array(128);
    /** 止めた回数（これより古い打鍵は捨てる） */
    private gen = 0;
    constructor() {
      super();
      this.port.onmessage = (ev: MessageEvent<PnMsg>) => this.recv(ev.data);
    }
    private recv(m: PnMsg): void {
      if (m.type === 'board') this.e.setBoard(m.d);
      else if (m.type === 'room') this.rv.set(m.r);
      else if (m.type === 'port') m.port.onmessage = (ev: MessageEvent<PnMsg>) => this.recv(ev.data);
      else if (m.type === 'stop') {
        this.q = [];
        this.gen = m.gen;
        this.e.stopAll(m.tau);
      } else if (m.type !== 'strike' || m.gen >= this.gen) {
        /* 同じ時刻なら、届いた順（鍵を離す・ペダル → 打鍵の順を崩さない） */
        let i = this.q.length;
        while (i > 0 && this.q[i - 1].at > m.at) i--;
        this.q.splice(i, 0, m);
      }
    }
    private fire(m: Ev): void {
      if (m.type === 'strike') this.e.strike(m.p);
      else if (m.type === 'release') this.e.release(m.key);
      else this.e.setPedal(m.on);
    }
    process(_in: Float32Array[][], outputs: Float32Array[][]): boolean {
      const out = outputs[0];
      if (!out.length) return true;
      const ch = out[0],
        chR = out[1] ?? this.spare,
        n = ch.length;
      let i = 0;
      while (i < n) {
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
      this.rv.process(ch, chR, 0, n);
      return true;
    }
  },
);
