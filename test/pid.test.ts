import { describe, expect, it } from 'vitest';
import { valueList } from '../src/lib/param-core';
import { DT, type In, metrics, N, PIDController, ROWS, simulate, trace, vscale } from '../src/tools/pid/model';
import { PARAMS } from '../src/tools/pid/params';

const DEF: In = { kp: 0.0047, ki: 0, kd: 0.33, x0: 0, r: 50, v0: 0, w: -1, al: 0.05 };
const run = (p: Partial<In> = {}) => {
  const v = { ...DEF, ...p },
    S = simulate(v);
  return { S, M: metrics(S, v.x0, v.r) };
};

describe('PIDController', () => {
  it('最初は前回の誤差を 0 として微分項を出す', () => {
    const c = new PIDController(2, 0.5, 0.3);
    /* e = 10: 2·10 + 0.5·(10·0.1) + 0.3·10/0.1 */
    expect(c.calculate(10, 0, 0.1)).toBeCloseTo(20 + 0.5 + 30, 12);
    /* e = 6: 積分は 1.6、微分は (6 − 10)/0.1 */
    expect(c.calculate(10, 4, 0.1)).toBeCloseTo(12 + 0.5 * 1.6 - 12, 12);
  });
});

describe('シミュレーション（値は画面案の計算で求めたもの）', () => {
  it('初期値: 整定 14 s、行き過ぎ 6.87 %', () => {
    const { S, M } = run();
    expect(S.n).toBe(N);
    expect(S.X[1]).toBeCloseTo(-0.0173825, 12);
    expect(S.X[10]).toBeCloseTo(2.9105668637159097, 10);
    expect(S.X[N - 1]).toBeCloseTo(49.8135029084927, 9);
    expect(M.div).toBe(false);
    expect(M.flat).toBe(false);
    expect(M.ts).toBeCloseTo(14, 9);
    expect(M.tr).toBeCloseTo(4.836581564632953, 9);
    expect(M.os).toBeCloseTo(6.866450248492151, 9);
    expect(M.tp).toBeCloseTo(10, 9);
    expect(M.ee).toBeCloseTo(0.18649709150729876, 9);
    expect(M.iae).toBeCloseTo(233.33590932761052, 8);
    expect(M.vm).toBeCloseTo(10.729394184929893, 9);
  });

  it('積分項があると偏差がほぼ消える', () => {
    const { M } = run({ kp: 0.1, ki: 0.01, kd: 1 });
    expect(M.ts).toBeCloseTo(17.7, 9);
    expect(M.tr).toBeCloseTo(1.7933033837127965, 9);
    expect(M.os).toBeCloseTo(49.827730697615856, 9);
    expect(M.tp).toBeCloseTo(4.8, 9);
    expect(M.ee).toBeCloseTo(0.024573391808175415, 9);
    expect(M.vm).toBeCloseTo(25.97959387416337, 9);
  });

  it('負の向きへの移動と初速', () => {
    const { M } = run({ kp: 0.1, kd: 1, x0: 20, r: -30, v0: 2.5, w: 1, al: 0.1 });
    expect(M.ts).toBeCloseTo(6.2, 9);
    expect(M.tr).toBeCloseTo(1.5752448159619608, 9);
    expect(M.os).toBeCloseTo(21.378311035140317, 9);
    expect(M.tp).toBeCloseTo(3.7, 9);
    expect(M.iae).toBeCloseTo(101.1324526766659, 8);
  });

  it('発散したら 10¹² で打ち切り、整定時間を出さない', () => {
    const { S, M } = run({ kp: 20, ki: 20, kd: 0 });
    expect(S.n).toBe(198);
    expect(M.div).toBe(true);
    expect(M.ts).toBeNull();
    expect(M.tr).toBeCloseTo(0.4055331016596683, 9);
  });

  it('目標位置が初期位置と同じなら応答の指標を求めない', () => {
    const { M } = run({ x0: 10, r: 10 });
    expect(M.flat).toBe(true);
    expect([M.ts, M.tr, M.os, M.tp]).toEqual([null, null, null, null]);
    expect(M.ee).toBeCloseTo(0.7274464298496284, 9);
    expect(M.vm).toBeCloseTo(1.1296001380930893, 9);
  });
});

describe('表示窓の縦軸', () => {
  it('0 を目盛線に置き、6 div に収まる最小の 1-2-5', () => {
    expect(vscale(-0.02, 53.4, 1)).toEqual({ vd: 10, k: 0 });
    expect(vscale(-30, 20, 1)).toEqual({ vd: 10, k: 3 });
    expect(vscale(-29.1, 2.5, 1)).toEqual({ vd: 10, k: 4 });
    /* 振れ幅がなければ既定の vd で中央に置く */
    expect(vscale(0, 0, 1)).toEqual({ vd: 1, k: 3 });
  });

  it('ページの表示窓（ROWS div）でも 0 を目盛線に置いて収める', () => {
    expect(ROWS).toBe(4);
    expect(vscale(-0.02, 53.4, 1, ROWS)).toEqual({ vd: 20, k: 1 });
    expect(vscale(-30, 20, 1, ROWS)).toEqual({ vd: 20, k: 2 });
    expect(vscale(0, 0, 1, ROWS)).toEqual({ vd: 1, k: 2 });
    const { S } = run();
    const p = trace(S.X, 50, ROWS);
    expect([p.vd, p.k, p.y0]).toEqual([20, 1, 120]);
  });

  it('画面案と同じレンジ', () => {
    const { S } = run();
    const p = trace(S.X, 50),
      v = trace(S.V, 1);
    expect([p.vd, p.k]).toEqual([10, 0]);
    expect([v.vd, v.k]).toEqual([2, 0]);
    expect(p.d.startsWith('M0.0 240.0L0.4 240.1')).toBe(true);
    expect(p.X(14)).toBe('56.0');
    expect(p.d.split('L')).toHaveLength(N);
  });
});

describe('入力の並び', () => {
  const list = (k: string) => {
    const d = PARAMS.find((p) => p.k === k);
    if (!d) throw new Error(k);
    return valueList(d, 12);
  };

  it('ゲインは 0、0.0001〜18 の E12、上限 20', () => {
    const L = list('kp');
    expect(L[0]).toBe(0);
    expect(L[1]).toBe(1e-4);
    expect(L).toContain(0.0047);
    expect(L).toContain(0.33);
    expect(L.slice(-2)).toEqual([18, 20]);
    expect(L).toHaveLength(66);
  });

  it('α は 0.0001〜1 の E12', () => {
    const L = list('al');
    expect(L[0]).toBe(1e-4);
    expect(L.at(-1)).toBe(1);
    expect(L).toHaveLength(49);
  });

  it('位置は 1 m、速度は 0.1 m/s 刻み', () => {
    expect(list('r')).toHaveLength(201);
    const v = list('w');
    expect(v).toHaveLength(2001);
    expect(v[990]).toBe(-1);
  });

  it('刻み幅', () => {
    expect(DT).toBe(0.1);
  });
});
