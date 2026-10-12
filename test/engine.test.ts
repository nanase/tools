import { describe, expect, it } from 'vitest';
import { Duct } from '../src/tools/engine/duct';
import { EngineSim } from '../src/tools/engine/engine';
import { type EndState, Orifice, P_ATM, R_GAS, solveEnd } from '../src/tools/engine/gas';
import { JA55, JA65, liftAt, MUFFLERS, specOf } from '../src/tools/engine/spec';
import { torqueAt } from '../src/tools/engine/worker';

const FS = 48000;

describe('絞りの流れ', () => {
  it('チョークすると下流によらず、差圧がなければ 0、逆向きは負', () => {
    const o = new Orifice(1.4),
      A = 1e-4,
      T = 300,
      phiC = Math.sqrt(1.4) * (2 / 2.4) ** (2.4 / 0.8),
      choked = (A * 2e5 * phiC) / Math.sqrt(R_GAS * T);
    expect(o.flow(A, 2e5, T, 5e4, T)).toBeCloseTo(choked, 9);
    expect(o.flow(A, 2e5, T, 9e4, T)).toBeCloseTo(choked, 9);
    expect(o.flow(A, 1e5, T, 1e5, T)).toBe(0);
    expect(o.flow(A, 1e5, T, 1.2e5, T)).toBeLessThan(0);
  });
  it('管の端の境界: 閉じていれば波をそのまま返し、開いていれば pe = pm + 2w + zc ṁ を満たす', () => {
    const o = new Orifice(1.33),
      st: EndState = { pe: P_ATM, m: 0 };
    solveEnd(o, 0, 3e5, 1500, 2000, P_ATM, 1e6, 800, st);
    expect(st.pe).toBeCloseTo(P_ATM + 4000, 6);
    expect(st.m).toBe(0);
    solveEnd(o, 2e-4, 3e5, 1500, 2000, P_ATM, 1e6, 800, st);
    expect(st.m).toBeGreaterThan(0);
    expect(st.pe).toBeCloseTo(P_ATM + 4000 + 1e6 * st.m, 0);
  });
});

describe('管', () => {
  it('開いた端は圧力の波を負で返す（往復の遅れのあと、低い周波数では −1）', () => {
    const d = new Duct([{ len: 0.5, d: 0.02, heat: 0 }], FS, true),
      round = Math.floor(((2 * 0.5) / 346) * FS);
    let early = 0;
    for (let i = 0; i < 2000; i++) {
      d.prepare();
      if (i < round - 2) early = Math.max(early, Math.abs(d.aL[0]));
      d.commit(1, 0);
    }
    expect(early).toBe(0);
    expect(d.aL[0]).toBeCloseTo(-1, 2);
  });
});

describe('弁', () => {
  it('閉じている間は 0、開いている間の中ほどで最大のリフト', () => {
    const v = JA65.inValve;
    expect(liftAt(v, v.open - 1)).toBe(0);
    expect(liftAt(v, v.open + v.dur + 1)).toBe(0);
    expect(liftAt(v, v.open + v.dur / 2)).toBeCloseTo(v.lift, 9);
  });
});

describe('エンジン', () => {
  it('アイドリングは目標の回転数のまわりに落ち着く', () => {
    const e = new EngineSim(JA65, FS);
    for (let i = 0; i < FS * 3; i++) e.step();
    let s = 0;
    const n = FS * 2;
    for (let i = 0; i < n; i++) {
      const y = e.step();
      expect(Number.isFinite(y)).toBe(true);
      s += e.rpm;
    }
    expect(s / n).toBeGreaterThan(1200);
    expect(s / n).toBeLessThan(1650);
  });
  it('全開のトルクは公表の最大トルクに 5 % で合う（JA65・純正、4,750 rpm）', () => {
    expect(torqueAt('ja65', 'stock', 4750)).toBeGreaterThan(11 * 0.95);
    expect(torqueAt('ja65', 'stock', 4750)).toBeLessThan(11 * 1.05);
  });
  it('回転の上限: 手前から点火を遅らせて燃料を絞り（切らない）、上限を大きく超えたときだけ燃料を切る', () => {
    const e = new EngineSim(JA65, FS, 8200);
    e.mode = 'hold';
    e.throttle = 1;
    for (let i = 0; i < FS * 0.2; i++) e.step();
    expect(e.last?.fuel).toBe(true);
    expect(e.last?.limit).toBe(1);
    e.rpm = 8800;
    for (let i = 0; i < FS * 0.2; i++) e.step();
    expect(e.last?.fuel).toBe(false);
  });
  it('負荷なしで全開にすると、回転は上限のあたりで頭打ちになる', () => {
    const e = new EngineSim(JA65, FS);
    e.mode = 'drive';
    e.throttle = 1;
    let mx = 0;
    for (let i = 0; i < FS * 4; i++) {
      e.step();
      if (i > FS * 2) mx = Math.max(mx, e.rpm);
    }
    expect(mx).toBeGreaterThan(7600);
    expect(mx).toBeLessThan(8400);
  });
  it('走行: 1 速で全開にすると進み、ブレーキで止まる', () => {
    const e = new EngineSim(JA65, FS);
    e.mode = 'drive';
    for (let i = 0; i < FS * 0.5; i++) e.step();
    e.shift(1);
    for (let i = 0; i < FS * 0.5; i++) e.step();
    expect(e.gear).toBe(1);
    e.throttle = 1;
    for (let i = 0; i < FS * 3; i++) e.step();
    expect(e.v * 3.6).toBeGreaterThan(15);
    e.throttle = 0;
    e.brake = 1;
    for (let i = 0; i < FS * 4; i++) e.step();
    expect(e.v).toBe(0);
    expect(e.dist).toBeGreaterThan(5);
  });
  it('変速: シフトアップの間は回転が上がらず、低い速度のシフトダウンでも回転が落ちない（ワンウェイクラッチ）', () => {
    const e = new EngineSim(JA65, FS);
    e.mode = 'drive';
    for (let i = 0; i < FS * 0.5; i++) e.step();
    e.shift(1);
    for (let i = 0; i < FS * 0.3; i++) e.step();
    e.throttle = 1;
    while (e.rpm < 6500) e.step();
    const r0 = e.rpm;
    e.shift(1);
    let mx = 0;
    while (e.shifting) {
      e.step();
      mx = Math.max(mx, e.rpm);
    }
    expect(e.gear).toBe(2);
    expect(mx).toBeLessThan(r0 + 100);
    /* 2 速で 15 km/h ほどまで落としてから 1 速へ: 車輪がエンジンを回す */
    e.throttle = 0;
    e.brake = 0.5;
    while (e.v * 3.6 > 15) e.step();
    e.brake = 0;
    e.shift(-1);
    for (let i = 0; i < FS * 0.6; i++) e.step();
    expect(e.gear).toBe(1);
    expect(e.rpm).toBeGreaterThan(2500);
  });
  it('エンジンとマフラーの組み合わせ', () => {
    expect(specOf('ja55', 'delta').bore).toBe(JA55.bore);
    expect(specOf('ja65', 'delta').exhaust.length).toBe(MUFFLERS.delta.segs.length);
    /* 音色の補正は純正だけ */
    expect(specOf('ja55', 'stock').tone).toBeDefined();
    expect(specOf('ja65', 'delta').tone).toBeUndefined();
  });
});
