import { describe, expect, it } from 'vitest';
import { SW } from '../src/lib/scope';
import { solve, wave } from '../src/tools/timer555/model';

const LN2 = Math.LN2;

describe('555 非安定マルチバイブレータ', () => {
  const input = { r1: 10e3, r2: 10e3, c1: 100e-9, vcc: 5 };
  const o = solve(input);

  it('H・L の時間と周期', () => {
    expect(o.tH).toBeCloseTo(LN2 * 20e3 * 100e-9, 15);
    expect(o.tL).toBeCloseTo(LN2 * 10e3 * 100e-9, 15);
    expect(o.T).toBeCloseTo(o.tH + o.tL, 15);
  });

  it('周波数はモックの表示どおり 480.9 Hz', () => {
    expect(o.f).toBeCloseTo(1 / (LN2 * 30e3 * 100e-9), 9);
    expect(o.f).toBeCloseTo(480.898, 3);
  });

  it('デューティ比は (R1 + R2) / (R1 + 2 R2)', () => {
    expect(o.D).toBeCloseTo(200 / 3, 12);
    expect(solve({ ...input, r1: 1e3, r2: 100e3 }).D).toBeCloseTo((101 / 201) * 100, 12);
    expect(solve({ ...input, r1: 100e3, r2: 1e3 }).D).toBeGreaterThan(98);
  });

  it('R1 の最大電流と最大損失', () => {
    expect(o.I).toBeCloseTo(5e-4, 15);
    expect(o.P).toBeCloseTo(2.5e-3, 15);
    expect(solve({ ...input, r1: 100, vcc: 18 }).P).toBeCloseTo(3.24, 12);
  });

  it('波形: 1 周期が 3 div 前後になる時間軸と、電源の 1/5 以上の電圧軸', () => {
    const w = wave(input, o);
    expect(w.td).toBe(1e-3);
    expect(w.vd).toBe(1);
    expect(w.ch1.startsWith('M0 ')).toBe(true);
    expect(w.ch1.endsWith(`H${SW}`)).toBe(true);
    /* 1/3 VCC と 2/3 VCC の閾値線 */
    expect(w.y1).toBeCloseTo(200 - (5 / 3) * 40, 2);
    expect(w.y2).toBeCloseTo(200 - (10 / 3) * 40, 2);
  });

  it('波形: C1 の電圧は 1/3 VCC と 2/3 VCC の間にある', () => {
    const w = wave(input, o);
    const ys = [...w.ch2.matchAll(/[ML][\d.]+ ([\d.-]+)/g)].map((m) => Number(m[1]));
    expect(ys).toHaveLength(601);
    for (const y of ys) {
      expect(y).toBeLessThanOrEqual(w.y1 + 0.01);
      expect(y).toBeGreaterThanOrEqual(w.y2 - 0.01);
    }
  });
});

import { CIR, CIRCUITS, ldr, rstV, type Vals, VRST } from '../src/tools/timer555/circuits';
import { pxPerSec } from '../src/tools/timer555/flow';
import { PARAMS } from '../src/tools/timer555/params';
import { drawCircuit, segments } from '../src/tools/timer555/schematic';
import { Sim } from '../src/tools/timer555/sim';

const base = Object.fromEntries(PARAMS.map((d) => [d.k, d.v])) as Vals;
const valsOf = (id: keyof typeof CIR, over: Partial<Vals> = {}): Vals => ({ ...base, ...CIR[id].def, ...over });
const live = { power: true, trig: false, rst: false };
/** 回路を t 秒進める（刻みは周期の 1/200） */
function runFor(id: keyof typeof CIR, v: Vals, t: number, l = live) {
  const s = new Sim(),
    c = CIR[id],
    dt = t / 4000;
  for (let i = 0; i < 4000; i++) s.advance(dt, c.env(v, l));
  return s;
}

