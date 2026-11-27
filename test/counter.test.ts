import { describe, expect, it } from 'vitest';
import { aWeight, toneGain } from '../src/tools/counter/audio';
import { audible, figSvg } from '../src/tools/counter/fig';
import { HOW } from '../src/tools/counter/how';
import {
  beforeMidnight,
  DAY,
  digits,
  edges,
  F32,
  fmtSpeed,
  inSecond,
  qv,
  STAGES,
  stF,
  winSec,
  winTop,
  wrapDay,
} from '../src/tools/counter/model';

describe('分周', () => {
  it('15 段で 32768 Hz が 1 Hz になる', () => {
    expect(stF(0)).toBe(32768);
    expect(stF(STAGES)).toBe(1);
    for (let k = 1; k <= STAGES; k++) expect(stF(k)).toBe(stF(k - 1) / 2);
  });

  it('段の出力は 1 秒に周波数の回数だけ 1 になる', () => {
    for (let k = 1; k <= STAGES; k++) {
      let rises = 0;
      for (let t = 0; t < F32; t++) if (qv(k, t + 0.5) === 1 && qv(k, t - 0.5) === 0) rises++;
      expect(rises, `k=${k}`).toBe(stF(k));
    }
  });

  it('段は前の段の立ち下がりで反転する（反転出力の立ち上がり）', () => {
    for (let k = 2; k <= 6; k++)
      for (let t = 1; t < 512; t++) {
        const flips = qv(k, t) !== qv(k, t - 1),
          prevFall = qv(k - 1, t - 1) === 1 && qv(k - 1, t) === 0;
        expect(flips, `k=${k} t=${t}`).toBe(prevFall);
      }
  });

  it('段の出力を並べると水晶の振動の回数の 2 進', () => {
    for (const n of [0, 1, 5, 1000, 32767, 123456]) {
      let v = 0;
      for (let k = 1; k <= STAGES; k++) v += qv(k, n + 0.25) * 2 ** (k - 1);
      expect(v).toBe(n % 2 ** STAGES);
    }
  });

  it('負の時刻でも出力は 0 か 1', () => {
    for (let k = 0; k <= STAGES; k++) for (const t of [-0.3, -1, -5.5, -1000]) expect([0, 1]).toContain(qv(k, t));
  });

  it('変わり目の数', () => {
    expect(edges(1, 0, 4)).toBe(4);
    expect(edges(STAGES, 0, F32)).toBe(2);
    expect(edges(3, 10, 10)).toBe(0);
  });
});

describe('時刻', () => {
  it('6 桁と 24 時の折り返し', () => {
    expect(digits(0)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(digits((23 * 3600 + 59 * 60 + 59) * F32)).toEqual([2, 3, 5, 9, 5, 9]);
    expect(digits(wrapDay(DAY + 61 * F32))).toEqual([0, 0, 0, 1, 0, 1]);
  });

  it('23:59:59 の直前は今の速さで 3 秒前', () => {
    for (const sp of [2 ** -15, 1, 4096]) {
      const t = beforeMidnight(sp);
      expect(t).toBeLessThan(DAY);
      expect((DAY - t) / (F32 * sp)).toBeCloseTo(3, 5);
    }
    expect(digits(beforeMidnight(1)).join('')).toBe('235957');
  });

  it('この 1 秒の中は 1〜32768 回目', () => {
    expect(inSecond(0)).toBe(1);
    expect(inSecond(F32 - 0.5)).toBe(F32);
    expect(inSecond(F32)).toBe(1);
  });
});

describe('速さと 6 段', () => {
  it('点滅が 1 秒に 16 回以下の最も速い段から 6 段（先頭は 10 段目まで）', () => {
    expect(winTop(1)).toBe(10);
    expect(winTop(2 ** -10)).toBe(1);
    expect(winTop(2 ** -11)).toBe(0);
    expect(winTop(2 ** -15)).toBe(0);
    expect(winTop(4096)).toBe(10);
    for (let e = -15; e <= 0; e++) {
      const k = winTop(2 ** e);
      if (k > 0 && k < 10) {
        expect(stF(k) * 2 ** e).toBeLessThanOrEqual(16);
        expect(stF(k - 1) * 2 ** e).toBeGreaterThan(16);
      }
    }
  });

  it('見せる長さは先頭の段の 1 周期が 5 px 以上になる長さ', () => {
    expect(winSec(1, 10, 800)).toBe(4);
    expect(winSec(1, 10, 150)).toBe(0.5);
    expect(winSec(2 ** -10, 1, 300)).toBe(2);
  });

  it('速さの表記', () => {
    expect(fmtSpeed(1)).toBe('×1');
    expect(fmtSpeed(4096)).toBe('×4096');
    expect(fmtSpeed(2 ** -15)).toBe('1/32768');
  });
});

describe('図', () => {
  it('どの幅と速さでも数値が壊れない', () => {
    for (const W of [300, 360, 520, 800, 1240])
      for (let e = -15; e <= 12; e += 3) {
        const { svg } = figSvg(W, 2 ** e, new Set([1, 15]));
        expect(svg, `W=${W} e=${e}`).not.toMatch(/NaN|Infinity|undefined/);
      }
  });

  it('6 段の行とスピーカーがある', () => {
    const { svg, geo } = figSvg(1000, 1, new Set());
    expect(geo.rows.map((r) => r.k)).toEqual([10, 11, 12, 13, 14, 15]);
    expect(svg.match(/data-snd=/g)?.length).toBe(6);
    expect(svg).toContain('10 段〜15 段の波形');
    expect(svg.match(/class="mk"/g)?.length).toBe(6);
    /* ランプの列の 16 個はどれも押せる */
    expect(svg.match(/data-st=/g)?.length).toBe(16);
    expect(svg).toContain('この 1 秒の振動回数');
  });

  it('16.5 kHz を超える段は鳴らせない', () => {
    expect(audible(1, 1)).toBe(true);
    expect(audible(0, 1)).toBe(false);
    expect(audible(1, 2)).toBe(false);
    const { svg } = figSvg(1000, 2 ** -15, new Set());
    expect(svg).not.toContain('aria-disabled');
  });
});

describe('音', () => {
  it('A 特性は 1 kHz で 0 dB、100 Hz で約 −19 dB', () => {
    expect(20 * Math.log10(aWeight(1000))).toBeCloseTo(0, 1);
    expect(20 * Math.log10(aWeight(100))).toBeCloseTo(-19.1, 0);
  });

  it('耳の敏感な段ほど小さく、低い段は上限で止める', () => {
    expect(toneGain(3000)).toBeLessThan(toneGain(1000));
    expect(toneGain(1000)).toBeLessThan(toneGain(128));
    expect(toneGain(32)).toBe(0.09);
    expect(toneGain(16384)).toBe(toneGain(12000));
  });
});

describe('しくみ', () => {
  it('5 つの工程に見出し・図・一言がある', () => {
    expect(HOW).toHaveLength(5);
    for (const [h, fig, p] of HOW) {
      expect(h.length).toBeGreaterThan(0);
      expect(fig).toContain('<svg');
      expect(p.length).toBeGreaterThan(0);
      expect(fig).not.toMatch(/NaN|undefined/);
    }
  });
});
