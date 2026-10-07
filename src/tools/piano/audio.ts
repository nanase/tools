/**
 * ピアノの音を Web Audio API で鳴らす: 打鍵の模型の計算（Worker、synth.ts）→ AudioWorklet（worklet.ts、ステレオと残響）
 * → 音量 → 出力。Worker の結果は MessagePort で AudioWorklet へ直接届く。
 * AudioContext は鍵を押した操作の中で作る（自動再生の制限）。鳴らしていない間は止めて CPU を休ませる
 */
import type { ReverbSpec } from '../../lib/reverb';
import type { BoardDesc } from './engine';
import { makePiano, type Piano, type PianoSpec, type StringView, strikeKey } from './model';
import { KEY_LO } from './strings';
import type { SynthIn, SynthOut } from './synth';
import type { PnMsg } from './worklet';
import workletUrl from './worklet.ts?worker&url';

type Ctor = typeof AudioContext;
const AC: Ctor | undefined =
  globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;

/** 最後の音から止めるまでの時間 [ms] */
const IDLE_MS = 60000;

export class PianoAudio {
  private ac: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private master: GainNode | null = null;
  private loading: Promise<boolean> | null = null;
  private board: BoardDesc | null = null;
  private room: ReverbSpec | null = null;
  private spec: PianoSpec | null = null;
  private db = -30;
  private idle: ReturnType<typeof setTimeout> | undefined;
  private synth: Worker | null = null;
  /** Worker を使えないときの、主スレッドの模型 */
  private local: Piano | null = null;
  private seq = 0;
  /** 止めた回数 */
  private gen = 0;
  private readonly waits = new Map<number, (v: StringView) => void>();

  /** サンプリング周波数（AudioContext を作る前は 48 kHz とみなす） */
  get fs(): number {
    return this.ac?.sampleRate ?? 48000;
  }

  /** AudioContext の時刻 [s]（作る前・止めている間は null） */
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
        const node = new AudioWorkletNode(ac, 'piano-model', { numberOfInputs: 0, outputChannelCount: [2] }),
          master = ac.createGain(),
          /* フルスケールを超えそうなときだけ働く安全のためのリミッタ（ff の和音で割れないように） */
          lim = ac.createDynamicsCompressor();
        lim.threshold.value = -3;
        lim.knee.value = 0;
        lim.ratio.value = 20;
        lim.attack.value = 0.002;
        lim.release.value = 0.15;
        master.gain.value = 10 ** (this.db / 20);
        node.connect(master).connect(lim).connect(ac.destination);
        this.node = node;
        this.master = master;
        if (this.board) this.post({ type: 'board', d: this.board });
        if (this.room) this.post({ type: 'room', r: this.room });
        this.startSynth();
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

  /** 計算用の Worker を作り、AudioWorklet とつなぐ */
  private startSynth(): void {
    const node = this.node;
    if (!node) return;
    try {
      const w = new Worker(new URL('./synth.ts', import.meta.url), { type: 'module' }),
        ch = new MessageChannel();
      node.port.postMessage({ type: 'port', port: ch.port1 } satisfies PnMsg, [ch.port1]);
      w.postMessage({ type: 'port', port: ch.port2 } satisfies SynthIn, [ch.port2]);
      w.onmessage = (e: MessageEvent<SynthOut>) => {
        const f = this.waits.get(e.data.id);
        this.waits.delete(e.data.id);
        f?.(e.data.view);
      };
      this.synth = w;
    } catch {
      this.synth = null;
    }
    if (this.spec) this.setSpec(this.spec);
  }

  /** しばらく鳴らさなければ止める */
  private keep(): void {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => void this.ac?.suspend(), IDLE_MS);
  }

  private post(m: PnMsg, tr?: Transferable[]): void {
    this.node?.port.postMessage(m, tr ?? []);
  }

  /** ピアノの設定を送る（打鍵の模型を作り直す） */
  setSpec(spec: PianoSpec): void {
    this.spec = spec;
    if (!this.node) return;
    if (this.synth) this.synth.postMessage({ type: 'spec', spec, fs: this.fs } satisfies SynthIn);
    else this.local = makePiano(spec, this.fs);
  }

  setBoard(d: BoardDesc): void {
    this.board = d;
    this.post({ type: 'board', d });
  }

  setRoom(r: ReverbSpec): void {
    this.room = r;
    this.post({ type: 'room', r });
  }

  /**
   * 鍵 key を速さ v [m/s] で打つ（at は AudioContext の時刻。0 ならすぐ）。free は鍵ごとに
   * ダンパーが上がっているか。弦の振動の表示に使う成分を返す
   */
  strike(key: number, v: number, soft: boolean, thump: number, free: Uint8Array, at = 0): Promise<StringView> {
    this.keep();
    const id = ++this.seq,
      m: Extract<SynthIn, { type: 'strike' }> = { type: 'strike', id, key, v, soft, thump, free, at, gen: this.gen };
    if (this.synth) {
      this.synth.postMessage(m);
      return new Promise((res) => this.waits.set(id, res));
    }
    if (!this.local) return Promise.reject(new Error('no model'));
    const s = strikeKey(this.local, { key, v, soft, free: (k) => free[k - KEY_LO] === 1, thump }, this.fs),
      p = s.msg;
    this.post({ type: 'strike', at, p, gen: this.gen }, [
      p.w.buffer,
      p.s.buffer,
      p.fr.buffer,
      p.fi.buffer,
      p.own.buffer,
      p.sd.buffer,
      p.att.buffer,
    ]);
    return Promise.resolve(s.view);
  }

  /** 鍵を離す */
  release(key: number, at = 0): void {
    this.post({ type: 'release', at, key });
  }

  /** 押しているすべての鍵とペダルを離す（予約した打鍵はそのまま） */
  releaseAll(at = 0): void {
    this.post({ type: 'releaseAll', at });
  }

  pedal(on: boolean, at = 0): void {
    this.post({ type: 'pedal', at, on });
  }

  /** 予定を消して、すべての音を止める */
  stop(tau = 0.08): void {
    this.post({ type: 'stop', tau, gen: ++this.gen });
  }

  vol(db: number): void {
    this.db = db;
    const { ac, master } = this;
    if (ac && master) master.gain.setTargetAtTime(10 ** (db / 20), ac.currentTime, 0.01);
  }
}
