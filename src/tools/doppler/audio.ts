/**
 * ドップラー効果の音を Web Audio API で鳴らす: AudioWorklet（worklet.ts、聞き手の位置の音圧 [Pa]）→ 音量 → 制限器 → 出力。
 * AudioContext は再生を押した操作の中で作る（自動再生の制限）。止めたら AudioContext も止めて CPU を休ませる
 */
import type { PropSet } from './prop';
import type { SourceId } from './sources';
import type { DopMsg, PosMsg } from './worklet';
import workletUrl from './worklet.ts?worker&url';

type Ctor = typeof AudioContext;
const AC: Ctor | undefined =
  globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;

/** 音量 0 dB でフルスケールにする音圧 [Pa]（20 Pa は 120 dB SPL） */
export const P_FS = 20;

export class DopplerAudio {
  private ac: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private master: GainNode | null = null;
  /** 音量の前の音圧（波形・スペクトラム用） */
  analyser: AnalyserNode | null = null;
  private loading: Promise<boolean> | null = null;
  private db = -30;
  private stopT: ReturnType<typeof setTimeout> | undefined;

  /** AudioContext の今の時刻 [s]（まだなければ 0） */
  get now(): number {
    return this.ac?.currentTime ?? 0;
  }

  get running(): boolean {
    return this.ac?.state === 'running' && !!this.node;
  }

  /** 使える状態にする。鳴らせなければ false */
  async ready(): Promise<boolean> {
    if (!AC) return false;
    const ac = this.ac ?? new AC({ latencyHint: 'interactive' });
    this.ac = ac;
    this.loading ??= ac.audioWorklet
      .addModule(workletUrl)
      .then(() => {
        const node = new AudioWorkletNode(ac, 'doppler', { numberOfInputs: 0, outputChannelCount: [2] }),
          master = ac.createGain(),
          lim = ac.createDynamicsCompressor(),
          an = ac.createAnalyser();
        /* 速いピークだけを抑える制限器（マッハ円錐が届いたときの大きな音で割れないように） */
        lim.threshold.value = -3;
        lim.knee.value = 0;
        lim.ratio.value = 20;
        lim.attack.value = 0.002;
        lim.release.value = 0.1;
        an.fftSize = 8192;
        master.gain.value = this.gain();
        node.connect(an);
        node.connect(master).connect(lim).connect(ac.destination);
        this.node = node;
        this.master = master;
        this.analyser = an;
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

  private gain(): number {
    return 10 ** (this.db / 20) / P_FS;
  }

  private post(m: DopMsg): void {
    this.node?.port.postMessage(m);
  }

  /** 音源を鳴らし始める（記録は空から） */
  start(src: SourceId, set: PropSet, tone?: number): void {
    clearTimeout(this.stopT);
    const { ac, master } = this;
    if (ac && master) {
      master.gain.cancelScheduledValues(ac.currentTime);
      master.gain.setTargetAtTime(this.gain(), ac.currentTime, 0.02);
    }
    this.post({ type: 'init', src, set, tone });
  }

  set(set: PropSet): void {
    this.post({ type: 'set', set });
  }

  tone(f: number): void {
    this.post({ type: 'tone', f });
  }

  /** 位置を送る。t は AudioContext の時刻 [s]（省けば今） */
  pos(m: Omit<PosMsg, 'type' | 't'> & { t?: number }): void {
    this.post({ type: 'pos', ...m, t: m.t ?? this.now });
  }

  /** 音を絞ってから止め、AudioContext も止める */
  stop(): void {
    const { ac, master } = this;
    if (!ac || !master) return;
    master.gain.setTargetAtTime(0, ac.currentTime, 0.05);
    this.stopT = setTimeout(() => {
      this.post({ type: 'stop' });
      void ac.suspend();
    }, 300);
  }

  vol(db: number): void {
    this.db = db;
    const { ac, master } = this;
    if (ac && master) master.gain.setTargetAtTime(this.gain(), ac.currentTime, 0.01);
  }
}
