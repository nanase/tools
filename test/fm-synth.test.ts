import { describe, expect, it } from 'vitest';
import { algText } from '../src/tools/fm-synth/diagram';
import { I0, IDX, L0, LVL, noteHz, noteName, R0, RATIOS } from '../src/tools/fm-synth/params';
import {
  ALGS,
  FB,
  isCarrier,
  normGain,
  type Patch,
  PTS,
  Voice,
  WAVES,
  waveAt,
  waveIndex,
  waveOf,
} from '../src/tools/fm-synth/synth';

const TAU = 2 * Math.PI;
const P = (p: Partial<Patch>): Patch => ({
  alg: 7,
  fb: 0,
  w: [0, 0, 0, 0],
  r: [1, 1, 1, 1],
  a: [0, 0, 0, 0],
  norm: false,
  ...p,
});

describe('アルゴリズム', () => {
  it('8 通りで、変調は番号の小さいオペレータから大きいオペレータへ向かう', () => {
    expect(ALGS).toHaveLength(8);
    for (const { e, c } of ALGS) {
      for (const [j, k] of e) expect(j).toBeLessThan(k);
      /* キャリアは誰も変調せず、モジュレータはどれかを変調する */
      for (let k = 0; k < 4; k++) expect(c.includes(k)).toBe(!e.some(([j]) => j === k));
    }
  });
  it('OPN と同じキャリアの数（1・1・1・1・2・3・3・4）', () => {
    expect(ALGS.map((a) => a.c.length)).toEqual([1, 1, 1, 1, 2, 3, 3, 4]);
    expect(isCarrier(4, 1)).toBe(true);
    expect(isCarrier(4, 2)).toBe(false);
  });
  it('帰還量は FB 1 が π/16、FB 7 が 4π', () => {
    expect(FB[1]).toBeCloseTo(Math.PI / 16, 15);
    expect(FB[7]).toBeCloseTo(4 * Math.PI, 15);
  });
  it('結線の説明', () => {
    expect(algText(0)).toBe('アルゴリズム 0: OP1が OP2 を変調、OP2が OP3 を変調、OP3が OP4 を変調、OP4を出力');
    expect(algText(7)).toBe('アルゴリズム 7: OP1・OP2・OP3・OP4を出力');
  });
});

describe('音の計算', () => {
  it('変調がなければ、キャリアの正弦波の和', () => {
    const y = waveOf(P({ r: [1, 2, 3, 0.5], a: [1, 0.5, 0.25, 0.125] }), 2);
    expect(y).toHaveLength(2 * PTS);
    for (const n of [0, 37, 300, 777]) {
      const t = n / PTS;
      const want =
        Math.sin(TAU * t) +
        0.5 * Math.sin(TAU * 2 * t) +
        0.25 * Math.sin(TAU * 3 * t) +
        0.125 * Math.sin(TAU * 0.5 * t);
      expect(y[n]).toBeCloseTo(want, 12);
    }
  });
  it('2 オペレータの FM: sin(2π r₂ t + I sin 2π r₁ t)', () => {
    /* アルゴリズム 4: OP1 → OP2（OP3 → OP4 は振幅 0） */
    const y = waveOf(P({ alg: 4, r: [3, 1, 1, 1], a: [2.5, 0.8, 0, 0] }), 1);
    for (const n of [0, 11, 128, 400]) {
      const t = n / PTS;
      expect(y[n]).toBeCloseTo(0.8 * Math.sin(TAU * t + 2.5 * Math.sin(TAU * 3 * t)), 12);
    }
  });
  it('アルゴリズム 0 は 4 段の直列', () => {
    const r = [1, 2, 3, 4],
      a = [0.7, 1.1, 0.4, 0.9],
      y = waveOf(P({ alg: 0, r, a }), 1);
    const n = 201,
      t = n / PTS,
      s1 = Math.sin(TAU * t),
      s2 = Math.sin(TAU * 2 * t + 0.7 * s1),
      s3 = Math.sin(TAU * 3 * t + 1.1 * s2),
      s4 = Math.sin(TAU * 4 * t + 0.4 * s3);
    expect(y[n]).toBeCloseTo(0.9 * s4, 12);
  });
  it('帰還は OP1 の直近 2 標本の平均に β を掛けて足す', () => {
    const fb = 5,
      y = waveOf(P({ fb, a: [1, 0, 0, 0] }), 1);
    let h1 = 0,
      h2 = 0;
    for (let n = 0; n < 50; n++) {
      const x = Math.sin((TAU * n) / PTS + (FB[fb] * (h1 + h2)) / 2);
      h2 = h1;
      h1 = x;
      expect(y[n]).toBeCloseTo(x, 12);
    }
  });
  it('続けて計算しても位相がつながる', () => {
    const p = P({ alg: 5, r: [2, 1, 3, 0.5], a: [1.3, 1, 0.5, 0.5], fb: 3 }),
      whole = waveOf(p, 1),
      v = new Voice(),
      a = new Float64Array(100),
      b = new Float64Array(PTS - 100);
    v.set(p);
    v.render(a, a.length, 1 / PTS);
    v.render(b, b.length, 1 / PTS);
    expect([...a, ...b].map((x, i) => x - whole[i]).every((d) => Math.abs(d) < 1e-12)).toBe(true);
  });
  it('glide では出力の大きさが目標へ近づく', () => {
    const v = new Voice(),
      out = new Float64Array(4000);
    v.set(P({ a: [1, 0, 0, 0] }));
    v.set(P({ a: [0, 0, 0, 0] }));
    v.render(out, out.length, 1 / 64, 0.01);
    expect(Math.abs(out[16])).toBeGreaterThan(0.5);
    expect(Math.max(...out.slice(3000).map(Math.abs))).toBeLessThan(1e-6);
  });
});

