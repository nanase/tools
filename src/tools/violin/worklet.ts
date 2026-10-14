/**
 * ヴァイオリンの音を鳴らす AudioWorklet。audio.ts が ?worker&url で読み込み、'violin-model' として使う。
 * 計算用の Worker（synth.ts）が作った音（ステレオ、512 標本ずつ）を MessagePort で受け取って順に鳴らし、
 * 部屋の残響を足す（残響は再生だけで、表示用の計算には使わない）。
 * 受け取った量と残っている量を Worker へ、いま鳴らしている標本の番号を主スレッドへ知らせる
 */
import { Reverb, type ReverbSpec } from '../../lib/reverb';
import type { UsedMsg } from './synth';

/* AudioWorkletGlobalScope の名前（TypeScript の DOM の型にはない） */
declare const sampleRate: number;
declare const currentTime: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

/** Worker から（MessagePort で）と主スレッドから送るもの */
export type VnMsg =
  | { type: 'port'; port: MessagePort }
  /* 音: 区切りの番号、最初の標本の番号（Worker の音源の通し番号） */
  | { type: 'audio'; epoch: number; at: number; L: Float32Array; R: Float32Array }
  /* 作っておいた音を捨てる（新しい区切りの音から鳴らす） */
  | { type: 'flush'; epoch: number }
  | { type: 'room'; r: ReverbSpec }
  /* 残っている音と残響をすぐ消す（一時停止の間に止めたとき） */
  | { type: 'reset' };

/** 主スレッドへ送るもの: いま鳴らしている標本の番号（音がなければ null）と、AudioContext の時刻 [s] */
export interface PosMsg {
  type: 'pos';
  at: number | null;
  t: number;
}

interface Chunk {
  at: number;
  L: Float32Array;
  R: Float32Array;
  /** 新しい区切りの最初の音（音量を上げながら始める） */
  fade: boolean;
}

/** 捨てるとき・始めるときに音量を変える長さ [標本] */
const FADE = 64;

registerProcessor(
  'violin-model',
  class extends AudioWorkletProcessor {
    private readonly rv = new Reverb(sampleRate);
    private q: Chunk[] = [];
    /** いま鳴らしている音の中の位置 */
    private o = 0;
    private epoch = 0;
    private got = 0;
    private under = 0;
    private wp: MessagePort | null = null;
    /** 新しい区切りの最初の音を受け取ったか */
    private fresh = false;
    private fadeIn = 0;
    private tick = 0;
    private playing = false;
    private readonly spare = new Float32Array(128);
    constructor() {
      super();
      this.port.onmessage = (ev: MessageEvent<VnMsg>) => this.msg(ev.data);
    }
    private msg(m: VnMsg): void {
      if (m.type === 'port') {
        this.wp = m.port;
        this.wp.onmessage = (ev: MessageEvent<VnMsg>) => this.msg(ev.data);
      } else if (m.type === 'audio') {
        if (m.epoch < this.epoch) return;
        if (m.epoch > this.epoch) this.drop(m.epoch);
        this.q.push({ at: m.at, L: m.L, R: m.R, fade: this.fresh });
        this.fresh = false;
        this.got += m.L.length;
      } else if (m.type === 'flush') {
        if (m.epoch > this.epoch) this.drop(m.epoch);
      } else if (m.type === 'room') this.rv.set(m.r);
      else {
        this.q = [];
        this.o = 0;
        this.rv.clear();
      }
    }
    /** 新しい区切りへ: 鳴らしている音は FADE 標本で消し、残りは捨てる */
    private drop(epoch: number): void {
      this.epoch = epoch;
      this.got = 0;
      this.fresh = true;
      const head = this.q[0];
      this.q = [];
      if (head && this.o > 0) {
        const k = Math.min(FADE, head.L.length - this.o),
          L = new Float32Array(k),
          R = new Float32Array(k);
        for (let j = 0; j < k; j++) {
          const g = 1 - (j + 1) / (k + 1);
          L[j] = head.L[this.o + j] * g;
          R[j] = head.R[this.o + j] * g;
        }
        this.q.push({ at: head.at + this.o, L, R, fade: false });
      }
      this.o = 0;
    }
    private queued(): number {
      let n = -this.o;
      for (const c of this.q) n += c.L.length;
      return Math.max(0, n);
    }
    process(_in: Float32Array[][], outputs: Float32Array[][]): boolean {
      const out = outputs[0];
      if (!out.length) return true;
      const L = out[0],
        R = out[1] ?? this.spare,
        n = L.length;
      let i = 0,
        at: number | null = null;
      while (i < n) {
        const c = this.q[0];
        if (!c) {
          if (this.playing) this.under++;
          this.playing = false;
          L.fill(0, i);
          R.fill(0, i);
          break;
        }
        this.playing = true;
        if (this.o === 0 && c.fade) this.fadeIn = FADE;
        const m = Math.min(n - i, c.L.length - this.o);
        for (let k = 0; k < m; k++) {
          let g = 1;
          if (this.fadeIn > 0) {
            g = 1 - this.fadeIn / FADE;
            this.fadeIn--;
          }
          L[i + k] = c.L[this.o + k] * g;
          R[i + k] = c.R[this.o + k] * g;
        }
        this.o += m;
        i += m;
        at = c.at + this.o;
        if (this.o >= c.L.length) {
          this.q.shift();
          this.o = 0;
        }
      }
      this.rv.process(L, R, 0, n);
      /* 約 10 ms ごとに知らせる */
      if (++this.tick % 4 === 0) {
        this.wp?.postMessage({
          type: 'used',
          epoch: this.epoch,
          got: this.got,
          queued: this.queued(),
          under: this.under,
        } satisfies UsedMsg);
        this.port.postMessage({ type: 'pos', at, t: currentTime } satisfies PosMsg);
      }
      return true;
    }
  },
);
