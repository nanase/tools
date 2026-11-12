import { describe, expect, it } from 'vitest';
import { ART, LOOP } from '../src/lib/card-art';
import { BD, boardMask, boardSim } from '../src/tools/wire-heating/board';
import { tOf, uOf } from '../src/tools/wire-heating/fig';
import { airField, linePlume, pointPlume } from '../src/tools/wire-heating/plume';
import { wireSim } from '../src/tools/wire-heating/sim';
import { acFactor, pathOf, type WireIn } from '../src/tools/wire-heating/wire';

const base: WireIn = {
  mat: 'cu',
  shape: 'round',
  d: 1.29e-3,
  w: 1e-3,
  t: 35e-6,
  len: 0.3,
  surf: 'oxid',
  ends: 'sink',
  I: 22,
  f: 0,
  mode: 'cont',
  tp: 1,
  Ta: 20,
  wind: 0,
};
const run = (o: Partial<WireIn> = {}) => wireSim({ ...base, ...o });
const maxOf = (f: Float32Array) => f.reduce((a, b) => Math.max(a, b), Number.NEGATIVE_INFINITY);

describe('表皮効果', () => {
  it('丸線の交流抵抗の倍率は、厚い極限の a/2δ + 1/4 に近づく', () => {
    const g = { shape: 'round', d: 1.29e-3 } as const;
    expect(acFactor(g, 1.68e-8, 0)).toBe(1);
    expect(acFactor(g, 1.68e-8, 50)).toBeCloseTo(1, 3);
    expect(acFactor(g, 1.68e-8, 1e6)).toBeCloseTo(5.2, 1);
  });
  it('角線は薄いほど効きが小さい', () => {
    const thin = acFactor({ shape: 'rect', w: 1e-3, t: 35e-6 }, 1.68e-8, 1e6),
      thick = acFactor({ shape: 'rect', w: 1e-3, t: 1e-3 }, 1.68e-8, 1e6);
    expect(thin).toBeLessThan(thick);
    expect(thin).toBeGreaterThanOrEqual(1);
  });
});

describe('線', () => {
  it('断熱に近い大電流では Onderdonk の式と同じころに溶ける', () => {
    /* 直径 1 mm、200 A。Onderdonk（Brooks の形）I = 0.188 A / √t（A は平方ミル）から t ≈ 1.31 s */
    const s = run({ d: 1e-3, I: 200 }),
      amil = (Math.PI * 0.5e-3 ** 2) / 25.4e-6 ** 2,
      tO = ((0.188 * amil) / 200) ** 2;
    expect(s.tMelt).not.toBeNull();
    expect(Math.abs((s.tMelt ?? 0) / tO - 1)).toBeLessThan(0.15);
  });
  it('溶けたら切れて電流が止まり、そのあとも冷えて気温へ戻るまで追う', () => {
    const s = run({ d: 0.5e-3, I: 40, len: 0.2 }),
      k = s.times.findIndex((t) => t > (s.tMelt ?? 0));
    expect(s.tMelt).not.toBeNull();
    expect(s.cut).not.toBeNull();
    expect(s.tOff).toBe(s.tMelt);
    /* 切れた後は発熱がなく、最後はほぼ気温 */
    expect(s.bal[k + 1].gen).toBe(0);
    expect(s.times[s.times.length - 1]).toBeGreaterThan((s.tMelt ?? 0) * 10);
    expect(maxOf(s.frames[s.frames.length - 1])).toBeLessThan(21);
  });
  it('観察時間を決めると、定常になってもその時刻まで続ける', () => {
    const s = run({ d: 0.5e-3, I: 10, span: 600 });
    expect(s.times[s.times.length - 1]).toBeCloseTo(600, 6);
    expect(run({ d: 0.5e-3, I: 10 }).times.at(-1)).toBeLessThan(200);
  });
  it('Preece の溶断電流では融点のあたりで釣り合う', () => {
    /* Preece の式（銅）I = 80 d^1.5（d は mm） */
    for (const dm of [0.5, 1]) {
      const s = run({ d: dm * 1e-3, I: 80 * dm ** 1.5, surf: 'oxid' });
      expect(s.Imelt / (80 * dm ** 1.5)).toBeGreaterThan(0.85);
      expect(s.Imelt / (80 * dm ** 1.5)).toBeLessThan(1.25);
    }
  });
  it('端子へ熱が逃げるので、短い線の最高温度は長い線の中ほどより低い', () => {
    const s = run(),
      last = s.frames[s.frames.length - 1];
    expect(s.Tss).not.toBeNull();
    expect(maxOf(last)).toBeLessThan(s.Tss ?? 0);
    expect(last[0]).toBeLessThan(maxOf(last));
  });
  it('断熱の端子では端も熱くなる', () => {
    const s = run({ ends: 'free' }),
      last = s.frames[s.frames.length - 1];
    expect(last[0]).toBeGreaterThan(maxOf(last) - 1);
  });
  it('細い線では、被覆で外周と放射率が増える分だけ裸より冷える', () => {
    const bare = run({ d: 0.5e-3, I: 10 }).Tss ?? 0,
      pvc = run({ d: 0.5e-3, I: 10, surf: 'pvc' }).Tss ?? 0;
    expect(pvc).toBeGreaterThan(20);
    expect(pvc).toBeLessThan(bare);
  });
  it('パルスのあとは冷えて気温に戻る', () => {
    const s = run({ d: 0.5e-3, I: 40, mode: 'pulse', tp: 0.5 }),
      last = s.frames[s.frames.length - 1];
    expect(s.tMelt).toBeNull();
    expect(maxOf(last)).toBeLessThan(25);
  });
  it('熱の内訳は定常で発熱と釣り合う', () => {
    const s = run(),
      b = s.bal[s.bal.length - 1];
    expect((b.conv + b.rad + b.term) / b.gen).toBeGreaterThan(0.97);
    expect((b.conv + b.rad + b.term) / b.gen).toBeLessThan(1.03);
  });
  it('温度上昇 30 K の電流では、長い線の中ほどが 30 K 上がる', () => {
    const s = run(),
      s2 = run({ I: s.I30 });
    expect(s2.Tss).toBeCloseTo(50, 0);
  });
});

