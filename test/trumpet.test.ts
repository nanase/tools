import { describe, expect, it } from 'vitest';
import { air, profile, SPEC } from '../src/tools/trumpet/bore';
import { CALIB, RES_DEV } from '../src/tools/trumpet/calib';
import { Bore } from '../src/tools/trumpet/guide';
import { Trumpet } from '../src/tools/trumpet/instrument';
import { FINGERS, fingering, HIGH, LOW, mtof } from '../src/tools/trumpet/notes';
import { dynOfDb, levelOfMarks, performPiece } from '../src/tools/trumpet/perform';
import { control, Player } from '../src/tools/trumpet/player';
import { mouthpieceResonance } from '../src/tools/trumpet/plot';
import { PIECES, pieceOf } from '../src/tools/trumpet/score';
import { loadScore } from '../src/tools/trumpet/scores/load';
import type { ScoreNote } from '../src/tools/trumpet/scores/types';
import { AIR_N, airPoints, airQuads } from '../src/tools/trumpet/shapes';
import { boreSteps, inputImpedance, peaksOf } from '../src/tools/trumpet/tmm';

const FS = 48000;
const B2 = mtof(46);
const cents = (f: number, g: number) => 1200 * Math.log2(f / g);

/** 管の入力インピーダンスの大きさ（伝達行列）の、周波数 f の列での値 */
function tmmZ(f: Float64Array): Float64Array {
  const A = air(27),
    st = boreSteps(profile(SPEC), 0, 1.5e-3),
    z = new Float64Array(f.length);
  for (let i = 0; i < f.length; i++) {
    const Z = inputImpedance(A, st, f[i]);
    z[i] = Math.hypot(Z[0], Z[1]);
  }
  return z;
}

/** 導波管の入口に往きの波のインパルスを入れ、入口を無反射にして帰りの波を測り、入力インピーダンスの大きさにする */
function guideZ(f: Float64Array): Float64Array {
  const bore = new Bore(profile(SPEC), air(27), FS),
    N = 12000,
    r = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    r[n] = bore.incoming();
    bore.step(n === 0 ? 1 : 0);
  }
  const z = new Float64Array(f.length);
  for (let i = 0; i < f.length; i++) {
    const w = (2 * Math.PI * f[i]) / FS;
    let re = 0,
      im = 0;
    for (let n = 0; n < N; n++) {
      re += r[n] * Math.cos(w * n);
      im -= r[n] * Math.sin(w * n);
    }
    /* Z = Zc (1 + R) / (1 − R) */
    const nr = 1 + re,
      dr = 1 - re;
    z[i] = (bore.zIn * Math.hypot(nr, im)) / Math.hypot(dr, -im);
  }
  return z;
}

/** 唇を表の値にして t 秒吹き、後ろ 0.15 秒のマウスピースの圧力の、上向きに 0 を横切る間隔から周波数を測る */
function blow(m: number, d: number, dur = 0.4, opts: { brass?: number } = {}): { f0: number; out: Float64Array } {
  const tr = new Trumpet(FS, { brass: opts.brass ?? 1 }),
    c = control(m, d),
    fl = mtof(m) * c.ratio;
  tr.setValves(FINGERS[fingering(m).semi].v);
  for (let i = 0; i < 3; i++) tr.bore.valves[i].press = tr.target[i];
  const N = Math.round(dur * FS),
    tail = Math.round(0.15 * FS),
    p = new Float64Array(tail),
    out = new Float64Array(tail);
  for (let n = 0; n < N; n++) {
    const y = tr.step(c.pm * Math.min(1, n / (0.01 * FS)), fl);
    if (n >= N - tail) {
      p[n - (N - tail)] = tr.lips.p;
      out[n - (N - tail)] = y;
    }
  }
  const mean = p.reduce((s, v) => s + v, 0) / tail,
    cross: number[] = [];
  for (let i = 1; i < tail; i++) {
    const a = p[i - 1] - mean,
      b = p[i] - mean;
    if (a <= 0 && b > 0) cross.push(i - 1 + a / (a - b));
  }
  const f0 = cross.length > 2 ? ((cross.length - 1) * FS) / (cross[cross.length - 1] - cross[0]) : 0;
  return { f0, out };
}

