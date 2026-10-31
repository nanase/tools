import { describe, expect, it } from 'vitest';
import { absorption, soundSpeed } from '../src/lib/air';
import { fft } from '../src/tools/biquad/filter';
import {
  type Branch,
  branchLength,
  CH0,
  FORK_P,
  LEGS_P,
  makeChannel,
  shape,
  strokeTimes,
  TWIN_P,
  turnAngles,
} from '../src/tools/thunder/channel';
import type { Elements } from '../src/tools/thunder/path';
import {
  arrivalHistogram,
  audibleRange,
  barrierDb,
  bendRadius,
  elements,
  firstArrival,
  SCENE0,
  type Scene,
  Via,
} from '../src/tools/thunder/path';
import {
  addBox,
  addNWave,
  addNWaveBox,
  airDensity,
  convolveNWave,
  fewPeak,
  LINE_G,
  N_PEAK_X,
  nDuration,
  nDuration0,
  nPeak,
  nSpectrum,
  P0,
  relaxRadius,
} from '../src/tools/thunder/shock';
import { render, spectrum } from '../src/tools/thunder/synth';
import { terrainIR, terrainTail } from '../src/tools/thunder/terrain';

const FS = 48000,
  C = soundSpeed(20);

/** 真っすぐな折れ線 */
const line = (a: [number, number, number], b: [number, number, number], e = 5e5, n = 20): Branch => {
  const p = new Float64Array(3 * (n + 1));
  for (let k = 0; k <= n; k++) for (let j = 0; j < 3; j++) p[3 * k + j] = a[j] + ((b[j] - a[j]) * k) / n;
  return { p, e, k: 0, t: 0 };
};
/** 反射も影もない場面 */
const FREE: Scene = { ...SCENE0, ground: 0, hillH: 0, lapse: 0 };

