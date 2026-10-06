import { describe, expect, it } from 'vitest';
import { parse } from '../src/lib/parse';
import { Engine, type PipeMsg, type WindDesc } from '../src/tools/organ/engine';
import { pipeId } from '../src/tools/organ/model';
import { FluePipe, type FlueSpec, ReedPipe, type ReedSpec, tanhP } from '../src/tools/organ/pipes';
import { PIECES, TempoMap } from '../src/tools/organ/score';
import { divOf, OPT0, pipesOf, STOPS, stopOf, topfer } from '../src/tools/organ/stops';
import { measSec, measureF0, sound } from '../src/tools/organ/tune';
import { TUNED } from '../src/tools/organ/tuned';
import { tuneStop } from '../src/tools/organ/tuner';
import { deviations, pitchHz, TEMPERAMENTS, temperamentOf } from '../src/tools/organ/tuning';

const FS = 48000;
const cents = (a: number, b: number) => 1200 * Math.log2(a / b);
const WIND: WindDesc = { p0: { I: 800, II: 720, P: 920 }, tremHz: 5.5, tremDepth: 0, sag: 0, tau: 0.06 };
const rms = (y: Float32Array | Float64Array, a: number, b: number) => {
  let s = 0;
  for (let i = Math.round(a * FS); i < Math.round(b * FS); i++) s += y[i] * y[i];
  return Math.sqrt(s / ((b - a) * FS));
};

describe('調律法', () => {
  it('平均律はずれなし、ヴェルクマイスター III とヴァロッティは文献の値（A を 0 にそろえたもの）', () => {
    expect(deviations(temperamentOf('equal')).every((x) => Math.abs(x) < 1e-9)).toBe(true);
    const w = deviations(temperamentOf('werck3')),
      v = deviations(temperamentOf('vallotti'));
    /* C +11.73、F♯ 0、G +7.82（ヴェルクマイスター III）、C +5.87、E −1.96、B −3.91（ヴァロッティ） */
    expect(w[0]).toBeCloseTo(11.73, 1);
    expect(w[6]).toBeCloseTo(0, 6);
    expect(w[7]).toBeCloseTo(7.82, 1);
    expect(v[0]).toBeCloseTo(5.87, 1);
    expect(v[4]).toBeCloseTo(-1.96, 1);
    expect(v[11]).toBeCloseTo(-3.91, 1);
    expect(TEMPERAMENTS.length).toBe(3);
    expect(pitchHz(69, 415, w)).toBeCloseTo(415, 9);
  });
});

describe('管', () => {
  it('Töpfer の標準スケール: 8 フィートの C で 155.5 mm、16 半音で半分', () => {
    const f = 440 * 2 ** ((36 - 69) / 12);
    expect(topfer(f)).toBeCloseTo(0.1555, 9);
    expect(topfer(f * 2 ** (16 / 12))).toBeCloseTo(0.1555 / 2, 9);
  });
  it('どのストップも、鍵盤の範囲の全部の鍵に管がある', () => {
    for (const s of STOPS) {
      const d = divOf(s.div);
      for (let k = d.lo; k <= d.hi; k += 7) {
        const p = pipesOf(s, k, OPT0);
        expect(p.length).toBeGreaterThan(0);
        for (const x of p) expect(x.f).toBeGreaterThan(20);
      }
    }
    expect(stopOf('mix').kind).toBe('flue');
    expect(pipesOf(stopOf('mix'), 60, OPT0).length).toBe(3);
  });
  it('プリンシパルの C4 は調律の表で目標から 2 セント以内に鳴る', () => {
    const t = tuneStop('p8', { temp: 'equal', a4: 440, voicing: {} }, FS, TUNED)[24][0],
      x = sound(new FluePipe(t.spec as FlueSpec, FS), FS, 1.2, 800),
      r = measureF0(x, FS, t.f / 2, t.f * 2, measSec(t.f));
    expect(Math.abs(cents(r.f, t.f))).toBeLessThan(2);
    expect(t.id).toBe(pipeId('p8', 60, 0));
  });
  it('ゲダクト（閉管）は奇数次の倍音が中心、トランペットは倍音が豊か', () => {
    const t = tuneStop('g8', { temp: 'equal', a4: 440, voicing: {} }, FS, TUNED)[24][0];
    expect(t.amp[1]).toBeLessThan(t.amp[2]);
    const r = pipesOf(stopOf('tr8'), 60, OPT0)[0],
      x = sound(new ReedPipe(r.spec as ReedSpec, FS), FS, 1, 800);
    expect(rms(x, 0.6, 1)).toBeGreaterThan(0.05);
  });
  it('先に求めた往復の損失を付けても同じ音になり、長さが違えば使わない', () => {
    const s = pipesOf(stopOf('p8'), 60, OPT0)[0].spec as FlueSpec,
      fit = new FluePipe(s, FS).fit,
      a = sound(new FluePipe(s, FS), FS, 0.3, 800);
    expect(sound(new FluePipe({ ...s, fit }, FS), FS, 0.3, 800)).toEqual(a);
    expect(new FluePipe({ ...s, l: s.l * 0.9, fit }, FS).fit.p).not.toBe(fit.p);
    const r = pipesOf(stopOf('tr8'), 60, OPT0)[0].spec as ReedSpec;
    expect(new ReedPipe({ ...r, fit: new ReedPipe(r, FS).fit }, FS).fit).toEqual(new ReedPipe(r, FS).fit);
  });
  it('tanh の近似は 1e-4 以内', () => {
    for (let x = -6; x <= 6; x += 0.01) expect(Math.abs(tanhP(x) - Math.tanh(x))).toBeLessThan(1e-4);
  });
});

