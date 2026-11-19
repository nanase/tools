import { describe, expect, it } from 'vitest';
import { develop, gainsFrom, sceneData, shoot } from '../src/tools/white-balance/scene';
import { SCENES } from '../src/tools/white-balance/scenes';
import {
  CHART,
  cctOf,
  cctSpec,
  D65,
  daylight,
  dot,
  FLUOR,
  mv,
  NM,
  ONE,
  planck,
  rawOf,
  SRGB_TO_XYZ,
  smoothFit,
  xyzOf,
  YB,
} from '../src/tools/white-balance/spectrum';
import { castName, LIGHTS, nearestT, PRESET, posOf, tempAt } from '../src/tools/white-balance/wb';

const xy = (X: number[]) => [X[0] / (X[0] + X[1] + X[2]), X[1] / (X[0] + X[1] + X[2])];

describe('光', () => {
  it('明るさ Y は 1 にそろえる', () => {
    for (const E of [planck(2700), daylight(5500), FLUOR]) expect(dot(E, YB)).toBeCloseTo(1, 9);
  });
  it('D65 の色度は (0.3127, 0.3290) に近い', () => {
    const [x, y] = xy(xyzOf(ONE, D65));
    expect(Math.abs(x - 0.3127)).toBeLessThan(0.003);
    expect(Math.abs(y - 0.329)).toBeLessThan(0.003);
  });
  it('黒体と昼光の相関色温度は元の温度に近い', () => {
    for (const T of [1900, 2700, 3200]) expect(Math.abs(cctOf(planck(T)).T - T) / T).toBeLessThan(0.03);
    for (const T of [5500, 6500, 7500]) expect(Math.abs(cctOf(daylight(T)).T - T) / T).toBeLessThan(0.03);
  });
  it('黒体は Duv がほぼ 0、昼光はわずかに緑寄り', () => {
    expect(Math.abs(cctOf(planck(3000)).duv)).toBeLessThan(0.002);
    expect(cctOf(daylight(6500)).duv).toBeGreaterThan(0);
  });
});

describe('反射率と色の行列', () => {
  it('滑らかな反射率は昼光で元の色に戻る', () => {
    const rgb = [194, 150, 130] as const,
      R = smoothFit(rgb),
      t = mv(
        SRGB_TO_XYZ,
        rgb.map((v) => ((v / 255 + 0.055) / 1.055) ** 2.4),
      ),
      X = xyzOf(R, D65).map((v) => v / xyzOf(ONE, D65)[1]);
    for (let k = 0; k < 3; k++) expect(X[k]).toBeCloseTo(t[k] as number, 3);
  });
  it('灰色の反射率はほぼ平ら', () => {
    const R = smoothFit([160, 160, 160]);
    expect(Math.max(...R) - Math.min(...R)).toBeLessThan(0.01);
  });
  it('白をそろえた RAW (1, 1, 1) は表示の白 (1, 1, 1) に移る', () => {
    const c = mv(NM, [1, 1, 1]);
    for (const v of c) expect(v).toBeCloseTo(1, 6);
  });
  it('昼光で写した色見本は、行列で元の色に近い', () => {
    const W = rawOf(ONE, D65),
      Xw = xyzOf(ONE, D65)[1];
    let worst = 0;
    for (const R of CHART) {
      const r = rawOf(R, D65),
        c = mv(NM, [r[0] / W[0], r[1] / W[1], r[2] / W[2]]),
        t = mv(
          [
            [3.2406, -1.5372, -0.4986],
            [-0.9689, 1.8758, 0.0415],
            [0.0557, -0.204, 1.057],
          ],
          xyzOf(R, D65).map((v) => v / Xw),
        );
      worst = Math.max(worst, ...c.map((v, k) => Math.abs(v - (t[k] as number))));
    }
    expect(worst).toBeLessThan(0.08);
  });
});

