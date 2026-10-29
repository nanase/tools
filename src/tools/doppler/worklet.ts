/**
 * ドップラー効果の音を作る AudioWorklet。audio.ts が ?worker&url で読み込み、'doppler' として使う。
 * 音源の音を作り（sources.ts）、Propagator で聞き手の位置の音圧 [Pa] にして出す（音量は主スレッドの GainNode）。
 * 音源と聞き手の位置は主スレッドが AudioContext の時刻つきで送り、ここでは LAG だけ遅らせて直線で補間する
 * （主スレッドの描画の間隔がばらついても、位置の動きをなめらかにするため）
 */
import { Propagator, type PropSet, TICK } from './prop';
import { makeSource, type Source, type SourceId, Tone } from './sources';

declare const sampleRate: number;
declare const currentTime: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

/** 位置を遅らせる時間 [s] */
export const LAG = 0.05;

/** 位置の知らせ: AudioContext の時刻 [s]、音源と聞き手の位置 [m]、瞬間移動か、音源の速さ [m/s] */
export interface PosMsg {
  type: 'pos';
  t: number;
  sx: number;
  sy: number;
  lx: number;
  ly: number;
  jump?: boolean;
  v: number;
}

/** 主スレッドから送るもの */
export type DopMsg =
  | { type: 'init'; src: SourceId; set: PropSet; tone?: number }
  | { type: 'set'; set: PropSet }
  | { type: 'tone'; f: number }
  | PosMsg
  | { type: 'stop' };

registerProcessor(
  'doppler',
  class extends AudioWorkletProcessor {
    private p: Propagator | null = null;
    private src: Source | null = null;
    private q: PosMsg[] = [];
    private s = new Float32Array(TICK);
    private o = new Float32Array(TICK);
    /** 次の刻みの位置が瞬間移動か（送られた知らせの間に jump があった） */
    private jump = false;
    constructor() {
      super();
      this.port.onmessage = (ev: MessageEvent<DopMsg>) => {
        const m = ev.data;
        if (m.type === 'init') {
          this.src = makeSource(m.src, sampleRate);
          if (m.tone && this.src instanceof Tone) this.src.f = m.tone;
          this.p = new Propagator(sampleRate, 4, { ...m.set, r0: this.src.spec.r0 });
          this.q = [];
        } else if (m.type === 'set') {
          if (this.p && this.src) this.p.setAir({ ...m.set, r0: this.src.spec.r0 });
        } else if (m.type === 'tone') {
          if (this.src instanceof Tone) this.src.f = m.f;
        } else if (m.type === 'pos') {
          this.q.push(m);
          if (this.q.length > 64) this.q.shift();
        } else {
          this.p = null;
          this.src = null;
        }
      };
    }
    /** 時刻 t の位置（知らせの間を直線で補間。瞬間移動の知らせの前後は補間しない） */
    private posAt(t: number): PosMsg | null {
      const q = this.q;
      if (!q.length) return null;
      while (q.length > 1 && q[1].t <= t) {
        if (q[1].jump) this.jump = true;
        q.shift();
      }
      const a = q[0],
        b = q[1];
      if (!b || b.jump || t <= a.t) return a;
      const u = (t - a.t) / (b.t - a.t);
      return {
        type: 'pos',
        t,
        sx: a.sx + u * (b.sx - a.sx),
        sy: a.sy + u * (b.sy - a.sy),
        lx: a.lx + u * (b.lx - a.lx),
        ly: a.ly + u * (b.ly - a.ly),
        v: a.v + u * (b.v - a.v),
      };
    }
    process(_in: Float32Array[][], outputs: Float32Array[][]): boolean {
      const out = outputs[0];
      if (!out.length) return true;
      const ch = out[0],
        p = this.p,
        src = this.src;
      if (!p || !src) {
        ch.fill(0);
      } else {
        for (let off = 0; off < ch.length; off += TICK) {
          const pos = this.posAt(currentTime + off / sampleRate - LAG);
          if (!pos) {
            ch.fill(0, off, off + TICK);
            continue;
          }
          src.speed(pos.v);
          for (let j = 0; j < TICK; j++) this.s[j] = src.step();
          p.advance(this.s, pos.sx, pos.sy, this.jump, pos.lx, pos.ly, this.o);
          this.jump = false;
          ch.set(this.o, off);
        }
      }
      for (let c = 1; c < out.length; c++) out[c].set(ch);
      return true;
    }
  },
);
