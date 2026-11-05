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

/** マスコンが 1 段進む時間 [s]（仮定） */
export const NOTCH_STEP = 0.15;
/** 加速とブレーキの段の数 */
const NOTCHES = 3;

/**
 * 惰行の減速度 [km/h/s]（仮定）: 転がりの抵抗と線路の傾斜の分が一定で、空気の抵抗の分が速度の 2 乗で増える。
 * 80 km/h で約 0.23 km/h/s
 */
export const coastDecel = (v: number): number => 0.1 + 2e-5 * v * v;

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
  /** 目標の段（3 が加速最大、−3 がブレーキ最大、0 が惰行） */
  lever = 0;
  /** 今の段。目標の段へ 1 つずつ進む */
  notch = 0;
  private notchWait = 0;
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
    this.notch = 0;
    this.notchWait = 0;
    this.power = false;
    this.brake = false;
    this.slip = 0;
  }

  /** 自動の今の段階から目標の段を決める */
  private autoLever(dt: number): void {
    if (this.phase === 'acc') {
      this.lever = NOTCHES;
      if (this.v >= V_TOP) {
        this.phase = 'coast';
        this.hold = 0;
      }
    }
    if (this.phase === 'coast') {
      this.lever = 0;
      this.hold += dt;
      if (this.hold > COAST) this.phase = 'brk';
    }
    if (this.phase === 'brk') this.lever = -NOTCHES;
  }
  /** 今の段を目標の段へ 1 つずつ進める。押した直後に 1 段目へ入る */
  private stepNotch(dt: number): void {
    if (this.notch === this.lever) {
      this.notchWait = 0;
      return;
    }
    this.notchWait -= dt;
    if (this.notchWait > 0) return;
    this.notch += Math.sign(this.lever - this.notch);
    this.notchWait = NOTCH_STEP;
  }

  /** dt [s] 進める */
  tick(dt: number): void {
    if (this.kind === 'stop') return;
    const c = this.car,
      isAuto = this.kind === 'auto';
    if (isAuto) this.autoLever(dt);
    this.stepNotch(dt);
    const n = this.notch;
    this.power = n > 0;
    this.brake = n < 0;
    let target: number,
      up = JERK_BR,
      dn = isAuto ? JERK_BR : JERK_FAST;
    if (n > 0) {
      target = ((c.a0 * n) / NOTCHES) * Math.min(1, V_POWER / Math.max(this.v, 1));
      up = !isAuto && this.a < 0 ? JERK_FAST : JERK_UP;
    } else if (n < 0) target = brakeTarget((c.b0 * -n) / NOTCHES, this.v);
    else target = -coastDecel(this.v);
    const slipT = this.power ? (SLIP_FULL * n) / NOTCHES : 0,
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
    if (this.v <= 0.02 && (isAuto ? this.phase === 'brk' : this.lever <= 0)) this.halt();
  }
}