describe('管', () => {
  it('弁を押さない管の第 2〜第 8 の共鳴は、B♭2 の倍音から ±40 セント以内', () => {
    const f = new Float64Array(1800).map((_, i) => 150 + i * 0.5),
      pk = peaksOf(f, tmmZ(f));
    for (let n = 2; n <= 8; n++) {
      const near = pk.reduce((a, q) => (Math.abs(cents(q.f, n * B2)) < Math.abs(cents(a.f, n * B2)) ? q : a));
      expect(Math.abs(cents(near.f, n * B2)), `第 ${n}`).toBeLessThan(40);
    }
  });

  it('はしごのずれ: 1 本の弁は弁なしと同じくらいに合い、組み合わせるほど高くなる', () => {
    const avg = (r: readonly number[]) => r.slice(0, 7).reduce((s, v) => s + v, 0) / 7;
    expect(RES_DEV).toHaveLength(FINGERS.length);
    expect(Math.abs(avg(RES_DEV[1]) - avg(RES_DEV[0]))).toBeLessThan(12);
    expect(Math.abs(avg(RES_DEV[2]) - avg(RES_DEV[0]))).toBeLessThan(12);
    expect(avg(RES_DEV[6])).toBeGreaterThan(avg(RES_DEV[3]) + 25);
  });

  it('マウスピースの popping の周波数は 700〜950 Hz', () => {
    const f = mouthpieceResonance();
    expect(f).toBeGreaterThan(700);
    expect(f).toBeLessThan(950);
  });

  it('導波管の入力インピーダンスの山は、伝達行列の山と 15 セント以内で合う', () => {
    const f = new Float64Array(1700).map((_, i) => 150 + i * 0.5),
      a = peaksOf(f, tmmZ(f)).filter((q) => q.f > 200 && q.f < 1000),
      b = peaksOf(f, guideZ(f)).filter((q) => q.f > 190 && q.f < 1010);
    expect(a.length).toBe(7);
    for (const q of a) {
      const near = b.reduce((x, y) => (Math.abs(cents(y.f, q.f)) < Math.abs(cents(x.f, q.f)) ? y : x));
      expect(Math.abs(cents(near.f, q.f)), `${q.f.toFixed(0)} Hz`).toBeLessThan(15);
      expect(near.z / q.z).toBeGreaterThan(0.75);
      expect(near.z / q.z).toBeLessThan(1.33);
    }
  });
});

describe('唇と奏者', () => {
  it('表の唇の張りで、低い音から高い音まで平均律から 15 セント以内で鳴る', () => {
    for (const m of [55, 58, 65, 70, 74, 77]) {
      const { f0 } = blow(m, 0.55);
      expect(Math.abs(cents(f0, mtof(m))), `MIDI ${m}`).toBeLessThan(15);
    }
  });

  it('舌で区切って同じ音を続けても、どの音も鳴りきって音程が合う', () => {
    for (const [m, d, tongue] of [
      [67, 0.23, 'da'],
      [70, 0.1, 'ta'],
      [79, 0.4, 'da'],
    ] as const) {
      const notes = [0, 1, 2, 3].map((i) => ({
          t: 0.2 + i * 0.45,
          d: 0.25,
          span: 0.45,
          m,
          d0: d,
          d1: d,
          slur: false,
          acc: false,
          tongue,
        })),
        tr = new Trumpet(FS),
        pl = new Player(FS),
        N = Math.round(2.2 * FS),
        p = new Float64Array(N);
      pl.start(notes, 0);
      for (let i = 0; i < N; i++) {
        pl.step(tr);
        p[i] = tr.lips.p;
      }
      for (const n of notes) {
        const a = Math.round((n.t + 0.06) * FS),
          b = Math.round((n.t + n.d - 0.03) * FS),
          seg = p.subarray(a, b),
          mean = seg.reduce((s, v) => s + v, 0) / seg.length,
          cr: number[] = [];
        let e = 0;
        for (let i = 1; i < seg.length; i++) {
          if (seg[i - 1] - mean <= 0 && seg[i] - mean > 0) cr.push(i);
          e += (seg[i] - mean) ** 2;
        }
        const f0 = ((cr.length - 1) * FS) / (cr[cr.length - 1] - cr[0]);
        expect(Math.abs(cents(f0, mtof(m))), `MIDI ${m} ${n.t}`).toBeLessThan(15);
        expect(Math.sqrt(e / seg.length)).toBeGreaterThan(1000);
      }
    }
  });

  it('強く吹くほど大きく明るい（非線形の伝搬あり）', () => {
    const bright = (y: Float64Array) => {
      let d = 0,
        e = 0;
      for (let i = 1; i < y.length; i++) {
        d += (y[i] - y[i - 1]) ** 2;
        e += y[i] ** 2;
      }
      return { level: e, ratio: d / e };
    };
    const p = bright(blow(65, 0.2).out),
      ff = bright(blow(65, 0.95).out),
      lin = bright(blow(65, 0.95, 0.4, { brass: 0 }).out);
    expect(ff.level).toBeGreaterThan(p.level * 10);
    expect(ff.ratio).toBeGreaterThan(p.ratio * 1.5);
    expect(ff.ratio).toBeGreaterThan(lin.ratio);
  });

  it('表は実音 E3〜D6 のどの音にもあり、強弱は口の圧力の範囲の中で単調', () => {
    for (let m = LOW; m <= HIGH; m++) {
      expect(CALIB[m]?.length, `MIDI ${m}`).toBeGreaterThan(0);
      let last = 0;
      for (const d of [0, 0.25, 0.5, 0.75, 1]) {
        const c = control(m, d);
        expect(c.pm).toBeGreaterThanOrEqual(last);
        last = c.pm;
      }
    }
  });
});

