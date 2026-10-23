import { describe, expect, it } from 'vitest';
import { valueList } from '../src/lib/param-core';
import { ellipse, K95, KF, nisBand, product, qDwna, steady, World } from '../src/tools/kalman/kf';
import { FILT, SCENES, TRUE } from '../src/tools/kalman/params';
import { type Setup, Tracker } from '../src/tools/kalman/sim';

const BASE: Setup = { T: 0.2, sa: 0.3, sz: 0.3, v0: 0.6, fq: 1, fr: 1, sp0: 1.5, sv0: 1 };

describe('1 次元の正規分布の積', () => {
  it('平均は分散の逆数で重み付け、分散の逆数は和になる（Faragher 式 (12)・(13)）', () => {
    const r = product(-0.6, 0.6, 0.5, 0.4);
    const w1 = 1 / 0.36,
      w2 = 1 / 0.16;
    expect(r.m).toBeCloseTo((-0.6 * w1 + 0.5 * w2) / (w1 + w2), 12);
    expect(1 / (r.s * r.s)).toBeCloseTo(w1 + w2, 9);
    expect(r.K).toBeCloseTo(0.36 / 0.52, 12);
    expect(r.s).toBeLessThan(0.4);
  });
  it('位置と速度のフィルタの位置の更新は、速度の相関がなければ 1 次元の積と同じ', () => {
    const f = new KF();
    f.reset(-0.6, 0, 0.6, 0);
    f.update(0.5, 0.16);
    const r = product(-0.6, 0.6, 0.5, 0.4);
    expect(f.x[0]).toBeCloseTo(r.m, 12);
    expect(Math.sqrt(f.P[0])).toBeCloseTo(r.s, 12);
    expect(f.K[0]).toBeCloseTo(r.K, 12);
  });
});

describe('予測と更新', () => {
  it('過程雑音の共分散は q·[[T⁴/4, T³/2], [T³/2, T²]]', () => {
    const [a, b, c] = qDwna(0.5, 2);
    expect(a).toBeCloseTo((2 * 0.5 ** 4) / 4, 15);
    expect(b).toBeCloseTo((2 * 0.5 ** 3) / 2, 15);
    expect(c).toBeCloseTo(2 * 0.25, 15);
    /* 階数 1（行列式 0） */
    expect(a * c - b * b).toBeCloseTo(0, 15);
  });
  it('F P Fᵀ は楕円の面積（行列式）を変えず、Q で増える', () => {
    const f = new KF();
    f.reset(0, 0, 1.2, 0.7);
    f.P = [1.44, 0.3, 0.49];
    const d0 = 1.44 * 0.49 - 0.09;
    f.predict(0.3, 0);
    expect(f.P[0] * f.P[2] - f.P[1] * f.P[1]).toBeCloseTo(d0, 12);
    f.reset(0, 0, 1.2, 0.7);
    f.P = [1.44, 0.3, 0.49];
    f.predict(0.3, 1);
    expect(f.P[0] * f.P[2] - f.P[1] * f.P[1]).toBeGreaterThan(d0);
  });
  it('更新で位置の分散は必ず縮み、速度の分散は相関があれば縮む', () => {
    const f = new KF();
    f.reset(0, 0, 1, 1);
    f.predict(0.2, 0.09);
    const pri = [...f.P];
    f.update(0.3, 0.09);
    expect(f.P[0]).toBeLessThan(pri[0]);
    expect(f.P[2]).toBeLessThan(pri[2]);
    expect(f.nis).toBeCloseTo((0.3 * 0.3) / (pri[0] + 0.09), 12);
  });
  it('止まった台車では k 回目の K が 1/(k + R/σp0²)', () => {
    const f = new KF(),
      R = 0.09,
      s0 = 1.5;
    f.reset(0, 0, s0, 0);
    for (let k = 1; k <= 20; k++) {
      f.predict(0.2, 0);
      f.update(0, R);
      expect(f.K[0]).toBeCloseTo(1 / (k + R / (s0 * s0)), 12);
      expect(f.K[1]).toBe(0);
    }
  });
  it('定常のカルマンゲインは 0〜1 で、雑音の比で決まる', () => {
    const a = steady(0.2, 0.09, 0.09, 1.5, 1),
      b = steady(0.2, 0.09, 9, 1.5, 1);
    expect(a.K[0]).toBeGreaterThan(0);
    expect(a.K[0]).toBeLessThan(1);
    /* 観測を疑うほど K は小さい */
    expect(b.K[0]).toBeLessThan(a.K[0]);
  });
});

