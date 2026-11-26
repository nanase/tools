/**
 * FM 音源を鳴らす AudioWorklet。audio.ts が ?worker&url で読み込み、'fm-synth' として使う。
 * port で受け取った音色（FmMsg）で、表示と同じ式（synth.ts）を出力のサンプリング周波数で計算する。
 * 再生ボタンの音（1 音。エンベロープなしで鳴らし続け、始まりと終わりだけ短いフェード）と、
 * 鍵盤・曲・MIDI の音（AudioContext の時刻で予約した音。エンベロープを掛け、あわせて MAX_NOTES まで）を足して出す
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
  /** 再生ボタンの音: 基本周波数 [Hz]・強さ（0〜1）と、鳴らすか */
  | { type: 'hand'; f0: number; vel: number; on: boolean }
  /** 音 id を時刻 at（AudioContext の時刻）に強さ vel（0〜1）で鳴らし始める・離す。曲の音は id ≥ 0、鍵盤と MIDI の音は id < 0 */
  | { type: 'on'; id: number; f0: number; vel: number; at: number }
  | { type: 'off'; id: number; at: number }
  /** 予約を消して、曲の音をすべて離す（鍵盤と MIDI の音は残す） */
  | { type: 'stop' }
  /** 鳴っている音をすべてすぐ消す（予約は残す） */
  | { type: 'panic' };

/** worklet から送る: 最後に鳴り始めた音のオペレータごとのエンベロープの大きさ（鳴っていなければ null） */
export type FmOut = { type: 'lv'; lv: number[] | null };

/** 出力の大きさを目標へ近づける時定数（s） */
const GLIDE_S = 0.005;
/** 再生ボタンの音の始まりと終わり、消す音のフェードの時定数（s） */
const GATE_S = 0.005;
/** フェードが終わったとみなす大きさ */
const SILENT = 1e-5;
/** 鍵盤・曲・MIDI の音を同時に鳴らす数の上限（超えたら古い音から消す） */
const MAX_NOTES = 32;
/** エンベロープの大きさを送る間隔（s） */
const LV_S = 1 / 30;

/** 鍵盤・曲・MIDI の 1 音 */
interface Note {
  v: Voice;
  /** 基本周波数 ÷ 標本化周波数 */
  step: number;
  id: number;
  /** 消しているときのフェードの大きさ（1 = 消していない） */
  g: number;
  kill: boolean;
}

registerProcessor(
  'fm-synth',
  class extends AudioWorkletProcessor {
    private p: Patch | null = null;
    /** 再生ボタンの音 */
    private readonly hand = { v: new Voice(), step: 0, g: 0, to: 0 as 0 | 1 };
    private notes: Note[] = [];
    /** 予約（時刻の順） */
    private queue: Extract<FmMsg, { at: number }>[] = [];
    private buf = new Float32Array(128);
    /** エンベロープの大きさを送ってからの標本の数と、前に送ったのが null か */
    private lvN = 0;
    private lvNull = true;
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
        h.v.setVel(m.vel);
        /* 鳴り止んでいたら、位相を 0 から始める（OPN のキーオンと同じ） */
        if (m.on && h.g < SILENT) h.v.reset();
        h.to = m.on ? 1 : 0;
      } else if (m.type === 'stop') {
        this.queue = this.queue.filter((q) => q.id < 0);
        for (const s of this.notes) if (s.id >= 0) s.v.release();
      } else if (m.type === 'panic') {
        for (const s of this.notes) s.kill = true;
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
          for (const s of this.notes) if (s.id === m.id && !s.v.released) s.v.release();
          continue;
        }
        if (m.type !== 'on' || !this.p) continue;
        /* 同じ id の音が鳴っていれば離す（鍵盤を押し直したときなど） */
        for (const s of this.notes) if (s.id === m.id && !s.v.released) s.v.release();
        const v = new Voice();
        v.set(this.p);
        v.start(sampleRate, m.vel);
        this.notes.push({ v, step: m.f0 / sampleRate, id: m.id, g: 1, kill: false });
        const on = this.notes.filter((s) => !s.kill);
        if (on.length > MAX_NOTES) on[0].kill = true;
      }
      if (k) q.splice(0, k);
    }
    /** 最後に鳴り始めた音のエンベロープの大きさを送る（鳴っていなければ 1 度だけ null） */
    private sendLv(len: number): void {
      this.lvN += len;
      if (this.lvN < LV_S * sampleRate) return;
      this.lvN = 0;
      const last = this.notes.findLast((s) => !s.kill && !s.v.done);
      if (!last) {
        if (!this.lvNull) this.port.postMessage({ type: 'lv', lv: null } satisfies FmOut);
        this.lvNull = true;
        return;
      }
      this.lvNull = false;
      this.port.postMessage({ type: 'lv', lv: [0, 1, 2, 3].map((k) => last.v.level(k)) } satisfies FmOut);
    }
    process(_in: Float32Array[][], outputs: Float32Array[][]): boolean {
      const out = outputs[0];
      if (!out.length) return true;
      const o = out[0],
        len = o.length,
        glide = 1 - Math.exp(-1 / (GLIDE_S * sampleRate)),
        gate = 1 - Math.exp(-1 / (GATE_S * sampleRate));
      if (this.buf.length < len) this.buf = new Float32Array(len);
      const b = this.buf;
      o.fill(0);
      this.due(currentTime + len / sampleRate);
      const h = this.hand;
      if (h.step && (h.to || h.g > SILENT)) {
        h.v.render(b, len, h.step, glide);
        let g = h.g;
        for (let i = 0; i < len; i++) {
          g += (h.to - g) * gate;
          o[i] += b[i] * g;
        }
        h.g = g;
      } else h.g = 0;
      for (const s of this.notes) {
        s.v.render(b, len, s.step, glide, 1 / sampleRate);
        if (s.kill) {
          let g = s.g;
          for (let i = 0; i < len; i++) {
            g -= g * gate;
            o[i] += b[i] * g;
          }
          s.g = g;
        } else for (let i = 0; i < len; i++) o[i] += b[i];
      }
      this.notes = this.notes.filter((s) => !(s.kill ? s.g < SILENT : s.v.done));
      this.sendLv(len);
      for (let c = 1; c < out.length; c++) out[c].set(o);
      return true;
    }
  },
);