describe('衝撃波と N 波', () => {
  it('緩和半径 R₀ = √(E/πp₀)。100 kPa で 10⁴・10⁵・10⁶ J/m なら 0.18・0.56・1.78 m（Few 1986 の表 4.1）', () => {
    expect(relaxRadius(Math.PI * P0)).toBeCloseTo(1, 12);
    expect(relaxRadius(1e4, 1e5)).toBeCloseTo(0.18, 2);
    expect(relaxRadius(1e5, 1e5)).toBeCloseTo(0.56, 2);
    expect(relaxRadius(1e6, 1e5)).toBeCloseTo(1.78, 2);
  });
  it('Few のピーク f_m = 0.63 c √(p₀/E) は、学位論文の式 4.7 E ≈ 5×10⁹/f_m² の f_m と 3 % 以内で合い、10⁶ J/m で約 69 Hz', () => {
    for (const e of [1e4, 1e5, 1e6]) {
      const f = Math.sqrt(5e9 / e);
      expect(Math.abs(fewPeak(e, 343) - f) / f).toBeLessThan(0.03);
    }
    expect(fewPeak(1e6, 343)).toBeGreaterThan(65);
    expect(fewPeak(1e6, 343)).toBeLessThan(72);
    /* R₀ で書くと 0.63 c/(√π R₀) */
    expect(fewPeak(1e6, 343) * relaxRadius(1e6)).toBeCloseTo((0.63 * 343) / Math.sqrt(Math.PI), 9);
  });
  it('N 波のスペクトルのピークは x = πfT ≈ 2.08（tan x = x/(1 − x²/2) の解でもある）', () => {
    expect(N_PEAK_X).toBeCloseTo(2.0816, 3);
    /* (sin x/x − cos x)/x の微分が 0: tan x (1 − x²/2) = x */
    const x = N_PEAK_X;
    expect(Math.tan(x) * (1 - (x * x) / 2) - x).toBeCloseTo(0, 6);
  });
  it('N 波の長さは正の側 0.53 R₀ の 2 倍。1 km で 2 倍に伸びると、スペクトルのピークが Few の f_m に 15 % 以内で近い', () => {
    for (const e of [1e5, 1e6]) {
      const T0 = nDuration0(e, C);
      expect((T0 * C) / 2 / relaxRadius(e)).toBeCloseTo(0.53, 9);
      const f = nPeak(nDuration(T0, 1000));
      expect(Math.abs(f - fewPeak(e, C)) / fewPeak(e, C)).toBeLessThan(0.15);
    }
  });
  it('標本にした N 波は面積 0、正の側の面積 PT/4、DFT が式のスペクトルに合う', () => {
    const N = 1 << 14,
      T = 96.3,
      P = 2,
      y = new Float64Array(N);
    addNWave(y, 100.37, T, P);
    let sum = 0,
      pos = 0;
    for (const v of y) {
      sum += v;
      if (v > 0) pos += v;
    }
    expect(sum).toBeCloseTo(0, 9);
    expect(pos / ((P * T) / 4)).toBeCloseTo(1, 2);
    /* 区間の平均を取った分（sinc）の差は低い周波数では小さい */
    for (const k of [20, 60, 200]) {
      let re = 0,
        im = 0;
      for (let n = 0; n < N; n++) {
        re += y[n] * Math.cos((2 * Math.PI * k * n) / N);
        im -= y[n] * Math.sin((2 * Math.PI * k * n) / N);
      }
      expect(Math.hypot(re, im) / nSpectrum(k / N, T, P)).toBeCloseTo(1, 2);
    }
  });
  it('幅 W にならした N 波は面積 0・正の側も N 波と同じ、DFT は N 波のスペクトルに箱の sinc を掛けたもの', () => {
    const N = 1 << 14,
      T = 96.3,
      P = 2,
      W = 17.6,
      y = new Float64Array(N);
    addNWaveBox(y, 300.37, T, P, W);
    let sum = 0;
    for (const v of y) sum += v;
    expect(sum).toBeCloseTo(0, 9);
    for (const k of [20, 60, 200]) {
      let re = 0,
        im = 0;
      for (let n = 0; n < N; n++) {
        re += y[n] * Math.cos((2 * Math.PI * k * n) / N);
        im -= y[n] * Math.sin((2 * Math.PI * k * n) / N);
      }
      const x = (Math.PI * k * W) / N;
      expect(Math.hypot(re, im) / (nSpectrum(k / N, T, P) * Math.abs(Math.sin(x) / x))).toBeCloseTo(1, 2);
    }
  });
  it('時刻の密度と N 波のたたみ込みは、幅 W にならした N 波を足したものと同じ（W ≥ 1 標本）', () => {
    const N = 4096,
      T = 96.3,
      a = new Float64Array(N),
      b = new Float64Array(N),
      x = new Float64Array(N);
    for (const [c, P, W] of [
      [300.37, 2, 17.6],
      [341.9, -0.7, 1.3],
      [512.05, 1.1, 40],
    ]) {
      addNWaveBox(a, c, T, P, W);
      addBox(x, c, P, W);
    }
    convolveNWave(x, b, N, T);
    let e = 0,
      s = 0;
    for (let n = 0; n < N; n++) {
      e += (a[n] - b[n]) ** 2;
      s += a[n] ** 2;
    }
    expect(Math.sqrt(e / s)).toBeLessThan(0.02);
    expect(b.reduce((p, v) => p + v, 0)).toBeCloseTo(0, 9);
  });
  it('N 波は最初の 1 km で 2 倍に伸び、その先は伸びない（Few 1986）', () => {
    expect(nDuration(0.004, 10)).toBe(0.004);
    expect(nDuration(0.004, 1000)).toBeCloseTo(0.008, 12);
    expect(nDuration(0.004, 1e4)).toBeCloseTo(0.008, 12);
    let prev = 0;
    for (const r of [30, 100, 300, 999]) {
      const T = nDuration(0.004, r);
      expect(T).toBeGreaterThan(prev);
      prev = T;
    }
  });
  it('まっすぐな長い放電路の音のエネルギーは単位長さあたり ηE（円筒を通る量で確かめる）', () => {
    const e = 1e6,
      rho = 50,
      s: Scene = { ...FREE, dist: rho, ear: 0, stretch: { r1: 1, r2: 2, k: 1 } },
      w = render(elements([line([0, 0, -3000], [0, 0, 3000], e, 1)], s), s.air, FS);
    let sum = 0;
    for (const v of w.y) sum += v * v;
    const flux = (2 * Math.PI * rho * sum) / FS / (airDensity(20) * C);
    expect(flux / (s.eta * e)).toBeGreaterThan(0.85);
    expect(flux / (s.eta * e)).toBeLessThan(1.1);
    expect(LINE_G).toBeCloseTo(0.25, 4);
  });
});

