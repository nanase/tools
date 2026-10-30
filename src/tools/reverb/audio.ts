/**
 * 音: 乾いた音に部屋のインパルス応答を畳み込んで鳴らす（Web Audio の ConvolverNode）。
 * インパルス応答は AudioContext と同じ標本化周波数で作る（ConvolverNode は違う周波数の応答を受け付けない）。
 * 大きさは応答のエネルギーで割ってそろえる（部屋や位置を変えても全体の大きさが大きく変わらないように）
 */

/** 鳴らし直すときに前の音を消す時間 [s] */
const FADE = 0.03;
/** 鳴り始めまでの余裕 [s] */
const LEAD = 0.03;
/** 音量 0 dB の倍率（乾いた音の最大 1 を、これだけ下げて出す） */
const GAIN = 0.6;

/** 聞き方: 部屋の応答・楽器のページの残響（左右）・乾いた音のまま */
export type Listen = 'room' | 'fdn' | 'dry';

export class RoomAudio {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private conv: ConvolverNode | null = null;
  private live: { s: AudioBufferSourceNode; g: GainNode }[] = [];
  /** 応答のエネルギーで決めた大きさ */
  private norm = 1;
  /** 最後に鳴らし始めた時刻（AudioContext の目盛り） */
  t0 = 0;
  /** ブラウザや OS が AudioContext を止めたとき（lib/pause.ts の autoPause が入れる） */
  onLost: (() => void) | null = null;

  /** 標本化周波数（作る前は 48 kHz とみなす） */
  get fs(): number {
    return this.ctx?.sampleRate ?? 48000;
  }

  private context(): AudioContext {
    if (!this.ctx) {
      const c = new AudioContext();
      this.ctx = c;
      this.out = c.createGain();
      this.out.connect(c.destination);
      c.onstatechange = () => {
        if (c.state !== 'running') this.onLost?.();
      };
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** 先に AudioContext を作る（標本化周波数を知るため。押した操作の中で呼ぶ） */
  open(): number {
    return this.context().sampleRate;
  }

  /**
   * 畳み込む応答を入れ替える。ch は 1 本（モノラル）か 2 本（左右）。
   * 標本化周波数は AudioContext と同じであること
   */
  setIR(ch: readonly Float32Array[]): void {
    const c = this.context(),
      n = ch[0].length,
      b = c.createBuffer(ch.length, n, c.sampleRate);
    let e = 0;
    ch.forEach((x, k) => {
      b.copyToChannel(x as Float32Array<ArrayBuffer>, k);
      for (const v of x) e += v * v;
    });
    e /= ch.length;
    /* 応答のエネルギー（1 m 先の直接音を 1 とした標本の 2 乗和）で割る。白色雑音なら乾いた音と同じ大きさになる */
    this.norm = GAIN / Math.sqrt(Math.max(e, 1e-12));
    const v = c.createConvolver();
    v.normalize = false;
    v.buffer = b;
    v.connect(this.out as GainNode);
    const old = this.conv;
    this.conv = v;
    /* 鳴っている音は前の応答のまま終わらせる */
    if (old) setTimeout(() => old.disconnect(), 100 + 1000 * (n / c.sampleRate));
  }

  /**
   * 乾いた音 x（AudioContext と同じ標本化周波数）を鳴らす。dry なら畳み込まずに鳴らす。
   * vol [dB] は音量。戻り値は鳴り始めの時刻（AudioContext の目盛り [s]）
   */
  play(x: Float32Array, mode: Listen, vol: number): number {
    const c = this.context(),
      t = c.currentTime + LEAD,
      buf = c.createBuffer(1, x.length, c.sampleRate);
    this.stop();
    buf.copyToChannel(x as Float32Array<ArrayBuffer>, 0);
    const s = c.createBufferSource(),
      g = c.createGain();
    s.buffer = buf;
    s.connect(g);
    g.gain.value = 10 ** (vol / 20) * (mode === 'dry' ? GAIN : this.norm);
    if (mode === 'dry' || !this.conv) g.connect(this.out as GainNode);
    else g.connect(this.conv);
    s.start(t);
    const item = { s, g };
    this.live.push(item);
    s.onended = () => {
      this.live = this.live.filter((u) => u !== item);
    };
    this.t0 = t;
    return t;
  }

  /** 鳴らしている乾いた音を止める（畳み込みの残りは鳴りきる） */
  stop(fade = FADE): void {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    for (const { s, g } of this.live) {
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0, t + fade);
      s.stop(t + fade + 0.01);
    }
    this.live = [];
  }

  /** 今の時刻（AudioContext の目盛り [s]） */
  now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /** 画面が隠れたら止める（スリープの後に時計が先走らないように） */
  suspend(): void {
    this.stop(0.005);
    void this.ctx?.suspend();
  }

  /** 手持ちの音のファイルを、AudioContext の標本化周波数のモノラルにする */
  async decode(file: ArrayBuffer): Promise<Float32Array> {
    const c = this.context(),
      b = await c.decodeAudioData(file),
      n = b.length,
      y = new Float32Array(n);
    for (let k = 0; k < b.numberOfChannels; k++) {
      const x = b.getChannelData(k);
      for (let i = 0; i < n; i++) y[i] += x[i] / b.numberOfChannels;
    }
    return y;
  }
}
