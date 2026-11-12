/**
 * エレキギターを Web Audio API で鳴らす: AudioWorklet（worklet.ts）→ 音量 → リミッタ → 出力。
 * ワークレットが送る段ごとの波形と弦の様子（Snap）を onSnap で渡す
 */
import type { Msg, Snap } from './proc';
import workletUrl from './worklet.ts?worker&url';

type Ctor = typeof AudioContext;
const AC: Ctor | undefined =
  globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;

export class EgAudio {
  /** ワークレットからの写し */
  onSnap: ((s: Snap) => void) | null = null;
  /** 準備ができたとき（設定をまとめて送り直す） */
  onReady: (() => void) | null = null;
  /** AudioContext が止まったとき（ブラウザや OS が止めたとき） */
  onLost: (() => void) | null = null;
  private ac: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private master: GainNode | null = null;
  private loading: Promise<boolean> | null = null;
  private db = -14;

  /** サンプリング周波数 [Hz]（作る前は 48 kHz） */
  get rate(): number {
    return this.ac?.sampleRate ?? 48000;
  }

  /** 音を出せる状態か */
  get live(): boolean {
    return !!this.node && this.ac?.state === 'running';
  }

  /** AudioContext の時刻 [s]（止めている間は null） */
  now(): number | null {
    return this.ac?.state === 'running' ? this.ac.currentTime : null;
  }

  suspend(): void {
    void this.ac?.suspend();
  }

  /** AudioContext を作って動かす（押した操作の中で呼ぶ）。鳴らせなかったら false */
  async ready(): Promise<boolean> {
    if (!AC) return false;
    const ac = this.ac ?? new AC({ latencyHint: 'interactive' });
    this.ac = ac;
    this.loading ??= ac.audioWorklet
      .addModule(workletUrl)
      .then(() => {
        const node = new AudioWorkletNode(ac, 'electric-guitar', { numberOfInputs: 0, outputChannelCount: [2] }),
          master = ac.createGain(),
          /* フィードバックや大きな歪みでフルスケールを超えそうなときだけ働く安全のためのリミッタ */
          lim = ac.createDynamicsCompressor();
        lim.threshold.value = -3;
        lim.knee.value = 0;
        lim.ratio.value = 20;
        lim.attack.value = 0.002;
        lim.release.value = 0.15;
        master.gain.value = 10 ** (this.db / 20);
        node.port.onmessage = (e: MessageEvent<Snap>) => this.onSnap?.(e.data);
        node.connect(master).connect(lim).connect(ac.destination);
        this.node = node;
        this.master = master;
        ac.addEventListener('statechange', () => {
          if (ac.state !== 'running') this.onLost?.();
        });
        this.onReady?.();
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

  post(m: Msg): void {
    this.node?.port.postMessage(m);
  }

  /** 音量 [dB] */
  vol(db: number): void {
    this.db = db;
    const { ac, master } = this;
    if (ac && master) master.gain.setTargetAtTime(10 ** (db / 20), ac.currentTime, 0.008);
  }
}
