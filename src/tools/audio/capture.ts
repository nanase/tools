/**
 * 音の入力（マイク・ファイル・テスト信号）と、モニター（スピーカーへ出す音）。
 * 表示は毎フレーム pull() で直近 NB 点（CH1 = L、CH2 = R）を受け取る。
 * マイクとファイルは AnalyserNode から、テスト信号はこの端末の中で作って輪のバッファから取り出す。
 * 初めはマイクを止めた状態で開く
 */
import { genTest, type TestParams } from './signal';
import type { TestMsg } from './worklet';
import workletUrl from './worklet.ts?worker&url';

export type Src = 'mic' | 'file' | 'test';
/** 表示に渡す点数（AnalyserNode の最大の長さ） */
export const NB = 32768;
/** テスト信号の標本化周波数 */
export const TFS = 48000;

type Ctor = typeof AudioContext;
const AC: Ctor | undefined =
  globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;

const MIC_ERR: Record<string, string> = {
  NotAllowedError: 'マイクの使用が許可されませんでした',
  SecurityError: 'マイクの使用が許可されませんでした',
  NotFoundError: 'マイクが見つかりません',
  NotReadableError: 'マイクをほかのアプリが使っています',
};

interface Graph {
  ac: AudioContext;
  /** ステレオを L・R に分ける */
  sp: ChannelSplitterNode;
  aL: AnalyserNode;
  aR: AnalyserNode;
  /** モニターの音量 */
  mon: GainNode;
}

export class AudioIn {
  src: Src = 'mic';
  /** 今の入力の標本化周波数 */
  fs = TFS;
  /** 入力が動いているか（マイクを受けている・ファイルを再生している・テスト信号を出している） */
  run = false;
  /** 直近 NB 点 */
  readonly L = new Float32Array(NB);
  readonly R = new Float32Array(NB);
  test: TestParams = { wave: 'sine', f: 1000, ra: [2, 3], ph: 0 };
  /** モニターを鳴らすか、その音量（dB、0 dB で入力と同じ大きさ） */
  monOn = false;
  vol = -30;
  /** マイクを使えないときの知らせ */
  micMsg = '';
  /** ファイルの知らせ（読めなかったとき） */
  fileMsg = '';
  buf: AudioBuffer | null = null;
  file = '';
  playing = false;
  /** 入力の状態が変わったとき（画面を合わせる） */
  onChange: () => void = () => {};
  /** 入力元を変えるか、ファイルを読み込むたびに増やす（表示は前の入力の波形を消す） */
  epoch = 0;

  private g: Graph | null = null;
  private readonly rL = new Float32Array(NB);
  private readonly rR = new Float32Array(NB);
  /** テスト信号の次に書く標本の番号と、最後に作った時刻 */
  private w = 0;
  private last = 0;
  private node: AudioBufferSourceNode | null = null;
  private off = 0;
  private t0 = 0;
  private mic: { st: MediaStream; node: MediaStreamAudioSourceNode } | null = null;
  private tNode: AudioWorkletNode | null = null;
  private wk: boolean | undefined;

  constructor() {
    genTest(this.test, TFS, 0, NB, this.rL, this.rR, true);
    this.w = NB;
    this.last = performance.now();
  }

  get micOn(): boolean {
    return !!this.mic;
  }

  /** 新しい音があれば L・R を直近 NB 点に入れ替える */
  pull(now: number): boolean {
    if (!this.run) return false;
    if (this.src === 'test') {
      this.fs = TFS;
      let cnt = Math.round(((now - this.last) / 1000) * TFS);
      this.last = now;
      if (cnt <= 0) return false;
      cnt = Math.min(cnt, NB);
      genTest(this.test, TFS, this.w, cnt, this.rL, this.rR, true);
      this.w += cnt;
      this.copyRing();
      return true;
    }
    const g = this.g;
    if (!g) return false;
    g.aL.getFloatTimeDomainData(this.L);
    g.aR.getFloatTimeDomainData(this.R);
    this.fs = g.ac.sampleRate;
    return true;
  }

  /** 前の入力の音を消す */
  private clear(): void {
    this.L.fill(0);
    this.R.fill(0);
    this.epoch++;
  }

  private copyRing(): void {
    const s = this.w % NB;
    this.L.set(this.rL.subarray(s));
    this.L.set(this.rL.subarray(0, s), NB - s);
    this.R.set(this.rR.subarray(s));
    this.R.set(this.rR.subarray(0, s), NB - s);
  }

  /* ---------- 音の経路 ---------- */
  private graph(): Graph | null {
    if (this.g) return this.g;
    if (!AC) return null;
    const ac = new AC(),
      sp = ac.createChannelSplitter(2),
      aL = ac.createAnalyser(),
      aR = ac.createAnalyser(),
      mon = ac.createGain();
    aL.fftSize = aR.fftSize = NB;
    sp.connect(aL, 0);
    sp.connect(aR, 1);
    mon.gain.value = 0;
    mon.connect(ac.destination);
    this.g = { ac, sp, aL, aR, mon };
    return this.g;
  }
  /** 表示とモニターへつなぐ。モノラルは CH1 と CH2 に同じ音を入れる */
  private route(n: AudioNode, ch: number): void {
    const g = this.g;
    if (!g) return;
    if (ch >= 2) n.connect(g.sp);
    else {
      n.connect(g.aL);
      n.connect(g.aR);
    }
    n.connect(g.mon);
  }
  private async resume(): Promise<void> {
    try {
      await this.g?.ac.resume();
    } catch {
      /* 再生を始められない環境 */
    }
  }

