/**
 * 無限音階の音を Web Audio API で鳴らす: AudioWorklet（worklet.ts）→ 直接音と残響 → 音量 → 出力。
 * スペクトログラムは音量の前から取るので、音量を変えても図は変わらない。
 * AudioContext は「再生」を押した操作の中で作る（自動再生の制限）
 */
import { REVERBS, type ReverbId } from './params';
import { roomIr } from './shepard';
import type { PosMsg, ShMsg } from './worklet';
import workletUrl from './worklet.ts?worker&url';

type Ctor = typeof AudioContext;
const AC: Ctor | undefined =
  globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;

/** 低い音の図に使う長い分析の FFT の点数（半音の間隔を分ける） */
const FFT_LOW = 16384;
/** 高い音の図に使う短い分析の FFT の点数（時間の動きを保つ） */
const FFT_HIGH = 4096;

export class ShepardAudio {
  private ac: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private master: GainNode | null = null;
  private dry: GainNode | null = null;
  private wet: GainNode | null = null;
  private conv: ConvolverNode | null = null;
  private loading: Promise<boolean> | null = null;
  private db = -12;
  private kind: ReverbId = 'hall';
  private amount = 0.45;
  private swap: ReturnType<typeof setTimeout> | undefined;
  private readonly irs = new Map<ReverbId, AudioBuffer>();
  /** 読み込む前に選んだ設定。読み込んだときに送る */
  private first: ShMsg[] = [];
  low: AnalyserNode | null = null;
  high: AnalyserNode | null = null;
  onPos: ((m: PosMsg) => void) | null = null;

  /** 使える状態にする。鳴らせなければ false */
  async ready(): Promise<boolean> {
    if (!AC) return false;
    const ac = this.ac ?? new AC({ latencyHint: 'interactive' });
    this.ac = ac;
    this.loading ??= ac.audioWorklet
      .addModule(workletUrl)
      .then(() => {
        const node = new AudioWorkletNode(ac, 'shepard-tone', {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [1],
          }),
          dry = ac.createGain(),
          wet = ac.createGain(),
          conv = ac.createConvolver(),
          bus = ac.createGain(),
          master = ac.createGain(),
          low = ac.createAnalyser(),
          high = ac.createAnalyser();
        conv.normalize = false;
        low.fftSize = FFT_LOW;
        high.fftSize = FFT_HIGH;
        low.smoothingTimeConstant = 0;
        high.smoothingTimeConstant = 0;
        master.gain.value = 10 ** (this.db / 20);
        node.connect(dry).connect(bus);
        node.connect(conv).connect(wet).connect(bus);
        bus.connect(low);
        bus.connect(high);
        bus.connect(master).connect(ac.destination);
        node.port.onmessage = (e: MessageEvent<PosMsg>) => this.onPos?.(e.data);
        Object.assign(this, { node, master, dry, wet, conv, low, high });
        for (const m of this.first) node.port.postMessage(m);
        this.first = [];
        this.applyReverb();
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

  /** 送る。読み込む前なら、読み込んだときに送る */
  post(m: ShMsg): void {
    if (this.node) this.node.port.postMessage(m);
    else this.first.push(m);
  }

  private irOf(id: ReverbId, ac: AudioContext): AudioBuffer {
    let b = this.irs.get(id);
    if (!b) {
      const t60 = REVERBS[id].t60;
      b = ac.createBuffer(2, Math.ceil(t60 * 1.15 * ac.sampleRate), ac.sampleRate);
      b.copyToChannel(new Float32Array(roomIr(ac.sampleRate, t60, 1234)), 0);
      b.copyToChannel(new Float32Array(roomIr(ac.sampleRate, t60, 98765)), 1);
      this.irs.set(id, b);
    }
    return b;
  }
  /** 直接音と残響の割合。全体のエネルギーが大きく変わらないようにする */
  private applyMix(): void {
    const { ac, dry, wet } = this;
    if (!ac || !dry || !wet) return;
    const w = this.kind === 'off' ? 0 : this.amount,
      T = ac.currentTime;
    dry.gain.setTargetAtTime(Math.sqrt(1 - w * w * 0.75), T, 0.02);
    wet.gain.setTargetAtTime(w, T, 0.02);
  }
  private applyReverb(): void {
    const { ac, conv } = this;
    if (ac && conv && this.kind !== 'off') conv.buffer = this.irOf(this.kind, ac);
    this.applyMix();
  }
  /** 残響の種類と量（0〜1）を選ぶ */
  reverb(kind: ReverbId, amount: number): void {
    const changed = kind !== this.kind;
    this.kind = kind;
    this.amount = amount;
    const { ac, wet } = this;
    if (!ac || !wet) return;
    if (!changed || kind === 'off') {
      this.applyMix();
      return;
    }
    /* インパルス応答を差し替える音を出さないよう、いったん下げる */
    wet.gain.setTargetAtTime(0, ac.currentTime, 0.012);
    clearTimeout(this.swap);
    this.swap = setTimeout(() => this.applyReverb(), 70);
  }

  vol(db: number): void {
    this.db = db;
    const { ac, master } = this;
    if (ac && master) master.gain.setTargetAtTime(10 ** (db / 20), ac.currentTime, 0.01);
  }

  /** 画面が隠れたスマートフォンで AudioContext を止める */
  sleep(): void {
    void this.ac?.suspend();
  }
}
