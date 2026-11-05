/**
 * 無限音階の音を作る AudioWorklet。audio.ts が ?worker&url で読み込み、'shepard-tone' として使う。
 * 今の位置を 1 秒に 60 回まで送る。音が消え切った間は計算しない
 */
import { Shepard, type TimbreId } from './shepard';

/* AudioWorkletGlobalScope の名前（TypeScript の DOM の型にはない） */
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

/** 主スレッドから送るもの */
export type ShMsg =
  /** 音を出す・止める。pos は鳴らし始める位置 [半音] */
  | { type: 'play'; on: boolean; pos: number }
  | { type: 'chord'; s: readonly number[] }
  | { type: 'timbre'; id: TimbreId }
  | { type: 'rate'; v: number }
  | { type: 'dir'; v: 1 | -1 }
  | { type: 'moving'; on: boolean }
  | { type: 'stepped'; on: boolean }
  /** 山の中心と幅 [オクターブ] */
  | { type: 'range'; center: number; width: number };

/** 主スレッドへ送るもの */
export interface PosMsg {
  pos: number;
  vel: number;
}

registerProcessor(
  'shepard-tone',
  class extends AudioWorkletProcessor {
    private readonly s = new Shepard(sampleRate);
    private since = 0;
    constructor() {
      super();
      this.port.onmessage = (ev: MessageEvent<ShMsg>) => {
        const m = ev.data,
          s = this.s;
        if (m.type === 'play') {
          if (m.on) s.pos = m.pos;
          s.on = m.on;
        } else if (m.type === 'chord') s.setChord(m.s);
        else if (m.type === 'timbre') s.setTimbre(m.id);
        else if (m.type === 'rate') s.rate = m.v;
        else if (m.type === 'dir') s.dir = m.v;
        else if (m.type === 'moving') s.moving = m.on;
        else if (m.type === 'stepped') s.stepped = m.on;
        else {
          s.center = m.center;
          s.width = m.width;
        }
      };
    }
    process(_in: Float32Array[][], outputs: Float32Array[][]): boolean {
      const ch = outputs[0]?.[0];
      if (!ch) return true;
      const s = this.s;
      if (s.silent) {
        ch.fill(0);
        return true;
      }
      s.render(ch, ch.length);
      this.since += ch.length;
      if (this.since >= sampleRate / 60) {
        this.since = 0;
        this.port.postMessage({ pos: s.pos, vel: s.vel } satisfies PosMsg);
      }
      return true;
    }
  },
);
