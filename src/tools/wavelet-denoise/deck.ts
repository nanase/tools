/**
 * 聴き比べの再生: どの音も同じ時刻から繰り返して鳴らし、音量だけを切り替える。
 * 切り替えても位置は変わらず、10 ms ほどで音量を入れ替える
 */

type Ctor = typeof AudioContext;
const AC: Ctor | undefined =
  globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;

/** 鳴らし始めるまでの余裕 [s] */
const LEAD = 0.03;

export class Deck {
  private a: AudioContext | null = null;
  private srcs: AudioBufferSourceNode[] = [];
  private gains: GainNode[] = [];
  private bufs: Float32Array[] = [];
  private fs = 48000;
  private t0 = 0;
  private off = 0;
  /** 聴いている音の番号 */
  sel = 0;
  playing = false;
  onState: () => void = () => {};

  ctx(): AudioContext | null {
    if (!this.a && AC) this.a = new AC();
    return this.a;
  }
  /** 1 周の長さ [s] */
  get dur(): number {
    return this.bufs.length ? this.bufs[0].length / this.fs : 0;
  }
  /** 今の位置 [s] */
  pos(): number {
    const a = this.a,
      d = this.dur;
    if (!this.playing || !a || !d) return this.off;
    return (((a.currentTime - this.t0) % d) + d) % d;
  }
  /** 鳴らす音を入れ替える（鳴っていれば同じ位置から続ける） */
  set(bufs: Float32Array[], fs: number): void {
    const was = this.playing,
      p = this.pos();
    this.halt();
    this.bufs = bufs;
    this.fs = fs;
    this.off = Math.min(p, this.dur);
    if (this.sel >= bufs.length) this.sel = 0;
    if (was) void this.play(this.off);
    else this.onState();
  }
  async play(from = this.off): Promise<void> {
    const a = this.ctx();
    if (!a || !this.bufs.length) return;
    try {
      await a.resume();
    } catch {
      /* 鳴らし始められない環境 */
    }
    this.halt();
    const at = a.currentTime + LEAD;
    this.t0 = at - from;
    this.srcs = this.bufs.map((x, i) => {
      const b = a.createBuffer(1, x.length, this.fs);
      b.copyToChannel(x as Float32Array<ArrayBuffer>, 0);
      const s = a.createBufferSource(),
        g = a.createGain();
      s.buffer = b;
      s.loop = true;
      g.gain.value = i === this.sel ? 1 : 0;
      s.connect(g).connect(a.destination);
      s.start(at, Math.min(from, b.duration));
      this.gains[i] = g;
      return s;
    });
    this.playing = true;
    this.onState();
  }
  private halt(): void {
    for (const s of this.srcs) {
      try {
        s.stop();
      } catch {
        /* 止まっている */
      }
      s.disconnect();
    }
    this.srcs = [];
    this.gains = [];
    this.playing = false;
  }
  pause(): void {
    if (!this.playing) return;
    this.off = this.pos();
    this.halt();
    this.onState();
  }
  toggle(): void {
    if (this.playing) this.pause();
    else void this.play();
  }
  seek(t: number): void {
    this.off = Math.max(0, Math.min(this.dur, t));
    if (this.playing) void this.play(this.off);
    else this.onState();
  }
  select(i: number): void {
    this.sel = i;
    const a = this.a;
    if (a && this.playing)
      this.gains.forEach((g, j) => {
        g.gain.setTargetAtTime(j === i ? 1 : 0, a.currentTime, 0.003);
      });
    this.onState();
  }
  /** 画面が隠れたとき（スマートフォン）: 止めて AudioContext も休ませる */
  suspend(): void {
    this.pause();
    void this.a?.suspend().catch(() => {});
  }
}