describe('音量の調整', () => {
  const four = P({ alg: 7, a: [1, 1, 0.5, 0.5] });
  it('キャリアの振幅の合計が 1 を超えたら、合計で割る', () => {
    expect(normGain({ ...four, norm: true })).toBeCloseTo(1 / 3, 15);
    const y = waveOf(four, 1),
      z = waveOf({ ...four, norm: true }, 1);
    for (const n of [0, 50, 300]) expect(z[n]).toBeCloseTo(y[n] / 3, 12);
    expect(Math.max(...z.map(Math.abs))).toBeLessThanOrEqual(1);
  });
  it('合計が 1 以下か、調整しないなら変えない', () => {
    expect(normGain(P({ alg: 4, a: [3, 0.6, 2, 0.4], norm: true }))).toBe(1);
    expect(normGain(four)).toBe(1);
  });
  it('モジュレータの変調指数は合計に入れない', () => {
    expect(normGain(P({ alg: 4, a: [5, 0.8, 5, 0.8], norm: true }))).toBeCloseTo(1 / 1.6, 15);
  });
});

describe('波形', () => {
  const at = (w: string, u: number) => waveAt(waveIndex(w), 2 * Math.PI * u);
  it('どれも位相 0 で 0 から始まり、−1〜1 に収まる', () => {
    for (const [w] of WAVES) {
      if (w !== 'sq') expect(at(w, 0)).toBeCloseTo(0, 12);
      for (let i = 0; i < 200; i++) expect(Math.abs(at(w, i / 200 + 0.0013))).toBeLessThanOrEqual(1 + 1e-12);
    }
  });
  it('1/4 周期・3/4 周期の値', () => {
    expect([at('sin', 0.25), at('tri', 0.25), at('saw', 0.25), at('sq', 0.25)]).toEqual([1, 1, 0.5, 1]);
    expect(at('tri', 0.75)).toBeCloseTo(-1, 12);
    expect(at('saw', 0.75)).toBeCloseTo(-0.5, 12);
    expect(at('sq', 0.75)).toBe(-1);
    expect(at('half', 0.75)).toBe(0);
    expect(at('abs', 0.75)).toBeCloseTo(1, 12);
    expect(at('qtr', 0.125)).toBeCloseTo(Math.SQRT1_2, 12);
    expect(at('qtr', 0.375)).toBe(0);
    expect(at('qtr', 0.625)).toBeCloseTo(Math.SQRT1_2, 12);
  });
  it('負の位相（変調で戻ったとき）も 1 周期でくり返す', () => {
    for (const [w] of WAVES) expect(at(w, -0.3)).toBeCloseTo(at(w, 0.7), 12);
  });
  it('オペレータごとの波形で計算する', () => {
    const y = waveOf(P({ w: [waveIndex('saw'), 0, 0, 0], a: [1, 0, 0, 0] }), 1);
    expect(y[PTS / 4]).toBeCloseTo(0.5, 12);
    expect(waveIndex('unknown')).toBe(0);
  });
});

describe('入力の定義', () => {
  it('初期値は範囲内で、周波数比は 0.5・1〜15 の並び', () => {
    expect(RATIOS).toEqual([0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    for (const r of R0) expect(RATIOS).toContain(r);
    for (const v of I0) expect(v >= IDX.min && v <= IDX.max).toBe(true);
    for (const v of L0) expect(v >= LVL.min && v <= LVL.max).toBe(true);
  });
  it('鍵盤の音名と平均律の周波数', () => {
    expect(noteHz(69)).toBe(440);
    expect(noteHz(60)).toBeCloseTo(261.6256, 4);
    expect([noteName(60), noteName(61), noteName(69), noteName(24)]).toEqual(['C4', 'C♯4', 'A4', 'C1']);
  });
});
