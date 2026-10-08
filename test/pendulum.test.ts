import { describe, expect, it } from 'vitest';
import { valueList } from '../src/lib/param-core';
import { type Ctrl, DiffFilter, design, H, pairOf, REC_N, type Sense, Sim } from '../src/tools/pendulum/control';
import {
  acker,
  type C,
  care,
  careResidual,
  ctrb,
  eig,
  invDet,
  lqr,
  type Mat,
  mul,
  norm1,
  polyFromRoots,
} from '../src/tools/pendulum/linalg';
import {
  driveOf,
  energy,
  G,
  impulse,
  linearize,
  type Plant,
  pendEnergy,
  railStop,
  rk4,
} from '../src/tools/pendulum/model';
import { DRIVE, LQR, PID, PLACE, PLANT, PRESETS, PUSH, SENSE, SWING } from '../src/tools/pendulum/params';
import { maxAbs, ROWS, rollPath, splane, vdiv } from '../src/tools/pendulum/plot';

const D2R = Math.PI / 180;
/** Quanser IP02 におもりを載せ、長い振子を付けたもの（ページの初期値） */
const IP02: Plant = {
  M: 0.94,
  m: 0.23,
  l: 0.3302,
  J: 7.8838e-3,
  bc: 5.4,
  fc: 0,
  bp: 0.0024,
  rail: 0.814,
  drive: 'motor',
  umax: 10,
  kt: 0.00767,
  rm: 2.6,
  kg: 3.71,
  rp: 6.35e-3,
  jm: 3.9e-7,
};
const CTRL: Ctrl = {
  kind: 'lqr',
  swing: true,
  q: [35, 350, 0.1, 0.1],
  r: 0.02,
  w1: 3,
  z1: 0.7,
  w2: 15,
  z2: 0.7,
  kpa: 180,
  kia: 0,
  kda: 27,
  kpx: 0.22,
  kix: 0,
  kdx: 0.27,
  ke: 10,
  amax: 6,
  thsw: 20 * D2R,
  th0: 3 * D2R,
};
const SENSE0: Sense = { ts: 1e-3, cpr: 4096, xres: 22.75e-6, fv: 50, nth: 0, nx: 0 };

/** 根の集合として近いか（順序によらない） */
function samePoles(a: readonly C[], b: readonly C[], tol: number): void {
  expect(a).toHaveLength(b.length);
  const rest = [...b];
  for (const p of a) {
    let bi = 0,
      bd = Infinity;
    rest.forEach((q, i) => {
      const d = Math.hypot(p.re - q.re, p.im - q.im);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    });
    expect(bd).toBeLessThan(tol * Math.max(1, Math.hypot(p.re, p.im)));
    rest.splice(bi, 1);
  }
}

describe('行列の計算', () => {
  it('逆行列と行列式', () => {
    const A = [
      [4, 7, 2],
      [3, 6, 1],
      [2, 5, 3],
    ];
    const r = invDet(A);
    expect(r).not.toBeNull();
    expect(r?.det).toBeCloseTo(9, 12);
    const I = mul(A, r?.inv ?? []);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(I[i][j]).toBeCloseTo(i === j ? 1 : 0, 12);
    expect(
      invDet([
        [1, 2],
        [2, 4],
      ]),
    ).toBeNull();
  });

  it('根から多項式の係数（低次から）', () => {
    /* (s + 1)(s + 2) = s² + 3s + 2、(s + 1 ± 2j) = s² + 2s + 5 */
    expect(
      polyFromRoots([
        { re: -1, im: 0 },
        { re: -2, im: 0 },
      ]),
    ).toEqual([2, 3]);
    const c = polyFromRoots([
      { re: -1, im: 2 },
      { re: -1, im: -2 },
    ]);
    expect(c[0]).toBeCloseTo(5, 12);
    expect(c[1]).toBeCloseTo(2, 12);
  });

  it('固有値: 実数と複素数の根を持つコンパニオン行列', () => {
    const roots: C[] = [
      { re: 3, im: 0 },
      { re: -1, im: 0 },
      { re: -2, im: 0 },
      { re: -1, im: 2 },
      { re: -1, im: -2 },
      { re: -40, im: 0 },
    ];
    const c = polyFromRoots(roots),
      n = c.length,
      A: Mat = Array.from({ length: n }, (_, i) =>
        Array.from({ length: n }, (_, j) => (i < n - 1 ? (j === i + 1 ? 1 : 0) : -c[j])),
      );
    const e = eig(A);
    expect(e).not.toBeNull();
    samePoles(e ?? [], roots, 1e-8);
    /* 実部の大きい順 */
    expect(e?.[0].re).toBeCloseTo(3, 8);
  });

  it('固有値: 対称行列は実数', () => {
    const e = eig([
      [2, 1, 0],
      [1, 2, 1],
      [0, 1, 2],
    ]);
    samePoles(
      e ?? [],
      [2 + Math.SQRT2, 2, 2 - Math.SQRT2].map((re) => ({ re, im: 0 })),
      1e-10,
    );
  });
});

