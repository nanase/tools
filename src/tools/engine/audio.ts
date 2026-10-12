/**
 * エンジンの音を Web Audio API で鳴らす: AudioWorklet（worklet.ts、排気口から 0.5 m の音圧 [Pa]）→ 音量 → 制限器 → 出力。
 * 波形とスペクトラムは、音量の前の AnalyserNode から取る（単位は Pa のまま）。
 * AudioContext は「運転」を押した操作の中で作る（自動再生の制限）。止めたら AudioContext も止めて CPU を休ませる
 */
import type { EngineId, MufflerId } from './spec';
import type { EngMsg, RunSet, StatMsg, WaveMsg } from './worklet';
import workletUrl from './worklet.ts?worker&url';

type Ctor = typeof AudioContext;
const AC: Ctor | undefined =
  globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;

/** 音量 0 dB でフルスケールにする音圧 [Pa]（20 Pa は 120 dB SPL） */
export const P_FS = 20;

export class EngineAudio {
  private ac: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private master: GainNode | null = null;
  /** 音量の前の音圧（波形・スペクトラム用） */
  analyser: AnalyserNode | null = null;
  private loading: Promise<boolean> | null = null;
  private db = -10;
  private stopT: ReturnType<typeof setTimeout> | undefined;
  /** サイクルの集計を受け取る */
  onStat: ((m: StatMsg) => void) | null = null;
  /** トリガを掛けた波形を受け取る */
  onWave: ((m: WaveMsg) => void) | null = null;

  get fs(): number {
    return this.ac?.sampleRate ?? 48000;
  }

  /** 使える状態にする。鳴らせなければ false */
  async ready(): Promise<boolean> {
    if (!AC) return false;
    const ac = this.ac ?? new AC({ latencyHint: 'interactive' });
    this.ac = ac;
    this.loading ??= ac.audioWorklet
      .addModule(workletUrl)
      .then(() => {
        const node = new AudioWorkletNode(ac, 'engine-model', { numberOfInputs: 0, outputChannelCount: [2] }),
          master = ac.createGain(),
          lim = ac.createDynamicsCompressor(),
          an = ac.createAnalyser();
        /* 速いピークだけを抑える制限器（音量を上げすぎたときの割れを防ぐ） */
        lim.threshold.value = -3;
        lim.knee.value = 0;
        lim.ratio.value = 20;
        lim.attack.value = 0.002;
        lim.release.value = 0.1;
        an.fftSize = 16384;
        an.smoothingTimeConstant = 0.6;
        master.gain.value = this.gain();
        node.connect(an);
        node.connect(master).connect(lim).connect(ac.destination);
        node.port.onmessage = (e: MessageEvent<StatMsg | WaveMsg>) => {
          const d = e.data;
          if (d.type === 'wave') this.onWave?.(d);
          else this.onStat?.(d);
        };
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

  private post(m: EngMsg): void {
    this.node?.port.postMessage(m);
  }

  /** エンジンを掛ける。keep なら回転と車体の状態を引き継いで、エンジン・マフラーだけを替える */
  start(eng: EngineId, muf: MufflerId, set: RunSet, keep = false): void {
    clearTimeout(this.stopT);
    const { ac, master } = this;
    if (ac && master) {
      master.gain.cancelScheduledValues(ac.currentTime);
      master.gain.setTargetAtTime(this.gain(), ac.currentTime, 0.02);
    }
    this.post({ type: 'init', eng, muf, set, keep });
  }

  set(set: RunSet): void {
    this.post({ type: 'set', set });
  }

  /** トリガを掛けた波形を送ってもらうか */
  scope(on: boolean): void {
    this.post({ type: 'scope', on });
  }

  /** 変速する（1 で上、−1 で下） */
  shift(dir: 1 | -1): void {
    this.post({ type: 'shift', dir });
  }

  /** 音を絞ってからエンジンを止め、AudioContext も止める */
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
