/** 運転: 自動（発車から停止まで）・手動（加速とブレーキのボタン）・緊急停止で速度を決める */
import { type Car, type Run, V_MAX } from './cars';

/** 自動運転の上の速度 [km/h] */
export const V_TOP = 80;
/** 自動運転で惰行する時間 [s] */
const COAST = 2.5;
/** これより速いと加速度が落ちる速度 [km/h]（定出力の領域の仮定） */
const V_POWER = 65;
/** 加速度の変化の上限 [km/h/s²]: 自動の出だし・ブレーキ・手動で逆へ切り替えるとき */
const JERK_UP = 1.3,
  JERK_BR = 1.4,
  JERK_FAST = 3;

/**
 * 加速のすべり周波数: 全負荷の値 [Hz] と立ち上がりの速さ [Hz/s]（仮定）。トルクは速度より先に立ち上がるので、
 * 発車直後はほとんど止まっていても基本波が上がる
 */
const SLIP_FULL = 2.6,
  SLIP_RISE = 1.4,
  SLIP_FALL = 6;

export type DriveKind = 'stop' | 'auto' | 'hand';
type Phase = 'acc' | 'coast' | 'brk';

/** ブレーキの強さ: 止まる直前は弱めてなめらかに止める */
const brakeTarget = (b: number, v: number): number => -Math.min(b, Math.sqrt(2 * JERK_BR * Math.max(v, 0)));

export class Drive implements Run {
  v = 0;
  a = 0;
  power = false;
  brake = false;
  slip = 0;
  kind: DriveKind = 'stop';
  /** 手動のときの段（3 が加速最大、−3 がブレーキ最大、0 が惰行） */
  lever = 0;
  private phase: Phase = 'acc';
  private hold = 0;

  constructor(public car: Car) {}

  /** 自動を入れる。今の速度から続ける */
  auto(): void {
    this.kind = 'auto';
    this.phase = this.v >= V_TOP ? 'coast' : 'acc';
    this.hold = 0;
  }
  /** 手動の段を選ぶ */
  hand(lever: number): void {
    this.kind = 'hand';
    this.lever = lever;
    if (lever <= 0 && this.v <= 0) this.halt();
  }
  /** 緊急停止: すぐに 0 km/h にする */
  halt(): void {
    this.kind = 'stop';
    this.v = 0;
    this.a = 0;
    this.lever = 0;
    this.power = false;
    this.brake = false;
    this.slip = 0;
  }

  /** dt [s] 進める */
  tick(dt: number): void {
    if (this.kind === 'stop') return;
    const c = this.car;
    let target = 0,
      up = JERK_BR,
      dn = JERK_BR;
    this.power = false;
    this.brake = false;
    if (this.kind === 'auto') {
      if (this.phase === 'acc') {
        target = c.a0 * Math.min(1, V_POWER / Math.max(this.v, 1));
        this.power = true;
        up = JERK_UP;
        if (this.v >= V_TOP) {
          this.phase = 'coast';
          this.hold = 0;
        }
      }
      if (this.phase === 'coast') {
        this.power = false;
        target = 0;
        this.hold += dt;
        if (this.hold > COAST) this.phase = 'brk';
      }
      if (this.phase === 'brk') {
        target = brakeTarget(c.b0, this.v);
        this.brake = true;
      }
    } else {
      const l = this.lever;
      if (l > 0) {
        target = ((c.a0 * l) / 3) * Math.min(1, V_POWER / Math.max(this.v, 1));
        this.power = true;
        up = this.a < 0 ? JERK_FAST : JERK_UP;
      } else if (l < 0) {
        target = brakeTarget((c.b0 * -l) / 3, this.v);
        this.brake = true;
      }
      dn = JERK_FAST;
    }
    const slipT = this.power ? SLIP_FULL * (this.kind === 'hand' ? this.lever / 3 : 1) : 0,
      ds = slipT > this.slip ? SLIP_RISE * dt : -SLIP_FALL * dt;
    this.slip = ds > 0 ? Math.min(slipT, this.slip + ds) : Math.max(slipT, this.slip + ds);
    const j = (target > this.a ? up : dn) * dt;
    this.a += Math.max(-j, Math.min(j, target - this.a));
    this.v = Math.max(0, this.v + this.a * dt);
    if (this.v >= V_MAX && this.a > 0) {
      this.v = V_MAX;
      this.a = 0;
    }
    /* 止まりきったら停止にする。手動で加速の段にある間は止めない */
    if (this.v <= 0.02 && (this.kind === 'auto' ? this.phase === 'brk' : this.lever <= 0)) this.halt();
  }
}
