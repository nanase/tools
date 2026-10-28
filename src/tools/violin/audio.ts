/**
 * ヴァイオリンの音を Web Audio API で鳴らす: 弓と弦と胴の計算（Worker、synth.ts）→ AudioWorklet（worklet.ts、残響）
 * → 音量 → リミッタ → 出力。Worker の音は MessagePort で AudioWorklet へ直接届く。
 * AudioContext は弾く操作の中で作る（自動再生の制限）。鳴らしていない間は止めて CPU を休ませる
 */
import { clockLead } from '../../lib/pause';
import type { ReverbSpec } from '../../lib/reverb';
import type { BodySpec } from './body';
import type { Frame, Manual, Vib } from './player';
import type { Expr, PieceData } from './score';
import type { SynthIn, SynthOut } from './synth';
import type { PosMsg, VnMsg } from './worklet';
import workletUrl from './worklet.ts?worker&url';

type Ctor = typeof AudioContext;
const AC: Ctor | undefined =
  globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;

/** 最後に弾いてから止めるまでの時間 [ms] */
const IDLE_MS = 30000;

export class ViolinAudio {
  private ac: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private master: GainNode | null = null;
  private loading: Promise<boolean> | null = null;
  private synth: Worker | null = null;
  private body: BodySpec | null = null;
  private vib: Vib | null = null;
  private room: ReverbSpec | null = null;
  private db = -10;
  private idle: ReturnType<typeof setTimeout> | undefined;
  /** 最後に知らせてきた、鳴らしている標本の番号と AudioContext の時刻 */
  private pos: { at: number; t: number } | null = null;
  private bowing = false;
  private inPiece = false;
  private feelV = { fluct: 1, rough: 0.03, press: 1 };
  private tuneV = [0, 0, 0, 0];
  private scopeOn = false;
  /** 直前の音が届いたとき（音の波形の表示） */
  onWave: ((y: Float32Array, fs: number) => void) | null = null;
  /** AudioContext が止まったときに呼ぶ（ブラウザや OS が止めたとき。鳴らしていない間に止めたときも） */
  onLost: (() => void) | null = null;
  /** 表示用の状態が届いたとき */
  onFrames: ((f: Frame[]) => void) | null = null;
  /** 曲を始めたとき（長さ [s]、最初と最後の拍）・曲が終わったとき・計算で困ったとき */
  onPiece: ((v: string, dur: number, b0: number, b1: number) => void) | null = null;
  onDone: (() => void) | null = null;
  onError: ((msg: string) => void) | null = null;

  /** サンプリング周波数（AudioContext を作る前は 48 kHz とみなす） */
  get fs(): number {
    return this.ac?.sampleRate ?? 48000;
  }

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
        const node = new AudioWorkletNode(ac, 'violin-model', { numberOfInputs: 0, outputChannelCount: [2] }),
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
        node.port.onmessage = (e: MessageEvent<PosMsg>) => {
          if (e.data.type === 'pos' && e.data.at !== null) this.pos = { at: e.data.at, t: e.data.t };
        };
        this.node = node;
        this.master = master;
        ac.addEventListener('statechange', () => {
          if (ac.state !== 'running') this.onLost?.();
        });
        if (this.room) this.post({ type: 'room', r: this.room });
        return this.startSynth(ac.sampleRate);
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
  private startSynth(fs: number): boolean {
    const node = this.node;
    if (!node) return false;
    try {
      const w = new Worker(new URL('./synth.ts', import.meta.url), { type: 'module' }),
        ch = new MessageChannel();
      node.port.postMessage({ type: 'port', port: ch.port1 } satisfies VnMsg, [ch.port1]);
      w.postMessage({ type: 'port', port: ch.port2 } satisfies SynthIn, [ch.port2]);
      w.onmessage = (e: MessageEvent<SynthOut>) => {
        const m = e.data;
        if (m.type === 'frames') this.onFrames?.(m.frames);
        else if (m.type === 'wave') this.onWave?.(m.y, m.fs);
        else if (m.type === 'piece') {
          this.inPiece = true;
          this.onPiece?.(m.v, m.dur, m.b0, m.b1);
        } else if (m.type === 'done') {
          this.inPiece = false;
          this.onDone?.();
        } else this.onError?.(m.msg);
      };
      this.synth = w;
      this.send({ type: 'feel', ...this.feelV });
      this.send({ type: 'tune', cent: this.tuneV });
      this.send({ type: 'scope', on: this.scopeOn });
      if (this.body && this.vib) this.send({ type: 'init', fs, body: this.body, vib: this.vib });
      return true;
    } catch {
      return false;
    }
  }

