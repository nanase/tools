/**
 * ギターの音を Web Audio API で鳴らす: AudioWorklet（worklet.ts、ステレオと残響）→ 音量 → 出力。
 * AudioContext は弦を弾いた操作の中で作る（自動再生の制限）。鳴らしていない間は止めて CPU を休ませる
 */
import type { ReverbSpec } from '../../lib/reverb';
import type { BodyDesc, PluckMsg } from './engine';
import type { GtMsg } from './worklet';
import workletUrl from './worklet.ts?worker&url';

type Ctor = typeof AudioContext;
const AC: Ctor | undefined =
  globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;

/** 最後の音から止めるまでの時間 [ms] */
const IDLE_MS = 30000;

export class GuitarAudio {
  private ac: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private master: GainNode | null = null;
  private loading: Promise<boolean> | null = null;
  private body: BodyDesc | null = null;
  private room: ReverbSpec | null = null;
  private db = -30;
  private idle: ReturnType<typeof setTimeout> | undefined;
  /** 撥弦の番号 */
  private seq = 0;

  /** サンプリング周波数（AudioContext を作る前は 48 kHz とみなす） */
  get fs(): number {
    return this.ac?.sampleRate ?? 48000;
  }

  /** AudioContext の時刻 [s]（作る前は null） */
  now(): number | null {
    return this.ac && this.ac.state === 'running' ? this.ac.currentTime : null;
  }

  /** 使える状態にする。鳴らせなければ false */
  async ready(): Promise<boolean> {
    if (!AC) return false;
    const ac = this.ac ?? new AC({ latencyHint: 'interactive' });
    this.ac = ac;
    this.loading ??= ac.audioWorklet
      .addModule(workletUrl)
      .then(() => {
        const node = new AudioWorkletNode(ac, 'guitar-model', { numberOfInputs: 0, outputChannelCount: [2] }),
          master = ac.createGain();
        master.gain.value = 10 ** (this.db / 20);
        node.connect(master).connect(ac.destination);
        this.node = node;
        this.master = master;
        if (this.body) this.post({ type: 'body', d: this.body });
        if (this.room) this.post({ type: 'room', r: this.room });
        return true;
      })
      .catch(() => false);
    if (!(await this.loading)) return false;
    try {
      await ac.resume();
    } catch {
      /* 再生できない環境 */
    }
    this.keep();
    return ac.state === 'running';
  }

  /** しばらく鳴らさなければ止める */
  private keep(): void {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => void this.ac?.suspend(), IDLE_MS);
  }

  private post(m: GtMsg, tr?: Transferable[]): void {
    this.node?.port.postMessage(m, tr ?? []);
  }

  /** 胴を入れ替える */
  setBody(d: BodyDesc): void {
    this.body = d;
    this.post({ type: 'body', d });
  }

  /** 部屋の残響を入れ替える */
  setRoom(r: ReverbSpec): void {
    this.room = r;
    this.post({ type: 'room', r });
  }

  /** 弦を弾く（at は AudioContext の時刻。0 ならすぐ。pan は定位で、−1 が左、1 が右）。撥弦の番号を返す */
  pluck(p: PluckMsg, at = 0, pan = 0): number {
    this.keep();
    const id = ++this.seq;
    this.post({ type: 'pluck', at, p, pan, id });
    return id;
  }

  /** 弦 si の指を離す。id を渡すと、その撥弦だけを止める（0 なら弦の音をすべて） */
  damp(si: number, at = 0, id = 0, tau = 0.06): void {
    this.post({ type: 'damp', at, si, tau, id });
  }

  noise(si: number, buf: Float32Array, at = 0, pan = 0): void {
    this.post({ type: 'noise', at, si, buf, pan }, [buf.buffer]);
  }

  /** 予定を消して、すべての弦を止める */
  stop(tau = 0.08): void {
    this.post({ type: 'stop', tau });
  }

  vol(db: number): void {
    this.db = db;
    const { ac, master } = this;
    if (ac && master) master.gain.setTargetAtTime(10 ** (db / 20), ac.currentTime, 0.01);
  }
}
