/**
 * マイクの音をそのまま受け取る AudioWorklet。rec.ts が ?worker&url で読み込み、'wd-rec' として使う。
 * 入力の各ブロックを、チャンネルを平均したモノラルにして port へ送る
 */

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

registerProcessor(
  'wd-rec',
  class extends AudioWorkletProcessor {
    process(inputs: Float32Array[][]): boolean {
      const ch = inputs[0];
      if (!ch?.length) return true;
      const n = ch[0].length,
        m = new Float32Array(n);
      for (const c of ch) for (let i = 0; i < n; i++) m[i] += c[i] / ch.length;
      this.port.postMessage(m, [m.buffer]);
      return true;
    }
  },
);
