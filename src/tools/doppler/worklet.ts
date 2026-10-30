/**
 * ドップラー効果の音を作る AudioWorklet。audio.ts が ?worker&url で読み込み、'doppler' として使う。
 * 音源の音を作り（sources.ts）、Propagator で聞き手の位置の音圧 [Pa] にして出す（音量は主スレッドの GainNode）。
 * 音源と聞き手の動きは、主スレッドが AudioContext の時刻つきの「節目」（その時刻の位置と速度）で送る。
 * 節目の間は速度で延ばして位置を決めるので、描画の間隔がばらついても動きはなめらかなまま。
 * ドラッグ中は描画ごとに節目が来るので、LAG だけ遅らせて節目の間を直線で補間する
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

/**
 * 動きの節目: AudioContext の時刻 [s]、その時刻の音源と聞き手の位置 [m]、x の向きの速度 [m/s]。
 * jump は音源の瞬間移動（道路の端から端へ）、cut は前の節目から補間しない（聞き手の瞬間移動を含む）、
 * pre は先の予定（折り返し）で、時刻の順に差し込む。pre でない節目は、それより先の予定を消す（動きが変わったため）
 */
export interface PosMsg {
  type: 'pos';
  t: number;
  sx: number;
  sy: number;
  lx: number;
  ly: number;
  v: number;
  u: number;
  jump?: boolean;
  cut?: boolean;
  pre?: boolean;
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
    private p0: PosMsg = { type: 'pos', t: 0, sx: 0, sy: 0, lx: 0, ly: 0, v: 0, u: 0 };
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
          const q = this.q;
          if (m.pre) {
            let i = q.length;
            while (i > 0 && q[i - 1].t > m.t) i--;
            q.splice(i, 0, m);
          } else {
            while (q.length && q[q.length - 1].t > m.t) q.pop();
            q.push(m);
          }
          if (q.length > 64) q.shift();
        } else {
          this.p = null;
          this.src = null;
        }
      };
    }
    /** 時刻 t の位置: 次の節目まで直線で補間する。次がない・cut なら、前の節目から速度で延ばす */
    private posAt(t: number): PosMsg | null {
      const q = this.q;
      if (!q.length) return null;
      while (q.length > 1 && q[1].t <= t) {
        if (q[1].jump) this.jump = true;
        q.shift();
      }
      const a = q[0],
        b = q[1],
        p = this.p0;
      p.t = t;
      if (b && !b.cut && t > a.t) {
        const w = (t - a.t) / (b.t - a.t);
        p.sx = a.sx + w * (b.sx - a.sx);
        p.sy = a.sy + w * (b.sy - a.sy);
        p.lx = a.lx + w * (b.lx - a.lx);
        p.ly = a.ly + w * (b.ly - a.ly);
        p.v = a.v + w * (b.v - a.v);
      } else {
        const dt = Math.max(0, t - a.t);
        p.sx = a.sx + a.v * dt;
        p.sy = a.sy;
        p.lx = a.lx + a.u * dt;
        p.ly = a.ly;
        p.v = a.v;
      }
      return p;
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
