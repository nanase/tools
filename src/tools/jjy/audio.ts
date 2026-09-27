/**
 * JJY の信号を Web Audio API で鳴らす。
 * 発振器 → 包絡線（高 1・低 0.1）→ 音量 → 計測 → 出力。包絡線の変化は先読みして予約する
 */
import { LOW, type Signal } from './code';

/** 時刻合わせの搬送波: 13.333 kHz の矩形波の第 3 高調波が 40 kHz になる */
export const SYNC_F = 40000 / 3;
/** 先読みする長さ（ms）と、振幅を変える時定数（s） */
const AHEAD = 600,
  TC = 0.004;

type Ctor = typeof AudioContext;
const AC: Ctor | undefined =
  globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;

export interface Clock {
  /** 表示している時刻（UTC のミリ秒） */
  now(): number;
  /** 時刻を止めているか */
  frozen(): boolean;
}

export class JjyAudio {
  play = false;
  mode: 'tone' | 'sync' = 'tone';
  /** 可聴音の周波数（Hz）と音量（%） */
  freq = 440;
  vol = 50;
  private ac: AudioContext | null = null;
  private osc: OscillatorNode | null = null;
  private env: GainNode | null = null;
  private master: GainNode | null = null;
  private an: AnalyserNode | null = null;
  private buf = new Float32Array(1024);
  /** 包絡線を予約し終えた時刻（表示時刻の ms） */
  private schedTo: number | null = null;

  constructor(
    private readonly sig: Signal,
    private readonly clock: Clock,
  ) {
    setInterval(() => this.pump(), 100);
  }

  /** 出力のサンプリング周波数。まだ鳴らしていなければ null */
  get sampleRate(): number | null {
    return this.ac?.sampleRate ?? null;
  }

  private ensure(): AudioContext | null {
    if (this.ac || !AC) return this.ac;
    const ac = new AC(),
      osc = ac.createOscillator(),
      env = ac.createGain(),
      master = ac.createGain(),
      an = ac.createAnalyser();
    an.fftSize = this.buf.length;
    env.gain.value = 0;
    master.gain.value = 0;
    osc.connect(env).connect(master).connect(an).connect(ac.destination);
    osc.start();
    this.ac = ac;
    this.osc = osc;
    this.env = env;
    this.master = master;
    this.an = an;
    return ac;
  }

  /** 音の種類・周波数・音量を反映する */
  params(): void {
    const { ac, osc, master } = this;
    if (!ac || !osc || !master) return;
    const sync = this.mode === 'sync',
      now = ac.currentTime;
    osc.type = sync ? 'square' : 'sine';
    osc.frequency.setValueAtTime(sync ? SYNC_F : this.freq, now);
    master.gain.setTargetAtTime(this.play ? this.vol / 100 : 0, now, 0.015);
  }

  private latency(): number {
    return this.ac ? this.ac.outputLatency || this.ac.baseLatency || 0 : 0;
  }

  /** 予約を捨てて、今の時刻から組み直す（時刻や送出する情報を変えたとき） */
  resync(): void {
    const { ac, env } = this;
    if (!ac || !env || !this.play) return;
    const now = ac.currentTime;
    env.gain.cancelScheduledValues(now);
    if (this.clock.frozen()) {
      env.gain.setTargetAtTime(0, now, TC);
      this.schedTo = null;
      return;
    }
    const t = this.clock.now();
    env.gain.setTargetAtTime(this.sig.level(t), now, TC);
    this.schedTo = t;
    this.pump();
  }

  /** AHEAD ms 先までの振幅の変化を予約する */
  private pump(): void {
    const { ac, env } = this;
    if (!ac || !env || !this.play || this.clock.frozen() || this.schedTo == null) return;
    const t = this.clock.now(),
      to = t + AHEAD,
      now = ac.currentTime,
      L = this.latency();
    /* タブが裏にあって予約が途切れていたら組み直す */
    if (this.schedTo < t - 1000) {
      this.resync();
      return;
    }
    for (let m = Math.floor(this.schedTo / 60000) * 60000; m < to; m += 60000)
      for (const [a, b] of this.sig.minute(m).H)
        for (const [u, lv] of [
          [m + a * 1000, 1],
          [m + b * 1000, LOW],
        ])
          if (u >= this.schedTo && u < to) env.gain.setTargetAtTime(lv, Math.max(now, now + (u - t) / 1000 - L), TC);
    this.schedTo = to;
  }

  /** 再生・停止。再生を始められたら true */
  async setPlay(on: boolean): Promise<boolean> {
    let ok = true;
    if (on) {
      const ac = this.ensure();
      if (ac) {
        try {
          await ac.resume();
        } catch {
          /* 再生できない環境 */
        }
      }
      ok = ac?.state === 'running';
      this.play = true;
    } else this.play = false;
    this.params();
    const { ac, env } = this;
    if (this.play) this.resync();
    else if (ac && env) {
      env.gain.cancelScheduledValues(ac.currentTime);
      env.gain.setTargetAtTime(0, ac.currentTime, TC);
      this.schedTo = null;
      setTimeout(() => {
        if (!this.play) ac.suspend();
      }, 200);
    }
    return ok;
  }

  /**
   * 信号の強さ（0〜1）: -30〜-10 dBFS の RMS を割り当てる（旧実装の SignalIndicator と同じ範囲）。
   * 鳴らしていなければ 0
   */
  meter(): number {
    const { an, buf } = this;
    if (!an || !this.play) return 0;
    an.getFloatTimeDomainData(buf);
    let s = 0;
    for (const x of buf) s += x * x;
    const db = 10 * Math.log10(s / buf.length + 1e-12);
    return Math.max(0, Math.min(1, (db + 30) / 20));
  }
}
