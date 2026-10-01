import { describe, expect, it } from 'vitest';
import { genTest, type TestParams } from '../src/tools/audio/signal';
import { corr, dbfs, findTrig, freqOf, phaseDiff, stats } from '../src/tools/oscilloscope/measure';

const FS = 48000;
/** テスト信号を n 点作る */
function sig(p: Partial<TestParams>, n = 32768): [Float32Array, Float32Array] {
  const L = new Float32Array(n),
    R = new Float32Array(n);
  genTest({ wave: 'sine', f: 1000, ra: [1, 1], ph: 0, ...p }, FS, 0, n, L, R);
  return [L, R];
}
const sine = (f: number, n: number, ph = 0, amp = 1) =>
  Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / FS + ph));

describe('トリガ', () => {
  it('立ち上がりでレベルを横切る最も新しい点を、小数で補間して返す', () => {
    const a = sine(1000, 4800);
    const c = findTrig(a, 0, 'up', 0, 0, a.length - 1);
    /* 1 kHz は 48 点で 1 周期。0 を上向きに横切るのは 48 の倍数 */
    expect(c % 48).toBeCloseTo(0, 3);
    expect(c).toBeGreaterThan(4800 - 49);
  });
  it('立ち下がりは半周期ずれる', () => {
    const a = sine(1000, 4800);
    const c = findTrig(a, 0, 'down', 0, 0, 2000);
    expect(c % 48).toBeCloseTo(24, 3);
  });
  it('両方向: どちら向きでも横切れば、最も新しい点を返す（レベル 0 ならゼロ点交差）', () => {
    const a = sine(1000, 4800);
    /* 0 を横切るのは 24 点ごと。2000 以下で最も新しいのは 1992（下向き）、1990 以下なら 1968（上向き） */
    expect(findTrig(a, 0, 'both', 0, 0, 2000)).toBeCloseTo(1992, 3);
    expect(findTrig(a, 0, 'both', 0, 0, 1990)).toBeCloseTo(1968, 3);
    const c = findTrig(a, 0.5, 'both', 0, 0, 4799),
      i = Math.floor(c);
    expect(a[i] + (a[i + 1] - a[i]) * (c - i)).toBeCloseTo(0.5, 6);
  });
  it('範囲（lo〜hi）の外は使わない。レベルに届かなければ −1', () => {
    const a = sine(1000, 4800, 0, 0.5);
    expect(findTrig(a, 0, 'up', 0, 100, 140)).toBeLessThan(0);
    expect(findTrig(a, 0.6, 'up', 0, 0, 4799)).toBe(-1);
    const c = findTrig(a, 0.25, 'up', 0, 0, 4799),
      i = Math.floor(c);
    expect(a[i] + (a[i + 1] - a[i]) * (c - i)).toBeCloseTo(0.25, 6);
  });
  it('ノイズ除去: レベルからその幅だけ離れるまで次を受け付けない', () => {
    /* −0.5 から上がった後、0 の付近で小さく揺れるだけの波形。幅 0.05 では最初の 1 回だけトリガする */
    const a = Float32Array.from({ length: 200 }, (_, i) => (i < 10 ? -0.5 : 0.01 * Math.sin(i)));
    expect(findTrig(a, 0, 'up', 0, 0, 199)).toBeGreaterThan(150);
    const c = findTrig(a, 0, 'up', 0.05, 0, 199);
    expect(c).toBeGreaterThan(9);
    expect(c).toBeLessThan(20);
  });
});

describe('測定', () => {
  it('周波数を横切る点の間隔から求める', () => {
    for (const f of [50, 440, 1000, 5000]) {
      const [L] = sig({ f });
      expect(freqOf(L, FS)).toBeCloseTo(f, f < 100 ? 1 : 0);
    }
  });
  it('無音・直流は周波数なし', () => {
    expect(freqOf(new Float32Array(1000), FS)).toBeNaN();
    expect(freqOf(new Float32Array(1000).fill(0.3), FS)).toBeNaN();
  });
  it('正弦波の実効値（√2 倍）とピークは同じ dBFS', () => {
    const [L] = sig({ f: 1000 });
    const s = stats(L);
    expect(dbfs(Math.SQRT2 * s.rms)).toBeCloseTo(dbfs(0.7), 1);
    expect(dbfs(s.pk)).toBeCloseTo(dbfs(0.7), 1);
    expect(dbfs(1)).toBeCloseTo(0, 9);
  });
  it('位相差 CH2 − CH1 を度で返す（−180 より大きく 180 以下）', () => {
    for (const ph of [0, 45, 90, 135]) {
      const [L, R] = sig({ f: 1000, ph });
      expect(phaseDiff(L, R, 1000, FS)).toBeCloseTo(ph, 0);
    }
    const [L1, R1] = sig({ f: 1000, ph: 180 });
    expect(Math.abs(phaseDiff(L1, R1, 1000, FS))).toBeCloseTo(180, 0);
    const L = sine(1000, 9600),
      R = sine(1000, 9600, (-60 * Math.PI) / 180);
    expect(phaseDiff(L, R, 1000, FS)).toBeCloseTo(-60, 0);
  });
  it('周波数が違えば位相差は出さない', () => {
    const [L, R] = sig({ f: 1000, ra: [2, 3] });
    expect(phaseDiff(L, R, 1000, FS)).toBeNaN();
  });
  it('相関係数: 同相 +1、逆相 −1、90° で 0', () => {
    const L = sine(1000, 4800);
    expect(corr(L, L, 4800)).toBeCloseTo(1, 6);
    expect(
      corr(
        L,
        L.map((x) => -x),
        4800,
      ),
    ).toBeCloseTo(-1, 6);
    expect(corr(L, sine(1000, 4800, Math.PI / 2), 4800)).toBeCloseTo(0, 3);
    expect(corr(L, new Float32Array(4800), 4800)).toBeNaN();
  });
});
