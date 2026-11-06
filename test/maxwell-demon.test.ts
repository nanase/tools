import { describe, expect, it } from 'vitest';
import { ledger } from '../src/tools/maxwell-demon/fig';
import { Gas, LN2, lnFact, MS, mb2 } from '../src/tools/maxwell-demon/gas';

const energy = (g: Gas): number => {
  let e = 0;
  for (let i = 0; i < g.n; i++) e += 0.5 * (g.vx[i] ** 2 + g.vy[i] ** 2);
  return e;
};
/** 気体・記録・消去の熱の合計 [k] */
const total = (g: Gas): number => g.entropy() + g.memory() + g.heat();

describe('マクスウェルの悪魔の気体', () => {
  it('初めは左右に半分ずつ、どちらも 300 K。気体のエントロピーも記録も 0', () => {
    const g = new Gas(200);
    const { N, T } = g.stats();
    expect(N).toEqual([100, 100]);
    expect(g.entropy()).toBeCloseTo(0, 10);
    expect(g.tape).toHaveLength(0);
    expect(T[0]).toBeCloseTo(1, 10);
    expect(T[1]).toBeCloseTo(1, 10);
  });

  it('衝突で運動エネルギーは変わらない', () => {
    const g = new Gas(200),
      e0 = energy(g);
    g.run(20);
    expect(energy(g) / e0).toBeCloseTo(1, 9);
  });

  it('温度の差の悪魔は右を熱く、左を冷たくする', () => {
    const g = new Gas(200);
    g.cap = 1e9;
    g.run(40);
    const { T } = g.stats();
    expect(T[1] * 300).toBeGreaterThan(400);
    expect(T[0] * 300).toBeLessThan(200);
    expect(g.entropy()).toBeLessThan(-20);
  });

  it('圧力の差の悪魔は分子を右へ集める', () => {
    const g = new Gas(200);
    g.mode = 'press';
    g.run(40);
    const { N } = g.stats();
    expect(N[1]).toBeGreaterThan(180);
  });

  it('悪魔がいなければ温度の差は戻る', () => {
    const g = new Gas(200);
    g.run(30);
    g.mode = 'none';
    g.run(40);
    const { T } = g.stats();
    expect(Math.abs(T[0] - T[1]) * 300).toBeLessThan(60);
  });

  it('気体・記録・消去の熱の合計は負にならない', () => {
    for (const mode of ['temp', 'press', 'none'] as const)
      for (const n of [1, 2, 3, 20, 200]) {
        const g = new Gas(n);
        g.mode = mode;
        g.cap = 64;
        expect(total(g), `${mode} ${n} 初め`).toBeGreaterThanOrEqual(-1e-9);
        for (let k = 0; k < 30; k++) {
          g.run(1);
          expect(total(g), `${mode} ${n} ${k}`).toBeGreaterThanOrEqual(-1e-9);
        }
      }
  });

  it('悪魔の種類を切り替え、手で開け閉めしても合計は負にならない', () => {
    const modes = ['temp', 'none', 'press', 'hand', 'temp', 'hand', 'press'] as const;
    for (const n of [1, 3, 50]) {
      const g = new Gas(n);
      g.cap = 8;
      for (const m of modes) {
        g.mode = m;
        for (let k = 0; k < 20; k++) {
          if (m === 'hand') g.setHand(k % 3 === 0);
          g.run(0.5);
          expect(total(g), `${n} ${m} ${k}`).toBeGreaterThanOrEqual(-1e-9);
        }
        g.setHand(false);
      }
    }
  });

  it('記憶が満杯になると消して熱を出す', () => {
    const g = new Gas(200);
    g.cap = 32;
    g.run(10);
    expect(g.tape.length).toBeLessThanOrEqual(32);
    expect(g.erased).toBeGreaterThan(0);
    expect(g.heat()).toBeCloseTo(g.erased * LN2, 10);
    expect(g.erased + g.tape.length).toBe(g.meas);
  });

  it('記憶が 1 ビットなら、判断のたびに前の記録を消す', () => {
    const g = new Gas(1);
    g.cap = 1;
    g.mode = 'press';
    for (let k = 0; k < 400 && g.meas < 3; k++) g.run(1);
    expect(g.meas).toBeGreaterThanOrEqual(3);
    expect(g.tape).toHaveLength(1);
    expect(g.erased).toBe(g.meas - 1);
    expect(total(g)).toBeGreaterThanOrEqual(-1e-9);
  });

  it('分子 1 個は、初めて測った時点で −k ln 2、記録 1 ビット', () => {
    for (const mode of ['temp', 'press'] as const) {
      const g = new Gas(1);
      g.mode = mode;
      g.cap = 1;
      expect(g.entropy()).toBeCloseTo(0, 10);
      while (g.meas === 0 && g.t < 400) g.step(1 / 600);
      expect(g.meas, mode).toBe(1);
      expect(g.entropy(), mode).toBeCloseTo(-LN2, 10);
      expect(total(g), mode).toBeCloseTo(0, 10);
    }
  });

  it('記録を数えない合計は、消すまで負で、消すと取り戻す', () => {
    const g = new Gas(1);
    g.mode = 'press';
    g.cap = 1;
    while (g.meas === 0 && g.t < 400) g.step(1 / 600);
    const l1 = ledger(g);
    expect(l1.sum).toBeCloseTo(-LN2, 10);
    expect(l1.all).toBeCloseTo(0, 10);
    while (g.meas === 1 && g.t < 800) g.step(1 / 600);
    const l2 = ledger(g);
    expect(l2.heat).toBeCloseTo(LN2, 10);
    expect(l2.sum).toBeCloseTo(0, 10);
  });

  it('扉を開けると悪魔は知識を失い、気体は 0 に戻る', () => {
    const g = new Gas(200);
    g.mode = 'press';
    g.run(20);
    expect(g.entropy()).toBeLessThan(-20);
    g.mode = 'none';
    expect(g.entropy()).toBe(0);
    g.run(1);
    g.mode = 'press';
    expect(g.entropy()).toBeCloseTo(0, 10);
  });

  it('圧力の差の悪魔で左右の数がかたよると、左右の数の項が下がる', () => {
    const g = new Gas(200);
    g.mode = 'press';
    g.run(40);
    expect(g.stats().N[1]).toBeGreaterThan(180);
    expect(g.entropy()).toBeLessThan(-80);
  });

  it('手で操作するときは開けると閉じるを 1 回ずつ数える', () => {
    const g = new Gas(20);
    g.mode = 'hand';
    const b = g.tape.length;
    g.setHand(true);
    g.setHand(true);
    g.setHand(false);
    expect(g.meas).toBe(2);
    expect(g.tape.length).toBe(b + 2);
  });

  it('マクスウェル分布の中央値が既定のしきい値', () => {
    let s = 0;
    const dv = 1e-4,
      med = Math.sqrt(2 * LN2);
    for (let v = dv / 2; v < med; v += dv) s += mb2(v, 1) * dv;
    expect(s).toBeCloseTo(0.5, 4);
    expect(Math.round(med * MS)).toBe(351);
  });

  it('ln n! は対数の和', () => {
    expect(lnFact(0)).toBe(0);
    expect(lnFact(5)).toBeCloseTo(Math.log(120), 12);
  });
});