describe('時間を進める計算', () => {
  it('非安定: 測った周期・H・L が式と合い、電源を入れて最初の H は ln 3 倍', () => {
    const v = valsOf('astable'),
      tm = CIR.astable.timing(v),
      m = runFor('astable', v, (tm.T as number) * 12).measure();
    expect(m.tH).toBeCloseTo(tm.tH as number, 9);
    expect(m.tL).toBeCloseTo(tm.tL as number, 9);
    expect(m.f).toBeCloseTo(1 / (tm.T as number), 3);
    expect(m.first).toBeCloseTo(Math.log(3) * 20e3 * 100e-9, 9);
    expect(tm.first).toBeCloseTo(m.first as number, 9);
  });

  it('ダイオード付き: 充電は R1 だけでデューティ比 50 % 未満になる', () => {
    const v = valsOf('diode'),
      tm = CIR.diode.timing(v),
      m = runFor('diode', v, (tm.T as number) * 12).measure();
    expect(tm.tH).toBeCloseTo(LN2 * 10e3 * 100e-9, 12);
    expect(m.D).toBeLessThan(0.5);
    expect(m.D).toBeCloseTo(10 / 32, 6);
  });

  it('デューティ比可変: つまみを動かしても周期はほぼ一定', () => {
    const T = [10, 50, 90].map((pos) => CIR.pwm.timing(valsOf('pwm', { pos })).T as number);
    for (const t of T) expect(t).toBeCloseTo(LN2 * 101e3 * 100e-9, 9);
    const D = [10, 90].map((pos) => {
      const tm = CIR.pwm.timing(valsOf('pwm', { pos }));
      return (tm.tH as number) / (tm.T as number);
    });
    expect(D[0]).toBeLessThan(0.2);
    expect(D[1]).toBeGreaterThan(0.8);
  });

  it('電圧で周波数を変える: CV を下げると周波数が上がり、VCC 以上で止まる', () => {
    const f = (cv: number) => 1 / (CIR.vco.timing(valsOf('vco', { cv })).T as number);
    expect(f(10 / 3)).toBeCloseTo(1 / (LN2 * 30e3 * 100e-9), 6);
    expect(f(2)).toBeGreaterThan(f(3));
    expect(CIR.vco.timing(valsOf('vco', { cv: 5 })).T).toBeUndefined();
    const v = valsOf('vco', { cv: 2 }),
      tm = CIR.vco.timing(v),
      m = runFor('vco', v, (tm.T as number) * 12).measure();
    expect(m.f).toBeCloseTo(1 / (tm.T as number), 3);
  });

  it('暗くなると点滅: 明るいと RST が L で止まり、暗いと発振する', () => {
    expect(ldr(10)).toBeCloseTo(20e3, 6);
    expect(rstV(valsOf('dark', { lux: 1000 }))).toBeLessThan(VRST);
    expect(rstV(valsOf('dark', { lux: 1 }))).toBeGreaterThan(VRST);
    const bright = runFor('dark', valsOf('dark', { lux: 1000 }), 5);
    expect(bright.edges.filter((e) => e[1] === 1)).toHaveLength(0);
    const dark = runFor('dark', valsOf('dark', { lux: 1 }), 5);
    expect(dark.edges.filter((e) => e[1] === 1).length).toBeGreaterThan(3);
  });

  it('単安定: 押すと ln 3 · R1 · C1 だけ H', () => {
    const v = valsOf('mono'),
      c = CIR.mono,
      s = new Sim();
    s.advance(0.1, c.env(v, live));
    expect(s.q).toBe(0);
    s.advance(0.05, c.env(v, { ...live, trig: true }));
    expect(s.q).toBe(1);
    for (let i = 0; i < 300; i++) s.advance(0.01, c.env(v, live));
    expect(s.q).toBe(0);
    expect(s.measure().tp).toBeCloseTo(Math.log(3) * 100e3 * 10e-6, 6);
  });

  it('双安定: ON で H を保ち、OFF で L', () => {
    const v = valsOf('bistable'),
      c = CIR.bistable,
      s = new Sim();
    s.advance(0.1, c.env(v, { ...live, trig: true }));
    s.advance(1, c.env(v, live));
    expect(s.q).toBe(1);
    s.advance(0.1, c.env(v, { ...live, rst: true }));
    s.advance(1, c.env(v, live));
    expect(s.q).toBe(0);
  });

  it('シュミットトリガ: 2/3 VCC を超えると L、1/3 VCC を下回ると H、間では保つ', () => {
    const c = CIR.schmitt,
      s = new Sim(),
      go = (vin: number) => s.advance(0.01, c.env(valsOf('schmitt', { vin }), live));
    go(1);
    expect(s.q).toBe(1);
    go(2.5);
    expect(s.q).toBe(1);
    go(3.5);
    expect(s.q).toBe(0);
    go(2.5);
    expect(s.q).toBe(0);
    go(1.6);
    expect(s.q).toBe(1);
  });

  it('電源を切ると出力は L、入れ直すと最初の H をまた測る', () => {
    const v = valsOf('astable'),
      c = CIR.astable,
      s = new Sim();
    for (let i = 0; i < 100; i++) s.advance(1e-4, c.env(v, live));
    s.advance(1e-3, c.env(v, { ...live, power: false }));
    expect(s.q).toBe(0);
    s.powerOn();
    for (let i = 0; i < 100; i++) s.advance(1e-4, c.env(v, live));
    expect(s.measure().first).toBeDefined();
  });
});