describe('放電路', () => {
  it('同じ種なら同じ形、違う種なら違う形', () => {
    const a = makeChannel(CH0),
      b = makeChannel(CH0),
      c = makeChannel({ ...CH0, seed: 2 });
    expect(Array.from(a[0].p)).toEqual(Array.from(b[0].p));
    expect(Array.from(c[0].p)).not.toEqual(Array.from(a[0].p));
  });
  it('区間の向きの変化の平均は turn（Hill の 16°）に近く、区間の長さは lmin〜lmax で平均 8 m', () => {
    const all: number[] = [],
      lens: number[] = [];
    for (let s = 1; s <= 20; s++)
      for (const b of makeChannel({ ...CH0, seed: s })) {
        all.push(...turnAngles(b.p));
        for (let i = 3; i < b.p.length; i += 3)
          lens.push(Math.hypot(b.p[i] - b.p[i - 3], b.p[i + 1] - b.p[i - 2], b.p[i + 2] - b.p[i - 1]));
      }
    const mean = all.reduce((x, y) => x + y, 0) / all.length;
    expect(mean).toBeGreaterThan(14);
    expect(mean).toBeLessThan(18);
    /* 地面で止めた区間だけ短くなりうる */
    expect(lens.filter((l) => l > CH0.lmax + 1e-9).length).toBe(0);
    expect(lens.filter((l) => l < CH0.lmin - 1e-9).length / lens.length).toBeLessThan(0.01);
    expect(lens.reduce((x, y) => x + y, 0) / lens.length).toBeCloseTo(8, 0);
  });
  it('本流は地面から雲の底まで上がり、雲の中の最初の向きへ進む。ほかの向きは雲の底から', () => {
    const sh = shape(CH0),
      bs = makeChannel(CH0),
      [m] = bs,
      zs = m.p.filter((_, i) => i % 3 === 2);
    expect(sh.legs.length).toBe(2);
    expect(m.p[2]).toBe(0);
    expect(Math.max(...zs)).toBeGreaterThanOrEqual(CH0.base);
    expect(branchLength(m.p)).toBeGreaterThan(CH0.base + sh.legs[0].len);
    const leg = bs[1];
    expect(leg.k).toBe(0);
    /* 本流が雲の底に着いた点から始まる */
    const top = m.p.findIndex((v, i) => i % 3 === 2 && v >= CH0.base) - 2;
    expect(Array.from(leg.p.subarray(0, 3))).toEqual(Array.from(m.p.subarray(top, top + 3)));
    expect(branchLength(leg.p)).toBeGreaterThanOrEqual(sh.legs[1].len);
  });
  it('形の確かさ: 雲の中の向きの数・落雷 2 か所以上・落雷点に 2 本は、LEGS_P・FORK_P・TWIN_P に近い', () => {
    const N = 4000,
      legs = [0, 0, 0, 0];
    let forks = 0,
      twins = 0;
    for (let seed = 1; seed <= N; seed++) {
      const sh = shape({ ...CH0, seed });
      legs[sh.legs.length]++;
      if (sh.forks.length) forks++;
      twins += sh.twins;
    }
    for (let k = 0; k < legs.length; k++) expect(Math.abs(legs[k] / N - LEGS_P[k])).toBeLessThan(0.03);
    expect(Math.abs(forks / N - FORK_P)).toBeLessThan(0.02);
    expect(Math.abs(twins / N - TWIN_P)).toBeLessThan(0.02);
  });
  it('地面に届く枝は地面まで下り、2 本目の放電路は落雷点から雲の底まで上がる', () => {
    let fk = 0,
      tw = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const ch = { ...CH0, seed, strokes: 1 },
        sh = shape(ch),
        bs = makeChannel(ch).filter((b) => b.k === 0),
        extra = bs.slice(sh.legs.length ? sh.legs.length : 1);
      expect(extra).toHaveLength(sh.forks.length + sh.twins);
      sh.forks.forEach((f, i) => {
        const p = extra[i].p,
          n = p.length;
        expect(p[n - 1]).toBe(0);
        /* 分かれる高さの近くから、目標の点の向きへ（乱歩は目標の向きから 35° までそれる） */
        expect(Math.abs(p[2] - f.z)).toBeLessThan(CH0.lmax);
        expect(Math.hypot(p[n - 3] - f.x, p[n - 2] - f.y)).toBeLessThan(
          Math.tan((35 * Math.PI) / 180) * Math.hypot(f.z, f.x - p[0], f.y - p[1]),
        );
        fk++;
      });
      for (let i = 0; i < sh.twins; i++) {
        const p = extra[sh.forks.length + i].p;
        expect(Array.from(p.subarray(0, 3))).toEqual([0, 0, 0]);
        expect(p[p.length - 1]).toBeGreaterThanOrEqual(CH0.base);
        tw++;
      }
    }
    expect(fk).toBeGreaterThan(0);
    expect(tw).toBeGreaterThan(0);
  });
  it('雲の中へ進まない雷は、2 回目からも落雷点から雲の底までを通る', () => {
    let seed = 1;
    while (shape({ ...CH0, seed }).legs.length) seed++;
    const bs = makeChannel({ ...CH0, seed }),
      later = bs.filter((b) => b.t > 0);
    expect(later).toHaveLength(CH0.strokes - 1);
    for (const b of later) expect(Array.from(b.p)).toEqual(Array.from(bs[0].p));
  });
  it('多重雷: 2 回目からは本流の根元を通り、雲の中で分かれて grow だけ伸びる。回数を増やしても前の回は変わらない', () => {
    const four = makeChannel(CH0),
      eight = makeChannel({ ...CH0, strokes: 8 }),
      /* 放電ごとの本流（最初の本流と、2 回目からの本流） */
      mains = (bs: Branch[]) => bs.filter((b, i) => i === 0 || b.t > 0);
    expect(strokeTimes(four)).toHaveLength(4);
    expect(strokeTimes(eight)).toHaveLength(8);
    expect(strokeTimes(eight).slice(0, 4)).toEqual(strokeTimes(four));
    expect(
      mains(eight)
        .slice(0, 4)
        .map((b) => Array.from(b.p)),
    ).toEqual(mains(four).map((b) => Array.from(b.p)));
    const [m, ...rest] = mains(four);
    for (const b of rest) {
      expect(Array.from(b.p.subarray(0, 300))).toEqual(Array.from(m.p.subarray(0, 300)));
      expect(b.e).toBeCloseTo(CH0.e * CH0.eSub);
    }
    expect(makeChannel({ ...CH0, strokes: 1 }).filter((b) => b.t > 0)).toHaveLength(0);
  });
  it('放電の間隔の幾何平均は gap（Saba ほか 2006 の 61 ms）に近い', () => {
    const logs: number[] = [];
    for (let seed = 1; seed <= 200; seed++) {
      const t = strokeTimes(makeChannel({ ...CH0, seed, strokes: 8, branches: 0, cloud: 100, grow: 100 }));
      for (let k = 1; k < t.length; k++) logs.push(Math.log(t[k] - t[k - 1]));
    }
    const gm = Math.exp(logs.reduce((x, y) => x + y, 0) / logs.length);
    expect(gm).toBeGreaterThan(CH0.gap * 0.85);
    expect(gm).toBeLessThan(CH0.gap * 1.15);
  });
});