describe('LQR（リカッチ方程式）', () => {
  it('二重積分の既知の解: P = [√3 1; 1 √3]、K = [1 √3]', () => {
    const A = [
        [0, 1],
        [0, 0],
      ],
      r = lqr(A, [0, 1], [1, 1], 1);
    expect(r).not.toBeNull();
    const P = r?.P ?? [];
    expect(P[0][0]).toBeCloseTo(Math.sqrt(3), 10);
    expect(P[0][1]).toBeCloseTo(1, 10);
    expect(P[1][0]).toBeCloseTo(1, 10);
    expect(P[1][1]).toBeCloseTo(Math.sqrt(3), 10);
    expect(r?.K[0]).toBeCloseTo(1, 10);
    expect(r?.K[1]).toBeCloseTo(Math.sqrt(3), 10);
  });

  it('1 次の既知の解: P = r(a + √(a² + b²q/r))/b²', () => {
    const a = 2,
      b = 3,
      q = 5,
      rr = 0.7,
      P = care([[a]], [[b]], [[q]], [[rr]]);
    expect(P?.[0][0]).toBeCloseTo((rr * (a + Math.sqrt(a * a + (b * b * q) / rr))) / (b * b), 12);
  });

  it('倒立振子の解は残差が小さく、閉ループの極がすべて左半面', () => {
    const { A, B } = linearize(IP02),
      Bm = B.map((v) => [v]),
      Q = [35, 350, 0.1, 0.1].map((v, i) => [0, 0, 0, 0].map((_, j) => (i === j ? v : 0))),
      P = care(A, Bm, Q, [[0.02]]);
    expect(P).not.toBeNull();
    const res = careResidual(A, Bm, Q, [[0.02]], P ?? []);
    expect(norm1(res) / norm1(Q)).toBeLessThan(1e-9);
    /* P は対称で正定（固有値が正） */
    const pe = eig(P ?? []) ?? [];
    for (const p of pe) expect(p.re).toBeGreaterThan(0);
    const ds = design(IP02, CTRL);
    expect(ds.K).not.toBeNull();
    expect(ds.cl).toHaveLength(4);
    for (const p of ds.cl) expect(p.re).toBeLessThan(0);
  });

  it('入力の重みを大きくすると、ゲインが小さく応答が遅くなる', () => {
    const a = design(IP02, CTRL),
      b = design(IP02, { ...CTRL, r: 2 });
    expect(Math.abs(b.K?.[1] ?? 0)).toBeLessThan(Math.abs(a.K?.[1] ?? 0));
    const slow = (ps: C[]) => Math.max(...ps.map((p) => p.re));
    expect(slow(b.cl)).toBeGreaterThan(slow(a.cl));
  });
});