describe('回路図の電流', () => {
  it('どの回路も、つながっている点で電流の出入りがつり合う（555 のピンと VCC・GND の端を除く）', () => {
    for (const c of CIRCUITS) {
      const v = valsOf(c.id),
        d = drawCircuit(c.id, v),
        segs = segments(d.branches);
      /* 状態を変えて何度か確かめる */
      for (const [q, vc, power, trig, rst] of [
        [1, 1.5, true, false, false],
        [0, 3, true, true, true],
        [0, 2, false, false, false],
      ] as const) {
        const s = new Sim();
        s.q = q;
        s.vc = vc;
        const st = c.state(v, s, { power, trig, rst }),
          net = new Map<string, number>();
        for (const g of segs) {
          let i = 0;
          for (const [bi, dir] of g.of) i += dir * (st.I[d.branches[bi]?.k as string] ?? 0);
          const ka = `${g.a[0]},${g.a[1]}`,
            kb = `${g.b[0]},${g.b[1]}`;
          net.set(ka, (net.get(ka) ?? 0) - i);
          net.set(kb, (net.get(kb) ?? 0) + i);
        }
        /* 枝の端（VCC・GND・ピン・極板）は出入りが残る。それ以外の点はつり合う */
        const ends = new Set<string>();
        for (const b of d.branches)
          for (const line of b.p) {
            ends.add(`${line[0]?.[0]},${line[0]?.[1]}`);
            ends.add(`${line.at(-1)?.[0]},${line.at(-1)?.[1]}`);
          }
        for (const [k, x] of net) if (!ends.has(k)) expect(Math.abs(x), `${c.id} ${k}`).toBeLessThan(1e-12);
      }
    }
  });

  it('同じ線を通る枝の電流は足し合わせる', () => {
    const segs = segments([
      {
        k: 'a',
        p: [
          [
            [0, 0],
            [10, 0],
            [20, 0],
          ],
        ],
      },
      {
        k: 'b',
        p: [
          [
            [20, 0],
            [0, 0],
          ],
        ],
      },
    ]);
    expect(segs).toHaveLength(2);
    for (const s of segs) expect(s.of.map(([i]) => i).sort()).toEqual([0, 1]);
  });

  it('粒の速さは電流が大きいほど速く、1 μA 未満は止まる', () => {
    expect(pxPerSec(0)).toBe(0);
    expect(pxPerSec(5e-7)).toBe(0);
    expect(pxPerSec(0.02)).toBeCloseTo(160, 9);
    expect(pxPerSec(1e-3)).toBeGreaterThan(pxPerSec(1e-4));
    expect(pxPerSec(-1e-3)).toBe(pxPerSec(1e-3));
  });
});
