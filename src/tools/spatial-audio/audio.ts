/**
 * 立体音響の音を Web Audio API で鳴らす: AudioWorklet（worklet.ts）→ 音量 → 制限器 → 出力。
 * 録音（public/spatial-audio/<id>.mp3）は使うときに読み、くり返せる形にしてから worklet へ送る。
 * 自然の音は終わりと初めを重ねてつなぎ、声は終わりに無音を足す。大きさは鳴っている区間の実効値でそろえる。
 * AudioContext は再生を押した操作の中で作る（自動再生の制限）
 */
import { prepareClip } from './clip';
import { soundOf } from './model';
import type { SceneSpec } from './render';
import type { SpMsg } from './worklet';
import workletUrl from './worklet.ts?worker&url';

type Ctor = typeof AudioContext;
const AC: Ctor | undefined =
  globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
const BASE = import.meta.env.BASE_URL;

export class SpatialAudio {
  private ac: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private master: GainNode | null = null;
  private loading: Promise<boolean> | null = null;
  private db = -6;
  private readonly sent = new Set<string>();
  private readonly pending = new Map<string, Promise<void>>();
  private scene: SceneSpec | null = null;
  onLost: (() => void) | null = null;

  get running(): boolean {
    return this.ac?.state === 'running' && !!this.node;
  }

  /** 使える状態にする。鳴らせなければ false */
  async ready(): Promise<boolean> {
    if (!AC) return false;
    const ac = this.ac ?? new AC({ latencyHint: 'interactive' });
    if (!this.ac) {
      this.ac = ac;
      ac.addEventListener('statechange', () => {
        if (ac.state !== 'running' && this.node) this.onLost?.();
      });
    }
    /* iPhone の Safari は、押した操作の中で最初の await より前に resume しないと鳴らない */
    void ac.resume().catch(() => {});
    this.loading ??= ac.audioWorklet
      .addModule(workletUrl)
      .then(() => {
        const node = new AudioWorkletNode(ac, 'spatial-audio', { numberOfInputs: 0, outputChannelCount: [2] }),
          master = ac.createGain(),
          lim = ac.createDynamicsCompressor();
        lim.threshold.value = -3;
        lim.knee.value = 0;
        lim.ratio.value = 20;
        lim.attack.value = 0.002;
        lim.release.value = 0.1;
        master.gain.value = 0;
        node.connect(master).connect(lim).connect(ac.destination);
        this.node = node;
        this.master = master;
        if (this.scene) this.post({ type: 'scene', scene: this.scene });
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

  private post(m: SpMsg, transfer: Transferable[] = []): void {
    this.node?.port.postMessage(m, transfer);
  }

  /** 録音を読み、worklet へ送る（送ったものは送らない） */
  load(id: string): Promise<void> {
    const ac = this.ac;
    if (!ac || this.sent.has(id)) return Promise.resolve();
    let p = this.pending.get(id);
    if (!p) {
      p = fetch(`${BASE}spatial-audio/${id}.mp3`)
        .then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.arrayBuffer();
        })
        .then((b) => ac.decodeAudioData(b))
        .then((buf) => {
          const clip = prepareClip(buf.getChannelData(0), buf.sampleRate, soundOf(id).kind === 'voice');
          this.post({ type: 'clip', id, clip }, [clip.data.buffer]);
          this.sent.add(id);
        })
        .finally(() => this.pending.delete(id));
      this.pending.set(id, p);
    }
    return p;
  }

  /** 場面を送る（読み込む前なら、読み込んだときに送る） */
  setScene(scene: SceneSpec): void {
    this.scene = scene;
    this.post({ type: 'scene', scene });
  }

  start(): void {
    const { ac, master } = this;
    if (!ac || !master) return;
    master.gain.cancelScheduledValues(ac.currentTime);
    master.gain.setTargetAtTime(10 ** (this.db / 20), ac.currentTime, 0.05);
  }

  /** 音を絞ってから AudioContext を止める */
  stop(): void {
    const { ac, master } = this;
    if (!ac || !master) return;
    master.gain.cancelScheduledValues(ac.currentTime);
    master.gain.setTargetAtTime(0, ac.currentTime, 0.05);
    const a = ac;
    setTimeout(() => {
      if (master.gain.value < 1e-3) void a.suspend();
    }, 400);
  }

  vol(db: number, playing: boolean): void {
    this.db = db;
    const { ac, master } = this;
    if (ac && master && playing) master.gain.setTargetAtTime(10 ** (db / 20), ac.currentTime, 0.01);
  }

  suspend(): void {
    void this.ac?.suspend();
  }
}
