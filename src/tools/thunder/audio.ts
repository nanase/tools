/**
 * 雷鳴のページの音を鳴らす: 作った波形（音圧 [Pa]）を AudioBufferSourceNode で流す。
 * 光った時刻を決めてから、届くまでの時間だけ待って鳴らす（待たずに鳴らすこともできる）
 */

/** 鳴らし直すときに前の音を消す時間 [s] */
const FADE = 0.05;
/** 光るまでの余裕 [s] */
const LEAD = 0.05;

/** 大きさの合わせ方: 波形の最大をそろえる・距離による差を残す（基準の音圧 ref [Pa] を 0 dBFS の 1/4 にする） */
export type Level = { kind: 'peak' } | { kind: 'abs'; ref: number };

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
      this.out.connect(c.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** 先に AudioContext を作る（標本化周波数を知るため。押した操作の中で呼ぶ） */
  open(): number {
    return this.context().sampleRate;
  }

  /**
   * 波形 y [Pa]（標本化周波数 fs）を鳴らす。y[0] は光ってから wait [s] 後。
   * 戻り値は光った時刻（AudioContext の目盛り [s]）
   */
  play(y: Float32Array, fs: number, wait: number, peak: number, lv: Level, vol: number): number {
    const c = this.context(),
      flash = c.currentTime + LEAD,
      buf = c.createBuffer(1, y.length, fs);
    this.stop();
    buf.copyToChannel(y as Float32Array<ArrayBuffer>, 0);
    const s = c.createBufferSource(),
      g = c.createGain(),
      scale = lv.kind === 'peak' ? 0.5 / Math.max(peak, 1e-9) : 0.25 / lv.ref;
    s.buffer = buf;
    s.connect(g);
    g.gain.value = scale * 10 ** (vol / 20);
    g.connect(this.out as GainNode);
    s.start(flash + Math.max(0, wait));
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
