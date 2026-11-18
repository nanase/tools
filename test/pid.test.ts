import { describe, expect, it } from 'vitest';
import { valueList } from '../src/lib/param-core';
import {
  BAND_MIN,
  Boat,
  DT,
  GAIN_LIST,
  HOLD,
  type In,
  Meter,
  metrics,
  N,
  PIDController,
  ROWS,
  record,
  simulate,
  TUNE_OS,
  TUNE_VMAX,
  tune,
  tuneCost,
  vscale,
} from '../src/tools/pid/model';
import { PARAMS } from '../src/tools/pid/params';
import { tickStep, viewOf } from '../src/tools/pid/river';

const DEF: In = { kp: 0.0047, ki: 0, kd: 0.33, x0: 0, r: 50, v0: 0, w: -1, al: 0.05 };
const run = (p: Partial<In> = {}) => simulate({ ...DEF, ...p });

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
  it('抵抗なしの旧既定値の列', () => {
    const S = run();
    expect(S.n).toBe(N);
    expect(S.X[1]).toBeCloseTo(-0.0173825, 12);
    expect(S.X[10]).toBeCloseTo(2.9105668637159097, 10);
    expect(S.X[N - 1]).toBeCloseTo(49.8135029084927, 9);
  });

  it('発散したら 10¹² で打ち切る', () => {
    expect(run({ kp: 20, ki: 20, kd: 0 }).n).toBe(198);
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

/** ページの既定値（水の抵抗あり。2026-11-18） */
const PAGE: In = { kp: 0.015, ki: 0.00022, kd: 0.27, x0: 0, r: 50, v0: 0, w: -1, al: 0.05, c: 0.047 };

describe('水の抵抗', () => {
  it('入力の既定値は抵抗ありの値', () => {
    const v = Object.fromEntries(PARAMS.map((d) => [d.k, d.v]));
    expect(v).toEqual(PAGE);
  });

  it('抵抗 0 は抵抗を省いたときと同じ列', () => {
    const a = simulate(DEF),
      b = simulate({ ...DEF, c: 0 });
    expect(Array.from(b.X)).toEqual(Array.from(a.X));
    expect(Array.from(b.V)).toEqual(Array.from(a.V));
  });

  it('既定値: 行き過ぎ 2 % 未満で目標に着く', () => {
    const S = simulate(PAGE);
    let mx = -Infinity;
    for (const x of S.X) mx = Math.max(mx, x);
    expect((mx - 50) / 50).toBeLessThan(0.02);
    expect(Math.abs(50 - S.X[N - 1])).toBeLessThan(0.5);
  });

  it('積分項がないと流れに負けて目標の手前で止まる', () => {
    const S = simulate({ ...PAGE, ki: 0 }),
      e = 50 - S.X[N - 1];
    /* 流れに逆らう推力 c·|w| に見合う誤差 c·|w|/K_P ≈ 3.1 m が残る */
    expect(e).toBeGreaterThan(2.5);
    expect(e).toBeLessThan(3.5);
  });

  it('値の並びは 0 と 0.001〜1 の E12', () => {
    const d = PARAMS.find((p) => p.k === 'c');
    if (!d) throw new Error('c');
    const L = valueList(d, 12);
    expect(L[0]).toBe(0);
    expect(L[1]).toBe(0.001);
    expect(L).toContain(0.047);
    expect(L.at(-1)).toBe(1);
  });
});

describe('川の枠の計算（Boat）', () => {
  it('目標を変えなければ simulate と同じ列', () => {
    for (const p of [DEF, PAGE, { ...PAGE, x0: 20, r: -30, v0: 2.5, w: 1, al: 0.1 }]) {
      const S = simulate(p),
        b = new Boat(p);
      for (let i = 1; i < N; i++) {
        b.step();
        expect(b.x).toBe(S.X[i]);
        expect(b.v).toBe(S.V[i]);
      }
    }
  });

  it('PID を切ると操作量は 0、抵抗で流される', () => {
    const b = new Boat(PAGE);
    for (let i = 0; i < 600; i++) b.step();
    const x = b.x;
    b.setOn(false);
    for (let i = 0; i < 400; i++) b.step();
    expect(b.u).toBe(0);
    expect(b.x).toBeLessThan(x - 10);
  });

  it('抵抗がなければ切っても流されない（既定値を抵抗ありにした理由）', () => {
    const b = new Boat({ ...PAGE, c: 0 });
    for (let i = 0; i < 600; i++) b.step();
    const x = b.x;
    b.setOn(false);
    for (let i = 0; i < 400; i++) b.step();
    expect(Math.abs(b.x - x)).toBeLessThan(2);
  });

  it('入に戻した直後は微分項が跳ねない', () => {
    const b = new Boat(PAGE);
    for (let i = 0; i < 300; i++) b.step();
    b.setOn(false);
    for (let i = 0; i < 100; i++) b.step();
    b.setOn(true);
    const e = PAGE.r - b.x;
    b.step();
    /* 1 ステップぶんの誤差の変化だけ（前回の誤差を 0 のままにすると K_D·e/Δt で数十になる） */
    expect(Math.abs(b.ud)).toBeLessThan(5);
    /* 積分は 0 から */
    expect(b.ui).toBeCloseTo(PAGE.ki * e * DT, 15);
  });

  it('押すと流れに対する速さが変わる', () => {
    const b = new Boat(PAGE);
    b.push(2);
    expect(b.v).toBe(2);
  });

  it('発散を 10⁶ で見つける', () => {
    const b = new Boat({ ...PAGE, kp: 20, ki: 20, kd: 0 });
    let i = 0;
    while (!b.diverged && i < N) {
      b.step();
      i++;
    }
    expect(b.diverged).toBe(true);
    expect(i).toBeLessThan(N);
  });
});

describe('川の図', () => {
  it('範囲は出発と目標の両側に余白', () => {
    expect(viewOf(0, 50)).toEqual({ lo: -17.5, hi: 67.5 });
    expect(viewOf(10, 10)).toEqual({ lo: 2, hi: 18 });
    const v = viewOf(20, -30);
    expect(v.lo).toBeCloseTo(-47.5, 12);
    expect(v.hi).toBeCloseTo(37.5, 12);
  });

  it('目盛りは 1-2-5', () => {
    expect(tickStep(85, 8)).toBe(10);
    expect(tickStep(85, 4)).toBe(20);
    expect(tickStep(16, 3)).toBe(5);
  });
});

/** Boat を n ステップ進めながら Meter で測る */
function measure(p: In, n: number, kind: 'start' | 'target' | 'push' = 'start') {
  const b = new Boat(p),
    m = new Meter();
  m.begin(kind, b.t, b.x, b.p.r);
  for (let i = 0; i < n; i++) {
    b.step();
    m.sample(b.t, b.x, b.v);
  }
  return { b, m: m.get() };
}

describe('計算結果（出来事からの測定）', () => {
  it('既定値: 最初からの整定 9.3 s、行き過ぎ 1.8 %', () => {
    const { m } = measure(PAGE, 400);
    expect(m.band).toBe(1);
    expect(m.ts).toBeCloseTo(9.3, 9);
    expect(m.os).toBeCloseTo(1.8, 1);
    expect(m.tr).toBeGreaterThan(0);
    expect(m.tp).toBeGreaterThan(m.tr ?? 0);
    expect(Math.abs(m.e)).toBeLessThan(1);
  });

  it(`帯に入っても ${HOLD} s 留まるまでは整定時間を出さない`, () => {
    expect(measure(PAGE, 150).m.ts).toBeNull();
  });

  it('旧既定値（抵抗なし）でも 100 s の計算と同じ整定時間 14 s', () => {
    expect(measure(DEF, 400).m.ts).toBeCloseTo(14, 9);
  });

  it('目標が動かない出来事は帯の下限を使い、立ち上がりを測らない', () => {
    const b = new Boat(PAGE),
      m = new Meter();
    for (let i = 0; i < 400; i++) b.step();
    b.push(2);
    m.begin('push', b.t, b.x, b.p.r);
    /* 積分項がゆっくり戻すので、帯に入り直すまで 130 s ほどかかる */
    for (let i = 0; i < 2000; i++) {
      b.step();
      m.sample(b.t, b.x, b.v);
    }
    const g = m.get();
    expect(g.kind).toBe('push');
    expect(g.band).toBe(BAND_MIN);
    expect([g.tr, g.os, g.tp]).toEqual([null, null, null]);
    expect(g.ts).not.toBeNull();
    expect(g.vm).toBeGreaterThan(1);
    expect(g.dt).toBeCloseTo(200, 9);
  });

  it('誤差の積分は Δt ごとの和', () => {
    const { m } = measure({ ...PAGE, kp: 0, ki: 0, kd: 0, w: 0, c: 0 }, 10);
    expect(m.iae).toBeCloseTo(50 * DT * 10, 9);
    expect(m.e).toBe(50);
  });
});

describe('計算のモード（100 s の記録と指標）', () => {
  it('記録は simulate と同じ列で、各項の和が操作量', () => {
    const R = record(PAGE),
      S = simulate(PAGE);
    expect(R.n).toBe(N);
    expect(Array.from(R.X)).toEqual(Array.from(S.X));
    const i = 37;
    expect(R.UP[i]).toBeCloseTo(PAGE.kp * (PAGE.r - R.X[i - 1]), 12);
  });

  it('旧既定値: 整定 14 s、行き過ぎ 6.87 %（旧ページの値）', () => {
    const R = record(DEF),
      M = metrics(R, DEF.x0, DEF.r);
    expect(M.ts).toBeCloseTo(14, 9);
    expect(M.tr).toBeCloseTo(4.836581564632953, 9);
    expect(M.os).toBeCloseTo(6.866450248492151, 9);
    expect(M.tp).toBeCloseTo(10, 9);
    expect(M.iae).toBeCloseTo(233.33590932761052, 8);
  });

  it('発散したら打ち切って整定時間を出さない', () => {
    const R = record({ ...PAGE, kp: 20, ki: 20, kd: 0 }),
      M = metrics(R, PAGE.x0, PAGE.r);
    expect(R.n).toBeLessThan(N);
    expect(M.div).toBe(true);
    expect(M.ts).toBeNull();
  });
});

describe('自動調整', () => {
  it('ゲインの並びは入力と同じ', () => {
    const d = PARAMS.find((p) => p.k === 'kp');
    if (!d) throw new Error('kp');
    expect(GAIN_LIST).toEqual(valueList(d, 12));
  });

  it('既定の制御対象では既定値のゲインになる', () => {
    expect(tune(PAGE)).toEqual({ kp: 0.015, ki: 0.00022, kd: 0.27, ok: true });
  });

  it('条件を守る', () => {
    for (const p of [
      { ...PAGE, al: 0.5 },
      { ...PAGE, w: -3 },
      { ...PAGE, c: 0.5 },
    ]) {
      const g = tune(p);
      expect(g?.ok).toBe(true);
      const v = { ...p, ...g },
        R = record(v),
        M = metrics(R, v.x0, v.r);
      expect(M.ts).not.toBeNull();
      expect(M.os ?? 0).toBeLessThanOrEqual(TUNE_OS + 1e-9);
      expect(M.vm).toBeLessThanOrEqual(TUNE_VMAX + 1e-9);
    }
  });

  it('条件を守れないときは、はみ出しの最も小さい組を ok: false で返す', () => {
    /* 下流の目標は流れに運ばれて行き過ぎ、どのゲインでも 5 % 以下にならない（全部の組で確かめた） */
    const g = tune({ ...PAGE, r: -20 });
    expect(g?.ok).toBe(false);
    const M = metrics(record({ ...PAGE, r: -20, ...g }), 0, -20);
    expect(M.ts).not.toBeNull();
  });

  it('整定しない・初期位置と目標位置が同じなら評価は Infinity', () => {
    expect(tuneCost({ ...PAGE, kp: 1e-4, ki: 0, kd: 0 })).toBe(Infinity);
    expect(tuneCost({ ...PAGE, r: 0 })).toBe(Infinity);
    expect(tune({ ...PAGE, r: 0 })).toBeNull();
  });
});
