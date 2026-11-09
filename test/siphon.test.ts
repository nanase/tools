import { describe, expect, it } from 'vitest';
import { chord, makeVessel, pAtm, pVap, volAt } from '../src/tools/siphon/model';
import { sceneOf } from '../src/tools/siphon/scenes';
import { DEFAULTS, makeSim, run, type Vals } from '../src/tools/siphon/sim';

const L_S = 1e-3;
const go = (id: string, T: number, over: Partial<Vals> = {}) => {
  const sc = sceneOf(id),
    S = makeSim(sc, { ...DEFAULTS, ...over });
  run(S, sc, T);
  return S;
};

describe('容器', () => {
  it('切り口の幅と体積', () => {
    const sq: [number, number][] = [
      [0, 0],
      [2, 0],
      [2, 1],
      [0, 1],
    ];
    expect(chord(sq, 0.5)).toBeCloseTo(2, 9);
    const V = makeVessel({ poly: sq, D: 3 });
    expect(V.cap).toBeCloseTo(6, 6);
    expect(volAt(V, 0.25)).toBeCloseTo(1.5, 6);
  });
  it('気圧と蒸気圧', () => {
    expect(pAtm(0)).toBeCloseTo(101325, 0);
    expect(pAtm(3776) / 100).toBeGreaterThan(620);
    expect(pAtm(3776) / 100).toBeLessThan(645);
    expect(pVap(20)).toBeGreaterThan(2300);
    expect(pVap(20)).toBeLessThan(2400);
    expect(pVap(100)).toBeGreaterThan(100000);
    expect(pVap(100)).toBeLessThan(103000);
  });
});

describe('身近な物', () => {
  it('灯油ポンプ: 呼び水で流れ、3〜15 L/min。止めずにいるとカートリッジタンクからあふれる', () => {
    const S = go('kerosene', 5);
    expect(S.q * 6e4).toBeGreaterThan(3);
    expect(S.q * 6e4).toBeLessThan(15);
    expect(S.crestP()).toBeLessThan(S.patm);
    const S2 = go('kerosene', 200);
    expect(S2.ev.some((e) => e.k === 'over')).toBe(true);
  });
  it('灯油ポンプ: 空気弁を開けると止まる', () => {
    const sc = sceneOf('kerosene'),
      S = makeSim(sc);
    run(S, sc, 5);
    S.breakAir();
    run(S, sc, 5);
    expect(S.q).toBe(0);
  });
  it('水槽: 吸い口まで水位が下がると空気が入って止まり、既定ではバケツはあふれない', () => {
    const S = go('aquarium', 400);
    expect(S.q).toBe(0);
    expect(S.over).toBe(false);
    expect(S.h1).toBeCloseTo(0.752 + 0.19, 2);
    expect(S.out * 1000).toBeGreaterThan(12);
    expect(S.out * 1000).toBeLessThan(20);
  });
  it('水槽: 吸い口を下げるとバケツからあふれる', () => {
    const S = go('aquarium', 600, { atip: 4 });
    expect(S.over).toBe(true);
  });
  it('教訓茶碗: 注ぎ続けると、頂上を越えるたびに底まで抜けるくり返し', () => {
    const S = go('cup', 900);
    expect(S.bursts.length).toBeGreaterThanOrEqual(3);
    const p = S.period() ?? 0;
    expect(p).toBeGreaterThan(60);
    expect(p).toBeLessThan(300);
  });
  it('トイレ: レバーで吸い出し、補った水で封水が戻る。補う水だけでは流れ出さない', () => {
    const sc = sceneOf('toilet'),
      S = makeSim(sc);
    run(S, sc, 6);
    expect(S.qmax / L_S).toBeGreaterThan(2);
    expect(S.ev.some((e) => e.k === 'air')).toBe(true);
    run(S, sc, 24);
    expect(S.h1).toBeGreaterThan(S.zC - 0.01);
    expect(S.bursts).toHaveLength(1);
  });
});

describe('間欠冷泉（観測と比べる）', () => {
  const period = (q: number) => {
    const S = go('kusama', 70 * 3600, { kq: q });
    return { T: (S.period() ?? 0) / 3600, b: S.bursts[S.bursts.length - 1], S };
  };
  it('草間: 少雨の時期の流入で周期 4〜10 時間、約 10 分後に最大 約 10 L/s', () => {
    for (const q of [0.4, 0.9]) {
      const { T, b } = period(q);
      expect(T).toBeGreaterThan(4);
      expect(T).toBeLessThan(10.5);
      expect(b.peak / L_S).toBeGreaterThan(8.5);
      expect(b.peak / L_S).toBeLessThan(12);
      expect((b.tp - b.t0) / 60).toBeGreaterThan(5);
      expect((b.tp - b.t0) / 60).toBeLessThan(14);
      expect(b.vol).toBeGreaterThan(12);
      expect(b.vol).toBeLessThan(17);
    }
  });
  it('草間: 雨の多い時期（1〜2 L/s）で周期 2.5〜3.5 時間', () => {
    for (const q of [1.2, 1.5, 2]) {
      const { T } = period(q);
      expect(T).toBeGreaterThan(2.3);
      expect(T).toBeLessThan(3.8);
    }
  });
  it('草間: 5 L/s では湧き続ける', () => {
    const S = go('kusama', 30 * 3600, { kq: 5 });
    expect(S.q / L_S).toBeCloseTo(5, 0);
    expect(S.full).toBe(true);
  });
  it('ピリオディック・スプリング: 冬の流入で周期 約 30 分、湧くのは数分。夏は湧き続ける', () => {
    const S = go('periodic', 6 * 3600, { pq: 0.08 });
    const T = (S.period() ?? 0) / 60,
      b = S.bursts[S.bursts.length - 1];
    expect(T).toBeGreaterThan(25);
    expect(T).toBeLessThan(35);
    expect((b.t1 - b.t0) / 60).toBeGreaterThan(2);
    expect((b.t1 - b.t0) / 60).toBeLessThan(6);
    const W = go('periodic', 3 * 3600, { pq: 3 });
    expect(W.full).toBe(true);
  });
});

describe('高さの限界', () => {
  it('海面・20 ℃ で 9 m は流れ、11.5 m では水柱が分断する', () => {
    expect(go('height', 10, { ht: 9 }).q).toBeGreaterThan(0);
    const S = go('height', 10, { ht: 11.5 });
    expect(S.vapor).toBe(true);
    expect(S.q).toBe(0);
  });
  it('限界の高さは海面で約 10.1 m、富士山頂で約 6.2 m、90 ℃ の湯で約 3 m', () => {
    expect(go('height', 0.1).lift).toBeCloseTo(10.1, 1);
    expect(go('height', 0.1, { alt: 3800 }).lift).toBeGreaterThan(6);
    expect(go('height', 0.1, { alt: 3800 }).lift).toBeLessThan(6.4);
    const hot = go('height', 0.1, { tc: 90 }).lift;
    expect(hot).toBeGreaterThan(2.5);
    expect(hot).toBeLessThan(3.6);
  });
  it('限界の近くでは頂上の圧力が蒸気圧で止まり、流量が頭打ちになる', () => {
    const S = go('height', 10, { ht: 10.9 });
    expect(S.choke).toBe(true);
    expect(S.crestP()).toBeCloseTo(S.pv, -1);
  });
});
