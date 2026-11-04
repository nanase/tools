/**
 * VVVF の音を作る AudioWorklet。audio.ts が ?worker&url で読み込み、'vvvf-model' として使う。
 * 運転（Drive）を進めながらインバータの音（Inverter）を作り、今の速度などを 1 秒に 60 回まで送る。
 * 止まっていて音が消え切った間は計算しない
 */
import { CARS, type CarId } from './cars';
import { Drive, type DriveKind } from './drive';
import { Inverter } from './inverter';

/* AudioWorkletGlobalScope の名前（TypeScript の DOM の型にはない） */
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

/** 主スレッドから送るもの */
export type VvMsg =
  | { type: 'car'; id: CarId }
  | { type: 'auto' }
  | { type: 'hand'; lever: number }
  | { type: 'halt' }
  | { type: 'force'; on: boolean }
  | { type: 'road'; on: boolean }
  /** 走行音の音量 [dB] */
  | { type: 'roadDb'; db: number }
  /** 継ぎ目の間隔 [m]。0 なら継ぎ目の音を出さない */
  | { type: 'rail'; len: number }
  /** 連結部寄りの席で聞くか */
  | { type: 'seat'; end: boolean }
  | { type: 'stereo'; on: boolean }
  | { type: 'tunnel'; on: boolean };

/** 主スレッドへ送るもの */
export interface RunMsg {
  v: number;
  a: number;
  power: boolean;
  brake: boolean;
  slip: number;
  kind: DriveKind;
  lever: number;
}

/** 運転と音を更新する間隔 [標本] */
const STEP = 32;

registerProcessor(
  'vvvf-model',
  class extends AudioWorkletProcessor {
    private readonly drive = new Drive(CARS.tokyu5000);
    private readonly inv = new Inverter(CARS.tokyu5000, sampleRate);
    private since = 0;
    private quiet = true;
    constructor() {
      super();
      this.port.onmessage = (ev: MessageEvent<VvMsg>) => {
        const m = ev.data;
        if (m.type === 'car') {
          this.drive.car = CARS[m.id];
          this.inv.car = CARS[m.id];
        } else if (m.type === 'auto') this.drive.auto();
        else if (m.type === 'hand') this.drive.hand(m.lever);
        else if (m.type === 'halt') {
          this.drive.halt();
          this.inv.hush();
        } else if (m.type === 'force') this.inv.force = m.on;
        else if (m.type === 'road') this.inv.road = m.on;
        else if (m.type === 'roadDb') this.inv.roadLevel = 10 ** (m.db / 20);
        else if (m.type === 'rail') this.inv.rail = m.len;
        else if (m.type === 'seat') this.inv.seatEnd = m.end;
        else if (m.type === 'stereo') this.inv.stereo = m.on;
        else this.inv.tunnel = m.on;
        this.send();
      };
    }
    private send(): void {
      const d = this.drive;
      this.port.postMessage({
        v: d.v,
        a: d.a,
        power: d.power,
        brake: d.brake,
        slip: d.slip,
        kind: d.kind,
        lever: d.lever,
      } satisfies RunMsg);
    }
    process(_in: Float32Array[][], outputs: Float32Array[][]): boolean {
      const out = outputs[0];
      if (!out.length) return true;
      const ch = out[0],
        ch2 = out[1] ?? ch,
        d = this.drive,
        was = d.kind;
      if (d.kind === 'stop' && this.inv.idle(d)) {
        ch.fill(0);
        ch2.fill(0);
        this.quiet = true;
      } else {
        this.quiet = false;
        for (let i = 0; i < ch.length; i += STEP) {
          const n = Math.min(STEP, ch.length - i);
          d.tick(n / sampleRate);
          this.inv.render(d, ch, i, n, ch2);
        }
      }
      this.since += ch.length;
      if (d.kind !== was || (!this.quiet && this.since >= sampleRate / 60)) {
        this.since = 0;
        this.send();
      }
      return true;
    }
  },
);
