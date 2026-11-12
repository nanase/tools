/**
 * 音の処理の本体（DOM に依存しない）: ワークレット（worklet.ts）と試験で使う。
 * 画面からの指示（Msg）を受けて機材の並び（Rig）とフレーズの進行（Seq）を動かし、
 * 段ごとの最新 TAP_N サンプルと弦の様子（Snap）をときどき画面へ送る。
 * 音色を替えるときは、短く絞ってから設定を替え、前の音色の残り（弦・ディレイ・リバーブ）を消してから戻す
 */

import { Seq } from './phrases';
import { type Rack, Rig, type StageId } from './rig';

export type Msg =
  /** 機材の設定を替える。swap なら音色の切り替え（絞って前の音を消してから替える） */
  | { t: 'rack'; R: Rack; swap?: boolean }
  | { t: 'pluck'; si: number; fret: number; amp: number }
  /** フレーズを拍 beat から弾く */
  | { t: 'play'; v: string; bpm: number; beat: number }
  /** フレーズを止める（弦は鳴らしたまま） */
  | { t: 'pause' }
  | { t: 'bpm'; bpm: number }
  /** フレーズの移調 [半音] */
  | { t: 'key'; k: number }
  /** 弦 si を止める（-1 はすべて） */
  | { t: 'mute'; si: number }
  /** 試聴する段（その段を通った音をそのまま出す）。'out' は出力 */
  | { t: 'listen'; k: StageId }
  | { t: 'pick'; x: number }
  /** MIDI のホイール: ピッチベンド [半音]・ビブラート [半音] */
  | { t: 'wheel'; bend: number; vib: number };

/** 弦 1 本の様子: フレット・振れ [m]・チョーキング [半音]。鳴っていなければ null */
export type StrSnap = { fret: number; amp: number; bend: number } | null;
export interface Snap {
  /** 段ごとの最新 TAP_N サンプル（古い順） */
  taps: Record<StageId, Float32Array>;
  str: StrSnap[];
  /** フレーズの拍（弾いていなければ -1） */
  beat: number;
  /** 前の写しから後に弾いた弦とフレット */
  plucks: { si: number; fret: number }[];
}

export const TAP_N = 2048;
/** 画面へ送る間隔 [サンプル] */
const SNAP_EVERY = 1536;
/** 音色を替えるときに絞る時間 [s] */
const SWAP_S = 0.012;

export class Proc {
  readonly rig: Rig;
  readonly seq: Seq;
  private listen: StageId = 'out';
  /** 試聴する段の番号（-1 は出力） */
  private li = -1;
  /** 段ごとの波形のため（段の名前で持ち、並びが変わっても残す） */
  private readonly bufs = new Map<StageId, Float32Array>();
  private row: Float32Array[] = [];
  /** 出力（左右の平均）の波形のため */
  private readonly outBuf = new Float32Array(TAP_N);
  private w = 0;
  private cnt = 0;
  private readonly lr = new Float64Array(2);
  /** 出力の大きさ（0〜1）と、絞り終えたら替える設定 */
  private g = 1;
  private pending: Rack | null = null;

  constructor(
    fs: number,
    private readonly send: (s: Snap) => void,
  ) {
    this.rig = new Rig(fs);
    this.seq = new Seq(this.rig);
    this.restage();
  }

  /** 並びが変わったあと: 波形のためと試聴の段を合わせる */
  private restage(): void {
    const st = this.rig.stages;
    this.row = st.map((id) => {
      let b = this.bufs.get(id);
      if (!b) {
        b = new Float32Array(TAP_N);
        this.bufs.set(id, b);
      }
      return b;
    });
    for (const id of [...this.bufs.keys()]) if (!st.includes(id)) this.bufs.delete(id);
    this.li = st.indexOf(this.listen);
  }

  private apply(R: Rack): void {
    this.rig.setRack(R);
    this.restage();
  }

  msg(m: Msg): void {
    const r = this.rig;
    if (m.t === 'rack') {
      if (m.swap) this.pending = m.R;
      else this.apply(m.R);
    } else if (m.t === 'pluck') r.pluck(m.si, m.fret, { amp: m.amp });
    else if (m.t === 'play') this.seq.start(m.v, m.bpm, m.beat);
    else if (m.t === 'pause') this.seq.stop();
    else if (m.t === 'bpm') this.seq.bpm = m.bpm;
    else if (m.t === 'key') this.seq.key = m.k;
    else if (m.t === 'mute') {
      for (let s = 0; s < 6; s++) if (m.si < 0 || s === m.si) r.stopString(s, 120);
    } else if (m.t === 'listen') {
      this.listen = m.k;
      this.li = r.stages.indexOf(m.k);
    } else if (m.t === 'pick') r.pickPos = m.x;
    else r.wheel(m.bend, m.vib);
  }

  /** 出力を L・R へ書く */
  run(L: Float32Array, R: Float32Array): void {
    const n = L.length,
      r = this.rig,
      lr = this.lr,
      fs = r.fs,
      dg = 1 / (SWAP_S * fs);
    for (let j = 0; j < n; j += 128) {
      const m = Math.min(128, n - j);
      /* 音色を替えている間は進めない（前の音色で弾かない） */
      if (!this.pending) this.seq.step(m / fs);
      for (let i = j; i < j + m; i++) {
        /* 音色の切り替え: 絞りきったら替えて、前の音を消してから戻す */
        if (this.pending) {
          this.g -= dg;
          if (this.g <= 0) {
            this.g = 0;
            this.apply(this.pending);
            r.clear();
            this.pending = null;
          }
        } else if (this.g < 1) this.g = Math.min(1, this.g + dg);
        r.sample(lr);
        const g = this.g,
          tap = r.tap,
          row = this.row;
        if (this.li < 0) {
          L[i] = lr[0] * g;
          R[i] = lr[1] * g;
        } else L[i] = R[i] = tap[this.li] * g;
        for (let k = 0; k < row.length; k++) row[k][this.w] = tap[k];
        this.outBuf[this.w] = 0.5 * (lr[0] + lr[1]);
        this.w = (this.w + 1) % TAP_N;
      }
    }
    this.cnt += n;
    if (this.cnt >= SNAP_EVERY) {
      this.cnt = 0;
      this.send(this.snap());
    }
  }

  snap(): Snap {
    const taps: Record<StageId, Float32Array> = {};
    for (const [id, b] of [...this.bufs, ['out', this.outBuf] as const]) {
      const a = new Float32Array(TAP_N);
      a.set(b.subarray(this.w), 0);
      a.set(b.subarray(0, this.w), TAP_N - this.w);
      taps[id] = a;
    }
    const str: StrSnap[] = [null, null, null, null, null, null];
    for (const v of this.rig.voices) {
      let amp = 0;
      for (let i = 0; i < Math.min(v.n, 32); i++) amp += Math.abs(v.re[i]);
      str[v.si] = { fret: v.fret, amp, bend: v.bend };
    }
    const ph = this.seq.ph,
      plucks = this.rig.plucked.splice(0);
    return { taps, str, beat: ph ? this.seq.beat : -1, plucks };
  }
}
