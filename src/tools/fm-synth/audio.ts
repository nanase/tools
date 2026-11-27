/**
 * FM 音源を Web Audio API で鳴らす: AudioWorklet（worklet.ts）→ 音量 → リミッタ → 出力。
 * 再生ボタンの音（latch）はエンベロープなしで鳴らし続ける。鍵盤・曲・MIDI の音は AudioContext の時刻で予約し、エンベロープを掛ける。
 * 何も鳴らしていない間は AudioContext を止めて CPU を休ませる
 */
import { wakeOnRelease } from '../../lib/gesture';
import type { Patch } from './synth';
import type { FmMsg, FmOut } from './worklet';
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
  /** MIDI で弾いているか（ページが入れる。間は AudioContext を止めず、すぐ鳴らせるようにしておく） */
  midi = false;
  /** AudioContext が止まったときに呼ぶ（ブラウザや OS が止めたとき。鳴らしていない間に止めたときも） */
  onLost: (() => void) | null = null;
  /** 最後に鳴り始めた音のエンベロープの大きさ（鳴っていなければ null）。worklet から届くたびに入れる */
  lv: number[] | null = null;
  private ac: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private master: GainNode | null = null;
  private loading: Promise<boolean> | null = null;
  private patch: Patch | null = null;
  private f0 = 0;
  /** 強さ（0〜1） */
  private vel = 1;
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
    /* iPhone の Safari は、押した操作の中で最初の await より前に resume しないと音を出さない */
    void ac.resume().catch(() => undefined);
    wakeOnRelease(ac);
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
        node.port.onmessage = (e: MessageEvent<FmOut>) => {
          if (e.data.type === 'lv') this.lv = e.data.lv;
        };
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
    this.post({ type: 'hand', f0: this.f0, vel: this.vel, on: this.latch });
  }

  /** 音色と、再生ボタンの音の基本周波数・強さ（0〜1）を送る */
  send(p: Patch, f0: number, vel: number): void {
    this.patch = p;
    this.f0 = f0;
    this.vel = vel;
    this.post({ type: 'patch', p });
    this.hand();
  }

  /** 音量を変える */
  vol(db: number): void {
    this.db = db;
    const { ac, master } = this;
    if (ac && master) master.gain.setTargetAtTime(10 ** (db / 20), ac.currentTime, 0.008);
  }

  /** 音 id を、時刻 at（AudioContext の時刻。0 ならすぐ）に基本周波数 f0 [Hz]・強さ vel（0〜1）で鳴らし始める */
  on(id: number, f0: number, at: number, vel: number): void {
    this.post({ type: 'on', id, f0, vel, at });
  }
  /** 曲の音 id を時刻 at に離す */
  off(id: number, at: number): void {
    this.post({ type: 'off', id, at });
  }
  /** 予約を消して、曲の音をすべて離す（鍵盤と MIDI の音は残す） */
  stop(): void {
    this.post({ type: 'stop' });
  }
  /** 鳴っている音をすべてすぐ消す（曲の予約は残す） */
  panic(): void {
    this.post({ type: 'panic' });
  }

  /** 何も鳴らしていなければ、少しあとで AudioContext を止める（リリースで鳴っている音があれば、鳴り終わるまで待つ） */
  idle(): void {
    clearTimeout(this.timer);
    if (this.play || this.song || this.midi) return;
    const { ac } = this;
    this.timer = setTimeout(() => {
      if (this.play || this.song || this.midi) return;
      if (this.lv && ac?.state === 'running') this.idle();
      else void ac?.suspend();
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
