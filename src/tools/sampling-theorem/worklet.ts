/**
 * 標本化と復元の音を作る AudioWorklet。audio.ts が ?worker&url で読み込み、'sampling-theorem' として使う。
 * 今の時刻と標本化周波数を 1 秒に 30 回送る
 */
import type { MusicName } from '../pcm/music';
import { setMusic } from './music';
import { Stream, type StreamSet } from './stream';

/* AudioWorkletGlobalScope の名前（TypeScript の DOM の型にはない） */
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

/** 主スレッドから送るもの */
export type SmpMsg =
  | { type: 'set'; set: StreamSet }
  /** サンプル音源（44.1 kHz・モノラル） */
  | { type: 'music'; name: MusicName; x: Float32Array }
  /** 鳴らす・止める。t は鳴らし始める時刻 [s] */
  | { type: 'play'; on: boolean; t: number };

/** 主スレッドへ送るもの */
export interface PosMsg {
  t: number;
  fs: number;
}

registerProcessor(
  'sampling-theorem',
  class extends AudioWorkletProcessor {
    private st: Stream | null = null;
    private on = false;
    private since = 0;
    constructor() {
      super();
      this.port.onmessage = (ev: MessageEvent<SmpMsg>) => {
        const m = ev.data;
        if (m.type === 'music') setMusic(m.name, m.x);
        else if (m.type === 'set') {
          if (this.st) this.st.update(m.set);
          else this.st = new Stream(sampleRate, m.set);
        } else {
          this.on = m.on;
          if (m.on) this.st?.reset(m.t);
        }
      };
    }
    process(_in: Float32Array[][], outputs: Float32Array[][]): boolean {
      const ch = outputs[0]?.[0];
      if (!ch) return true;
      const st = this.st;
      if (!this.on || !st) {
        ch.fill(0);
        return true;
      }
      st.render(ch);
      this.since += ch.length;
      if (this.since >= sampleRate / 30) {
        this.since = 0;
        this.port.postMessage({ t: st.t, fs: st.fs } satisfies PosMsg);
      }
      return true;
    }
  },
);