describe('模型と線形化', () => {
  it('開ループの極: 不安定な 1 つが √(g/l) の近く（台車が重く、質点の振子）', () => {
    const p: Plant = { ...IP02, M: 1000, m: 0.1, l: 0.5, J: 0, bc: 0, bp: 0, drive: 'force', umax: 10 },
      e = eig(linearize(p).A) ?? [];
    const pu = e.filter((x) => x.re > 1e-9);
    expect(pu).toHaveLength(1);
    expect(pu[0].re / Math.sqrt(G / 0.5)).toBeCloseTo(1, 4);
    /* もう 1 つは −√(g/l) の近く、残りは 0（台車の位置と速度） */
    expect(e.some((x) => Math.abs(x.re + Math.sqrt(G / 0.5)) < 1e-3)).toBe(true);
  });

  it('開ループの不安定な極は √((Me + m)mgl/D)（摩擦なし）', () => {
    const p: Plant = { ...IP02, bc: 0, bp: 0, drive: 'force' },
      a = p.M + p.m,
      c = p.J + p.m * p.l * p.l,
      Dd = a * c - (p.m * p.l) ** 2,
      e = eig(linearize(p).A) ?? [];
    expect(e[0].re).toBeCloseTo(Math.sqrt((a * p.m * G * p.l) / Dd), 10);
  });

  it('Quanser IP02 の値: 開ループの不安定な極と、モータの力の係数', () => {
    const d = driveOf(IP02);
    /* α = Kg kt/(Rm r)、β = Kg² kt²/(Rm r²)、Me = M + Kg² Jm/r² */
    expect(d.alpha).toBeCloseTo((3.71 * 0.00767) / (2.6 * 6.35e-3), 12);
    expect(d.beta).toBeCloseTo((3.71 ** 2 * 0.00767 ** 2) / (2.6 * 6.35e-3 ** 2), 12);
    expect(d.Me).toBeCloseTo(0.94 + (3.71 ** 2 * 3.9e-7) / 6.35e-3 ** 2, 12);
    const e = eig(linearize(IP02).A) ?? [];
    expect(e[0].re).toBeCloseTo(4.8232, 3);
    expect(e[0].im).toBe(0);
  });

  it('可制御（可制御性行列が正則）', () => {
    const { A, B } = linearize(IP02);
    expect(invDet(ctrb(A, B))).not.toBeNull();
  });

  it('制御なし・摩擦なしではエネルギーが保存する', () => {
    const p: Plant = { ...IP02, bc: 0, bp: 0, fc: 0, drive: 'force', rail: 1e6 },
      d = driveOf(p),
      s = [0, 2.5, 0.3, -1],
      E0 = energy(p, d, s),
      scale = p.m * G * p.l;
    let worst = 0;
    for (let i = 0; i < 40000; i++) {
      rk4(p, d, s, 0, H);
      worst = Math.max(worst, Math.abs(energy(p, d, s) - E0));
    }
    expect(worst / scale).toBeLessThan(1e-8);
    /* 運動量も保存する（台車と振子の水平方向） */
    const px = (st: number[]) => (d.Me + p.m) * st[2] + p.m * p.l * Math.cos(st[1]) * st[3];
    expect(px(s)).toBeCloseTo(px([0, 2.5, 0.3, -1]), 8);
  });

  it('振子のエネルギー: 直立で 0、真下で −2mgl', () => {
    expect(pendEnergy(IP02, 0, 0)).toBe(0);
    expect(pendEnergy(IP02, Math.PI, 0)).toBeCloseTo(-2 * IP02.m * G * IP02.l, 12);
  });

  it('押した撃力: 台車を押すと振子は逆向きに回り、水平の運動量は力積だけ増える', () => {
    const d = driveOf(IP02),
      s = [0, 0, 0, 0];
    impulse(IP02, d, s, 0.1, null);
    expect(s[2]).toBeGreaterThan(0);
    expect(s[3]).toBeLessThan(0);
    const px = (d.Me + IP02.m) * s[2] + IP02.m * IP02.l * Math.cos(s[1]) * s[3];
    expect(px).toBeCloseTo(0.1, 12);
    /* 振子の先を押すと、振子は押した向きへ回る */
    const t = [0, 0, 0, 0];
    impulse(IP02, d, t, 0.1, 0.6);
    expect(t[3]).toBeGreaterThan(0);
  });

  it('レールの端: 端に戻して速度を反発係数で反転する', () => {
    const s = [0.5, 0, 1, 0];
    expect(railStop(IP02, s)).toBe(true);
    expect(s[0]).toBeCloseTo(0.407, 12);
    expect(s[2]).toBeCloseTo(-0.2, 12);
    /* 台車が急に止まった反動で、振子は進んでいた向きへ倒れる */
    expect(s[3]).toBeGreaterThan(0);
    expect(railStop(IP02, [0.1, 0, 1, 0])).toBe(false);
  });
});

describe('極配置（アッカーマンの式）', () => {
  it('指定した極になる', () => {
    const { A, B } = linearize(IP02),
      poles = [...pairOf(3, 0.7), ...pairOf(15, 0.7)],
      K = acker(A, B, poles);
    expect(K).not.toBeNull();
    const cl = eig(A.map((row, i) => row.map((v, j) => v - B[i] * (K?.[j] ?? 0)))) ?? [];
    samePoles(cl, poles, 1e-7);
    const ds = design(IP02, { ...CTRL, kind: 'place' });
    samePoles(ds.cl, poles, 1e-7);
  });

  it('減衰比が 1 以上なら実数の 2 つの極', () => {
    const [a, b] = pairOf(4, 1.25);
    expect(a.im).toBe(0);
    expect(b.im).toBe(0);
    expect(a.re * b.re).toBeCloseTo(16, 12);
    expect(a.re + b.re).toBeCloseTo(-10, 12);
  });
});