describe('楕円と NIS の範囲', () => {
  it('95 % の楕円の大きさは √5.991', () => {
    expect(K95 * K95).toBeCloseTo(5.9915, 4);
  });
  it('楕円の点はマハラノビス距離 K95 の上にある', () => {
    const m: [number, number] = [1, -0.5],
      P: [number, number, number] = [0.5, 0.2, 0.3],
      det = P[0] * P[2] - P[1] * P[1];
    for (const [x, y] of ellipse(m, P, K95, 16)) {
      const dx = x - m[0],
        dy = y - m[1],
        d2 = (P[2] * dx * dx - 2 * P[1] * dx * dy + P[0] * dy * dy) / det;
      expect(d2).toBeCloseTo(5.9915, 3);
    }
  });
  it('平均 NIS の範囲（Wilson–Hilferty）はカイ 2 乗の表に近い', () => {
    /* 自由度 50 の 2.5 %・97.5 % 点は 32.357・71.420 */
    const [lo, hi] = nisBand(50);
    expect(lo * 50).toBeCloseTo(32.357, 0);
    expect(hi * 50).toBeCloseTo(71.42, 0);
  });
});

describe('追跡', () => {
  it('同じ種と設定なら同じ動きと観測になる', () => {
    const a = new World(5),
      b = new World(5);
    a.reset(0, 0.6);
    b.reset(0, 0.6);
    for (let i = 0; i < 20; i++) expect(a.step(0.2, 0.3, 0.3)).toBe(b.step(0.2, 0.3, 0.3));
  });
  it('1 段ずつ進めると 予測 → 観測 → 更新 の順になり、full と同じ結果になる', () => {
    const a = new Tracker({ ...BASE }),
      b = new Tracker({ ...BASE });
    const seq: string[] = [];
    for (let i = 0; i < 6; i++) {
      a.step();
      seq.push(a.phase);
    }
    expect(seq).toEqual(['pred', 'obs', 'upd', 'pred', 'obs', 'upd']);
    b.warm(2);
    expect(a.f.x).toEqual(b.f.x);
    expect(a.hist.length).toBe(2);
  });
  it('見積りが合っていれば NIS の平均は 1 に近く、推定は観測より正確', () => {
    const t = new Tracker({ ...BASE });
    let s = 0,
      n = 0;
    for (let i = 0; i < 4000; i++) {
      t.full();
      if (i > 50) {
        s += t.f.nis;
        n++;
      }
    }
    expect(s / n).toBeGreaterThan(0.9);
    expect(s / n).toBeLessThan(1.1);
    const st = t.stats();
    expect(st).not.toBeNull();
    expect(st?.rms ?? 1).toBeLessThan(st?.orms ?? 0);
  });
  it('動きを過信すると NIS の平均が大きくなる', () => {
    const nisMean = (fq: number) => {
      const t = new Tracker({ ...BASE, fq });
      let s = 0;
      for (let i = 0; i < 2000; i++) {
        t.full();
        s += i > 200 ? t.f.nis : 0;
      }
      return s / 1799;
    };
    expect(nisMean(0.001)).toBeGreaterThan(2 * nisMean(1));
  });
  it('記録は直近 12 s だけ残す', () => {
    const t = new Tracker({ ...BASE, T: 0.1 });
    t.warm(500);
    expect(t.hist.length).toBeLessThanOrEqual(121);
    expect(t.hist[t.hist.length - 1].t - t.hist[0].t).toBeLessThanOrEqual(12 + 1e-9);
  });
});

describe('入力の定義', () => {
  it('既定値が並びの中にあり、場面の値も並びの中にある', () => {
    const defs = [...TRUE, ...FILT];
    for (const d of defs) expect(valueList(d, 12)).toContain(d.v);
    for (const s of SCENES)
      for (const [k, v] of Object.entries(s.vals)) {
        const d = defs.find((x) => x.k === k);
        expect(d, `${s.v}.${k}`).toBeDefined();
        expect(valueList(d as (typeof defs)[number], 12), `${s.v}.${k}`).toContain(v);
      }
  });
  it('既定値は「走る台車」の場面と一致する', () => {
    const run = SCENES.find((s) => s.v === 'run');
    const defs = [...TRUE, ...FILT];
    for (const [k, v] of Object.entries(run?.vals ?? {})) expect(defs.find((d) => d.k === k)?.v).toBe(v);
  });
});
