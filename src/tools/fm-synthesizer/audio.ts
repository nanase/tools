/**
 * FM シンセサイザを Web Audio API で鳴らす: AudioWorklet（worklet.ts、ステレオ。残響もここで足す）→ コンプレッサー →
 * 音量 → リミッタ → 出力。
 * 曲の音は AudioContext の時刻で予約し、MIDI 機器の音はすぐ鳴らす。何も鳴らしていない間は AudioContext を止めて CPU を休ませる
 */
import type { ReverbSpec } from '../../lib/reverb';
import { type Src, type Tone, VOL0 } from './engine';
import { PC } from './smf';
import type { SynthEv, SynthMsg } from './worklet';
import workletUrl from './worklet.ts?worker&url';

type Ctor = typeof AudioContext;
const AC: Ctor | undefined =
  globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;

/** 最後の音を離してから AudioContext を止めるまでの時間 [ms]（リリースの長い音を切らない） */
const IDLE_MS = 4000;

/** 全体のコンプレッサー: しきい値 [dB]・ニー [dB]・比・アタック [s]・リリース [s]・持ち上げ [dB] */
const COMP = { threshold: -24, knee: 12, ratio: 3, attack: 0.005, release: 0.2, makeup: 6 };
/** 使わないときは比 1（素通り） */
const COMP_OFF = { threshold: 0, knee: 0, ratio: 1, attack: 0.003, release: 0.25, makeup: 0 };

export class SynthAudio {
  /** 曲を演奏しているか（演奏の間は AudioContext を止めない） */
  song = false;
  /** MIDI 機器で弾いているか */
  midi = false;
  /** 手で弾いている（鍵盤やパッドを押している）か */
  hand = false;
  /** AudioContext が止まったときに呼ぶ */
  onLost: (() => void) | null = null;
  private ac: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private master: GainNode | null = null;
  private comp: DynamicsCompressorNode | null = null;
  private makeup: GainNode | null = null;
  private compOn = true;
  private loading: Promise<boolean> | null = null;
  private db = VOL0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** 準備の前に送った設定（音色・パート）。準備ができたら送る */
  private pending = new Map<string, SynthMsg>();

  /** AudioContext の時刻 [s]（作る前・止めている間は null） */
  now(): number | null {
    return this.ac?.state === 'running' ? this.ac.currentTime : null;
  }

  suspend(): void {
    void this.ac?.suspend();
  }

  /** AudioContext を作って動かす（押した操作の中で呼ぶ）。鳴らせなかったら false */
  async ready(): Promise<boolean> {
    clearTimeout(this.timer);
    if (!AC) return false;
    const ac = this.ac ?? new AC();
    this.ac = ac;
    this.loading ??= ac.audioWorklet
      .addModule(workletUrl)
      .then(() => {
        const node = new AudioWorkletNode(ac, 'fm-synthesizer', { numberOfInputs: 0, outputChannelCount: [2] }),
          comp = ac.createDynamicsCompressor(),
          makeup = ac.createGain(),
          master = ac.createGain(),
          /* 和音でフルスケールを超えそうなときだけ働く、安全のためのリミッタ */
          lim = ac.createDynamicsCompressor();
        lim.threshold.value = -3;
        lim.knee.value = 0;
        lim.ratio.value = 20;
        lim.attack.value = 0.002;
        lim.release.value = 0.15;
        master.gain.value = 10 ** (this.db / 20);
        node.connect(comp).connect(makeup).connect(master).connect(lim).connect(ac.destination);
        this.node = node;
        this.master = master;
        this.comp = comp;
        this.makeup = makeup;
        this.applyComp();
        ac.addEventListener('statechange', () => {
          if (ac.state !== 'running') this.onLost?.();
        });
        for (const m of this.pending.values()) node.port.postMessage(m);
        this.pending.clear();
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

  /** 設定を送る（準備の前なら、準備ができたときに送る。同じ key は最後のものだけ） */
  private setting(key: string, m: SynthMsg): void {
    if (this.node) this.node.port.postMessage(m);
    else this.pending.set(key, m);
  }

  /** GM の番号 prog の音色を替える */
  gm(prog: number, tone: Tone): void {
    this.setting(`gm${prog}`, { type: 'gm', prog, tone });
  }
  /** 打楽器のノート note の音色を替える */
  drum(note: number, tone: Tone): void {
    this.setting(`dr${note}`, { type: 'drum', note, tone });
  }
  /** パート part の GM の番号を替える（プログラムチェンジと同じ） */
  prog(part: number, prog: number): void {
    this.setting(`pc${part}`, { type: 'ev', at: 0, src: 1, e: { k: PC, ch: part, a: prog, v: 0 } });
  }
  /** パートの音量 [dB]・定位・ミュート・残響へ送る量 */
  part(part: number, vol: number, pan: number, mute: boolean, rev: number): void {
    this.setting(`pt${part}`, { type: 'part', part, vol, pan, mute, rev });
  }

  /** 出来事を時刻 at（0 はすぐ）に鳴らす。src は曲（0）か MIDI 機器と手（1） */
  ev(e: SynthEv, at: number, src: Src): void {
    this.node?.port.postMessage({ type: 'ev', at, src, e } satisfies SynthMsg);
  }

  /** 曲の予約を消して、曲の音を離す */
  stop(): void {
    this.node?.port.postMessage({ type: 'stop' } satisfies SynthMsg);
  }

  /** 残響（部屋） */
  room(spec: ReverbSpec): void {
    this.setting('room', { type: 'room', spec });
  }

  /** すべての音をすぐ消す（曲の演奏は続ける） */
  panic(): void {
    this.node?.port.postMessage({ type: 'panic' } satisfies SynthMsg);
  }

  /** 全体のコンプレッサーを使うか */
  compress(on: boolean): void {
    this.compOn = on;
    this.applyComp();
  }
  private applyComp(): void {
    const { comp, makeup } = this;
    if (!comp || !makeup) return;
    const c = this.compOn ? COMP : COMP_OFF;
    comp.threshold.value = c.threshold;
    comp.knee.value = c.knee;
    comp.ratio.value = c.ratio;
    comp.attack.value = c.attack;
    comp.release.value = c.release;
    makeup.gain.value = 10 ** (c.makeup / 20);
  }

  /** 全体の音量 [dB] */
  vol(db: number): void {
    this.db = db;
    const { ac, master } = this;
    if (ac && master) master.gain.setTargetAtTime(10 ** (db / 20), ac.currentTime, 0.008);
  }

  /** 何も鳴らしていなければ、少しあとで AudioContext を止める */
  idle(): void {
    clearTimeout(this.timer);
    if (this.song || this.midi || this.hand) return;
    const { ac } = this;
    this.timer = setTimeout(() => {
      if (!this.song && !this.midi && !this.hand) void ac?.suspend();
    }, IDLE_MS);
  }
}
