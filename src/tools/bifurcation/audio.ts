/**
 * 値の列を Web Audio API で鳴らす: AudioWorklet（worklet.ts）→ 音量 → 出力。
 * 鳴らしている間に送った条件（r・写像・音の種類）は、次の処理の区切り（128 標本）から効く
 */
import type { SoundParams } from './sound';
import workletUrl from './worklet.ts?worker&url';

type Ctor = typeof AudioContext;
const AC: Ctor | undefined =
  globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;

export class MapAudio {
  on = false;
  private ac: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private master: GainNode | null = null;
  private loading: Promise<boolean> | null = null;
  private msg: SoundParams | null = null;
  /** 音量（dB、0 dB = フルスケール） */
  private db = -18;
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** AudioContext は押した操作の中で作る（自動再生の制限） */
  private ensure(): Promise<boolean> {
    if (this.node) return Promise.resolve(true);
    if (!AC) return Promise.resolve(false);
    const ac = this.ac ?? new AC();
    this.ac = ac;
    this.loading ??= ac.audioWorklet
      .addModule(workletUrl)
      .then(() => {
        const node = new AudioWorkletNode(ac, 'bifurcation', { numberOfInputs: 0, outputChannelCount: [1] }),
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

  /** 鳴らす条件を送る */
  send(p: SoundParams): void {
    this.msg = { ...p };
    this.node?.port.postMessage(this.msg);
  }

  /** 音量を変える */
  vol(db: number): void {
    this.db = db;
    this.gain();
  }

  private gain(): void {
    const { ac, master } = this;
    if (ac && master) master.gain.setTargetAtTime(this.on ? 10 ** (this.db / 20) : 0, ac.currentTime, 0.008);
  }

  /** 鳴らす・止める。鳴らせなかったら false */
  async set(on: boolean): Promise<boolean> {
    this.on = on;
    clearTimeout(this.timer);
    if (!on) {
      this.gain();
      const { ac } = this;
      this.timer = setTimeout(() => {
        if (!this.on) void ac?.suspend();
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
}
