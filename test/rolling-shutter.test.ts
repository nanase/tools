import { describe, expect, it } from 'vitest';
import {
  fastest,
  flicker,
  G,
  GOLF_V0,
  golfAngles,
  golfPoints,
  type Inputs,
  MOTO,
  MOTO_W,
  metrics,
  motoPose,
  SUBJECTS,
  T_RANGE,
} from '../src/tools/rolling-shutter/motion';
import { CAMS, PARAMS, SUBJECT_ROWS, shutter, sig3 } from '../src/tools/rolling-shutter/params';
import { SUBJECT_ID } from '../src/tools/rolling-shutter/shader';

const base: Inputs = { tr: 19.4e-3, te: 1 / 2000, t: 0, rps: 40, nb: 2, kmh: 120, bike: 18, vs: 40, rotor: 6.5 };

describe('ローリングシャッターの題材', () => {
  it('題材・シェーダの番号・入力の行がそろう', () => {
    const keys = SUBJECTS.map(([k]) => k);
    expect(Object.keys(SUBJECT_ID).sort()).toEqual([...keys].sort());
    expect(Object.keys(SUBJECT_ROWS).sort()).toEqual([...keys].sort());
    const pk = new Set(PARAMS.map((d) => d.k));
    for (const rows of Object.values(SUBJECT_ROWS))
      for (const r of rows) if (r !== 'nb' && r !== 'rev') expect(pk.has(r)).toBe(true);
  });

  it('入力の既定値が範囲に入り、時刻の既定値は題材の時刻の範囲に入る', () => {
    for (const d of PARAMS) {
      expect(d.v).toBeGreaterThanOrEqual(d.min);
      expect(d.v).toBeLessThanOrEqual(d.max);
    }
    const tg = PARAMS.find((d) => d.k === 'tg');
    const [a, b] = T_RANGE.golf ?? [0, 0];
    expect(tg?.min).toBe(a);
    expect(tg?.max).toBe(b);
  });

  it('機種の走査時間は小さい順で、グローバルは 0', () => {
    expect(CAMS[0][2]).toBe(0);
    for (let i = 1; i < CAMS.length; i++) expect(CAMS[i][2]).toBeGreaterThan(CAMS[i - 1][2]);
  });
});

describe('ゆがみの量', () => {
  it('プロペラ: 1 走査の回転は ω·Tr', () => {
    const m = metrics('prop', base);
    expect(m[0][1]).toBeCloseTo(40 * 19.4e-3, 10);
    expect(m[1][1]).toBeCloseTo(2 * 40 * 19.4e-3, 10);
  });

  it('電車: ずれは v·Tr、傾きは arctan(v·Tr / H)', () => {
    const m = metrics('train', base);
    const d = (120 / 3.6) * 19.4e-3;
    expect(m[0][1]).toBeCloseTo(d, 10);
    expect(m[1][1]).toBeCloseTo((Math.atan(d / 10.6875) * 180) / Math.PI, 8);
  });

  it('左→右の走査: 右へ動くものは傾かずに伸び、追い越すと値なし', () => {
    const d = (120 / 3.6) * 19.4e-3;
    expect(metrics('train', { ...base, dir: 1 })[1][1]).toBeCloseTo(1 / (1 - d / 19), 10);
    expect(metrics('car', { ...base, kmh: 200, tr: 0.299, dir: 1 })[1][1]).toBeNull();
  });

  it('グローバルシャッターではゆがまない', () => {
    for (const [s] of SUBJECTS) expect(metrics(s, { ...base, tr: 0 })[0][1]).toBeCloseTo(0, 12);
  });

  it('ゴルフ: インパクトのヘッドスピードは入力の値になる', () => {
    for (const vs of [30, 40, 50]) expect(metrics('golf', { ...base, vs })[2][1]).toBeCloseTo(vs, 3);
    expect(GOLF_V0).toBeGreaterThan(30);
    expect(GOLF_V0).toBeLessThan(50);
  });

  it('ゴルフ: トップでクラブは腕より遅れ、インパクトでヘッドは地面の近く', () => {
    const [pa, pc] = golfAngles(-0.3);
    expect(pc).toBeLessThan(pa - 1.2);
    const { head } = golfPoints(0);
    expect(head[1]).toBeGreaterThan(0);
    expect(head[1]).toBeLessThan(0.12);
  });

  it('モトクロス: 着地で 1 回転し、頂上の時刻は vy / g', () => {
    expect(motoPose(MOTO.flight).a - motoPose(0).a).toBeCloseTo(MOTO.pitch1 - MOTO.pitch0, 10);
    expect(MOTO_W).toBeGreaterThan(0);
    const top = MOTO.vy / G;
    expect(motoPose(top).y).toBeGreaterThan(motoPose(top - 0.05).y);
    expect(motoPose(top).y).toBeGreaterThan(motoPose(top + 0.05).y);
  });

  it('速さと明暗の変わる回数は正', () => {
    for (const [s] of SUBJECTS) {
      const [v, h] = fastest(s, base);
      expect(v).toBeGreaterThan(0);
      expect(h).toBeGreaterThan(0);
      expect(flicker(s, base)).toBeGreaterThanOrEqual(0);
    }
    expect(flicker('prop', base)).toBe(80);
  });
});

describe('表記', () => {
  it('シャッター速度は 1/n', () => {
    expect(shutter(1 / 2000)).toBe('1/2000');
    expect(shutter(1 / 125)).toBe('1/125');
  });
  it('計算結果は有効数字 3 桁で末尾の 0 を残す', () => {
    expect(sig3(0.5)).toBe('0.500');
    expect(sig3(1690.4)).toBe('1690');
    expect(sig3(0)).toBe('0');
  });
});
