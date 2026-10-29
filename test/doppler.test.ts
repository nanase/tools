import { describe, expect, it } from 'vitest';
import { ampFactor, emissions, machAngle, passAt, passLimits, ratioHeadOn, vec } from '../src/tools/doppler/kin';
import { PROP0, Propagator, type PropSet, TICK } from '../src/tools/doppler/prop';
import { Engine, engineRpm, HORN, Horn, paOf, SIREN, Siren, Tone } from '../src/tools/doppler/sources';

const C = 343.2,
  FS = 48000,
  O = vec(0, 0, 0);

describe('放射時刻とドップラー効果', () => {
  it('止まっていれば遅れは r/c、周波数は変わらない', () => {
    const [e] = emissions(vec(0, 0), O, vec(30, 40), O, C);
    expect(e.delay).toBeCloseTo(50 / C, 12);
    expect(e.ratio).toBe(1);
  });
  it('真っすぐ近づく音源は f₀/(1 − M)、遠ざかると f₀/(1 + M)', () => {
    const v = 30,
      M = v / C,
      [a] = emissions(vec(0, 0), vec(v, 0), vec(100, 0), O, C),
      [b] = emissions(vec(0, 0), vec(v, 0), vec(-100, 0), O, C);
    expect(a.ratio).toBeCloseTo(ratioHeadOn(M).toward, 12);
    expect(b.ratio).toBeCloseTo(ratioHeadOn(M).away, 12);
  });
  it('近づく聞き手は f₀(1 + u/c)（音源は止まっている）', () => {
    const u = 20,
      [e] = emissions(vec(0, 0), O, vec(100, 0), vec(-u, 0), C);
    expect(e.ratio).toBeCloseTo(1 + u / C, 12);
  });
  it('すれ違い: 最も近い所で出た音は周波数が変わらず、d/c 後に届く。両端は 1/(1 ∓ M) に近づく', () => {
    const p = { v: 25, d: 15, c: C },
      [e] = passAt(p, p.d / C);
    expect(e.ratio).toBeCloseTo(1, 9);
    expect(e.r).toBeCloseTo(p.d, 9);
    const lim = passLimits(p);
    expect(passAt(p, -1e4)[0].ratio).toBeCloseTo(lim.before, 4);
    expect(passAt(p, 1e4)[0].ratio).toBeCloseTo(lim.after, 4);
    /* 時間とともに下がり続ける */
    let prev = Number.POSITIVE_INFINITY;
    for (let t = -5; t <= 5; t += 0.05) {
      const r = passAt(p, t)[0].ratio;
      expect(r).toBeLessThan(prev);
      prev = r;
    }
  });
  it('音速より速い音源: マッハ円錐が届くまでは聞こえず、届いた後は 2 つの音が同時に聞こえる', () => {
    const M = 2,
      p = { v: M * C, d: 100, c: C },
      tc = (p.d * Math.sqrt(M * M - 1)) / p.v;
    expect(passAt(p, tc - 0.01)).toHaveLength(0);
    const two = passAt(p, tc + 0.01);
    expect(two).toHaveLength(2);
    /* 円錐の上では 2 つの放射時刻が重なり、1 − M_r = 0 */
    const at = passAt(p, tc + 1e-7);
    expect(at[1].delay - at[0].delay).toBeLessThan(1e-3);
    expect(1 - at[0].mr).toBeCloseTo(0, 2);
    /* 先に出た音（遅れが大きい）は近づくときの音で、時間が逆に進む */
    expect(two[1].ratio).toBeLessThan(0);
    expect(two[0].ratio).toBeGreaterThan(0);
    expect(machAngle(M)).toBeCloseTo(Math.PI / 6, 12);
    expect(machAngle(0.9)).toBeNaN();
  });
  it('振幅の倍率: 近づく向きで大きく、遠ざかる向きで小さく、円錐の上では抑える', () => {
    expect(ampFactor(10, 0.1)).toBeCloseTo(1 / (10 * 0.81), 12);
    expect(ampFactor(10, -0.1)).toBeCloseTo(1 / (10 * 1.21), 12);
    expect(ampFactor(10, 1)).toBeCloseTo(1 / (10 * 0.01), 9);
    expect(ampFactor(0.1, 0)).toBe(1);
  });
});

