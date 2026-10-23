/**
 * 和音の音: 部分音ごとの正弦波を足す（Web Audio の OscillatorNode）。すべての部分音を同じ時刻に位相 0 で始めるので、
 * うなりの包絡は鳴り始め（start の戻り値）で最大になる。オルガンと正弦波は鳴らし続け、ピアノは部分音ごとに減衰する
 */
import type { Note, Timbre } from './tem';

/** 鳴らし直すときに前の音を消す時間 [s] */
const FADE = 0.04;
/** 鳴り始めまでの余裕 [s] */
const LEAD = 0.05;

interface Voice {
  g: GainNode;
  o: OscillatorNode[];
}

export class Synth {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private vs: Voice[] = [];

  private context(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.out = this.ctx.createGain();
      this.out.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** 鳴っている音を消す */
  stop(fade = FADE): void {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    for (const v of this.vs) {
      v.g.gain.cancelScheduledValues(t);
      v.g.gain.setValueAtTime(v.g.gain.value, t);
      v.g.gain.linearRampToValueAtTime(0, t + fade);
      for (const o of v.o) o.stop(t + fade + 0.02);
    }
    this.vs = [];
  }

  /**
   * notes の部分音を鳴らす。音量 vol [dB] は、全部分音の振幅の和（波形の最大）を 0 dB にした大きさ。
   * 戻り値は鳴り始めの時刻（performance.now() の目盛り [ms]）
   */
  start(notes: readonly Note[], tb: Timbre, vol: number): number {
    const c = this.context(),
      out = this.out as GainNode;
    this.stop();
    const t = c.currentTime + LEAD;
    let sum = 0;
    for (const n of notes) for (const p of n.parts) sum += p.a;
    out.gain.setValueAtTime(10 ** (vol / 20) / Math.max(1, sum), t);
    for (const n of notes) {
      const g = c.createGain(),
        os: OscillatorNode[] = [];
      g.connect(out);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + (tb === 'piano' ? 0.004 : 0.04));
      for (const p of n.parts) {
        if (p.f >= c.sampleRate / 2) continue;
        const o = c.createOscillator(),
          pg = c.createGain();
        o.frequency.value = p.f;
        pg.gain.setValueAtTime(p.a, t);
        /* ピアノ: 高い部分音ほど速く減衰する（C5 より上は全体に速い） */
        if (tb === 'piano') pg.gain.setTargetAtTime(0, t + 0.01, (n.m > 72 ? 2.2 : 4) / (1 + 0.18 * p.n));
        o.connect(pg);
        pg.connect(g);
        o.start(t);
        os.push(o);
      }
      this.vs.push({ g, o: os });
    }
    return performance.now() + (t - c.currentTime) * 1000;
  }
}
