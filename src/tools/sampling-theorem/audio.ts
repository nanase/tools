/**
 * 標本化定理のページの音: AudioWorklet（worklet.ts）→ 音量 → 出力。
 * AudioContext は「再生」を押した操作の中で作る（自動再生の制限）。鳴らし始めと止めは音量で短く寄せる
 */
import type { PosMsg, SmpMsg } from './worklet';
import workletUrl from './worklet.ts?worker&url';

type Ctor = typeof AudioContext;
const AC: Ctor | undefined =
  globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;

/** 鳴らし始めと止めの時定数 [s] */
const FADE = 0.012;

export class SmpAudio {
  private ac: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private gate: GainNode | null = null;
  private master: GainNode | null = null;
  private loading: Promise<boolean> | null = null;
  private db = -20;
  private stopT: ReturnType<typeof setTimeout> | undefined;
  /** 最後に送った設定と音源（読み込んだときに送る） */
  private last: SmpMsg | null = null;
  private readonly musics: SmpMsg[] = [];
  onPos: ((m: PosMsg) => void) | null = null;

  /** 使える状態にする。鳴らせなければ false */
  async ready(): Promise<boolean> {
    if (!AC) return false;
    const ac = this.ac ?? new AC({ latencyHint: 'interactive' });
    this.ac = ac;
    this.loading ??= ac.audioWorklet
      .addModule(workletUrl)
      .then(() => {
        const node = new AudioWorkletNode(ac, 'sampling-theorem', {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [1],
          }),
          gate = ac.createGain(),
          master = ac.createGain();
        gate.gain.value = 0;
        master.gain.value = 10 ** (this.db / 20);
        node.connect(gate).connect(master).connect(ac.destination);
        node.port.onmessage = (e: MessageEvent<PosMsg>) => this.onPos?.(e.data);
        Object.assign(this, { node, gate, master });
        for (const m of this.musics) node.port.postMessage(m);
        if (this.last) node.port.postMessage(this.last);
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

  /** 設定を送る */
  set(m: Extract<SmpMsg, { type: 'set' }>): void {
    this.last = m;
    this.node?.port.postMessage(m);
  }

  /** サンプル音源を渡す（ワークレットにも同じ音源を置く） */
  music(m: Extract<SmpMsg, { type: 'music' }>): void {
    this.musics.push(m);
    this.node?.port.postMessage(m);
  }

  /** 鳴らす（時刻 t から）・止める */
  play(on: boolean, t: number): void {
    const { ac, node, gate } = this;
    if (!ac || !node || !gate) return;
    clearTimeout(this.stopT);
    const T = ac.currentTime;
    gate.gain.cancelScheduledValues(T);
    if (on) {
      gate.gain.setValueAtTime(0, T);
      node.port.postMessage({ type: 'play', on: true, t } satisfies SmpMsg);
      gate.gain.setTargetAtTime(1, T, FADE);
    } else {
      gate.gain.setTargetAtTime(0, T, FADE);
      this.stopT = setTimeout(() => node.port.postMessage({ type: 'play', on: false, t } satisfies SmpMsg), 120);
    }
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
