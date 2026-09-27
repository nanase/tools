/** ライブ入力の包絡線を取り出す AudioWorklet。client.ts が ?worker&url で読み込み、'jjy-env' として使う */
import { type ProcIn, procInit, procMsg, procStep } from './proc';

/* AudioWorkletGlobalScope の名前（TypeScript の DOM の型にはない） */
declare const sampleRate: number;
declare const currentTime: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

registerProcessor(
  'jjy-env',
  class extends AudioWorkletProcessor {
    private readonly st = procInit();
    constructor() {
      super();
      this.port.onmessage = (e: MessageEvent<ProcIn>) => procMsg(this.st, sampleRate, e.data);
    }
    process(inputs: Float32Array[][]): boolean {
      const ch = inputs[0];
      if (!ch?.length) return true;
      let x = ch[0];
      if (ch.length > 1) {
        x = new Float32Array(x.length);
        for (const c of ch) for (let i = 0; i < x.length; i++) x[i] += c[i] / ch.length;
      }
      procStep(this.st, x, sampleRate, currentTime, (d) => this.port.postMessage(d));
      return true;
    }
  },
);