describe('届く時刻', () => {
  it('真上へ伸びる放電路: 最初に届くのは根元から、dist/c 秒後（3 秒で約 1 km）', () => {
    const el = elements([line([0, 0, 0], [0, 0, 2000])], { ...FREE, dist: 1000, ear: 0 });
    expect(firstArrival(el)).toBeCloseTo(1000 / C, 3);
    expect(1000 / C).toBeGreaterThan(2.8);
    expect(1000 / C).toBeLessThan(3.0);
  });
  it('後の放電の音は、その放電の時刻だけ遅れて届く', () => {
    const el = elements([{ ...line([0, 0, 0], [0, 0, 2000]), t: 0.2 }], { ...FREE, dist: 1000, ear: 0 });
    expect(firstArrival(el)).toBeCloseTo(0.2 + 1000 / C, 3);
  });
  it('雷鳴の長さ: 高さ H の放電路は、根元と先端の距離の差 (√(d² + H²) − d)/c だけ続く', () => {
    const d = 3000,
      H = 4000,
      el = elements([line([0, 0, 0], [0, 0, H])], { ...FREE, dist: d, ear: 0 });
    expect(Math.max(...el.t) - Math.min(...el.t)).toBeCloseTo((Math.hypot(d, H) - d) / C, 1);
  });
  it('地面の反射は、鏡像の分だけ遅れて地面の反射率の大きさで届く', () => {
    const el = elements([line([0, 0, 500], [0, 0, 501], 5e5, 1)], { ...FREE, ground: 0.8, ear: 10 }),
      d = el.via.indexOf(Via.Direct),
      g = el.via.indexOf(Via.Ground);
    expect(el.t[g] - el.t[d]).toBeCloseTo((Math.hypot(3000, 510.5) - Math.hypot(3000, 490.5)) / C, 4);
    expect(el.p[g] / el.p[d]).toBeCloseTo(0.8 * (el.r[d] / el.r[g]) * 1, 1);
  });
  it('左の聞き手: 放電路を左右に映したときの右の聞き手と、届く時刻と山の高さが同じ（後ろの山も左へ）', () => {
    const ch = makeChannel({ ...CH0, strokes: 2 }),
      flip = ch.map((b) => ({ ...b, p: b.p.map((v, i) => (i % 3 === 0 ? -v : v)) })),
      s: Scene = { ...SCENE0, dist: 2500, hillX: 3300, hillH: 300 },
      a = elements(ch, s),
      b = elements(flip, { ...s, dist: -2500, hillX: -3300 });
    expect(b.n).toBe(a.n);
    expect(Array.from(b.via)).toEqual(Array.from(a.via));
    for (let i = 0; i < a.n; i += 97) {
      expect(b.t[i]).toBeCloseTo(a.t[i], 9);
      expect(b.p[i]).toBeCloseTo(a.p[i], 9);
    }
    expect(Array.from(a.via).includes(Via.Hill)).toBe(true);
  });
  it('聞き手の後ろの山は、崖の高さより下で反射する部分だけこだまを返す', () => {
    const s: Scene = { ...FREE, dist: 2000, hillX: 3000, hillH: 300, hill: 0.7 },
      el = elements([line([0, 0, 0], [0, 0, 3000], 5e5, 60)], s),
      hz = Array.from(el.via).flatMap((v, i) => (v === Via.Hill ? [el.xyz[3 * i + 2]] : []));
    expect(hz.length).toBeGreaterThan(0);
    /* 崖を横切る高さ = z·(1000/(1000 + 3000))（ear ≈ 0）。300 m 以下になるのは z ≤ 約 1200 m */
    expect(Math.max(...hz)).toBeLessThan(1250);
    /* こだまは直接の音より 2·1000/c 以上遅れる */
    const tHill = Math.min(...Array.from(el.t).filter((_, i) => el.via[i] === Via.Hill));
    expect(tHill - firstArrival(el)).toBeGreaterThanOrEqual((2 * 1000) / C - 1e-6);
  });
  it('雷との間の山: 崖の向こうの低い所の音だけ弱まり、こだまは返らない', () => {
    const ch = [line([0, 0, 0], [0, 0, 3000], 5e5, 60)],
      s: Scene = { ...FREE, dist: 3000, hillX: 1500, hillH: 300, hill: 0.7 },
      a = elements(ch, { ...s, hillH: 0 }),
      b = elements(ch, s);
    expect(Array.from(b.via).includes(Via.Hill)).toBe(false);
    /* 聞き手への線が崖を横切る高さは z/2。z < 600 m は隠れ、それより上は変わらない */
    for (let i = 0; i < a.n; i++) {
      if (a.via[i] !== Via.Direct) continue;
      const z = a.xyz[3 * i + 2];
      if (z < 550) expect(b.p[i] / a.p[i]).toBeLessThan(10 ** (-4.7 / 20));
      if (z > 650) expect(b.p[i]).toBeCloseTo(a.p[i], 12);
    }
  });
  it('崖の回折の弱まりは 10 log₁₀(3 + 20N)、N = 2δ/λ（上限 24 dB）', () => {
    const T = 0.01,
      f = nPeak(T),
      /* 点 (−100, 0, 0) から聞き手 (100, 0, 0) へ、x = 0 の高さ 10 m の崖を越える。δ = 2√(100² + 10²) − 200 */
      d = 2 * Math.hypot(100, 10) - 200,
      N = (2 * d * f) / C;
    expect(barrierDb(-100, 0, 0, 100, 0, 0, 10, T, C)).toBeCloseTo(10 * Math.log10(3 + 20 * N), 9);
    expect(barrierDb(-100, 0, 0, 100, 0, 0, 1000, T, C)).toBe(24);
    /* 同じ側・崖より上を通るときは弱めない */
    expect(barrierDb(50, 0, 0, 100, 0, 0, 10, T, C)).toBe(0);
    expect(barrierDb(-100, 0, 30, 100, 0, 30, 10, T, C)).toBe(0);
  });
  it('頭上の雲の中の放電路: その下の聞き手には、落雷点より先に頭上から届く', () => {
    let n = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const ch = { ...CH0, seed, strokes: 1 },
        right = shape(ch).legs.filter((l) => Math.cos((l.az * Math.PI) / 180) > 0);
      if (!right.length || right[0].len < 4500) continue;
      const el = elements(makeChannel(ch), { ...SCENE0, dist: 4000 });
      /* 落雷点からなら 4000/c ≈ 11.7 s。頭上の雲の底（約 2 km）からなら 7 s 前後 */
      expect(firstArrival(el)).toBeLessThan(4000 / C - 2);
      n++;
    }
    expect(n).toBeGreaterThan(0);
  });
  it('雲の中の放電路は図の面（y = 0）の近くにある', () => {
    const ys: number[] = [];
    for (let seed = 1; seed <= 40; seed++)
      for (const b of makeChannel({ ...CH0, seed }))
        if (b.k === 0) for (let i = 0; i < b.p.length; i += 3) if (b.p[i + 2] > CH0.base) ys.push(Math.abs(b.p[i + 1]));
    ys.sort((x, y) => x - y);
    expect(ys[Math.floor(ys.length * 0.9)]).toBeLessThan(800);
  });
  it('影の領域: 届く距離 √(2Rz)、R = 2T/Γ。Fleagle の例（30 °C・9.8 K/km・5 km）で 25 km（l² = 4T₀h/Γ）', () => {
    const R = bendRadius(30, 9.8),
      x = audibleRange(5000, 0, R);
    expect(x ** 2).toBeCloseTo((4 * 303.15 * 5000) / 9.8e-3, 0);
    expect(x / 1000).toBeGreaterThan(24.5);
    expect(x / 1000).toBeLessThan(25.5);
  });
  it('分布の和は要素の分け方に依らない（山の高さは要素の長さに比例する）', () => {
    const ch = [line([0, 0, 0], [300, 0, 1500])],
      a = elements(ch, FREE),
      b = elements(ch, { ...FREE, stretch: { r1: 10, r2: 1000, k: 4 } }),
      sum = (el: typeof a) => arrivalHistogram(el, 0, 30, 0.1)[0].reduce((x, y) => x + y, 0);
    expect(b.n).toBeLessThan(a.n);
    /* 伸びの分 T₀/T だけ下がるので、伸びの比で割って比べる */
    const k = a.p[0] / a.dl[0] / (b.p[0] / b.dl[0]);
    expect(sum(a) / (sum(b) * k)).toBeCloseTo(1, 1);
  });
});

