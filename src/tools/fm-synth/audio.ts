/**
 * FM 音源を Web Audio API で鳴らす: AudioWorklet（worklet.ts）→ 音量 → 出力。
 * 鳴らし続ける（再生ボタン、latch）か、鍵盤を押している間（hold）に鳴らす
 */
import type { Patch } from './synth';
import type { FmMsg } from './worklet';
import workletUrl from './worklet.ts?worker&url';

type Ctor = typeof AudioContext;
const AC: Ctor | undefined =
  globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;

export class FmAudio {
  /** 再生ボタンで鳴らし続けているか */
  latch = false;
  /** 鍵盤を押しているか */
  held = false;
  private ac: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private master: GainNode | null = null;
  private loading: Promise<boolean> | null = null;
  private msg: FmMsg | null = null;
  /** 音量（dB、0 dB = フルスケール） */
  private db = -30;
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** 鳴っているか */
  get play(): boolean {
    return this.latch || this.held;
  }

  /** AudioContext は押した操作の中で作る（自動再生の制限） */
  private ensure(): Promise<boolean> {
    if (this.node) return Promise.resolve(true);
    if (!AC) return Promise.resolve(false);
    const ac = this.ac ?? new AC();
    this.ac = ac;
    this.loading ??= ac.audioWorklet
      .addModule(workletUrl)
      .then(() => {
        const node = new AudioWorkletNode(ac, 'fm-synth', { numberOfInputs: 0, outputChannelCount: [1] }),
          master = ac.createGain();
        master.gain.value = 0;
        node.connect(master).connect(ac.destination);
        this.node = node;
        this.master = master;
        if (this.msg) node.port.postMessage(this.msg);
        return true;
      })
      .catch(() => false);
    return this.loading;
  }

  /** 音色と基本周波数を送る */
  send(p: Patch, f0: number): void {
    this.msg = { p, f0 };
    this.node?.port.postMessage(this.msg);
  }

  /** 音量を変える */
  vol(db: number): void {
    this.db = db;
    this.gain();
  }

  private gain(): void {
    const { ac, master } = this;
    if (ac && master) master.gain.setTargetAtTime(this.play ? 10 ** (this.db / 20) : 0, ac.currentTime, 0.008);
  }

  /** latch・held を変えたあとに、鳴らす・止める。鳴らせなかったら false */
  private async apply(): Promise<boolean> {
    clearTimeout(this.timer);
    if (!this.play) {
      this.gain();
      const { ac } = this;
      this.timer = setTimeout(() => {
        if (!this.play) void ac?.suspend();
      }, 300);
      return true;
    }
    if (!(await this.ensure()) || !this.ac) return false;
    try {
      await this.ac.resume();
    } catch {
      /* 再生できない環境 */
    }
    if (this.ac.state !== 'running') return false;
    this.gain();
    return true;
  }

  /** 鳴らし続ける・止める */
  setLatch(on: boolean): Promise<boolean> {
    this.latch = on;
    return this.apply();
  }

  /** 鍵盤を押した・離した */
  setHold(on: boolean): Promise<boolean> {
    this.held = on;
    return this.apply();
  }
}
