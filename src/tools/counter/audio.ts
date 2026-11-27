/**
 * 段ごとの音。スピーカーのボタンで段を選び、いくつでも同時に鳴らせる。
 * 今の速さで 20 Hz 以上になる段はその周波数の正弦波、20 Hz 未満の段は出力が変わるたびに短い音で鳴らす。
 * 段は 1 つ下がるごとにちょうど 1 オクターブ下がるので、重ねるとオクターブの和音になる。
 * 耳に痛い倍音を避けて正弦波にし、段ごとの大きさは A 特性の逆でおおよそそろえる（ユーザーの判断、2026-11-27）
 */
import { edges, F32, qv, STAGES, stF } from './model';

/** 正弦波にする下限 [Hz]。これより遅い段は変わり目ごとに短い音で鳴らす */
export const TONE_HZ = 20;
/** A 特性の重み（振幅の比、1 kHz で 1。IEC 61672-1 の式） */
export function aWeight(f: number): number {
  const f2 = f * f,
    ra =
      (12194 ** 2 * f2 * f2) /
      ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2));
  return ra * 10 ** (2 / 20);
}
/** 正弦波の振幅。A 特性の逆で大きさをそろえ、低い段は 1 kHz の 1/0.6 倍で止める。12 kHz より上は 12 kHz と同じ重み */
export const toneGain = (f: number): number => 0.09 * Math.min(1, 0.6 / Math.max(0.2, aWeight(Math.min(f, 12000))));
/** 変わり目の短い音: 立ち上がりと立ち下がりの高さ [Hz]・振幅・長さ [s] */
const TICK_UP = 880,
  TICK_DOWN = 660,
  TICK_GAIN = 0.18,
  TICK_LEN = 0.06;
/** 1 こまで鳴らす短い音の上限 */
const MAX_TICKS = 8;
/** 短い音を鳴らすまでの余裕 [s]。こまの中の時刻のずれを保って鳴らす */
const LAG = 0.05;

interface Tone {
  o: OscillatorNode;
  g: GainNode;
}

export class StageAudio {
  /** 鳴らしている段 */
  readonly on = new Set<number>();
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private tones = new Map<number, Tone>();
  private vol = 1;

  private context(): AudioContext {
    if (!this.ctx) {
      const c = new AudioContext(),
        out = c.createGain();
      out.gain.value = this.vol;
      out.connect(c.destination);
      this.ctx = c;
      this.out = out;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** 音量 [dB] */
  setVol(db: number): void {
    this.vol = 10 ** (db / 20);
    if (this.ctx && this.out) this.out.gain.setTargetAtTime(this.vol, this.ctx.currentTime, 0.02);
  }

  /** 段 k を鳴らす・止める。戻り値は鳴らしているか */
  toggle(k: number): boolean {
    this.context();
    if (this.on.has(k)) this.on.delete(k);
    else this.on.add(k);
    return this.on.has(k);
  }

  /** 鳴らせない段（速さを上げて高くなりすぎた段）を外す。外した段があれば true */
  drop(ok: (k: number) => boolean): boolean {
    let n = 0;
    for (const k of [...this.on])
      if (!ok(k)) {
        this.on.delete(k);
        n++;
      }
    return n > 0;
  }

  /** すべて止める */
  stop(): void {
    this.on.clear();
    this.sync(0, 0, 1);
  }

  /** 画面が隠れたときなどに AudioContext を止める */
  suspend(): void {
    this.stop();
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  /**
   * 時計が t0 から t1 まで進んだ分を鳴らす（sp は速さ）。正弦波は周波数を合わせ、
   * 短い音はその間の出力の変わり目ごとに、実際の時刻のずれを保って鳴らす
   */
  sync(t0: number, t1: number, sp: number): void {
    const c = this.ctx;
    if (!c || !this.out) return;
    const now = c.currentTime;
    for (let k = 0; k <= STAGES; k++) {
      const f = stF(k) * sp,
        want = this.on.has(k) && f >= TONE_HZ;
      let tn = this.tones.get(k);
      if (want && !tn) {
        const o = c.createOscillator(),
          g = c.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(toneGain(f), now + 0.02);
        o.connect(g).connect(this.out);
        o.start(now);
        tn = { o, g };
        this.tones.set(k, tn);
      } else if (want && tn) {
        tn.o.frequency.setTargetAtTime(f, now, 0.01);
        tn.g.gain.setTargetAtTime(toneGain(f), now, 0.01);
      } else if (!want && tn) {
        tn.g.gain.cancelScheduledValues(now);
        tn.g.gain.setValueAtTime(tn.g.gain.value, now);
        tn.g.gain.linearRampToValueAtTime(0, now + 0.04);
        tn.o.stop(now + 0.06);
        this.tones.delete(k);
      }
      if (this.on.has(k) && f < TONE_HZ && t1 > t0) {
        const n = Math.min(MAX_TICKS, edges(k, t0, t1));
        const h = k === 0 ? 0.5 : 2 ** (k - 1);
        for (let i = 0; i < n; i++) {
          const te = (Math.floor(t1 / h) - i) * h,
            dt = (te - t1) / (F32 * sp);
          this.tick(qv(k, te + h / 2) === 1, now + LAG + Math.max(-LAG, dt));
        }
      }
    }
  }

  /** 変わり目の短い音。立ち上がりは高く、立ち下がりは低く */
  private tick(up: boolean, when: number): void {
    const c = this.ctx;
    if (!c || !this.out) return;
    const o = c.createOscillator(),
      g = c.createGain();
    o.frequency.value = up ? TICK_UP : TICK_DOWN;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(TICK_GAIN, when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, when + TICK_LEN);
    o.connect(g).connect(this.out);
    o.start(when);
    o.stop(when + TICK_LEN + 0.02);
  }
}