describe('音', () => {
  const msg = (id: string, k: number): PipeMsg => {
    const s = stopOf(id),
      p = pipesOf(s, k, OPT0)[0];
    return { id: `${id}:${k}`, chest: divOf(s.div).chest, kind: p.kind, spec: p.spec, pan: 0 };
  };
  it('弁を開くと鳴り、閉じると消える', () => {
    const e = new Engine(FS),
      y = new Float32Array(3 * FS);
    e.setWind(WIND);
    e.on(msg('p8', 60));
    for (let i = 0; i < y.length; i += 128) {
      if (i === 128 * Math.round(FS / 128)) e.off('p8:60');
      e.render(y, i, 128);
    }
    expect(y.every(Number.isFinite)).toBe(true);
    expect(rms(y, 0.6, 0.95)).toBeGreaterThan(0.05);
    expect(rms(y, 1.5, 1.8)).toBeLessThan(1e-3);
    expect(e.active().length).toBe(0);
  });
  it('風圧を上げると大きくなり、トレモラントで揺れる', () => {
    const run = (w: WindDesc) => {
      const e = new Engine(FS),
        y = new Float32Array(FS * 2);
      e.setWind(w);
      e.on(msg('p8', 60));
      for (let i = 0; i < y.length; i += 128) e.render(y, i, 128);
      return y;
    };
    const lo = run(WIND),
      hi = run({ ...WIND, p0: { ...WIND.p0, I: 1000 } });
    expect(rms(hi, 1, 2)).toBeGreaterThan(rms(lo, 1, 2));
    const tr = run({ ...WIND, tremDepth: 0.1 }),
      env: number[] = [];
    for (let t = 1; t < 1.95; t += 0.02) env.push(rms(tr, t, t + 0.02));
    expect(Math.max(...env) / Math.min(...env)).toBeGreaterThan(1.05);
  });
  it('ステレオの定位は再生だけに効く', () => {
    const run = (stereo: boolean, pan: number) => {
      const e = new Engine(FS, stereo),
        l = new Float32Array(FS / 2),
        r = new Float32Array(FS / 2);
      e.setWind(WIND);
      e.on({ ...msg('g8', 60), pan });
      for (let i = 0; i < l.length; i += 128) e.render(l, i, 128, r);
      return [l, r];
    };
    expect(run(false, -0.8)[0]).toEqual(run(false, 0.6)[0]);
    const [l, r] = run(true, 0.7);
    expect(rms(r, 0.3, 0.5)).toBeGreaterThan(1.5 * rms(l, 0.3, 0.5));
  });
});

describe('曲', () => {
  it('テンポの比の表は拍 0 の比から始められる', () => {
    const tm = new TempoMap([
      [0, 0.5],
      [4, 1],
    ]);
    expect(tm.tau(4)).toBe(8);
    expect(tm.tau(6)).toBe(10);
    expect(tm.beat(tm.tau(5))).toBeCloseTo(5, 12);
  });
  it('どの曲も鍵盤の範囲に収まり、譜表は 3 つ', async () => {
    for (const p of PIECES) {
      const { notes } = await p.load();
      expect(notes.length).toBeGreaterThan(500);
      for (const x of notes) {
        const d = divOf(p.hands[x.h]);
        expect(x.n).toBeGreaterThanOrEqual(d.lo);
        expect(x.n).toBeLessThanOrEqual(d.hi);
      }
      for (const id of p.stops) expect(STOPS.some((s) => s.id === id)).toBe(true);
    }
  });
  it('単位: 圧力 Pa', () => {
    expect(parse('800Pa', 'Pa')).toBe(800);
    expect(parse('1kPa', 'Pa')).toBe(1000);
  });
});
