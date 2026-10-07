import { describe, expect, it } from 'vitest';
import { parse } from '../src/lib/parse';
import { Engine, type PipeMsg, type WindDesc } from '../src/tools/organ/engine';
import { pipeId } from '../src/tools/organ/model';
import { FluePipe, type FlueSpec, ReedPipe, type ReedSpec, tanhP } from '../src/tools/organ/pipes';
import { barOf, PIECES, pieceOf, TempoMap } from '../src/tools/organ/score';
import { divOf, OPT0, pipesOf, STOPS, stopOf, topfer } from '../src/tools/organ/stops';
import { measSec, measureF0, sound } from '../src/tools/organ/tune';
import { TUNED } from '../src/tools/organ/tuned';
import { tuneStop } from '../src/tools/organ/tuner';
import { deviations, pitchHz, TEMPERAMENTS, temperamentOf } from '../src/tools/organ/tuning';
import { analyze } from '../src/tools/organ/voice';

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
  it('どのストップも、鍵盤の範囲の全部の鍵に管がある（高音だけのストップは、その鍵から上に）', () => {
    expect(STOPS.length).toBe(28);
    expect(new Set(STOPS.map((s) => s.id)).size).toBe(28);
    for (const s of STOPS) {
      const d = divOf(s.div),
        from = s.kind === 'flue' ? (s.from ?? d.lo) : d.lo;
      for (let k = d.lo; k <= d.hi; k++) {
        const p = pipesOf(s, k, OPT0);
        if (k < from) expect(p.length).toBe(0);
        else expect(p.length).toBeGreaterThan(0);
        for (const x of p) expect(x.f).toBeGreaterThan(20);
      }
      /* 調律の表にも、同じ数の管がある */
      TUNED[s.id].forEach((r, i) => {
        expect(r.length).toBe(pipesOf(s, d.lo + i, OPT0).length);
      });
    }
    expect(stopOf('mix').kind).toBe('flue');
    expect(pipesOf(stopOf('mix'), 60, OPT0).length).toBe(3);
  });
  it("コルネットは c' から上の 5 列で 8' だけ閉管、セレストは少し高く、ハーモニック・フルートは倍の長さを第 2 モードで鳴らす", () => {
    const cor = pipesOf(stopOf('cor'), 60, OPT0);
    expect(cor.map((p) => Math.round(p.f / pipesOf(stopOf('p8'), 60, OPT0)[0].f))).toEqual([1, 2, 3, 4, 5]);
    expect(cor.map((p) => (p.spec as FlueSpec).stopped)).toEqual([true, false, false, false, false]);
    expect(pipesOf(stopOf('cor'), 59, OPT0).length).toBe(0);
    /* セレストは C で 19 セント、5 オクターブ上で 4 セント高い */
    const vc = (k: number) => cents(pipesOf(stopOf('vc8'), k, OPT0)[0].f, pipesOf(stopOf('sal8'), k, OPT0)[0].f);
    expect(vc(48)).toBeCloseTo(16, 6);
    expect(vc(96)).toBeCloseTo(4, 6);
    /* ハーモニック・フルート: c' から b'' は第 2 モード（管は約 2 倍）で、調律の表で目標の近く（4 セント以内）に鳴る */
    const h = pipesOf(stopOf('fh8'), 72, OPT0)[0].spec as FlueSpec,
      o = pipesOf(stopOf('fh8'), 59, OPT0)[0].spec as FlueSpec;
    expect(h.mode).toBe(2);
    expect(o.mode).toBeUndefined();
    expect(h.l / (pipesOf(stopOf('p8'), 72, OPT0)[0].spec as FlueSpec).l).toBeGreaterThan(1.9);
    const t = tuneStop('fh8', { temp: 'equal', a4: 440, voicing: {} }, FS, TUNED)[72 - 36][0],
      x = sound(new FluePipe(t.spec as FlueSpec, FS), FS, 1, 720),
      r = measureF0(x, FS, t.f / 2, t.f * 2, measSec(t.f));
    expect(Math.abs(cents(r.f, t.f))).toBeLessThan(4);
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
  it('立ち上がりの増幅は高いモードを鳴らさない（オクターブバスの C で、高い帯域が定常の全体より 10 dB 以上小さい）', () => {
    const t = tuneStop('ob8', { temp: 'equal', a4: 440, voicing: {} }, FS, TUNED)[0][0],
      x = sound(new FluePipe(t.spec as FlueSpec, FS), FS, 0.6, 920);
    /* 1.5 kHz の 2 次の Butterworth 高域通過を 2 段 */
    let y = x;
    for (let k = 0; k < 2; k++) {
      const w0 = (2 * Math.PI * 1500) / FS,
        c = Math.cos(w0),
        al = Math.sin(w0) / Math.SQRT2,
        a0 = 1 + al,
        o = new Float64Array(y.length);
      let x1 = 0,
        x2 = 0,
        y1 = 0,
        y2 = 0;
      for (let i = 0; i < y.length; i++) {
        const v = (((1 + c) / 2) * (y[i] - 2 * x1 + x2) + 2 * c * y1 - (1 - al) * y2) / a0;
        x2 = x1;
        x1 = y[i];
        y2 = y1;
        y1 = v;
        o[i] = v;
      }
      y = o;
    }
    const ss = rms(x, 0.5, 0.6);
    let hi = 0;
    for (let t0 = 0; t0 < 0.48; t0 += 0.01) hi = Math.max(hi, rms(y, t0, t0 + 0.02));
    expect(20 * Math.log10(hi / ss)).toBeLessThan(-10);
  });
  it('プリンシパルの C5 は 60 ms で定常の −3 dB に届き、立ち上がりの増幅は定常の音を変えない', () => {
    const t = tuneStop('p8', { temp: 'equal', a4: 440, voicing: {} }, FS, TUNED)[36][0],
      s = t.spec as FlueSpec,
      x = sound(new FluePipe(s, FS), FS, 0.6, 800),
      y = sound(new FluePipe({ ...s, onset: 1 }, FS), FS, 0.6, 800),
      a = analyze(x, t.fMeas, FS, 'flue', false),
      b = analyze(y, t.fMeas, FS, 'flue', false);
    expect(a.rise).toBeLessThan(0.06);
    expect(b.rise).toBeGreaterThan(0.08);
    expect(Math.abs(20 * Math.log10(a.rms / b.rms))).toBeLessThan(0.2);
    for (let k = 0; k < 4; k++) expect(Math.abs(20 * Math.log10(a.amp[k] / b.amp[k]))).toBeLessThan(1);
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
  it('弁の開いている管のストップを数え、設定の違う同じ番号の管は作り直す', () => {
    const e = new Engine(FS),
      y = new Float32Array(128 * 40),
      m = msg('p8', 60),
      g = msg('g8', 60);
    e.setWind(WIND);
    e.on(m);
    e.on(g);
    for (let i = 0; i < 128 * 20; i += 128) e.render(y, i, 128);
    expect([...e.openStops(new Set())].sort()).toEqual(['g8', 'p8']);
    e.off(g.id);
    expect([...e.openStops(new Set())]).toEqual(['p8']);
    /* 同じ設定なら弁を開き直すだけ、違う設定（調律し直した管）なら古い管を鳴り終わらせて作り直す */
    e.on(m);
    expect(e.active().length).toBe(2);
    e.on({ ...m, spec: { ...(m.spec as FlueSpec), l: (m.spec as FlueSpec).l * 1.01 } });
    expect(e.active().length).toBe(3);
    expect([...e.openStops(new Set())]).toEqual(['p8']);
    e.allOff();
    for (let i = 0; i < 2 * FS; i += 128) e.render(new Float32Array(128), 0, 128);
    expect(e.active().length).toBe(0);
  });
  it('スウェル: 開き切ればそのまま、閉じると高い音ほど弱まる（第 2 手鍵盤の管だけ）', () => {
    const run = (sw: number, id: string, k: number) => {
      const e = new Engine(FS, true),
        l = new Float32Array(FS),
        r = new Float32Array(FS);
      e.setWind(WIND);
      e.setSwell(sw);
      e.on({ ...msg(id, k), pan: 0 });
      for (let i = 0; i < l.length; i += 128) e.render(l, i, 128, r);
      return l;
    };
    expect(run(1, 'g8', 60)).toEqual(run(1, 'g8', 60));
    const open = run(1, 'n3', 84),
      shut = run(0, 'n3', 84),
      low = 20 * Math.log10(rms(run(0, 'g8', 36), 0.6, 1) / rms(run(1, 'g8', 36), 0.6, 1)),
      high = 20 * Math.log10(rms(shut, 0.6, 1) / rms(open, 0.6, 1));
    /* g8 の C2（65 Hz）は数 dB、n3 の C6（3.1 kHz）は 20 dB 以上 */
    expect(low).toBeGreaterThan(-6);
    expect(high).toBeLessThan(-20);
    /* 第 1 手鍵盤の管は変わらない */
    expect(run(0, 'p8', 60)).toEqual(run(1, 'p8', 60));
  });
  it('同時に鳴らす管の数の上限を超えると、鳴り終わりかけの管をやめ、なければ新しい管を鳴らさない', () => {
    const e = new Engine(FS);
    e.setWind(WIND);
    e.budget = 2;
    e.on(msg('p8', 60));
    e.on(msg('p8', 62));
    e.on(msg('p8', 64));
    expect(e.active()).toEqual(['p8:60', 'p8:62']);
    e.off('p8:60');
    e.on(msg('p8', 64));
    expect(e.active()).toEqual(['p8:62', 'p8:64']);
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
      expect(p.couplers.every((c) => ['II/I', 'I/P', 'II/P'].includes(c))).toBe(true);
    }
  });
  it('BWV 565 は演奏の MIDI: 冒頭は A–G–A のモルデント（オクターブ）、テンポと拍子とレジストレーションが変わる', async () => {
    const pc = pieceOf('bwv565'),
      d = await pc.load(),
      at = (h: number, a: number, b: number) =>
        d.notes
          .filter((x) => x.h === h && x.t >= a && x.t < b)
          .sort((x, y) => x.t - y.t)
          .map((x) => x.n);
    expect(at(0, 3.9, 4.5).filter((n) => n > 75)).toEqual([81, 79, 81]);
    expect(at(0, 3.9, 4.5).filter((n) => n < 75)).toEqual([69, 67, 69]);
    expect(d.notes.length).toBe(3777);
    expect(d.notes.filter((x) => x.h === 1).length).toBe(543);
    /* 除いた弾き損じ（48 秒付近の二重の打鍵の E5）はなく、すぐ後の E5 は残る */
    expect(d.notes.some((x) => x.h === 0 && x.n === 76 && Math.abs(x.t - 4397 / 120) < 1e-6)).toBe(false);
    expect(d.notes.some((x) => x.h === 0 && x.n === 76 && Math.abs(x.t - 4407 / 120) < 1e-6)).toBe(true);
    expect(pc.tempoMap.length).toBe(0);
    expect(Math.min(...d.tempo.map((x) => x[1]))).toBeCloseTo(18 / 50, 3);
    expect(Math.max(...d.tempo.map((x) => x[1]))).toBeCloseTo(115 / 50, 3);
    /* プログラムチェンジ 10 回は、どれもレジストレーションに当ててある */
    expect(d.reg?.length).toBe(10);
    for (const [, r] of d.reg ?? []) {
      const reg = pc.regs?.[r];
      expect(reg).toBeDefined();
      for (const id of reg?.stops ?? []) expect(STOPS.some((s) => s.id === id)).toBe(true);
    }
    expect(d.reg?.[0]).toEqual([0, 6]);
    expect(d.reg?.[9][1]).toBe(9);
    /* 拍子: 140 拍から 3/4、143 拍から 4/4、567 拍から 8/4、599 拍から 4/4。最後の音は 154 小節の頭で終わる */
    const meter = d.meter ?? [];
    expect(barOf(meter, 0, 139.9)).toBe(35);
    expect(barOf(meter, 0, 140)).toBe(36);
    expect(barOf(meter, 0, 143)).toBe(37);
    expect(barOf(meter, 0, 627 - 1e-6)).toBe(153);
  });
  it('装飾を展開してある: BWV 645 と 582 にはトリル', async () => {
    const load = (v: string) => (PIECES.find((p) => p.v === v) as (typeof PIECES)[number]).load(),
      at = (ns: { t: number; n: number; h: number }[], h: number, a: number, b: number) =>
        ns.filter((x) => x.h === h && x.t >= a - 1e-9 && x.t < b).map((x) => x.n);
    /* BWV 645 の拍 33.5 の B♭ の 16 分音符のトリル（上の C から） */
    expect(at((await load('bwv645')).notes, 0, 33.5, 33.75)).toEqual([72, 70]);
    /* BWV 582 の拍 68 の H の付点 4 分音符のトリル: 上の C から交互に、1 秒に 8〜12 音 */
    const tr = (await load('bwv582')).notes.filter((x) => x.h === 0 && x.t >= 68 && x.t < 69.5);
    expect(tr[0].n).toBe(60);
    expect(tr[tr.length - 1].n).toBe(59);
    const sec = (tr[1].d * 60) / 66;
    expect(sec).toBeGreaterThanOrEqual(1 / 12 - 1e-3);
    expect(sec).toBeLessThanOrEqual(1 / 8 + 1e-3);
  });
  it('BWV 578 は、ペダルの 1 オクターブ下の重ねと両手のトラックのペダルの写しを除いてある', async () => {
    const { notes, tempo } = await (PIECES.find((p) => p.v === 'bwv578') as (typeof PIECES)[number]).load(),
      ped = notes.filter((x) => x.h === 2),
      man = notes.filter((x) => x.h === 0);
    expect(ped.length).toBe(179);
    expect(ped.some((x) => ped.some((y) => y.t === x.t && y.n === x.n - 12))).toBe(false);
    expect(Math.min(...man.map((x) => x.n))).toBeGreaterThanOrEqual(38);
    expect(notes.some((x) => x.h === 1)).toBe(false);
    /* 終わりの 2 小節の ritardando */
    expect(tempo[0][0]).toBeGreaterThan(260);
    expect(tempo[tempo.length - 1][1]).toBeLessThan(0.7);
  });
  it('単位: 圧力 Pa', () => {
    expect(parse('800Pa', 'Pa')).toBe(800);
    expect(parse('1kPa', 'Pa')).toBe(1000);
  });
});