describe('波形', () => {
  it('区間の指向性: 横から聞くと鋭い山、端の向きから聞くとなまって低い（Wright・Medendorp 1968）', () => {
    const seg = [line([-50, 0, 1000], [50, 0, 1000], 5e5, 1)],
      side = render(elements(seg, { ...FREE, dist: 0, ear: 0 }), FREE.air, FS),
      end = render(elements([line([-50, 0, 0], [50, 0, 0], 5e5, 1)], { ...FREE, dist: 1000, ear: 0 }), FREE.air, FS);
    expect(side.peak / end.peak).toBeGreaterThan(5);
  });
  it('並んだ要素の分け方に音が依らない（点の列が出す 1/Δt の音がない）', () => {
    /* 届く時刻が Δt ずつずれる要素の列を、n 個と 4n 個（山は 1/4）で作って比べる */
    const T = 0.003,
      span = 0.04,
      make = (n: number): Elements => {
        const t = Float64Array.from({ length: n }, (_, i) => 1 + ((i + 0.5) / n) * span);
        return {
          n,
          t,
          r: new Float64Array(n).fill(300),
          p: new Float64Array(n).fill(40 / n),
          dl: new Float64Array(n).fill(1),
          xyz: new Float64Array(3 * n),
          via: new Uint8Array(n),
          br: new Uint16Array(n),
          nSeg: 1,
          segStart: Uint32Array.of(0),
          segEnd: Uint32Array.of(n),
          segT: Float64Array.of(T),
          segR: Float64Array.of(300),
          segVia: Uint8Array.of(0),
        };
      },
      /* 4 個ずつで Δt = 10 ms（100 Hz の列）。点のままだと 100 Hz とその倍音が立つ */
      a = render(make(4), FREE.air, FS),
      b = render(make(16), FREE.air, FS),
      /* 波形の先頭は最初の要素の時刻で決まるので、そろえて比べる */
      k = Math.round((a.t0 - b.t0) * FS);
    let e = 0,
      d = 0;
    for (let i = 0; i < b.y.length; i++) {
      const u = i - k < 0 || i - k >= a.y.length ? 0 : a.y[i - k];
      e += b.y[i] ** 2;
      d += (u - b.y[i]) ** 2;
    }
    expect(d / e).toBeLessThan(0.01);
  });
  it('遠いほど高い音が減る（空気の吸収）', () => {
    const ch = [line([0, 0, 0], [0, 0, 2000], 5e5, 40)],
      /* 300 Hz より上のエネルギーの割合 [dB] */
      high = (d: number) => {
        const w = render(elements(ch, { ...FREE, dist: d }), FREE.air, FS),
          s = spectrum(w.y, FS);
        let a = 0,
          b = 0;
        for (let k = 1; k < s.f.length; k++) {
          const p = 10 ** (s.db[k] / 10);
          if (s.f[k] > 300) a += p;
          b += p;
        }
        return 10 * Math.log10(a / b);
      };
    expect(high(8000)).toBeLessThan(high(500) - 10);
    /* 8 km で 1 kHz は 30 dB 以上減る */
    expect(absorption(1000) * 8000).toBeGreaterThan(30);
  });
  it('落雷（既定の放電路）を 2〜5 km で聞くと、スペクトルのピークは 20〜120 Hz（Holmes ほか 1971 の落雷の平均 50 Hz）', () => {
    const pk: number[] = [];
    for (let seed = 1; seed <= 4; seed++)
      for (const d of [2000, 5000]) {
        const s = { ...SCENE0, dist: d },
          w = render(elements(makeChannel({ ...CH0, seed }), s), s.air, FS),
          sp = spectrum(w.y, FS);
        let b = 1;
        for (let k = 1; k < sp.f.length; k++) if (sp.db[k] > sp.db[b]) b = k;
        pk.push(sp.f[b]);
      }
    const mean = pk.reduce((x, y) => x + y, 0) / pk.length;
    expect(mean).toBeGreaterThan(20);
    expect(mean).toBeLessThan(120);
    /* 8 本の波形を作るので、ほかのテストと並ぶと 5 秒を超えることがある */
  }, 30000);
  it('波形は光ってから最初に届く時刻の少し前から始まる', () => {
    const el = elements(makeChannel(CH0), SCENE0),
      w = render(el, SCENE0.air, FS);
    expect(w.t0).toBeLessThan(firstArrival(el));
    expect(firstArrival(el) - w.t0).toBeLessThan(0.1);
    expect(w.peak).toBeGreaterThan(0);
  });
});

