/**
 * トランペットの音を Web Audio API で鳴らす: 奏者と楽器と残響（AudioWorklet、worklet.ts）→ 音量 → リミッタ → 出力。
 * AudioContext は吹く操作の中で作る（自動再生の制限）。鳴らしていない間は止めて CPU を休ませる
 */
import { clockLead } from '../../lib/pause';
import type { ReverbSpec } from '../../lib/reverb';
import type { Manual, PNote } from './player';
import type { Opts, TpMsg, TpOut } from './worklet';
import workletUrl from './worklet.ts?worker&url';

type Ctor = typeof AudioContext;
const AC: Ctor | undefined =
  globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;

/** 最後に吹いてから止めるまでの時間 [ms] */
const IDLE_MS = 30000;

export type Frame = Extract<TpOut, { type: 'frame' }>;

export class TrumpetAudio {
  private ac: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private master: GainNode | null = null;
  private loading: Promise<boolean> | null = null;
  private db = -28;
  private idle: ReturnType<typeof setTimeout> | undefined;
  private pts: Float32Array = new Float32Array(0);
  private opts: Opts = { temp: 27, brass: 1, onAxis: true, vib: false, noise: 0.01, slides: true };
  private room: ReverbSpec | null = null;
  private scopeOn = false;
  private blowing = false;
  private inPiece = false;
  onFrame: ((f: Frame) => void) | null = null;
  onWave: ((y: Float32Array, fs: number) => void) | null = null;
  onDone: (() => void) | null = null;
  /** AudioContext が止まったときに呼ぶ（ブラウザや OS が止めたとき。鳴らしていない間に止めたときも） */
  onLost: (() => void) | null = null;

  /** AudioContext の時計が、出力している音より何秒先にあるか（測れないときは null） */
  lead(): number | null {
    return clockLead(this.ac);
  }

  /** 使える状態にする。鳴らせなければ false */
  async ready(): Promise<boolean> {
    if (!AC) return false;
    const ac = this.ac ?? new AC({ latencyHint: 'interactive' });
    this.ac = ac;
    this.loading ??= ac.audioWorklet
      .addModule(workletUrl)
      .then(() => {
        const node = new AudioWorkletNode(ac, 'trumpet-model', { numberOfInputs: 0, outputChannelCount: [2] }),
          master = ac.createGain(),
          /* フルスケールを超えそうなときだけ働く安全のためのリミッタ */
          lim = ac.createDynamicsCompressor();
        lim.threshold.value = -3;
        lim.knee.value = 0;
        lim.ratio.value = 20;
        lim.attack.value = 0.002;
        lim.release.value = 0.15;
        master.gain.value = 10 ** (this.db / 20);
        node.connect(master).connect(lim).connect(ac.destination);
        node.port.onmessage = (e: MessageEvent<TpOut>) => {
          const m = e.data;
          if (m.type === 'frame') this.onFrame?.(m);
          else if (m.type === 'wave') this.onWave?.(m.y, m.fs);
          else {
            this.inPiece = false;
            this.onDone?.();
          }
        };
        this.node = node;
        this.master = master;
        ac.addEventListener('statechange', () => {
          if (ac.state !== 'running') this.onLost?.();
        });
        this.post({ type: 'init', pts: this.pts, opts: this.opts });
        if (this.room) this.post({ type: 'room', r: this.room });
        this.post({ type: 'scope', on: this.scopeOn });
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

  /** しばらく鳴らさなければ止める（吹いている間と曲の間は止めない） */
  private keep(): void {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => {
      if (this.blowing || this.inPiece) this.keep();
      else void this.ac?.suspend();
    }, IDLE_MS);
  }

  private post(m: TpMsg): void {
    this.node?.port.postMessage(m);
  }

  /** 図が管の中の圧力を読む点（要素, 位置 の対） */
  setPoints(pts: Float32Array): void {
    this.pts = pts;
    if (this.node) this.post({ type: 'init', pts, opts: this.opts });
  }

  setOpts(o: Partial<Opts>): void {
    this.opts = { ...this.opts, ...o };
    this.post({ type: 'opts', opts: o });
  }

  setRoom(r: ReverbSpec): void {
    this.room = r;
    this.post({ type: 'room', r });
  }

  /** 音の波形の表示に、直前の音を送ってもらうか */
  scope(on: boolean): void {
    this.scopeOn = on;
    this.post({ type: 'scope', on });
  }

  /** 手で吹く入力（null で手を離す）。吹き始めたときだけ曲をやめる */
  manual(m: Manual | null): void {
    this.keep();
    this.blowing = !!m?.blow;
    if (m?.blow) this.inPiece = false;
    this.post({ type: 'manual', m });
  }

  /** 曲を始める（from [s] から） */
  playPiece(notes: PNote[], from: number): void {
    this.keep();
    this.inPiece = true;
    this.post({ type: 'piece', notes, from });
  }

  stopPiece(): void {
    this.inPiece = false;
    this.post({ type: 'stopPiece' });
  }

  /** すべて止める */
  mute(): void {
    this.inPiece = false;
    this.blowing = false;
    this.post({ type: 'mute' });
  }

  vol(db: number): void {
    this.db = db;
    const { ac, master } = this;
    if (ac && master) master.gain.setTargetAtTime(10 ** (db / 20), ac.currentTime, 0.01);
  }
}
