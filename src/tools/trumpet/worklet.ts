/**
 * トランペットの音を作る AudioWorklet。audio.ts が ?worker&url で読み込み、'trumpet-model' として使う。
 * 奏者（player.ts）と楽器（instrument.ts）を標本ごとに回し、1 m 先の音圧 [Pa] に部屋の残響を足して出す
 * （音量は主スレッドの GainNode）。約 25 回/秒、鳴っている音の 1 周期を 24 の位相に分けて、唇の開き・
 * マウスピースの圧力・流量と、管の中の圧力（図が頼んだ点）を写して送る（図のスローと振れ幅に使う）
 */
import { Reverb, type ReverbSpec } from '../../lib/reverb';
import { PHASES, SCOPE_N } from './frame';
import { Trumpet } from './instrument';
import { type Manual, Player, type PNote } from './player';

/* AudioWorkletGlobalScope の名前（TypeScript の DOM の型にはない） */
declare const sampleRate: number;
declare const currentTime: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

export interface Opts {
  temp: number;
  brass: number;
  onAxis: boolean;
  vib: boolean;
  /** 息の雑音（割合） */
  noise: number;
  /** 抜差しで音程を直す */
  slides: boolean;
}

/** 主スレッドから送るもの */
export type TpMsg =
  /* 図が管の中の圧力を読む点: (要素, 位置) の対の列（Bore.pressureAt） */
  | { type: 'init'; pts: Float32Array; opts: Opts }
  | { type: 'opts'; opts: Partial<Opts> }
  | { type: 'manual'; m: Manual | null }
  | { type: 'piece'; notes: PNote[]; from: number }
  | { type: 'stopPiece' }
  | { type: 'mute' }
  | { type: 'room'; r: ReverbSpec }
  | { type: 'scope'; on: boolean }
  /* 残っている音と残響をすぐ消す（一時停止の間に止めたとき） */
  | { type: 'reset' };

/** 主スレッドへ送るもの */
export type TpOut =
  | {
      type: 'frame';
      /** AudioContext の時刻 [s]、曲の頭からの時刻 [s]、曲の中の音の番号（なければ −1） */
      t: number;
      time: number;
      idx: number;
      /** 狙っている音（MIDI、なければ −1）、鳴っている音の高さ（測った値 [Hz]、鳴っていなければ 0） */
      m: number;
      f0: number;
      /** 口の圧力 [Pa]、唇の共振 [Hz]、弁の押し具合 */
      pm: number;
      fl: number;
      press: [number, number, number];
      /** 1 周期の位相ごとの、唇の開き [m]・マウスピースの圧力 [Pa]・流量 [m³/s]・管の中の圧力 [Pa]（位相 × 点） */
      h: Float32Array;
      p: Float32Array;
      u: Float32Array;
      air: Float32Array;
      /** 直前の 1 周期の出力の実効値 [Pa] */
      rms: number;
    }
  | { type: 'wave'; y: Float32Array; fs: number }
  | { type: 'done' };

/** 図を送る間隔 [s] */
const FRAME = 0.04;

