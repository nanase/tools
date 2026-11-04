/**
 * VVVF の音を Web Audio API で鳴らす: AudioWorklet（worklet.ts）→ 反響を足す → 音量 → 出力。
 * スペクトログラムは音量の前から取る。
 * AudioContext は「自動」か運転のボタンを押した操作の中で作る（自動再生の制限）
 */
import type { CarId } from './cars';
import { ECHO, type EchoKind, makeIr } from './echo';
import type { RunMsg, VvMsg } from './worklet';
import workletUrl from './worklet.ts?worker&url';

type Ctor = typeof AudioContext;
const AC: Ctor | undefined =
  globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;

export class VvvfAudio {
  private ac: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private master: GainNode | null = null;
  private loading: Promise<boolean> | null = null;
  private db = -12;
  private wet: GainNode | null = null;
  private conv: ConvolverNode | null = null;
  private echoKind: EchoKind = 'ground';
  private stereoOn = true;
  analyser: AnalyserNode | null = null;
  onRun: ((m: RunMsg) => void) | null = null;
  /** ワークレットへ最初に送るもの（読み込む前に選んだ車種と音源） */
  private first: VvMsg[] = [];

  /** 使える状態にする。鳴らせなければ false */
  async ready(): Promise<boolean> {
    if (!AC) return false;
    const ac = this.ac ?? new AC({ latencyHint: 'interactive' });
    this.ac = ac;
    this.loading ??= ac.audioWorklet
      .addModule(workletUrl)
      .then(() => {
        const node = new AudioWorkletNode(ac, 'vvvf-model', { numberOfInputs: 0, outputChannelCount: [2] }),
          bus = ac.createGain(),
          wet = ac.createGain(),
          master = ac.createGain(),
          an = ac.createAnalyser();
        an.fftSize = 4096;
        an.smoothingTimeConstant = 0;
        master.gain.value = 10 ** (this.db / 20);
        node.connect(bus);
        wet.connect(bus);
        bus.connect(an);
        bus.connect(master).connect(ac.destination);
        node.port.onmessage = (e: MessageEvent<RunMsg>) => this.onRun?.(e.data);
        this.node = node;
        this.wet = wet;
        this.master = master;
        this.analyser = an;
        for (const m of this.first) node.port.postMessage(m);
        this.first = [];
        this.applyEcho();
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
  post(m: VvMsg): void {
    if (this.node) this.node.port.postMessage(m);
    else this.first.push(m);
  }
  car(id: CarId): void {
    this.post({ type: 'car', id });
  }

  /** 反響の畳み込みを作り直す（中に残っている音も消える） */
  private applyEcho(): void {
    const { ac, node, wet } = this;
    if (!ac || !node || !wet) return;
    if (this.conv) {
      node.disconnect(this.conv);
      this.conv.disconnect();
      this.conv = null;
    }
    const k = this.echoKind;
    if (k === 'off') return;
    const [L, R] = makeIr(k, ac.sampleRate, this.stereoOn),
      buf = ac.createBuffer(2, L.length, ac.sampleRate),
      c = ac.createConvolver();
    buf.copyToChannel(new Float32Array(L), 0);
    buf.copyToChannel(new Float32Array(R), 1);
    c.normalize = false;
    c.buffer = buf;
    wet.gain.value = ECHO[k].wet;
    node.connect(c).connect(wet);
    this.conv = c;
  }
  /** 反響とステレオを選ぶ */
  echo(kind: EchoKind, stereo: boolean): void {
    this.echoKind = kind;
    this.stereoOn = stereo;
    this.applyEcho();
  }

  /** 緊急停止: すぐに 0 km/h にして音を消す。走行音が急に切れて鳴らないよう音量を一瞬だけ絞り、反響の残りも消す */
  halt(): void {
    this.post({ type: 'halt' });
    const { ac, master } = this;
    if (!ac || !master) return;
    const T = ac.currentTime,
      g = master.gain;
    g.cancelScheduledValues(T);
    g.setTargetAtTime(0, T, 0.008);
    g.setTargetAtTime(10 ** (this.db / 20), T + 0.12, 0.01);
    setTimeout(() => this.applyEcho(), 60);
  }

  /** 画面が隠れたスマートフォンで AudioContext を止める */
  sleep(): void {
    this.halt();
    void this.ac?.suspend();
  }

  vol(db: number): void {
    this.db = db;
    const { ac, master } = this;
    if (ac && master) master.gain.setTargetAtTime(10 ** (db / 20), ac.currentTime, 0.01);
  }
}