describe('PID（2 つのループ）', () => {
  it('積分なしなら、等価な状態フィードバックの閉ループの極と同じ', () => {
    const ds = design(IP02, { ...CTRL, kind: 'pid' }),
      { A, B } = linearize(IP02),
      K = ds.K ?? [];
    expect(K).toEqual([-180 * 0.22, -180, -180 * 0.27, -27]);
    const cl = eig(A.map((row, i) => row.map((v, j) => v - B[i] * K[j]))) ?? [];
    samePoles(ds.cl, cl, 1e-9);
    for (const p of ds.cl) expect(p.re).toBeLessThan(0);
  });

  it('積分を入れると、その分だけ極が増える', () => {
    expect(design(IP02, { ...CTRL, kind: 'pid', kix: 0.05 }).cl).toHaveLength(5);
    expect(design(IP02, { ...CTRL, kind: 'pid', kix: 0.05, kia: 10 }).cl).toHaveLength(6);
  });
});

describe('速度の推定', () => {
  it('一定の傾きの入力では、その傾きに落ち着く', () => {
    const f = new DiffFilter(50, 1e-3);
    f.reset(0);
    let y = 0;
    for (let k = 1; k <= 500; k++) y = f.step(2 * k * 1e-3);
    expect(y).toBeCloseTo(2, 9);
  });
});

/** シミュレーションを t 秒進め、モードが変わった時刻を記録する */
function run(sim: Sim, t: number, step = 0.01): { catches: number[]; falls: number[] } {
  const o = { catches: [] as number[], falls: [] as number[] };
  let last = sim.mode;
  for (let k = 0; k < t / step; k++) {
    sim.advance(step);
    if (sim.mode !== last) {
      if (sim.mode === 'bal') o.catches.push(sim.t);
      else o.falls.push(sim.t);
      last = sim.mode;
    }
  }
  return o;
}

describe('シミュレーション（制御周期・量子化・飽和を含む）', () => {
  it('LQR: 真下から振り上げて立て、整定する', () => {
    const sim = new Sim(IP02, CTRL, SENSE0),
      r = run(sim, 10);
    expect(r.catches).toHaveLength(1);
    expect(r.falls).toHaveLength(0);
    expect(sim.tUp).toBeGreaterThan(1.5);
    expect(sim.tUp).toBeLessThan(5);
    expect(sim.mode).toBe('bal');
    expect(sim.settle).not.toBeNull();
    expect(Math.abs(Math.atan2(Math.sin(sim.s[1]), Math.cos(sim.s[1])))).toBeLessThan(1 * D2R);
    expect(Math.abs(sim.s[0])).toBeLessThan(0.01);
    /* 入力は上限で切れている */
    expect(sim.umaxSeen).toBeLessThanOrEqual(10);
  });

  it('押しても戻る（3 つの制御器）', () => {
    for (const kind of ['lqr', 'place', 'pid'] as const) {
      const sim = new Sim(IP02, { ...CTRL, kind, swing: false }, SENSE0);
      run(sim, 4);
      sim.push(0.05, 0.6);
      const r = run(sim, 6);
      expect(r.falls, kind).toHaveLength(0);
      expect(sim.mode).toBe('bal');
      expect(sim.settle, kind).not.toBeNull();
      expect(sim.ev.k).toBe('push');
    }
  });

  it('ゲインが悪いと倒れる: 角度の微分がない PID、長すぎる制御周期', () => {
    const a = new Sim(IP02, { ...CTRL, kind: 'pid', kda: 0, swing: false }, SENSE0);
    expect(run(a, 5).falls.length).toBeGreaterThan(0);
    expect(a.mode).toBe('fall');
    const b = new Sim(IP02, { ...CTRL, swing: false }, { ...SENSE0, ts: 100e-3 });
    expect(run(b, 5).falls.length).toBeGreaterThan(0);
    expect(b.mode).toBe('fall');
    /* 50 ms では倒れないが、電圧が上限の間を行き来して収まらない */
    const c = new Sim(IP02, { ...CTRL, swing: false }, { ...SENSE0, ts: 50e-3 });
    run(c, 2);
    expect(run(c, 5).falls).toHaveLength(0);
    expect(c.settle).toBeNull();
    expect(c.umaxSeen).toBe(10);
  });

  it('倒れたら振り上げ直す', () => {
    const sim = new Sim(IP02, CTRL, SENSE0);
    run(sim, 6);
    expect(sim.mode).toBe('bal');
    /* 強く押して倒す */
    sim.push(0.6, 0.6);
    const r = run(sim, 12);
    expect(r.falls.length).toBeGreaterThan(0);
    expect(sim.mode).toBe('bal');
  });

  it('角度はエンコーダの刻みで量子化され、記録は 10 s 分', () => {
    const sim = new Sim(IP02, { ...CTRL, swing: false }, SENSE0);
    run(sim, 12);
    const q = (2 * Math.PI) / 4096;
    expect(Math.abs(sim.mth / q - Math.round(sim.mth / q))).toBeLessThan(1e-6);
    expect(Math.abs(sim.mx / 22.75e-6 - Math.round(sim.mx / 22.75e-6))).toBeLessThan(1e-6);
    expect(sim.rec.len).toBe(REC_N);
  });

  it('力で駆動する教材（CTMS の例題）でも振り上げて立てる', () => {
    const ctms: Plant = { ...IP02, M: 0.5, m: 0.2, l: 0.3, J: 0.006, bc: 0.1, bp: 0, drive: 'force' },
      sim = new Sim(ctms, CTRL, SENSE0),
      r = run(sim, 10);
    expect(r.catches.length).toBeGreaterThan(0);
    expect(sim.mode).toBe('bal');
  });
});

