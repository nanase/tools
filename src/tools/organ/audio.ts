/**
 * オルガンの音を Web Audio API で鳴らす: AudioWorklet（worklet.ts、ステレオと残響）→ 音量 → リミッタ → 出力。
 * AudioContext は鍵を押した操作の中で作る（自動再生の制限）。鳴らしていない間は止めて CPU を休ませる
 */
import type { ReverbSpec } from '../../lib/reverb';
import type { PipeMsg, WindDesc } from './engine';
import type { OgMsg, OgOut } from './worklet';
import workletUrl from './worklet.ts?worker&url';

type Ctor = typeof AudioContext;
const AC: Ctor | undefined =
  globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;

/** 最後の音から止めるまでの時間 [ms] */
const IDLE_MS = 60000;
/**
 * サンプリング周波数 [Hz]。調律の表（tuned.ts）を作った値に固定する（出力の装置と違えばブラウザが変換する）。
 * 管の鳴る高さは導波管の離散化に少しよるので、ほかの値では表のとおりに合わない
 */
export const FS = 48000;

/** AudioContext を作る（サンプリング周波数を指定できないブラウザでは装置の値で） */
function newContext(): AudioContext {
  if (!AC) throw new Error('no AudioContext');
  try {
    return new AC({ latencyHint: 'interactive', sampleRate: FS });
  } catch {
    return new AC({ latencyHint: 'interactive' });
  }
}

export class OrganAudio {
  private ac: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private master: GainNode | null = null;
  private loading: Promise<boolean> | null = null;
  private wind: WindDesc | null = null;
  private room: ReverbSpec | null = null;
  private swell = 1;
  private db = -30;
  private idle: ReturnType<typeof setTimeout> | undefined;
  /** 弁の開いている管のストップが変わったときに呼ぶ */
  onStops: ((ids: string[]) => void) | null = null;
  /** 同時に鳴らす管の数の上限が変わったときに呼ぶ（上限がなければ 0） */
  onBudget: ((n: number) => void) | null = null;

  get fs(): number {
    return this.ac?.sampleRate ?? FS;
  }
  now(): number | null {
    return this.ac && this.ac.state === 'running' ? this.ac.currentTime : null;
  }

  async ready(): Promise<boolean> {
    if (!AC) return false;
    const ac = this.ac ?? newContext();
    this.ac = ac;
    this.loading ??= ac.audioWorklet
      .addModule(workletUrl)
      .then(() => {
        const node = new AudioWorkletNode(ac, 'organ-model', { numberOfInputs: 0, outputChannelCount: [2] }),
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
        node.port.onmessage = (e: MessageEvent<OgOut>) => {
          if (e.data.type === 'stops') this.onStops?.(e.data.ids);
          else if (e.data.type === 'budget') this.onBudget?.(e.data.n);
        };
        this.node = node;
        this.master = master;
        if (this.wind) this.post({ type: 'wind', w: this.wind });
        if (this.room) this.post({ type: 'room', r: this.room });
        this.post({ type: 'swell', s: this.swell });
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

  private keep(): void {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => void this.ac?.suspend(), IDLE_MS);
  }

  private post(m: OgMsg): void {
    this.node?.port.postMessage(m);
  }

  setWind(w: WindDesc): void {
    this.wind = w;
    this.post({ type: 'wind', w });
  }
  /** スウェルの扉の開き（0 で閉じる、1 で開く） */
  setSwell(s: number): void {
    this.swell = s;
    this.post({ type: 'swell', s });
  }
  setRoom(r: ReverbSpec): void {
    this.room = r;
    this.post({ type: 'room', r });
  }
  /** 管の弁を開く（at は AudioContext の時刻。0 ならすぐ） */
  on(p: PipeMsg[], at = 0): void {
    if (!p.length) return;
    this.keep();
    this.post({ type: 'on', at, p });
  }
  off(ids: string[], at = 0): void {
    if (ids.length) this.post({ type: 'off', at, ids });
  }
  /** 時刻 at にすべての弁を閉じる（その後の予定は残す） */
  release(at = 0): void {
    this.post({ type: 'release', at });
  }
  /** 予定を消して、すべての弁を閉じる */
  stop(): void {
    this.post({ type: 'stop' });
  }
  vol(db: number): void {
    this.db = db;
    const { ac, master } = this;
    if (ac && master) master.gain.setTargetAtTime(10 ** (db / 20), ac.currentTime, 0.01);
  }
}