  /* ---------- 入力元 ---------- */
  /**
   * 入力元を変える。前の入力元は止め、新しい入力元も止めた状態で始める（開始・再生は押してから）。
   * マイクではハウリングを避けるためモニターを使わない
   */
  setSrc(v: Src): void {
    if (v === this.src) return;
    this.micStop();
    this.pause();
    this.src = v;
    this.clear();
    this.run = false;
    if (v === 'mic') this.monOn = false;
    this.last = performance.now();
    this.syncMon();
    this.onChange();
  }

  /** 開始・停止（ファイルは再生・一時停止） */
  async toggle(): Promise<void> {
    if (this.src === 'mic') {
      if (this.mic) this.micStop();
      else await this.micStart();
    } else if (this.src === 'file') {
      if (!this.buf) return;
      if (this.playing) this.pause();
      else {
        await this.resume();
        this.play();
      }
    } else {
      this.run = !this.run;
      this.last = performance.now();
      this.syncMon();
    }
    this.onChange();
  }

  private async micStart(): Promise<void> {
    if (!AC || !navigator.mediaDevices?.getUserMedia) {
      this.micMsg = 'この環境ではマイクを使えません';
      return;
    }
    this.micMsg = 'マイクを準備しています…';
    this.onChange();
    let st: MediaStream;
    try {
      st = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } },
      });
    } catch (e) {
      const n = e instanceof Error ? e.name : String(e);
      this.micMsg = MIC_ERR[n] || `マイクを使えませんでした（${n}）`;
      return;
    }
    /* 許可を待つ間に入力元を変えたら使わない */
    if (this.src !== 'mic') {
      for (const t of st.getTracks()) t.stop();
      this.micMsg = '';
      return;
    }
    const g = this.graph();
    if (!g) return;
    await this.resume();
    const node = g.ac.createMediaStreamSource(st);
    this.route(node, st.getAudioTracks()[0]?.getSettings().channelCount || 1);
    this.mic = { st, node };
    this.run = true;
    this.micMsg = '';
    this.syncMon();
  }
  private micStop(): void {
    if (!this.mic) return;
    for (const t of this.mic.st.getTracks()) t.stop();
    this.mic.node.disconnect();
    this.mic = null;
    this.run = false;
  }

  /* ---------- ファイル ---------- */
  /** 読み込んで先頭から再生する */
  async open(f: File): Promise<void> {
    const g = this.graph();
    if (!g) {
      this.fileMsg = 'この環境では音声を扱えません';
      this.onChange();
      return;
    }
    try {
      await this.resume();
      const buf = await g.ac.decodeAudioData(await f.arrayBuffer());
      this.micStop();
      this.pause();
      Object.assign(this, { buf, file: f.name, off: 0, fileMsg: '', src: 'file' as Src, monOn: true });
      this.clear();
      this.play();
    } catch {
      this.fileMsg = 'このファイルは読み込めませんでした（WAV・MP3・FLAC など）';
    }
    this.onChange();
  }
  /** 再生位置（秒） */
  get pos(): number {
    if (!this.buf) return 0;
    return this.playing && this.g ? (this.g.ac.currentTime - this.t0) % this.buf.duration : this.off;
  }
  seek(s: number): void {
    const was = this.playing;
    this.pause();
    this.off = s;
    if (was) this.play();
  }
  private play(): void {
    const g = this.g;
    if (!g || !this.buf) return;
    const n = g.ac.createBufferSource(),
      off = this.off % this.buf.duration;
    n.buffer = this.buf;
    n.loop = true;
    this.route(n, this.buf.numberOfChannels);
    n.start(0, off);
    this.t0 = g.ac.currentTime - off;
    Object.assign(this, { node: n, playing: true, run: true });
    this.syncMon();
  }
  private pause(): void {
    if (!this.node) return;
    this.off = this.pos;
    this.node.stop();
    this.node.disconnect();
    Object.assign(this, { node: null, playing: false, run: false });
  }

  /* ---------- モニター ---------- */
  async setMon(on: boolean): Promise<void> {
    this.monOn = on && this.src !== 'mic';
    if (on && this.graph()) await this.resume();
    await this.syncMon();
    this.onChange();
  }
  setVol(db: number): void {
    this.vol = db;
    this.syncMon();
  }
  /** テスト信号の条件が変わった */
  testChanged(): void {
    this.tNode?.port.postMessage({ p: this.test } satisfies TestMsg);
  }
  /** モニターの音量と、テスト信号を鳴らすノードを今の状態に合わせる */
  private async syncMon(): Promise<void> {
    const g = this.g;
    if (!g) return;
    g.mon.gain.setTargetAtTime(this.monOn ? 10 ** (this.vol / 20) : 0, g.ac.currentTime, 0.02);
    const want = this.monOn && this.src === 'test' && this.run;
    if (want && !this.tNode) {
      if (this.wk === undefined) {
        this.wk = false;
        try {
          await g.ac.audioWorklet.addModule(workletUrl);
          this.wk = true;
        } catch {
          /* AudioWorklet を使えない環境ではテスト信号を鳴らさない */
        }
      }
      if (!this.wk || this.tNode || !(this.monOn && this.src === 'test' && this.run)) return;
      const n = new AudioWorkletNode(g.ac, 'audio-test', { numberOfInputs: 0, outputChannelCount: [2] });
      n.port.postMessage({ p: this.test, n: Math.round((this.w / TFS) * g.ac.sampleRate) } satisfies TestMsg);
      n.connect(g.mon);
      this.tNode = n;
    } else if (!want && this.tNode) {
      this.tNode.disconnect();
      this.tNode = null;
    }
  }
  /** テスト信号をモニターで鳴らせない環境か（AudioWorklet を読み込めなかった） */
  get testMute(): boolean {
    return this.wk === false || !AC;
  }
}
