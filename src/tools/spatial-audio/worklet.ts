/**
 * 立体音響の音を作る AudioWorklet。audio.ts が ?worker&url で読み込み、'spatial-audio' として使う。
 * 録音（clip）と場面（scene）を受け取り、render.ts で両耳の音にする
 */
import { Binaural, type Clip, type SceneSpec } from './render';

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

/** 主スレッドから送るもの */
export type SpMsg = { type: 'clip'; id: string; clip: Clip } | { type: 'scene'; scene: SceneSpec };

registerProcessor(
  'spatial-audio',
  class extends AudioWorkletProcessor {
    private readonly b = new Binaural(sampleRate);
    constructor() {
      super();
      this.port.onmessage = (ev: MessageEvent<SpMsg>) => {
        const m = ev.data;
        if (m.type === 'clip') this.b.setClip(m.id, m.clip);
        else this.b.setScene(m.scene);
      };
    }
    process(_in: Float32Array[][], outputs: Float32Array[][]): boolean {
      const L = outputs[0]?.[0],
        R = outputs[0]?.[1];
      if (!L || !R) return true;
      this.b.render(L, R, L.length);
      return true;
    }
  },
);
