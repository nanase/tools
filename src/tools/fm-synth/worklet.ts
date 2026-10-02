/**
 * FM 音源を鳴らす AudioWorklet。audio.ts が ?worker&url で読み込み、'fm-synth' として使う。
 * port で受け取った音色と基本周波数（FmMsg）で、表示と同じ式（synth.ts）を出力のサンプリング周波数で計算する
 */
import { type Patch, Voice } from './synth';

/* AudioWorkletGlobalScope の名前（TypeScript の DOM の型にはない） */
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

export interface FmMsg {
  p: Patch;
  /** 基本周波数（Hz） */
  f0: number;
}

/** 出力の大きさを目標へ近づける時定数（s） */
const GLIDE_S = 0.005;

registerProcessor(
  'fm-synth',
  class extends AudioWorkletProcessor {
    private readonly v = new Voice();
    private f0 = 0;
    constructor() {
      super();
      this.port.onmessage = (e: MessageEvent<FmMsg>) => {
        this.v.set(e.data.p);
        this.f0 = e.data.f0;
      };
    }
    process(_in: Float32Array[][], outputs: Float32Array[][]): boolean {
      const out = outputs[0];
      if (!out.length || !this.f0) return true;
      this.v.render(out[0], out[0].length, this.f0 / sampleRate, 1 - Math.exp(-1 / (GLIDE_S * sampleRate)));
      for (let c = 1; c < out.length; c++) out[c].set(out[0]);
      return true;
    }
  },
);