describe('地形の反響', () => {
  it('帯の中の |H|² は wet²·k、低い帯ほど長く続く', () => {
    const fs = 3000,
      h = terrainIR('hills', fs, 1) as Float64Array,
      N = 2 ** Math.ceil(Math.log2(h.length)),
      re = new Float64Array(N),
      im = new Float64Array(N);
    re.set(h);
    fft(re, im);
    const mean = (f0: number, f1: number) => {
      let s = 0,
        c = 0;
      for (let k = Math.ceil((f0 / fs) * N); k <= (f1 / fs) * N; k++, c++) s += re[k] ** 2 + im[k] ** 2;
      return s / c;
    };
    /* 帯の真ん中あたりで比べる（端はフィルタの肩で下がる） */
    expect(mean(15, 40) / (1.2 ** 2 * 1)).toBeGreaterThan(0.6);
    expect(mean(15, 40) / (1.2 ** 2 * 1)).toBeLessThan(1.5);
    expect(mean(230, 330) / (1.2 ** 2 * 0.3)).toBeGreaterThan(0.6);
    expect(mean(230, 330) / (1.2 ** 2 * 0.3)).toBeLessThan(1.5);
    expect(mean(600, 1400)).toBeLessThan(mean(15, 40) * 1e-3);
    expect(terrainIR('0', fs, 1)).toBeNull();
  });
  it('反響の尾は低い音ほど長く、元の音より長い', () => {
    const fs = 48000,
      y = new Float32Array(fs);
    y[100] = 1;
    const tail = terrainTail(y, fs, 'valley');
    expect(tail).not.toBeNull();
    const [L, R] = tail as [Float64Array, Float64Array];
    expect(L.length).toBeGreaterThan(y.length + 7 * fs);
    expect(Array.from(L.subarray(fs, fs + 100))).not.toEqual(Array.from(R.subarray(fs, fs + 100)));
  });
});
