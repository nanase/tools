/**
 * エレキギターを鳴らす AudioWorklet。audio.ts が ?worker&url で読み込み、'electric-guitar' として使う。
 * 計算は proc.ts（弦・ピックアップ・エフェクター・アンプ・キャビネット・ディレイ・リバーブ）
 */
import { type Msg, Proc } from './proc';

/* AudioWorkletGlobalScope の名前（TypeScript の DOM の型にはない） */
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

class EgProc extends AudioWorkletProcessor {
  private readonly p: Proc;
  constructor() {
    super();
    this.p = new Proc(sampleRate, (s) => this.port.postMessage(s));
    this.port.onmessage = (e: MessageEvent<Msg>) => this.p.msg(e.data);
  }
  process(_in: Float32Array[][], out: Float32Array[][]): boolean {
    const o = out[0];
    this.p.run(o[0], o[1] ?? o[0]);
    return true;
  }
}
registerProcessor('electric-guitar', EgProc);