describe('経路', () => {
  it('等間隔に並べた点の長さは、直線なら両端の距離', () => {
    const p = pathOf(
      [
        [0, 0],
        [0.05, 0],
        [0.1, 0],
      ],
      100,
    );
    expect(p.len).toBeCloseTo(0.1, 6);
    expect(p.pts).toHaveLength(100);
  });
  it('縦のジグザグは、下の区間の熱気で直線より熱くなる', () => {
    const ctrl: [number, number][] = [];
    for (let k = 0; k <= 12; k++) ctrl.push([0.02 + k * 0.005, k % 2 ? 0.01 : 0.05]);
    const path = pathOf(ctrl, 120),
      zig = wireSim({ ...base, d: 0.3e-3, I: 4, path }),
      str = wireSim({ ...base, d: 0.3e-3, I: 4, len: path.len });
    expect(maxOf(zig.frames[zig.frames.length - 1])).toBeGreaterThan(maxOf(str.frames[str.frames.length - 1]) + 5);
  });
});

describe('空気', () => {
  it('線の上のプルームは昇るほどぬるくなり、速さは増える', () => {
    const pl = linePlume(9.5, 137, 20, 0),
      a = pl.at(0, 0.01),
      b = pl.at(0, 0.03);
    expect(a[0]).toBeGreaterThan(b[0]);
    expect(b[1]).toBeGreaterThan(a[1]);
    /* 線の位置では表面の温度を超えない */
    expect(pl.at(0, 0)[0]).toBeLessThanOrEqual(137 + 1e-9);
    /* 横へ離れるとほぼ気温 */
    expect(pl.at(0.02, 0.01)[0]).toBeLessThan(0.01);
  });
  it('点の熱源のプルームは線の温度を超えず、重なっても線の最高の 85 % まで', () => {
    const f = pointPlume(0.05, 100, 20);
    expect(f(0, 0)[0]).toBeCloseTo(100, 6);
    const src = Array.from({ length: 20 }, (_, i) => ({ x: 0, y: 0.05 - i * 0.002, dTs: 100, f }));
    expect(airField(src, 0, 0)[0]).toBeLessThanOrEqual(85);
  });
});

