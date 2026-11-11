import { describe, expect, it } from 'vitest';
import { activeRatio, integrated, kWeight } from '../scripts/loudness-meter';

/** 1 kHz 付近の正弦波を K 特性に通し、100 ms ごとの二乗平均（左右の和）にする */
function sineBlocks(amp: number, sec: number, fs = 48000): number[] {
  const f = kWeight(fs),
    s = [
      [0, 0],
      [0, 0],
    ],
    sub = fs / 10,
    out: number[] = [];
  let acc = 0;
  for (let i = 0; i < sec * fs; i++) {
    let v = amp * Math.sin((2 * Math.PI * 997 * i) / fs);
    for (let j = 0; j < 2; j++) {
      const c = f[j],
        y = c.b0 * v + s[j][0];
      s[j][0] = c.b1 * v - c.a1 * y + s[j][1];
      s[j][1] = c.b2 * v - c.a2 * y;
      v = y;
    }
    acc += 2 * v * v;
    if ((i + 1) % sub === 0) {
      out.push(acc / sub);
      acc = 0;
    }
  }
  return out;
}

describe('聞こえの大きさの計算', () => {
  it('48 kHz の K 特性は BS.1770 の表の係数', () => {
    const [shelf, high] = kWeight(48000);
    expect(shelf.b0).toBeCloseTo(1.53512485958697, 12);
    expect(shelf.b1).toBeCloseTo(-2.69169618940638, 12);
    expect(shelf.b2).toBeCloseTo(1.19839281085285, 12);
    expect(shelf.a1).toBeCloseTo(-1.69065929318241, 12);
    expect(shelf.a2).toBeCloseTo(0.73248077421585, 12);
    expect(high).toMatchObject({ b0: 1, b1: -2, b2: 1 });
    expect(high.a1).toBeCloseTo(-1.99004745483398, 12);
    expect(high.a2).toBeCloseTo(0.99007225036621, 12);
  });
  it('左右に振幅 0.5 の 1 kHz は −6.0 LUFS（44.1 kHz でも同じ）', () => {
    expect(integrated(sineBlocks(0.5, 3).slice(5))).toBeCloseTo(-6.02, 1);
    expect(integrated(sineBlocks(0.5, 3, 44100).slice(5))).toBeCloseTo(-6.02, 1);
  });
  it('音のない区間は数えない', () => {
    const on = sineBlocks(0.1, 3).slice(5),
      gap = [...on, ...new Array(40).fill(0), ...on];
    /* 音の境目の 400 ms は一部だけ音があるので、わずかに下がる */
    expect(integrated(gap)).toBeCloseTo(integrated(on), 0);
    expect(activeRatio(gap)).toBeGreaterThan(0.4);
    expect(activeRatio(gap)).toBeLessThan(0.6);
    expect(integrated(new Array(30).fill(0))).toBe(-Infinity);
  });
});