/** 音源の位置と聞き手の位置を時刻 [s] の関数で与えて、聞き手の音を作る */
function render(
  src: { step(): number },
  sPos: (t: number) => [number, number],
  lPos: (t: number) => [number, number],
  seconds: number,
  set: Partial<PropSet> = {},
): { y: Float32Array; p: Propagator } {
  const p = new Propagator(FS, 4, { ...PROP0, absorb: false, ground: 0, ...set }),
    n = Math.floor((seconds * FS) / TICK),
    y = new Float32Array(n * TICK),
    s = new Float32Array(TICK),
    o = new Float32Array(TICK);
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < TICK; j++) s[j] = src.step();
    const t = (k * TICK) / FS,
      [sx, sy] = sPos(t),
      [lx, ly] = lPos(t);
    p.advance(s, sx, sy, false, lx, ly, o);
    y.set(o, k * TICK);
  }
  return { y, p };
}

const rms = (y: Float32Array, a: number, b: number) => {
  let e = 0;
  for (let i = a; i < b; i++) e += y[i] * y[i];
  return Math.sqrt(e / (b - a));
};
/** 区間の中の上向きのゼロ交差から周波数 [Hz] を測る */
function freq(y: Float32Array, a: number, b: number): number {
  let first = -1,
    last = -1,
    n = 0;
  for (let i = a + 1; i < b; i++)
    if (y[i - 1] < 0 && y[i] >= 0) {
      const t = i - 1 + y[i - 1] / (y[i - 1] - y[i]);
      if (first < 0) first = t;
      else n++;
      last = t;
    }
  return (n * FS) / (last - first);
}

describe('伝える計算（可変の遅延線）', () => {
  it('止まった音源: 振幅は r0/r、遅れは r/c', () => {
    const tone = new Tone(FS, 500),
      r = 40,
      { y } = render(
        tone,
        () => [0, 0],
        () => [0, r],
        1,
        { hs: 0, hl: 0, r0: 10 },
      );
    const lag = Math.round((r / C) * FS);
    expect(rms(y, 0, lag - 100)).toBe(0);
    expect(rms(y, FS / 2, FS)).toBeCloseTo((paOf(90) * 10) / r, 3);
    expect(freq(y, FS / 2, FS)).toBeCloseTo(500, 1);
  });
  it('真っすぐ近づく音源の音は f₀/(1 − M) になる', () => {
    const v = 40,
      tone = new Tone(FS, 400),
      { y } = render(
        tone,
        (t) => [v * t, 0],
        () => [300, 0],
        2,
        { hs: 0, hl: 0 },
      );
    expect(freq(y, FS, 2 * FS)).toBeCloseTo(400 / (1 - v / C), 0);
  });
  it('真っすぐ近づく聞き手は f₀(1 + u/c) を聞く', () => {
    const u = 30,
      tone = new Tone(FS, 400),
      { y } = render(
        tone,
        () => [0, 0],
        (t) => [200 - u * t, 0],
        2,
        { hs: 0, hl: 0 },
      );
    expect(freq(y, FS, 2 * FS)).toBeCloseTo(400 * (1 + u / C), 0);
  });
  it('すれ違いの周波数が式（passAt）の曲線に沿う', () => {
    const v = 30,
      d = 10,
      t0 = 3,
      tone = new Tone(FS, 600),
      { y } = render(
        tone,
        (t) => [v * (t - t0), 0],
        () => [0, d],
        6,
        { hs: 0, hl: 0 },
      ),
      p = { v, d, c: C };
    for (const t of [1.5, 2.5, 3.0, 3.5, 4.5]) {
      const a = Math.round((t - 0.02) * FS),
        b = Math.round((t + 0.02) * FS),
        want = 600 * passAt(p, t - t0)[0].ratio;
      expect(Math.abs(freq(y, a, b) - want), `t = ${t}`).toBeLessThan(1.5);
    }
  });
  it('硬い地面の反射: 直接音と鏡像からの音が干渉する', () => {
    const f = 500,
      hs = 1,
      hl = 1.5,
      x = 20,
      r1 = Math.hypot(x, hl - hs),
      r2 = Math.hypot(x, hl + hs),
      k = (2 * Math.PI * f) / C,
      want = paOf(90) * Math.hypot(1 / r1 + Math.cos(k * (r2 - r1)) / r2, Math.sin(k * (r2 - r1)) / r2),
      { y } = render(
        new Tone(FS, f),
        () => [0, 0],
        () => [x, 0],
        1,
        { hs, hl, ground: 1 },
      );
    expect(rms(y, FS / 2, FS)).toBeCloseTo(want, 3);
  });
  it('音速より速い音源: 円錐が届くと解が 2 つになる', () => {
    const M = 1.5,
      v = M * C,
      d = 60,
      t0 = 1,
      tc = t0 + (d * Math.sqrt(M * M - 1)) / v,
      tone = new Tone(FS, 300);
    const p = new Propagator(FS, 4, { ...PROP0, absorb: false, ground: 0, hs: 0, hl: 0 }),
      s = new Float32Array(TICK),
      o = new Float32Array(TICK);
    let before = -1,
      after = -1;
    for (let k = 0; k * TICK < 2.5 * FS; k++) {
      for (let j = 0; j < TICK; j++) s[j] = tone.step();
      const t = (k * TICK) / FS;
      p.advance(s, v * (t - t0), 0, false, 0, d, o);
      if (Math.abs(t - (tc - 0.05)) < TICK / FS / 2) before = p.count;
      if (Math.abs(t - (tc + 0.05)) < TICK / FS / 2) after = p.count;
      for (const x of o) expect(Number.isFinite(x)).toBe(true);
    }
    expect(before).toBe(0);
    expect(after).toBe(2);
  });
  it('瞬間移動（道の端で戻る）をまたいだ解は探さない', () => {
    const p = new Propagator(FS, 2, { ...PROP0, absorb: false, ground: 0, hs: 0, hl: 0 }),
      s = new Float32Array(TICK),
      o = new Float32Array(TICK);
    /* 遠くで止まっていた音源が、聞き手のすぐそばへ飛ぶ。飛んだ直後は、飛ぶ前の遠くの音だけが届いている途中 */
    for (let k = 0; k < 100; k++) p.advance(s, 1000, 0, false, 0, 0, o);
    p.advance(s, 1, 0, true, 0, 0, o);
    expect(p.count).toBe(0);
  });
});

