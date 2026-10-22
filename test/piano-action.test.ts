import { describe, expect, it } from 'vitest';
import { CONTACTS, Q_FIG } from '../src/tools/piano-action/geom';
import { Action, gp, headGap, pose, REG0, rigOf, touch } from '../src/tools/piano-action/model';
import { simulate } from '../src/tools/piano-action/sim';
import { events, stages } from '../src/tools/piano-action/stages';

/** 力をかけずに t [s] 動かした姿勢 */
function settle(t = 0.3): Action {
  const a = new Action(rigOf(REG0, Q_FIG), Q_FIG);
  for (let i = 0; i < t / 2e-5; i++) a.step(2e-5);
  return a;
}

describe('静止の姿勢', () => {
  const a = settle();
  it('図 A.1 の姿勢から 2° 以内でつり合い、速さがほぼ 0 になる', () => {
    for (let i = 0; i < 5; i++) expect(Math.abs(a.q[i] - Q_FIG[i])).toBeLessThan((2 * Math.PI) / 180);
    expect(Math.max(...Array.from(a.qd, Math.abs))).toBeLessThan(0.01);
  });
  it('付いている接触は、キャプスタン・バックレール・ジャックの止め・レペティションのねじ・ナックル・ハンマーレール', () => {
    const on = CONTACTS.filter((_, k) => a.fn[k] > 0.005).map((c) => c.n);
    expect(on).toEqual([1, 3, 5, 6, 7, 13]);
  });
  it('ハンマーの頭から弦までは約 48 mm（論文の整調の目標）', () => {
    expect(headGap(pose(a.q), 0.1706)).toBeCloseTo(0.048, 3);
  });
});

describe('整調から点の位置を決める', () => {
  const q0 = settle().q;
  it('レットオフ 2 mm: ハンマーが弦から 2 mm の姿勢で、ジャックのつま先がボタンにちょうど触れる', () => {
    const rig = rigOf({ ...REG0, letoff: 0.002 }, q0);
    /* ゆっくり押した姿勢を作り直す: ハンマーを 2 mm に、ジャックの角がナックルに触れるまでウィッペンを上げる */
    let lo = q0[4] - 0.8,
      hi = q0[4];
    for (let i = 0; i < 60; i++) {
      const m = (lo + hi) / 2;
      if (headGap(pose([q0[0], q0[1], q0[2], q0[3], m]), rig.str) > 0.002) hi = m;
      else lo = m;
    }
    let wl = q0[1],
      wh = q0[1] + 0.3;
    for (let i = 0; i < 60; i++) {
      const m = (wl + wh) / 2;
      if (touch(pose([q0[0], m, q0[2], q0[3], lo]), CONTACTS[6], rig).pen > 0) wh = m;
      else wl = m;
    }
    const P = pose([q0[0], wl, q0[2], q0[3], lo]);
    expect(touch(P, CONTACTS[7], rig).pen).toBeCloseTo(0, 6);
  });
  it('打弦距離を 46 mm にすると、弦が 2 mm 下がる', () => {
    const a = rigOf(REG0, q0),
      b = rigOf({ ...REG0, blow: 0.046 }, q0);
    expect(a.str - b.str).toBeCloseTo(0.002, 9);
  });
  it('鍵の深さ 10 mm: 鍵の前が 10 mm 下がったところでフロントレールに触れる', () => {
    const rig = rigOf(REG0, q0);
    const y0 = gp(pose(q0), 'key', [0.2278, 0.0261])[1];
    let lo = q0[0] - 0.1,
      hi = q0[0];
    for (let i = 0; i < 60; i++) {
      const m = (lo + hi) / 2;
      if (touch(pose([m, q0[1], q0[2], q0[3], q0[4]]), CONTACTS[1], rig).pen > 0) lo = m;
      else hi = m;
    }
    expect(y0 - gp(pose([hi, q0[1], q0[2], q0[3], q0[4]]), 'key', [0.2278, 0.0261])[1]).toBeCloseTo(0.01, 4);
  });
});

describe('打鍵（Hirschkorn 2004 の実験と比べる）', () => {
  const f = simulate('forte', REG0),
    Ef = events(f);
  it('強く: 弦を 1 回打ち、時刻は実験の 0.1105 s から 3 ms 以内、ハンマーの頭は 2.5〜3.5 m/s', () => {
    expect(Ef.strikes).toHaveLength(1);
    expect(Math.abs(Ef.strikes[0].t - 0.1105)).toBeLessThan(0.003);
    expect(Ef.strikes[0].v).toBeGreaterThan(2.5);
    expect(Ef.strikes[0].v).toBeLessThan(3.5);
  });
  it('強く: 段階は 静止 → 加速 → レットオフ → 打弦 → チェック → 戻り → 静止', () => {
    expect(stages(f, Ef).map((s) => s.id)).toEqual(['rest', 'acc', 'let', 'hit', 'chk', 'ret', 'rest2']);
  });
  it('弱く: 実験の 0.228 s から 5 ms 以内に、1 m/s 前後で打つ', () => {
    const E = events(simulate('piano', REG0));
    expect(Math.abs(E.strikes[0].t - 0.228)).toBeLessThan(0.005);
    expect(E.strikes[0].v).toBeGreaterThan(0.6);
    expect(E.strikes[0].v).toBeLessThan(1.5);
  });
  it('連打: 鍵を半分戻して押し直すと、もう一度打てる', () => {
    const r = simulate('rep', REG0);
    expect(stages(r).map((s) => s.id)).toEqual(['rest', 'acc', 'let', 'hit', 'chk', 'half', 'rep']);
  });
});

describe('整調の失敗', () => {
  it('レットオフが 0 より近いと、ブロッキングになる', () => {
    const r = simulate('forte', { ...REG0, letoff: -0.001 });
    expect(stages(r).map((s) => s.id)).toContain('block');
  });
  it('レペティションのばねが弱すぎると、連打できない', () => {
    const r = simulate('rep', { ...REG0, spring: 0.05 });
    expect(stages(r).map((s) => s.id)).toContain('fail');
  });
});
