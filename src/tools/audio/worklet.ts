/**
 * テスト信号をモニターで鳴らす AudioWorklet。capture.ts が ?worker&url で読み込み、'audio-test' として使う。
 * port で受け取った条件（TestMsg）で、出力の 2 チャンネルに L・R を書く
 */
import { genTest, type TestParams } from './signal';

/* AudioWorkletGlobalScope の名前（TypeScript の DOM の型にはない） */
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

/** 鳴らす条件。n は次に書く標本の番号（省略時はそのまま続ける） */
export interface TestMsg {
  p: TestParams;
  n?: number;
}

registerProcessor(
  'audio-test',
  class extends AudioWorkletProcessor {
    private p: TestParams | null = null;
    private n = 0;
    constructor() {
      super();
      this.port.onmessage = (e: MessageEvent<TestMsg>) => {
        this.p = e.data.p;
        if (e.data.n != null) this.n = e.data.n;
      };
    }
    process(_in: Float32Array[][], outputs: Float32Array[][]): boolean {
      const out = outputs[0];
      if (!this.p || out.length < 2) return true;
      genTest(this.p, sampleRate, this.n, out[0].length, out[0], out[1]);
      this.n += out[0].length;
      return true;
    }
  },
);