describe('ホワイトバランス', () => {
  it('光と同じ白でゲインを決めると、白い紙の R・G・B がそろう', () => {
    for (const [, , f] of LIGHTS) {
      const E = f(),
        w = rawOf(ONE, E),
        g = gainsFrom(w);
      expect(w[0] * g[0]).toBeCloseTo(w[1], 9);
      expect(w[2] * g[2]).toBeCloseTo(w[1], 9);
    }
  });
  it('電球を太陽光の設定で写すと橙寄り、電球の設定ならほぼ白', () => {
    const w = rawOf(ONE, planck(2700)),
      dev = (S: number) => {
        const g = gainsFrom(rawOf(ONE, cctSpec(S)));
        return mv(NM, [(w[0] * g[0]) / w[1], 1, (w[2] * g[2]) / w[1]]);
      };
    expect(castName(dev(5200))).toMatch(/^橙寄り/);
    expect(castName(dev(2700))).toBe('ほぼ白');
  });
  it('曇天を電球の設定で写すと青寄り', () => {
    const w = rawOf(ONE, daylight(6500)),
      g = gainsFrom(rawOf(ONE, cctSpec(3200)));
    expect(castName(mv(NM, [(w[0] * g[0]) / w[1], 1, (w[2] * g[2]) / w[1]]))).toMatch(/^青寄り/);
  });
  it('白の RAW から元の色温度を探せる', () => {
    for (const T of [2000, 2700, 4000, 5200, 7000, 10000])
      expect(Math.abs(nearestT(rawOf(ONE, cctSpec(T))) - T) / T).toBeLessThan(0.03);
  });
  it('蛍光灯の設定で蛍光灯を写すと、ほぼ白', () => {
    const p = PRESET.fl as readonly [number, number],
      w = rawOf(ONE, FLUOR),
      g = gainsFrom(rawOf(ONE, cctSpec(p[0]))),
      t = Math.exp(-p[1] * 0.006);
    expect(castName(mv(NM, [(w[0] * g[0]) / w[1], t, (w[2] * g[2]) / w[1]]))).toBe('ほぼ白');
  });
  it('帯の位置と色温度は行き来できる', () => {
    for (const T of [1800, 2700, 5200, 12000]) expect(tempAt(posOf(T))).toBeCloseTo(T, 6);
    expect(posOf(1800)).toBeCloseTo(0, 9);
    expect(posOf(12000)).toBeCloseTo(1, 9);
  });
});

describe('場面', () => {
  const LKEYS = new Set(LIGHTS.map((l) => l[0]));
  it('id は重ならず、スポイトと白い所は写真の中にある', () => {
    expect(new Set(SCENES.map((s) => s.id)).size).toBe(SCENES.length);
    for (const s of SCENES) {
      const pts = [s.pick, ...(s.refs ?? [])];
      for (const p of pts) {
        expect(p[0], s.id).toBeGreaterThanOrEqual(0);
        expect(p[0], s.id).toBeLessThan(800);
        expect(p[1], s.id).toBeGreaterThanOrEqual(0);
        expect(p[1], s.id).toBeLessThan(500);
      }
    }
  });
  it('光が 2 つの場面は、白い所が 2 つと、光の初めの選択を持つ', () => {
    for (const s of SCENES.filter((x) => x.w)) {
      expect(s.refs?.length, s.id).toBe(2);
      for (const k of s.lights ?? []) expect(LKEYS.has(k as never), `${s.id}: ${k}`).toBe(true);
    }
  });
  it('どの場面も画素の表にでき、材質の番号は表の中にある', () => {
    for (const s of SCENES) {
      const d = sceneData(s, 80, 50);
      let mx = 0;
      for (const v of d.ID) mx = Math.max(mx, v);
      expect(mx, s.id).toBeLessThan(d.mats.length);
    }
  });
  it('食卓の白い紙は、光に合わせると白く、太陽光の設定で電球を写すと橙に写る', () => {
    const s = SCENES.find((x) => x.id === 'table');
    if (!s) throw new Error('食卓がない');
    const W = 160,
      H = 100,
      d = sceneData(s, W, H),
      E = planck(2700),
      sh = shoot(d, E),
      out = new Uint8ClampedArray(W * H * 4),
      ref = s.refs?.[0] ?? s.pick,
      p = (Math.round(ref[1] / 5) * W + Math.round(ref[0] / 5)) * 4;
    develop(out, sh, gainsFrom(rawOf(ONE, E)), 0);
    expect(Math.abs((out[p] as number) - (out[p + 2] as number))).toBeLessThan(8);
    develop(out, sh, gainsFrom(rawOf(ONE, cctSpec(5200))), 0);
    expect((out[p] as number) - (out[p + 2] as number)).toBeGreaterThan(40);
  });
});
