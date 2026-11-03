/**
 * 聴き比べの再生: 選んだ音を同じ時刻から繰り返して鳴らす。音を替えるときは位置を保ったまま 12 ms で入れ替えるので、
 * 値をドラッグしている間も音が途切れない
 */
import { mod } from './pcm';

type Ctor = typeof AudioContext;
const AC: Ctor | undefined =
  globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;

/** 鳴らし始めるまでの余裕と、入れ替えの時間 [s] */
const LEAD = 0.012,
  FADE = 0.012;

export class Deck {
  private a: AudioContext | null = null;
  private master: GainNode | null = null;
  private src: AudioBufferSourceNode | null = null;
  private g: GainNode | null = null;
  private tracks: Float32Array[] = [];
  private fs = 48000;
  private t0 = 0;
  private off = 0;
  private vol = 0.1;
  sel = 3;
  playing = false;
  onState: () => void = () => {};

  ctx(): AudioContext | null {
    if (!this.a && AC) this.a = new AC();
    return this.a;
  }
  /** 1 周の長さ [s] */
  get dur(): number {
    return this.tracks.length ? this.tracks[0].length / this.fs : 0;
  }
  /** 今の位置 [s] */
  pos(): number {
    const a = this.a,
      d = this.dur;
    if (!this.playing || !a || !d) return this.off;
    return mod(a.currentTime - this.t0, d);
  }
  /** 今鳴らす列 */
  get cur(): Float32Array | null {
    return this.tracks[this.sel] ?? null;
  }
  set(tracks: Float32Array[], fs: number): void {
    const p = this.pos();
    this.tracks = tracks;
    this.fs = fs;
    this.off = Math.min(p, this.dur);
    if (this.playing) this.voice();
    this.onState();
  }
  volume(db: number): void {
    this.vol = 10 ** (db / 20);
    if (this.a && this.master) this.master.gain.setTargetAtTime(this.vol, this.a.currentTime, 0.01);
  }
  /** 今の列の音を鳴らし始め、前の音と入れ替える */
  private voice(): void {
    const a = this.a,
      x = this.cur;
    if (!a || !x || !this.master) return;
    const b = a.createBuffer(1, x.length, this.fs);
    b.copyToChannel(x as Float32Array<ArrayBuffer>, 0);
    const s = a.createBufferSource(),
      g = a.createGain(),
      t = a.currentTime + LEAD;
    s.buffer = b;
    s.loop = true;
    s.connect(g).connect(this.master);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + FADE);
    s.start(t, mod(t - this.t0, this.dur));
    this.fadeOut(t);
    this.src = s;
    this.g = g;
  }
  private fadeOut(t: number): void {
    if (!this.src || !this.g) return;
    this.g.gain.setValueAtTime(1, t);
    this.g.gain.linearRampToValueAtTime(0, t + FADE);
    this.src.stop(t + FADE * 2);
    this.src = null;
    this.g = null;
  }
  async play(): Promise<void> {
    const a = this.ctx();
    if (!a || !this.tracks.length) return;
    if (!this.master) {
      this.master = a.createGain();
      this.master.gain.value = this.vol;
      this.master.connect(a.destination);
    }
    try {
      await a.resume();
    } catch {
      /* 鳴らし始められない環境 */
    }
    this.t0 = a.currentTime - this.off;
    this.playing = true;
    this.voice();
    this.onState();
  }
  pause(): void {
    if (!this.playing) return;
    this.off = this.pos();
    this.playing = false;
    if (this.a) this.fadeOut(this.a.currentTime);
    this.onState();
  }
  toggle(): void {
    if (this.playing) this.pause();
    else void this.play();
  }
  seek(t: number): void {
    this.off = Math.max(0, Math.min(this.dur, t));
    if (this.playing && this.a) {
      this.t0 = this.a.currentTime - this.off;
      this.voice();
    }
    this.onState();
  }
  select(i: number): void {
    this.sel = i;
    if (this.playing) this.voice();
    this.onState();
  }
  /** 画面が隠れたとき（スマートフォン）: 止めて AudioContext も休ませる */
  suspend(): void {
    this.pause();
    void this.a?.suspend().catch(() => {});
  }
}
