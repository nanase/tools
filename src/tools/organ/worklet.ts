/**
 * オルガンの音を作る AudioWorklet。audio.ts が ?worker&url で読み込み、'organ-model' として使う。
 * 管の弁を開く・閉じるを、指定の時刻（AudioContext の時刻）に標本の単位で行う。
 * 出力はステレオで、部屋の残響を足す（再生だけ。表示用の計算には使わない）
 */
import { Reverb, type ReverbSpec } from '../../lib/reverb';
import { Engine, type PipeMsg, type WindDesc } from './engine';

/* AudioWorkletGlobalScope の名前（TypeScript の DOM の型にはない） */
declare const sampleRate: number;
declare const currentFrame: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

/** 主スレッドから送るもの。at は AudioContext の時刻 [s]（過ぎていればすぐ） */
export type OgMsg =
  | { type: 'wind'; w: WindDesc }
  | { type: 'room'; r: ReverbSpec }
  | { type: 'on'; at: number; p: PipeMsg[] }
  | { type: 'off'; at: number; ids: string[] }
  | { type: 'stop' };

type Ev = Extract<OgMsg, { at: number }>;

registerProcessor(
  'organ-model',
  class extends AudioWorkletProcessor {
    private readonly e = new Engine(sampleRate, true);
    private readonly rv = new Reverb(sampleRate);
    private q: Ev[] = [];
    private readonly spare = new Float32Array(128);
    constructor() {
      super();
      this.port.onmessage = (ev: MessageEvent<OgMsg>) => {
        const m = ev.data;
        if (m.type === 'wind') this.e.setWind(m.w);
        else if (m.type === 'room') this.rv.set(m.r);
        else if (m.type === 'stop') {
          this.q = [];
          this.e.allOff();
        } else {
          /* 同じ時刻なら届いた順（閉じる → 開くの順を崩さない） */
          let i = this.q.length;
          while (i > 0 && this.q[i - 1].at > m.at) i--;
          this.q.splice(i, 0, m);
        }
      };
    }
    private fire(m: Ev): void {
      if (m.type === 'on') for (const p of m.p) this.e.on(p);
      else for (const id of m.ids) this.e.off(id);
    }
    process(_in: Float32Array[][], outputs: Float32Array[][]): boolean {
      const out = outputs[0];
      if (!out.length) return true;
      const ch = out[0],
        chR = out[1] ?? this.spare,
        n = ch.length;
      let i = 0;
      while (i < n) {
        let j = n;
        while (this.q.length) {
          const k = Math.round(this.q[0].at * sampleRate) - currentFrame;
          if (k > i) {
            j = Math.min(n, k);
            break;
          }
          this.fire(this.q.shift() as Ev);
        }
        this.e.render(ch, i, j - i, chR);
        i = j;
      }
      this.rv.process(ch, chR, 0, n);
      return true;
    }
  },
);