describe('曲の演奏', () => {
  it('どの曲も音が時刻の順に並び、長さが次の音までに収まり、音域に入る', async () => {
    for (const p of PIECES)
      for (const ex of ['plain', 'phrase'] as const) {
        const perf = performPiece(p, await loadScore(p.file), 1, ex),
          ns = perf.notes;
        expect(ns.length, p.v).toBeGreaterThan(20);
        for (let i = 0; i < ns.length; i++) {
          const n = ns[i];
          expect(n.d).toBeGreaterThan(0);
          expect(n.d).toBeLessThanOrEqual(n.span + 1e-9);
          expect(n.m).toBeGreaterThanOrEqual(LOW);
          expect(n.m).toBeLessThanOrEqual(HIGH);
          expect(n.d0).toBeGreaterThan(0);
          expect(n.d0).toBeLessThanOrEqual(1);
          if (i) expect(n.t).toBeGreaterThanOrEqual(ns[i - 1].t);
        }
        /* 拍と秒は行き来できる */
        expect(perf.beatAt(perf.secAt(5.25))).toBeCloseTo(5.25, 3);
      }
  });

  it('テンポを上げると短くなり、同じ高さの音へのスラーはタイとして 1 つの音にする', async () => {
    const pc = pieceOf('ave-maria'),
      d = await loadScore(pc.file),
      a = performPiece(pc, d, 1, 'plain'),
      b = performPiece(pc, d, 1.25, 'plain'),
      end = (p: typeof a) => p.notes[p.notes.length - 1].t;
    expect(end(b)).toBeLessThan(end(a) * 0.85);
    expect(a.notes.length).toBeLessThan(d.voices[0].length);
  });

  it('強弱: 記号の段と、行き先のない松葉は ±4 dB 動いて戻る', () => {
    const N = (t: number, x: Partial<ScoreNote> = {}): ScoreNote => ({
      t,
      d: 1,
      n: 70,
      slurOn: false,
      slurOff: false,
      trill: false,
      fermata: false,
      stacc: false,
      accent: false,
      tenuto: false,
      ...x,
    });
    const lv = levelOfMarks([
      N(0, { dyn: 'p' }),
      N(1, { hair: '<' }),
      N(2),
      N(3, { hair: '!' }),
      N(5),
      N(6, { dyn: 'f' }),
    ]);
    expect(lv(0.5)).toBeCloseTo(-7);
    expect(lv(4)).toBeCloseTo(-3);
    expect(lv(4.6)).toBeCloseTo(-7);
    expect(lv(6.5)).toBeCloseTo(5);
    expect(dynOfDb(-12)).toBeCloseTo(0.04);
    expect(dynOfDb(0)).toBeCloseTo(0.55);
    expect(dynOfDb(9)).toBeCloseTo(0.973);
  });
});

describe('図', () => {
  it('どの指使いでも、気柱の四角は管の 9 つの要素をすべて通る', () => {
    for (const g of FINGERS) {
      const els = new Set(airQuads(g.v).map((q) => q.el));
      expect([...els].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    }
    expect(airPoints().length).toBe(2 * AIR_N.reduce((s, v) => s + v, 0));
  });
});
