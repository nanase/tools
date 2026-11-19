/**
 * FM シンセサイザを鳴らす AudioWorklet。audio.ts が ?worker&url で読み込み、'fm-synthesizer' として使う。
 * 音源は engine.ts の Synth。GM の音色の表（tones.ts）を持ち、プログラムチェンジでパートの音色を替える。
 * 画面で直した音色は、GM の番号（打楽器はノート番号）ごとに表を書き換える
 */
import { Reverb, type ReverbSpec } from '../../lib/reverb';
import { BEND, CC, type Kind, OFF, ON, PC } from '../../lib/smf';
import { DRUM_PART, PARTS, type Src, Synth, type Tone } from './engine';
import { DRUM_DEFAULT, DRUM_TONES, GM_TONES } from './tones';

declare const sampleRate: number;
declare const currentTime: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

/** 鳴らす出来事（smf.ts と同じ形。ch は 0〜15） */
export interface SynthEv {
  k: Kind;
  ch: number;
  a: number;
  v: number;
}

export type SynthMsg =
  /** GM の番号 prog の音色を替える（その番号のパートもすぐ替わる） */
  | { type: 'gm'; prog: number; tone: Tone }
  /** 打楽器のノート note の音色を替える */
  | { type: 'drum'; note: number; tone: Tone }
  /** パートの画面の音量 [dB]・定位（−1〜1）・ミュート・残響へ送る量（0〜1） */
  | { type: 'part'; part: number; vol: number; pan: number; mute: boolean; rev: number }
  /** 残響（部屋）。送る量を掛けた音だけに掛け、直接音に足す */
  | { type: 'room'; spec: ReverbSpec }
  /** すべての音をすぐ消す（曲の予約は残す） */
  | { type: 'panic' }
  /** 出来事を時刻 at（AudioContext の時刻。0 はすぐ）に鳴らす */
  | { type: 'ev'; at: number; src: Src; e: SynthEv }
  /** 曲の予約を消し、曲の音を離して、曲で変えたコントローラを戻す（MIDI 機器の音は残す） */
  | { type: 'stop' };

interface Queued {
  at: number;
  src: Src;
  e: SynthEv;
}

registerProcessor(
  'fm-synthesizer',
  class extends AudioWorkletProcessor {
    private readonly gm: Tone[] = [...GM_TONES];
    private readonly prog = new Array<number>(PARTS).fill(0);
    private readonly synth = new Synth(sampleRate, GM_TONES[0], DRUM_DEFAULT);
    private queue: Queued[] = [];
    private L = new Float32Array(128);
    private R = new Float32Array(128);
    private SL = new Float32Array(128);
    private SR = new Float32Array(128);
    private WL = new Float32Array(128);
    private WR = new Float32Array(128);
    private readonly rev = new Reverb(sampleRate);
    private revOn = false;
    constructor() {
      super();
      for (const [n, t] of Object.entries(DRUM_TONES)) this.synth.drums.set(Number(n), t);
      this.port.onmessage = (e: MessageEvent<SynthMsg>) => this.recv(e.data);
    }
    private recv(m: SynthMsg): void {
      const s = this.synth;
      if (m.type === 'gm') {
        this.gm[m.prog] = m.tone;
        for (let k = 0; k < PARTS; k++) if (k !== DRUM_PART && this.prog[k] === m.prog) s.parts[k].tone = m.tone;
      } else if (m.type === 'drum') s.drums.set(m.note, m.tone);
      else if (m.type === 'part') {
        const p = s.parts[m.part];
        p.vol = m.vol;
        p.pan = m.pan;
        p.mute = m.mute;
        p.rev = m.rev;
      } else if (m.type === 'room') {
        /* 送った音には残響音だけを足す。残響音の大きさは送る量で決めるので、wet は 1、直接音の調整（norm）は使わない */
        this.rev.set({ ...m.spec, norm: 1, wet: 1 });
        this.revOn = !m.spec.off;
      } else if (m.type === 'panic') s.panic();
      else if (m.type === 'stop') {
        this.queue = [];
        s.allOff(undefined, 0);
        for (let k = 0; k < PARTS; k++) {
          s.cc(k, 121, 0);
          s.bend(k, 0);
        }
      } else if (m.at <= 0) this.run(m.e, m.src);
      else {
        const q = this.queue;
        let i = q.length;
        while (i > 0 && q[i - 1].at > m.at) i--;
        q.splice(i, 0, { at: m.at, src: m.src, e: m.e });
      }
    }
    private run(e: SynthEv, src: Src): void {
      const s = this.synth;
      if (e.k === ON) s.noteOn(e.ch, e.a, e.v / 127, src);
      else if (e.k === OFF) s.noteOff(e.ch, e.a, src);
      else if (e.k === PC) {
        if (e.ch === DRUM_PART) return;
        this.prog[e.ch] = e.a;
        s.parts[e.ch].tone = this.gm[e.a];
      } else if (e.k === CC) s.cc(e.ch, e.a, e.v);
      else if (e.k === BEND) s.bend(e.ch, e.v);
    }
    process(_in: Float32Array[][], outputs: Float32Array[][]): boolean {
      const out = outputs[0];
      if (!out.length) return true;
      const len = out[0].length,
        t = currentTime + len / sampleRate,
        q = this.queue;
      let k = 0;
      for (; k < q.length && q[k].at <= t; k++) this.run(q[k].e, q[k].src);
      if (k) q.splice(0, k);
      if (this.L.length < len)
        for (const k of ['L', 'R', 'SL', 'SR', 'WL', 'WR'] as const) this[k] = new Float32Array(len);
      const { L, R, SL, SR, WL, WR } = this;
      this.synth.render(L, R, len, SL, SR);
      if (this.revOn) {
        /* 残響は送った音の写しに掛け、写しとの差（残響音だけ）を直接音に足す */
        WL.set(SL.subarray(0, len));
        WR.set(SR.subarray(0, len));
        this.rev.process(WL, WR, 0, len);
        for (let i = 0; i < len; i++) {
          L[i] += WL[i] - SL[i];
          R[i] += WR[i] - SR[i];
        }
      }
      out[0].set(L.subarray(0, len));
      if (out.length > 1) out[1].set(R.subarray(0, len));
      return true;
    }
  },
);
