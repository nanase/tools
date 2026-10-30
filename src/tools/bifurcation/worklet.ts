/**
 * 値の列を鳴らす AudioWorklet。audio.ts が ?worker&url で読み込み、'bifurcation' として使う。
 * port で受け取った条件（SoundParams）で、表示と同じ写像（map.ts）を出力のサンプリング周波数でまわす
 */
import { MapVoice, type SoundParams } from './sound';

/* AudioWorkletGlobalScope の名前（TypeScript の DOM の型にはない） */
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

registerProcessor(
  'bifurcation',
  class extends AudioWorkletProcessor {
    private readonly v = new MapVoice();
    private on = false;
    constructor() {
      super();
      this.port.onmessage = (e: MessageEvent<SoundParams>) => {
        this.v.set(e.data);
        this.on = true;
      };
    }
    process(_in: Float32Array[][], outputs: Float32Array[][]): boolean {
      const out = outputs[0];
      if (!out.length || !this.on) return true;
      this.v.render(out[0], out[0].length, sampleRate);
      for (let c = 1; c < out.length; c++) out[c].set(out[0]);
      return true;
    }
  },
);
