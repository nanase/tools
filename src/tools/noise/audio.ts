/**
 * ノイズを Web Audio API で鳴らす: AudioWorklet（worklet.ts）→ 音量 → 出力。
 * 標本化周波数は、生成の条件を作った 48 kHz に合わせる（できない環境では既定の値）。
 * AudioWorklet が送り返す音を onData に渡す
 */
import type { Spec } from './gen';
import type { NoiseMsg, NoiseOut } from './worklet';
import workletUrl from './worklet.ts?worker&url';

type Ctor = typeof AudioContext;
const AC: Ctor | undefined =
  globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;

/** 鳴らす標本化周波数 */
export const AFS = 48000;

export class NoiseAudio {
  /** 鳴らしているか */
  playing = false;
  /** 送り返された音（v は条件の版） */
  onData: (b: Float32Array, v: number) => void = () => {};
  private ac: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private master: GainNode | null = null;
  private loading: Promise<boolean> | null = null;
  private msg: NoiseMsg | null = null;
  private db = -30;
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** AudioContext の標本化周波数（まだ作っていなければ null） */
  get fs(): number | null {
    return this.ac?.sampleRate ?? null;
  }

  /** AudioContext は押した操作の中で作る（自動再生の制限） */
  private ensure(): Promise<boolean> {
    if (this.node) return Promise.resolve(true);
    if (!AC) return Promise.resolve(false);
    if (!this.ac)
      try {
        this.ac = new AC({ sampleRate: AFS });
      } catch {
        this.ac = new AC();
      }
    const ac = this.ac;
    this.loading ??= ac.audioWorklet
      .addModule(workletUrl)
      .then(() => {
        const node = new AudioWorkletNode(ac, 'noise-gen', { numberOfInputs: 0, outputChannelCount: [2] }),
          master = ac.createGain();
        master.gain.value = 0;
        node.connect(master).connect(ac.destination);
        node.port.onmessage = (e: MessageEvent<NoiseOut>) => {
          if (this.playing) this.onData(e.data.b, e.data.v);
        };
        this.node = node;
        this.master = master;
        if (this.msg) node.port.postMessage(this.msg);
        return true;
      })
      .catch(() => false);
    return this.loading;
  }

  /** 生成の条件を送る（版 v を付ける） */
  send(sp: Spec, v: number): void {
    this.msg = { sp, v, seed: Math.floor(Math.random() * 2 ** 32) };
    this.node?.port.postMessage(this.msg);
  }

  vol(db: number): void {
    this.db = db;
    this.gain();
  }

  private gain(): void {
    const { ac, master } = this;
    if (ac && master) master.gain.setTargetAtTime(this.playing ? 10 ** (this.db / 20) : 0, ac.currentTime, 0.008);
  }

  /** 鳴らす・止める。鳴らせなかったら false */
  async setPlay(on: boolean): Promise<boolean> {
    clearTimeout(this.timer);
    if (!on) {
      this.playing = false;
      this.gain();
      const { ac } = this;
      this.timer = setTimeout(() => {
        if (!this.playing) void ac?.suspend();
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
    this.playing = true;
    this.gain();
    return true;
  }
}
