/**
 * FM 音源を鳴らす AudioWorklet。audio.ts が ?worker&url で読み込み、'fm-synth' として使う。
 * port で受け取った音色（FmMsg）で、表示と同じ式（synth.ts）を出力のサンプリング周波数で計算する。
 * 鍵盤と再生ボタンの音（1 音）と、曲の音（AudioContext の時刻で予約した音。数に上限はほぼない）を足して出す。
 * エンベロープはなく、音の始まりと終わりは、ぷつ音を防ぐ短いフェードだけ
 */
import { type Patch, Voice } from './synth';

/* AudioWorkletGlobalScope の名前（TypeScript の DOM の型にはない） */
declare const sampleRate: number;
declare const currentTime: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

export type FmMsg =
  /** 音色を変える（鳴っている音もすぐ変わる） */
  | { type: 'patch'; p: Patch }
  /** 鍵盤と再生ボタンの音: 基本周波数 [Hz] と、鳴らすか */
  | { type: 'hand'; f0: number; on: boolean }
  /** 曲の音を時刻 at（AudioContext の時刻）に鳴らし始める・離す */
  | { type: 'on'; id: number; f0: number; at: number }
  | { type: 'off'; id: number; at: number }
  /** 予約を消して、曲の音をすべて離す */
  | { type: 'stop' };

/** 出力の大きさを目標へ近づける時定数（s） */
const GLIDE_S = 0.005;
/** 音の始まりと終わりのフェードの時定数（s） */
const GATE_S = 0.005;
/** フェードが終わったとみなす大きさ */
const SILENT = 1e-5;
/** 曲の音を同時に鳴らす数の上限（超えたら古い音から離す） */
const MAX_NOTES = 32;

/** 鳴っている 1 音 */
interface Slot {
  v: Voice;
  /** 基本周波数 ÷ 標本化周波数 */
  step: number;
  /** フェードの今の大きさと、目標（1 = 鳴らす、0 = 離す） */
  g: number;
  to: 0 | 1;
  id: number;
}

registerProcessor(
  'fm-synth',
  class extends AudioWorkletProcessor {
    private p: Patch | null = null;
    private readonly hand: Slot = { v: new Voice(), step: 0, g: 0, to: 0, id: -1 };
    private notes: Slot[] = [];
    /** 予約（時刻の順） */
    private queue: Extract<FmMsg, { at: number }>[] = [];
    private buf = new Float32Array(128);
    constructor() {
      super();
      this.port.onmessage = (e: MessageEvent<FmMsg>) => this.recv(e.data);
    }
    private recv(m: FmMsg): void {
      if (m.type === 'patch') {
        this.p = m.p;
        this.hand.v.set(m.p);
        for (const s of this.notes) s.v.set(m.p);
      } else if (m.type === 'hand') {
        const h = this.hand;
        h.step = m.f0 / sampleRate;
        /* 鳴り止んでいたら、位相を 0 から始める（OPN のキーオンと同じ） */
        if (m.on && h.g < SILENT) h.v.reset();
        h.to = m.on ? 1 : 0;
      } else if (m.type === 'stop') {
        this.queue = [];
        for (const s of this.notes) s.to = 0;
      } else {
        const q = this.queue;
        let i = q.length;
        while (i > 0 && q[i - 1].at > m.at) i--;
        q.splice(i, 0, m);
      }
    }
    /** 予約の時刻が来た音を鳴らす・離す */
    private due(t: number): void {
      const q = this.queue;
      let k = 0;
      for (; k < q.length && q[k].at <= t; k++) {
        const m = q[k];
        if (m.type === 'off') {
          for (const s of this.notes) if (s.id === m.id) s.to = 0;
          continue;
        }
        if (m.type !== 'on' || !this.p) continue;
        const v = new Voice();
        v.set(this.p);
        this.notes.push({ v, step: m.f0 / sampleRate, g: 0, to: 1, id: m.id });
        const on = this.notes.filter((s) => s.to === 1);
        if (on.length > MAX_NOTES) on[0].to = 0;
      }
      if (k) q.splice(0, k);
    }
    /** 1 音を out に足す（フェードを掛ける） */
    private mix(s: Slot, out: Float32Array, len: number, glide: number, gate: number): void {
      const b = this.buf;
      s.v.render(b, len, s.step, glide);
      let g = s.g;
      for (let i = 0; i < len; i++) {
        g += (s.to - g) * gate;
        out[i] += b[i] * g;
      }
      s.g = g;
    }
    process(_in: Float32Array[][], outputs: Float32Array[][]): boolean {
      const out = outputs[0];
      if (!out.length) return true;
      const o = out[0],
        len = o.length,
        glide = 1 - Math.exp(-1 / (GLIDE_S * sampleRate)),
        gate = 1 - Math.exp(-1 / (GATE_S * sampleRate));
      if (this.buf.length < len) this.buf = new Float32Array(len);
      o.fill(0);
      this.due(currentTime + len / sampleRate);
      const h = this.hand;
      if (h.step && (h.to || h.g > SILENT)) this.mix(h, o, len, glide, gate);
      else h.g = 0;
      for (const s of this.notes) this.mix(s, o, len, glide, gate);
      this.notes = this.notes.filter((s) => s.to || s.g > SILENT);
      for (let c = 1; c < out.length; c++) out[c].set(o);
      return true;
    }
  },
);