describe('表示窓と極の配置図', () => {
  it('縦軸: 上下 3 div に収め、小さくするときは余裕を持たせる', () => {
    expect(ROWS).toBe(6);
    expect(vdiv(180, 0.5)).toBe(100);
    expect(vdiv(25, 0.5)).toBe(10);
    expect(vdiv(0, 0.5)).toBe(0.5);
    /* 今 10 で、最大が 12（新しい値 5 の 3 div の 8 割 = 12 を下回らない）なら 10 のまま */
    expect(vdiv(12, 0.5, 10)).toBe(10);
    expect(vdiv(11, 0.5, 10)).toBe(5);
  });

  it('折れ線: 最新を右端に置き、±180° を越えるところで線を切る', () => {
    const buf = new Float32Array([0, 1, 2, 3]),
      d = rollPath(buf, 0, 4, 1, 1);
    expect(d.startsWith('M')).toBe(true);
    expect(d.endsWith('L400.0 0.0')).toBe(true);
    const w = new Float32Array([170, 179, -179, -170]);
    expect(rollPath(w, 0, 4, 1, 100, 180).split('M')).toHaveLength(3);
    expect(maxAbs(new Float32Array([0.1, -0.3, 0.2]), 1, 3, 10)).toBeCloseTo(3, 6);
  });

  it('s 平面: すべての極が枠に入る 1 div', () => {
    const ds = design(IP02, CTRL),
      sp = splane(ds.ol, ds.cl, String);
    expect(sp.out).toBe(0);
    expect(sp.d).toBe(5);
    expect(sp.cl.match(/a5 5/g)).toHaveLength(8);
  });
});

describe('入力の定義', () => {
  const all = [...PLANT, ...DRIVE, ...SENSE, ...LQR, ...PLACE, ...PID, ...SWING, PUSH];
  it('項目の名前が重ならず、初期値が範囲に入る', () => {
    const ks = all.map((d) => d.k);
    expect(new Set(ks).size).toBe(ks.length);
    for (const d of all) {
      expect(d.v, d.k).toBeGreaterThanOrEqual(d.min);
      expect(d.v, d.k).toBeLessThanOrEqual(d.max);
      expect(valueList(d, 24).length, d.k).toBeGreaterThan(5);
    }
  });

  it('教材の値は範囲に入り、初期値は IP02・長い振子・おもり', () => {
    for (const p of PRESETS)
      for (const [k, v] of Object.entries(p.vals)) {
        const d = all.find((x) => x.k === k);
        expect(d, k).toBeDefined();
        expect(v).toBeGreaterThanOrEqual(d?.min ?? 0);
        expect(v).toBeLessThanOrEqual(d?.max ?? 0);
      }
    const w = PRESETS[0];
    for (const [k, v] of Object.entries(w.vals)) expect(all.find((x) => x.k === k)?.v, k).toBe(v);
  });
});
