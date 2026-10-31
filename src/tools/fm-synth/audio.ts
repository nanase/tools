/**
 * FM 音源を Web Audio API で鳴らす: AudioWorklet（worklet.ts）→ 音量 → リミッタ → 出力。
 * 鍵盤と再生ボタンの音は、鳴らし続ける（再生ボタン、latch）か、鍵盤を押している間（hold）に鳴らす。
 * 曲の音は AudioContext の時刻で予約する。何も鳴らしていない間は AudioContext を止めて CPU を休ませる
 */
import type { Patch } from './synth';
import type { FmMsg } from './worklet';
import workletUrl from './worklet.ts?worker&url';

type Ctor = typeof AudioContext;
const AC: Ctor | undefined =
  globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;

/** 最後の音を離してから AudioContext を止めるまでの時間 [ms] */
const IDLE_MS = 300;

export class FmAudio {
  /** 再生ボタンで鳴らし続けているか */
  latch = false;
  /** 鍵盤を押しているか */
  held = false;
  /** 曲を演奏しているか（ページが入れる。演奏の間は AudioContext を止めない） */
  song = false;
  /** AudioContext が止まったときに呼ぶ（ブラウザや OS が止めたとき。鳴らしていない間に止めたときも） */
  onLost: (() => void) | null = null;
  private ac: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private master: GainNode | null = null;
  private loading: Promise<boolean> | null = null;
  private patch: Patch | null = null;
  private f0 = 0;
  /** 音量（dB、0 dB = フルスケール） */
  private db = -30;
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** 鍵盤と再生ボタンの音が鳴っているか */
  get play(): boolean {
    return this.latch || this.held;
  }

  /** AudioContext の時刻 [s]（作る前・止めている間は null） */
  now(): number | null {
    return this.ac?.state === 'running' ? this.ac.currentTime : null;
  }

  /** AudioContext を止める（次に鳴らすときに動かし直す） */
  suspend(): void {
    void this.ac?.suspend();
  }

  /** AudioContext を作って動かす（押した操作の中で呼ぶ。自動再生の制限）。鳴らせなかったら false */
  async ready(): Promise<boolean> {
    clearTimeout(this.timer);
    if (!AC) return false;
    const ac = this.ac ?? new AC();
    this.ac = ac;
    this.loading ??= ac.audioWorklet
      .addModule(workletUrl)
      .then(() => {
        const node = new AudioWorkletNode(ac, 'fm-synth', { numberOfInputs: 0, outputChannelCount: [1] }),
          master = ac.createGain(),
          /* 曲の和音でフルスケールを超えそうなときだけ働く安全のためのリミッタ */
          lim = ac.createDynamicsCompressor();
        lim.threshold.value = -3;
        lim.knee.value = 0;
        lim.ratio.value = 20;
        lim.attack.value = 0.002;
        lim.release.value = 0.15;
        master.gain.value = 10 ** (this.db / 20);
        node.connect(master).connect(lim).connect(ac.destination);
        this.node = node;
        this.master = master;
        ac.addEventListener('statechange', () => {
          if (ac.state !== 'running') this.onLost?.();
        });
        if (this.patch) this.post({ type: 'patch', p: this.patch });
        this.hand();
        return true;
      })
      .catch(() => false);
    if (!(await this.loading)) return false;
    try {
      await ac.resume();
    } catch {
      /* 再生できない環境 */
    }
    return ac.state === 'running';
  }

  private post(m: FmMsg): void {
    this.node?.port.postMessage(m);
  }

  private hand(): void {
    this.post({ type: 'hand', f0: this.f0, on: this.play });
  }

  /** 音色と、鍵盤と再生ボタンの音の基本周波数を送る */
  send(p: Patch, f0: number): void {
    this.patch = p;
    this.f0 = f0;
    this.post({ type: 'patch', p });
    this.hand();
  }

  /** 音量を変える */
  vol(db: number): void {
    this.db = db;
    const { ac, master } = this;
    if (ac && master) master.gain.setTargetAtTime(10 ** (db / 20), ac.currentTime, 0.008);
  }

  /** 曲の音 id を、時刻 at（AudioContext の時刻）に基本周波数 f0 [Hz] で鳴らし始める */
  on(id: number, f0: number, at: number): void {
    this.post({ type: 'on', id, f0, at });
  }
  /** 曲の音 id を時刻 at に離す */
  off(id: number, at: number): void {
    this.post({ type: 'off', id, at });
  }
  /** 予約を消して、曲の音をすべて離す */
  stop(): void {
    this.post({ type: 'stop' });
  }

  /** 何も鳴らしていなければ、少しあとで AudioContext を止める */
  idle(): void {
    clearTimeout(this.timer);
    if (this.play || this.song) return;
    const { ac } = this;
    this.timer = setTimeout(() => {
      if (!this.play && !this.song) void ac?.suspend();
    }, IDLE_MS);
  }

  /** latch・held を変えたあとに、鳴らす・止める。鳴らせなかったら false */
  private async apply(): Promise<boolean> {
    if (!this.play) {
      this.hand();
      this.idle();
      return true;
    }
    if (!(await this.ready())) return false;
    this.hand();
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
