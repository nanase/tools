/**
 * 雷鳴のページの音を鳴らす: 作った左右の波形（音圧 [Pa]）を AudioBufferSourceNode で流す。
 * 光った時刻を決めてから、届くまでの時間だけ待って鳴らす（待たずに・途中から鳴らすこともできる）。
 * 出口に速いリミッターを置き、近い雷の「バリッ」の山だけを抑える
 */

/** 鳴らし直すときに前の音を消す時間 [s] */
const FADE = 0.05;
/** 光るまでの余裕 [s] */
const LEAD = 0.05;

export class ThunderAudio {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private live: { s: AudioBufferSourceNode; g: GainNode }[] = [];

  get fs(): number {
    return this.ctx?.sampleRate ?? 48000;
  }

  private context(): AudioContext {
    if (!this.ctx) {
      const c = new AudioContext();
      this.ctx = c;
      this.out = c.createGain();
      const lim = c.createDynamicsCompressor();
      lim.threshold.value = -3;
      lim.knee.value = 0;
      lim.ratio.value = 20;
      lim.attack.value = 0.001;
      lim.release.value = 0.2;
      this.out.connect(lim).connect(c.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** 先に AudioContext を作る（標本化周波数を知るため。押した操作の中で呼ぶ） */
  open(): number {
    return this.context().sampleRate;
  }

  /**
   * 左右の波形 yl・yr [Pa]（標本化周波数 fs）を gain 倍して鳴らす。y[0] は光ってから wait [s] 後（負なら途中から）。
   * 戻り値は光った時刻（AudioContext の目盛り [s]）
   */
  play(yl: Float32Array, yr: Float32Array, fs: number, wait: number, gain: number): number {
    const c = this.context(),
      flash = c.currentTime + LEAD,
      buf = c.createBuffer(2, yl.length, fs);
    this.stop();
    buf.copyToChannel(yl as Float32Array<ArrayBuffer>, 0);
    buf.copyToChannel(yr as Float32Array<ArrayBuffer>, 1);
    const s = c.createBufferSource(),
      g = c.createGain();
    s.buffer = buf;
    s.connect(g);
    g.gain.value = gain;
    g.connect(this.out as GainNode);
    if (wait >= 0) s.start(flash + wait);
    else s.start(flash, -wait);
    const item = { s, g };
    this.live.push(item);
    s.onended = () => {
      this.live = this.live.filter((u) => u !== item);
    };
    return flash;
  }

  stop(fade = FADE): void {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    for (const { s, g } of this.live) {
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0, t + fade);
      s.stop(t + fade + 0.01);
    }
    this.live = [];
  }

  /** 鳴らしている音の大きさを変える（音量を動かしたとき） */
  gain(v: number): void {
    const c = this.ctx;
    if (!c) return;
    for (const { g } of this.live) g.gain.setTargetAtTime(v, c.currentTime, 0.02);
  }

  /** 今の時刻（AudioContext の目盛り [s]） */
  now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /** 画面が隠れたら止める（スリープの後に時計が先走らないように） */
  suspend(): void {
    this.stop(0.005);
    void this.ctx?.suspend();
  }
}
