/**
 * 試聴: AudioWorklet（worklet.ts、音源とフィルタ）→ 音量 → レベル計測 → 出力。
 * 点の並びからフィルタの因子と、最大の利得を 0 dB にそろえる値を作って送る
 */
import { factor, type Pt } from './pz';
import type { PzMsg, UnitMsg } from './worklet';
import workletUrl from './worklet.ts?worker&url';

type Ctor = typeof AudioContext;
const AC: Ctor | undefined =
  globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;

/** 点ごとの因子（零点は分子、極は分母） */
export function unitsOf(pts: readonly Pt[]): UnitMsg[] {
  return pts.map((p) => {
    const f = factor(p);
    return {
      id: p.id,
      c: p.k === 'z' ? [f[0], f[1], f[2] ?? 0, 0, 0] : [1, 0, 0, f[1], f[2] ?? 0],
    };
  });
}

export class PzAudio {
  playing = false;
  private ac: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private master: GainNode | null = null;
  private an: AnalyserNode | null = null;
  private buf = new Float32Array(2048);
  private loading: Promise<boolean> | null = null;
  private set: PzMsg | null = null;
  private src: PzMsg | null = null;
  /** 音量（dB、0 dB = フルスケール） */
  private db = -30;
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** 再生装置のサンプリング周波数（まだ開いていなければ null） */
  get rate(): number | null {
    return this.ac?.sampleRate ?? null;
  }

  /** AudioContext は押した操作の中で作る（自動再生の制限） */
  private ensure(): Promise<boolean> {
    if (this.node) return Promise.resolve(true);
    if (!AC) return Promise.resolve(false);
    const ac = this.ac ?? new AC();
    this.ac = ac;
    this.loading ??= ac.audioWorklet
      .addModule(workletUrl)
      .then(() => {
        const node = new AudioWorkletNode(ac, 'pole-zero', { numberOfInputs: 0, outputChannelCount: [1] }),
          master = ac.createGain(),
          an = ac.createAnalyser();
        an.fftSize = 2048;
        master.gain.value = 0;
        node.connect(master).connect(an).connect(ac.destination);
        this.node = node;
        this.master = master;
        this.an = an;
        if (this.src) node.port.postMessage(this.src);
        if (this.set) node.port.postMessage(this.set);
        return true;
      })
      .catch(() => false);
    return this.loading;
  }

  /** フィルタ（点の並び）と、全体に掛ける値 g。on でなければ音を止める */
  filter(pts: readonly Pt[], g: number, on: boolean): void {
    this.set = { t: 'set', u: unitsOf(pts), g, on };
    this.node?.port.postMessage(this.set);
  }

  /** 入力の音 */
  source(s: 'noise' | 'saw', f: number): void {
    this.src = { t: 'src', s, f };
    this.node?.port.postMessage(this.src);
  }

  vol(db: number): void {
    this.db = db;
    this.gain();
  }

  private gain(): void {
    const { ac, master } = this;
    if (ac && master) master.gain.setTargetAtTime(this.playing ? 10 ** (this.db / 20) : 0, ac.currentTime, 0.01);
  }

  /** 鳴らす・止める。鳴らせなかったら false */
  async play(on: boolean): Promise<boolean> {
    clearTimeout(this.timer);
    this.playing = on;
    if (!on) {
      this.gain();
      const { ac } = this;
      this.timer = setTimeout(() => {
        if (!this.playing) void ac?.suspend();
      }, 300);
      return true;
    }
    if (!(await this.ensure()) || !this.ac) {
      this.playing = false;
      return false;
    }
    try {
      await this.ac.resume();
    } catch {
      /* 再生できない環境 */
    }
    if (this.ac.state !== 'running') {
      this.playing = false;
      return false;
    }
    this.gain();
    return true;
  }

  /** 出力の大きさ [dBFS]（実効値を √2 倍した AES17 の値）。鳴っていなければ −∞ */
  level(): number {
    if (!this.an || !this.playing) return -Infinity;
    this.an.getFloatTimeDomainData(this.buf);
    let s = 0;
    for (const x of this.buf) s += x * x;
    return 10 * Math.log10((2 * s) / this.buf.length);
  }
}