  /** しばらく鳴らさなければ止める（弓を当てている間と曲の間は止めない） */
  private keep(): void {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => {
      if (this.bowing || this.inPiece) this.keep();
      else void this.ac?.suspend();
    }, IDLE_MS);
  }

  private post(m: VnMsg): void {
    this.node?.port.postMessage(m);
  }

  private send(m: SynthIn): void {
    this.synth?.postMessage(m);
  }

  /** 胴を入れ替える（最初の 1 回で Worker を初期化する） */
  setBody(b: BodySpec): void {
    const first = !this.body;
    this.body = b;
    if (!this.synth) return;
    if (first && this.vib) this.send({ type: 'init', fs: this.fs, body: b, vib: this.vib });
    else this.send({ type: 'body', body: b });
  }

  setVib(v: Vib): void {
    const first = !this.vib;
    this.vib = v;
    if (!this.synth) return;
    if (first && this.body) this.send({ type: 'init', fs: this.fs, body: this.body, vib: v });
    else this.send({ type: 'vib', vib: v });
  }

  /** 揺らぎの倍率・松脂のむら・曲の弓圧の倍率 */
  feel(fluct: number, rough: number, press: number): void {
    this.feelV = { fluct, rough, press };
    this.send({ type: 'feel', fluct, rough, press });
  }

  /** 弦ごとの調弦のずれ [セント]（0 = E 線 … 3 = G 線） */
  tune(cent: readonly number[]): void {
    this.tuneV = [...cent];
    this.send({ type: 'tune', cent: this.tuneV });
  }

  /** 音の波形の表示に、直前の音を送ってもらうか */
  scope(on: boolean): void {
    this.scopeOn = on;
    this.send({ type: 'scope', on });
  }

  /** 部屋の残響を入れ替える */
  setRoom(r: ReverbSpec): void {
    this.room = r;
    this.post({ type: 'room', r });
  }

  /** 手で弾く弓と左手（弦が空なら弓を離す） */
  manual(m: Manual): void {
    this.keep();
    this.bowing = m.strings.length > 0;
    if (this.bowing) this.inPiece = false;
    this.send({ type: 'manual', m });
  }

  /** 曲を始める（beat から。null なら頭から） */
  playPiece(v: string, data: PieceData, expr: Expr, tempo: number, beat: number | null): void {
    this.keep();
    this.bowing = false;
    this.send({ type: 'piece', v, data, expr, tempo, beat });
  }

  /** 演奏中の曲の表情とテンポを変える */
  retempo(expr: Expr, tempo: number): void {
    if (this.inPiece) this.send({ type: 'retempo', expr, tempo });
  }

  /** 曲をやめる（弦は鳴り残る） */
  stopPiece(): void {
    this.inPiece = false;
    this.send({ type: 'stopPiece' });
    this.send({ type: 'flush' });
  }

  /** すべての弦を止める */
  mute(): void {
    this.inPiece = false;
    this.bowing = false;
    this.send({ type: 'mute' });
    this.send({ type: 'flush' });
  }

  /** いま聞こえている標本の番号の見積もり（出力の遅れを引く）。鳴らしていなければ null */
  heardAt(): number | null {
    const ac = this.ac,
      p = this.pos;
    if (!ac || !p || ac.state !== 'running') return p ? p.at : null;
    const lat = (ac.outputLatency || 0) + (ac.baseLatency || 0);
    return p.at + (ac.currentTime - p.t - lat) * ac.sampleRate;
  }

  vol(db: number): void {
    this.db = db;
    const { ac, master } = this;
    if (ac && master) master.gain.setTargetAtTime(10 ** (db / 20), ac.currentTime, 0.01);
  }
}
