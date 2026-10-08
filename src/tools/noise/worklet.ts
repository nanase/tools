/**
 * ノイズを鳴らす AudioWorklet。audio.ts が ?worker&url で読み込み、'noise-gen' として使う。
 * port で受け取った生成の条件（NoiseMsg）で表示と同じ生成器（gen.ts）を回し、出力の 2 チャンネルに同じ音を書く。
 * 書いた音は BLK 標本ずつ port で送り返す（表示は鳴らしている音そのものを描く）
 */
import { Gen, type Spec } from './gen';

/* AudioWorkletGlobalScope の名前（TypeScript の DOM の型にはない） */
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

export interface NoiseMsg {
  sp: Spec;
  /** 条件の版（送り返す音に付ける） */
  v: number;
  seed: number;
}
export interface NoiseOut {
  b: Float32Array;
  v: number;
}

/** 条件を変えたときに前の音から移る時間（s）と、送り返す長さ（標本） */
const XFADE_S = 0.02,
  BLK = 1024;

registerProcessor(
  'noise-gen',
  class extends AudioWorkletProcessor {
    private g: Gen | null = null;
    private old: Gen | null = null;
    /** 移り変わりの位置と長さ（標本） */
    private xi = 0;
    private xn = 0;
    private v = 0;
    private buf = new Float32Array(BLK);
    private bi = 0;
    private tmp = new Float32Array(128);
    constructor() {
      super();
      this.port.onmessage = (e: MessageEvent<NoiseMsg>) => {
        this.old = this.g;
        this.g = new Gen(e.data.sp, e.data.seed);
        this.v = e.data.v;
        this.xi = 0;
        this.xn = this.old ? Math.round(XFADE_S * sampleRate) : 0;
      };
    }
    process(_in: Float32Array[][], outputs: Float32Array[][]): boolean {
      const out = outputs[0];
      if (!out.length || !this.g) return true;
      const o = out[0],
        n = o.length;
      this.g.fill(o, 0, n);
      /* 前の音から等パワーで移る（無相関の雑音どうしなので、和のパワーが変わらない） */
      if (this.old) {
        if (this.tmp.length < n) this.tmp = new Float32Array(n);
        this.old.fill(this.tmp, 0, n);
        for (let i = 0; i < n; i++) {
          const t = Math.min(1, (this.xi + i) / this.xn) * (Math.PI / 2);
          o[i] = o[i] * Math.sin(t) + this.tmp[i] * Math.cos(t);
        }
        this.xi += n;
        if (this.xi >= this.xn) this.old = null;
      }
      for (let c = 1; c < out.length; c++) out[c].set(o);
      for (let i = 0; i < n; i++) {
        this.buf[this.bi++] = o[i];
        if (this.bi === BLK) {
          this.port.postMessage({ b: this.buf, v: this.v } satisfies NoiseOut, [this.buf.buffer]);
          this.buf = new Float32Array(BLK);
          this.bi = 0;
        }
      }
      return true;
    }
  },
);