describe('音源', () => {
  it('サイレンはピー 960 Hz・ポー 770 Hz を 0.65 s ずつ、実効値は 20 m で 105 dB', () => {
    const s = new Siren(FS),
      y = new Float32Array(2 * FS);
    for (let i = 0; i < y.length; i++) y[i] = s.step();
    expect(freq(y, 0.05 * FS, 0.6 * FS)).toBeCloseTo(SIREN.hi, 0);
    expect(freq(y, 0.7 * FS, 1.25 * FS)).toBeCloseTo(SIREN.lo, 0);
    expect(rms(y, 0, 1.3 * FS)).toBeCloseTo(paOf(105), 2);
  });
  it('警笛は 370 Hz と 660 Hz の 2 音', () => {
    const h = new Horn(FS);
    expect(h.f0()).toBe(HORN.hi);
    const y = new Float32Array(FS);
    for (let i = 0; i < y.length; i++) y[i] = h.step();
    expect(rms(y, 0, FS)).toBeCloseTo(paOf(110), 1);
  });
  it('エンジンの回転数: 60 km/h は 4 速で約 4800 rpm、止まればアイドリング', () => {
    const a = engineRpm(60 / 3.6);
    expect(a.gear).toBe(4);
    expect(a.rpm).toBeCloseTo(4802, -1);
    expect(engineRpm(0).rpm).toBe(1400);
    expect(engineRpm(20 / 3.6).gear).toBe(1);
    expect(engineRpm(30 / 3.6).gear).toBe(2);
  });
  it('エンジンの音は回転数を追い、点火の周波数は rpm/120', () => {
    const e = new Engine(FS);
    e.speed(60 / 3.6);
    for (let i = 0; i < FS; i++) e.step();
    expect(e.f0()).toBeCloseTo(4802 / 120, -1);
  });
});