registerProcessor(
  'trumpet-model',
  class extends AudioWorkletProcessor {
    private tr: Trumpet | null = null;
    private readonly pl = new Player(sampleRate);
    private readonly rv = new Reverb(sampleRate);
    private opts: Opts = { temp: 27, brass: 1, onAxis: true, vib: false, noise: 0.01, slides: true };
    private pts: Float32Array = new Float32Array(0);
    /* 写し取り: 次に始める標本、写している位相（−1 は待ち）、次の位相の標本、1 位相の長さ */
    private n = 0;
    private next = 0;
    private ph = -1;
    private at = 0;
    private step = 0;
    private h = new Float32Array(PHASES);
    private p = new Float32Array(PHASES);
    private u = new Float32Array(PHASES);
    private air = new Float32Array(0);
    /* 音高: マウスピースの圧力の平均（低域通過）と、上向きに 0 を横切った時刻 */
    private mean = 0;
    private last = 0;
    private cross: number[] = [];
    private e2 = 0;
    private ne = 0;
    private rms = 0;
    private wasPlaying = false;
    private scope = false;
    private ring = new Float32Array(SCOPE_N);
    private rw = 0;
    private sentWave = 0;
    constructor() {
      super();
      this.port.onmessage = (ev: MessageEvent<TpMsg>) => this.msg(ev.data);
    }
    /** 楽器を作る（唇の張りの表を作った 27 °C で。温度は時間の刻みの倍率で変える） */
    private build(): void {
      const tr = new Trumpet(sampleRate, { temp: 27, brass: this.opts.brass, onAxis: this.opts.onAxis });
      tr.slides = this.opts.slides;
      tr.setTemp(this.opts.temp);
      this.tr = tr;
    }
    private msg(m: TpMsg): void {
      if (m.type === 'init') {
        this.pts = m.pts;
        this.air = new Float32Array(PHASES * (m.pts.length / 2));
        this.opts = m.opts;
        this.pl.vib = m.opts.vib;
        this.pl.noiseAmp = m.opts.noise;
        this.build();
      } else if (m.type === 'opts') {
        const o = { ...this.opts, ...m.opts };
        this.opts = o;
        this.pl.vib = o.vib;
        this.pl.noiseAmp = o.noise;
        if (this.tr) {
          this.tr.setTemp(o.temp);
          this.tr.setBrass(o.brass);
          if (m.opts.onAxis !== undefined) this.tr.setOnAxis(o.onAxis);
          this.tr.slides = o.slides;
        }
      } else if (m.type === 'manual') this.pl.setManual(m.m);
      else if (m.type === 'piece') {
        this.pl.start(m.notes, m.from);
        this.wasPlaying = true;
      } else if (m.type === 'stopPiece') {
        /* 止めたときは終わりを知らせない（すぐ別の位置から弾き直すと、新しい演奏の終わりと取り違える） */
        this.pl.stop();
        this.wasPlaying = false;
      } else if (m.type === 'mute') {
        this.pl.stop();
        this.wasPlaying = false;
        this.pl.setManual(null);
        this.tr?.reset();
        this.pl.pm = 0;
      } else if (m.type === 'room') this.rv.set(m.r);
      else if (m.type === 'scope') this.scope = m.on;
      else {
        this.tr?.reset();
        this.rv.clear();
        this.pl.pm = 0;
      }
    }
    /** 鳴っている音の高さ [Hz]（直近の 0 の横切りの間隔の平均） */
    private f0(): number {
      const c = this.cross;
      if (c.length < 4 || this.n - c[c.length - 1] > 0.05 * sampleRate) return 0;
      return ((c.length - 1) * sampleRate) / (c[c.length - 1] - c[0]);
    }
    process(_in: Float32Array[][], outputs: Float32Array[][]): boolean {
      const out = outputs[0],
        tr = this.tr;
      if (!out.length || !tr) return true;
      const L = out[0],
        R = out[1] ?? L,
        len = L.length,
        pl = this.pl,
        lips = tr.lips,
        bore = tr.bore,
        np = this.pts.length / 2;
      for (let i = 0; i < len; i++) {
        const y = pl.step(tr);
        L[i] = y;
        R[i] = y;
        this.ring[this.rw] = y;
        this.rw = (this.rw + 1) % SCOPE_N;
        this.e2 += y * y;
        this.ne++;
        /* 音高 */
        const p = lips.p;
        this.mean += (p - this.mean) * 0.002;
        const v = p - this.mean;
        if (this.last <= 0 && v > 0) {
          this.cross.push(this.n - v / (v - this.last));
          if (this.cross.length > 9) this.cross.shift();
        }
        this.last = v;
        /* 写し取り */
        if (this.ph < 0 && this.n >= this.next) {
          const f = this.f0() || (pl.ctl.m >= 0 ? 440 * 2 ** ((pl.ctl.m - 69) / 12) : 233);
          this.step = sampleRate / f / PHASES;
          this.ph = 0;
          this.at = this.n;
        }
        if (this.ph >= 0 && this.n >= this.at) {
          const k = this.ph;
          this.h[k] = lips.y + lips.prm.h0;
          this.p[k] = p;
          this.u[k] = lips.u;
          for (let j = 0; j < np; j++) this.air[k * np + j] = bore.pressureAt(this.pts[2 * j], this.pts[2 * j + 1]);
          this.ph++;
          this.at += this.step;
          if (this.ph >= PHASES) {
            this.rms = Math.sqrt(this.e2 / Math.max(1, this.ne));
            this.e2 = 0;
            this.ne = 0;
            const c = pl.ctl;
            this.port.postMessage({
              type: 'frame',
              t: currentTime,
              time: pl.time,
              idx: c.idx,
              m: c.m,
              f0: this.f0(),
              pm: c.pm,
              fl: c.fl,
              press: [tr.press(0), tr.press(1), tr.press(2)],
              h: this.h.slice(),
              p: this.p.slice(),
              u: this.u.slice(),
              air: this.air.slice(),
              rms: this.rms,
            } satisfies TpOut);
            this.ph = -1;
            this.next = this.n + FRAME * sampleRate;
          }
        }
        this.n++;
      }
      this.rv.process(L, R, 0, len);
      if (this.wasPlaying && !pl.playing) {
        this.wasPlaying = false;
        this.port.postMessage({ type: 'done' } satisfies TpOut);
      }
      if (this.scope && this.n - this.sentWave > 0.1 * sampleRate) {
        this.sentWave = this.n;
        const y = new Float32Array(SCOPE_N);
        for (let i = 0; i < SCOPE_N; i++) y[i] = this.ring[(this.rw + i) % SCOPE_N];
        this.port.postMessage({ type: 'wave', y, fs: sampleRate } satisfies TpOut);
      }
      return true;
    }
  },
);
