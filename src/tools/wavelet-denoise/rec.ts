/**
 * マイクで数秒を録る。雑音を消す・音量をそろえる処理（ブラウザの既定）は切り、生の標本をそのまま集める。
 * 録っている間は鳴らさない（スピーカーへはつながない）ので、ハウリングは起きない
 */
import workletUrl from './rec-worklet.ts?worker&url';

const MIC_ERR: Record<string, string> = {
  NotAllowedError: 'マイクの使用が許可されませんでした',
  SecurityError: 'マイクの使用が許可されませんでした',
  NotFoundError: 'マイクが見つかりません',
  NotReadableError: 'マイクをほかのアプリが使っています',
};

export class Recorder {
  on = false;
  msg = '';
  /** 録った長さ [s] */
  sec = 0;
  private chunks: Float32Array[] = [];
  private n = 0;
  private st: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private loaded = new WeakSet<AudioContext>();
  onChange: () => void = () => {};
  /** 録り終えたとき（max 秒に達したときも） */
  onDone: (x: Float32Array, fs: number) => void = () => {};

  constructor(
    private readonly ac: () => AudioContext | null,
    readonly max: number,
  ) {}

  async start(): Promise<void> {
    const ac = this.ac();
    if (!ac || !navigator.mediaDevices?.getUserMedia || !ac.audioWorklet) {
      this.msg = 'この環境ではマイクを使えません';
      this.onChange();
      return;
    }
    this.msg = 'マイクを準備しています…';
    this.onChange();
    try {
      await ac.resume();
      if (!this.loaded.has(ac)) {
        await ac.audioWorklet.addModule(workletUrl);
        this.loaded.add(ac);
      }
      this.st = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (e) {
      const n = e instanceof Error ? e.name : String(e);
      this.msg = MIC_ERR[n] || `マイクを使えませんでした（${n}）`;
      this.onChange();
      return;
    }
    const fs = ac.sampleRate,
      lim = Math.round(fs * this.max),
      src = ac.createMediaStreamSource(this.st),
      node = new AudioWorkletNode(ac, 'wd-rec', { numberOfOutputs: 0 });
    this.chunks = [];
    this.n = 0;
    this.sec = 0;
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (!this.on) return;
      this.chunks.push(e.data);
      this.n += e.data.length;
      this.sec = this.n / fs;
      if (this.n >= lim) this.stop();
      else this.onChange();
    };
    src.connect(node);
    this.node = node;
    this.on = true;
    this.msg = '';
    this.onChange();
  }

  stop(): void {
    if (!this.on) return;
    this.on = false;
    const ac = this.ac();
    this.node?.port.close();
    this.node?.disconnect();
    this.node = null;
    for (const t of this.st?.getTracks() ?? []) t.stop();
    this.st = null;
    const fs = ac?.sampleRate ?? 48000,
      x = new Float32Array(Math.min(this.n, Math.round(fs * this.max)));
    let o = 0;
    for (const c of this.chunks) {
      if (o >= x.length) break;
      x.set(c.subarray(0, x.length - o), o);
      o += c.length;
    }
    this.chunks = [];
    this.onChange();
    if (x.length > fs * 0.5) this.onDone(x, fs);
    else {
      this.msg = '短すぎました（0.5 秒以上録ってください）';
      this.onChange();
    }
  }
}