describe('基板', () => {
  it('パターンの銅箔は左右のパッドを結ぶ', () => {
    for (const kind of ['line', 'neck', 'corner', 'meander'] as const) {
      const { cu, fix } = boardMask(kind, 1);
      expect(fix.some((v) => v === 1)).toBe(true);
      expect(fix.some((v) => v === -1)).toBe(true);
      expect(cu.reduce((a, b) => a + b, 0)).toBeGreaterThan(100);
    }
  });
  it('幅 0.5 mm・1 oz・2 A の直線は 10〜25 K 上がる（IPC-2152 由来の表で 0.38 mm・20 K）', () => {
    const s = boardSim({ kind: 'line', w: 0.5, tcu: 35e-6, tb: 1.6e-3, Ta: 20, I: 2, f: 0, mode: 'cont', tp: 1 });
    while (!s.step(1e9, () => 0)) {
      /* 終わるまで進める */
    }
    const rise = s.maxT[s.maxT.length - 1] - 20;
    expect(rise).toBeGreaterThan(10);
    expect(rise).toBeLessThan(25);
    /* 抵抗は ρL/(wt) の直線の部分とおおむね合う（パッドの分だけ短い） */
    expect(s.R[0]).toBeGreaterThan((1.68e-8 * 0.02) / (0.5e-3 * 35e-6));
    expect(s.R[0]).toBeLessThan((1.68e-8 * 0.027) / (0.5e-3 * 35e-6));
  }, 60000);
  it('くびれでは電流が集まり、直線より熱い', () => {
    const go = (kind: 'line' | 'neck') => {
      const s = boardSim({ kind, w: 1, tcu: 35e-6, tb: 1.6e-3, Ta: 20, I: 3, f: 0, mode: 'cont', tp: 1 });
      for (let k = 0; k < 120; k++) s.step(1e9, () => 0);
      return s.maxT[s.maxT.length - 1];
    };
    expect(go('neck')).toBeGreaterThan(go('line') + 3);
  }, 60000);
  it('溶けた升は外れ、パッドの間が切れると電流が止まって冷える', () => {
    const s = boardSim({ kind: 'neck', w: 1, tcu: 35e-6, tb: 1.6e-3, Ta: 20, I: 30, f: 0, mode: 'cont', tp: 1 });
    while (!s.step(1e9, () => 0)) {
      /* 終わるまで進める */
    }
    expect(s.tOpen).not.toBeNull();
    expect([...s.cutAt].some(Number.isFinite)).toBe(true);
    expect(s.Ion[s.Ion.length - 1]).toBe(0);
    expect(s.t).toBeGreaterThan((s.tOpen ?? 0) + 600);
    expect(s.maxT[s.maxT.length - 1]).toBeLessThan(25);
  }, 60000);
  it('パルスの後は電流が止まり、冷えるまで追う', () => {
    const s = boardSim({ kind: 'line', w: 1, tcu: 35e-6, tb: 1.6e-3, Ta: 20, I: 5, f: 0, mode: 'pulse', tp: 30 });
    while (!s.step(1e9, () => 0)) {
      /* 終わるまで進める */
    }
    expect(s.tOff).toBe(30);
    expect(s.tOpen).toBeNull();
    const k = s.times.findIndex((t) => t > 30);
    expect(s.Ion[k]).toBe(0);
    /* 止めてから 30 分でほぼ気温 */
    expect(s.maxT[s.maxT.length - 1]).toBeLessThan(23);
  }, 60000);
  it('格子は 30 × 18 mm', () => {
    expect(BD.NX * BD.dx).toBeCloseTo(0.03, 9);
    expect(BD.NY * BD.dx).toBeCloseTo(0.018, 9);
  });
});

describe('カードの図柄', () => {
  it('1 周で元の絵に戻り、止まった絵に点がある', () => {
    expect(ART.wh(LOOP.wh)).toBe(ART.wh(0));
    expect(ART.wh(0)).toContain('<circle class="fa"');
  });
});

describe('時間軸', () => {
  it('対数に近い目盛りは端を合わせ、行き来で同じ時刻に戻る', () => {
    const m = { t0: 0.05, te: 1800 };
    expect(uOf(m, 0)).toBe(0);
    expect(uOf(m, 1800)).toBeCloseTo(1, 12);
    for (const t of [0.001, 0.05, 1, 60, 1000]) expect(tOf(m, uOf(m, t))).toBeCloseTo(t, 6);
    /* 線形では時刻に比例 */
    const l = { ...m, lin: true };
    expect(uOf(l, 900)).toBeCloseTo(0.5, 12);
    expect(tOf(l, 0.25)).toBeCloseTo(450, 9);
    /* 1 秒までに目盛りの 2 割以上を使う */
    expect(uOf(m, 1)).toBeGreaterThan(0.2);
  });
});
