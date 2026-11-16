import { describe, expect, it } from 'vitest';
import {
  type Bit,
  GF,
  hazards,
  makeSim,
  prep,
  SAMPLE,
  SAMPLES,
  type Sim,
  truthTable,
} from '../src/tools/logic-gates/circuits';
import { chartRows, chartSvg, circuitSvg } from '../src/tools/logic-gates/svg';

const b = (v: number): Bit => (v ? 1 : 0);
/** 入力を変えて落ち着くまでを記録する（先頭は変える前） */
function change(s: Sim, inp: Record<string, number>): Record<string, Bit>[] {
  const snap = () => Object.fromEntries(s.p.outputs.map((n) => [n.id, s.val(n.id)]));
  const hs = [snap()];
  for (const [k, v] of Object.entries(inp)) s.inp[k] = b(v);
  hs.push(snap());
  for (let i = 0; i < 50; i++) {
    const n = s.tick();
    hs.push(snap());
    if (!n) break;
  }
  return hs;
}
function sim(id: string, inp: Record<string, number> = {}): Sim {
  const s = makeSim(SAMPLE[id]);
  for (const [k, v] of Object.entries(inp)) s.inp[k] = b(v);
  s.settle();
  return s;
}

describe('回路のサンプル', () => {
  it('どの回路も部品のつながりと大きさがそろう', () => {
    for (const c of SAMPLES) {
      const p = prep(c);
      expect(p.box.every(Number.isFinite), c.id).toBe(true);
      expect(p.inputs.length, c.id).toBeGreaterThan(0);
      expect(p.outputs.length, c.id).toBeGreaterThan(0);
      expect(circuitSvg(c, 'mil'), c.id).not.toMatch(/NaN|undefined/);
      expect(circuitSvg(c, 'jis'), c.id).not.toMatch(/NaN|undefined/);
    }
  });

  it('id が重ならない', () => {
    expect(new Set(SAMPLES.map((c) => c.id)).size).toBe(SAMPLES.length);
  });

  it('組み合わせ回路は輪がなく段数が決まる', () => {
    for (const c of SAMPLES.filter((x) => x.g !== 'seq')) expect(prep(c).depth, c.id).toBeGreaterThan(0);
    for (const c of SAMPLES.filter((x) => x.g === 'seq')) expect(prep(c).depth, c.id).toBeNull();
  });
});

describe('真理値表', () => {
  it('基本ゲートはゲートの働きどおり', () => {
    for (const c of SAMPLES.filter((x) => x.g === 'basic')) {
      const t = truthTable(c);
      const g = c.id as keyof typeof GF;
      for (const r of t.rows) expect(r.Y, `${c.id} ${JSON.stringify(r)}`).toBe(GF[g](t.ins.map((k) => r[k])));
    }
  });

  it('加算器は足し算になる', () => {
    for (const r of truthTable(SAMPLE.ha).rows) expect(r.C * 2 + r.S).toBe(r.A + r.B);
    for (const r of truthTable(SAMPLE.fa).rows) expect(r.Cout * 2 + r.S).toBe(r.A + r.B + r.Cin);
    for (const r of truthTable(SAMPLE.add2).rows)
      expect(r.S2 * 4 + r.S1 * 2 + r.S0).toBe(r.A1 * 2 + r.A0 + r.B1 * 2 + r.B0);
  });

  it('XOR の 3 通りの作り方は XOR と同じ', () => {
    for (const id of ['nandx', 'xaon', 'norx'])
      for (const r of truthTable(SAMPLE[id]).rows) expect(r.Y, id).toBe(r.A ^ r.B);
  });

  it('NAND で作る基本ゲート・ド・モルガンの法則', () => {
    for (const r of truthTable(SAMPLE.nandb).rows) {
      expect(r['¬A']).toBe(1 - r.A);
      expect(r['A·B']).toBe(r.A & r.B);
      expect(r['A+B']).toBe(r.A | r.B);
    }
    for (const r of truthTable(SAMPLE.dem).rows) expect(r.Y1).toBe(r.Y2);
  });

  it('マルチプレクサ・デコーダ・比較器・パリティ・多数決', () => {
    for (const r of truthTable(SAMPLE.mux).rows) expect(r.Y).toBe(r.S ? r.B : r.A);
    for (const r of truthTable(SAMPLE.dec).rows) {
      const k = r.A1 * 2 + r.A0;
      for (let i = 0; i < 4; i++) expect(r[`Y${i}`]).toBe(i === k ? 1 : 0);
    }
    for (const r of truthTable(SAMPLE.cmp).rows) {
      expect(r['A>B']).toBe(r.A > r.B ? 1 : 0);
      expect(r['A=B']).toBe(r.A === r.B ? 1 : 0);
      expect(r['A<B']).toBe(r.A < r.B ? 1 : 0);
    }
    for (const r of truthTable(SAMPLE.par).rows) expect(r.P).toBe((r.D0 + r.D1 + r.D2 + r.D3) % 2);
    for (const r of truthTable(SAMPLE.maj).rows) expect(r.Y).toBe(r.A + r.B + r.C >= 2 ? 1 : 0);
  });
});

describe('遅れとハザード', () => {
  it('ハザードの回路は B = C = 1 で A を 1 から 0 にすると Y に一瞬 0 が出る', () => {
    const s = sim('haz', { A: 1, B: 1, C: 1 });
    const hs = change(s, { A: 0 });
    expect(hazards(hs, ['Y'])).toHaveLength(1);
    expect(hs[hs.length - 1].Y).toBe(1);
  });

  it('A を 0 から 1 にするときは出ない', () => {
    const s = sim('haz', { A: 0, B: 1, C: 1 });
    expect(hazards(change(s, { A: 1 }), ['Y'])).toHaveLength(0);
  });

  it('マルチプレクサは A = B = 1 で S を 1 から 0 にすると出る', () => {
    const s = sim('mux', { A: 1, B: 1, S: 1 });
    expect(hazards(change(s, { S: 0 }), ['Y'])).toHaveLength(1);
  });

  it('落ち着くまでの段数は最長の経路を超えない', () => {
    for (const c of SAMPLES.filter((x) => x.g !== 'seq')) {
      const t = truthTable(c),
        d = prep(c).depth ?? 0;
      for (const r of t.rows) {
        const s = makeSim(c);
        s.settle();
        for (const k of t.ins) s.inp[k] = r[k];
        expect(s.settle(), c.id).toBeLessThanOrEqual(d);
      }
    }
  });
});

describe('順序回路', () => {
  it('SR ラッチはセット・リセットし、どちらも 0 なら前のまま', () => {
    const s = sim('sr');
    expect(s.val('Q')).toBe(0);
    s.inp.S = 1;
    s.settle();
    s.inp.S = 0;
    s.settle();
    expect([s.val('Q'), s.val('¬Q')]).toEqual([1, 0]);
    s.inp.R = 1;
    s.settle();
    s.inp.R = 0;
    s.settle();
    expect([s.val('Q'), s.val('¬Q')]).toEqual([0, 1]);
  });

  it('D ラッチは E = 1 の間 D に従い、E = 0 で保つ', () => {
    const s = sim('dl', { E: 1, D: 1 });
    expect(s.val('Q')).toBe(1);
    s.inp.E = 0;
    s.settle();
    s.inp.D = 0;
    s.settle();
    expect(s.val('Q')).toBe(1);
    s.inp.E = 1;
    s.settle();
    expect(s.val('Q')).toBe(0);
  });

  it('D フリップフロップは CLK の立ち上がりの D だけを取り込む', () => {
    const s = sim('dff', { D: 1 });
    expect(s.val('Q')).toBe(0);
    s.inp.CLK = 1;
    s.settle();
    expect(s.val('Q')).toBe(1);
    s.inp.D = 0;
    s.settle();
    expect(s.val('Q')).toBe(1);
    s.inp.CLK = 0;
    s.settle();
    expect(s.val('Q')).toBe(1);
    s.inp.CLK = 1;
    s.settle();
    expect(s.val('Q')).toBe(0);
  });

  /** 入力を順に変え、そのたびに落ち着かせて Q を返す */
  const qs = (id: string, steps: Record<string, number>[]): Bit[] => {
    const c = SAMPLE[id];
    const s = makeSim(c);
    Object.assign(s.inp, c.defIn ?? {});
    s.settle();
    return steps.map((st) => {
      for (const [k, v] of Object.entries(st)) s.inp[k] = b(v);
      expect(s.settle(), id).toBeGreaterThanOrEqual(0);
      expect(s.val('¬Q'), id).toBe(1 - s.val('Q'));
      return s.val('Q');
    });
  };

  it('NAND の SR ラッチは 0 にした側を覚える', () => {
    expect(qs('srn', [{ '¬S': 0 }, { '¬S': 1 }, { '¬R': 0 }, { '¬R': 1 }])).toEqual([1, 1, 0, 0]);
  });

  it('ゲート付き SR ラッチは E = 1 の間だけ受け付ける', () => {
    expect(qs('gsr', [{ S: 1 }, { E: 1 }, { E: 0, S: 0 }, { R: 1 }, { E: 1 }])).toEqual([0, 1, 1, 1, 0]);
  });

  it('JK フリップフロップは立ち上がりで保持・セット・リセット・反転', () => {
    const up = { CLK: 1 },
      dn = { CLK: 0 };
    expect(
      qs('jk', [{ J: 1 }, up, { ...dn, J: 0, K: 1 }, up, { ...dn, J: 1, K: 1 }, up, dn, up, { ...dn, J: 0, K: 0 }, up]),
    ).toEqual([0, 1, 1, 0, 0, 1, 1, 0, 0, 0]);
  });

  it('T フリップフロップは T = 1 なら立ち上がりごとに反転する', () => {
    const up = { CLK: 1 },
      dn = { CLK: 0 };
    expect(qs('tff', [{ T: 1 }, up, dn, up, dn, up, { ...dn, T: 0 }, up])).toEqual([0, 1, 1, 0, 0, 1, 1, 1]);
  });

  it('リングオシレータは EN = 1 で発振し、0 で止まる', () => {
    const s = sim('ring');
    expect(s.settle()).toBeGreaterThanOrEqual(0);
    s.inp.EN = 1;
    expect(s.settle()).toBe(-1);
    const ys: Bit[] = [];
    for (let i = 0; i < 12; i++) {
      s.tick();
      ys.push(s.val('Y'));
    }
    expect(new Set(ys).size).toBe(2);
  });
});

describe('タイミングチャート', () => {
  it('どの波形でも数値が壊れず、右端に今の値を出す', () => {
    const c = SAMPLE.haz;
    const s = sim('haz', { A: 1, B: 1, C: 1 });
    const rows = chartRows(c, true);
    const hs = Array.from({ length: 28 }, (_, i) => {
      if (i === 20) s.inp.A = 0;
      s.tick();
      return Object.fromEntries(c.nodes.filter((n) => n.t !== 'j').map((n) => [n.id, s.val(n.id)]));
    });
    for (const wave of ['sq', 'tr', 'fill', 'num'] as const)
      for (const nt of ['01', 'LH'] as const) {
        const { svg } = chartSvg(rows, hs, { w: 600, nt, wave, sel: 3, hov: 5 });
        expect(svg, `${wave} ${nt}`).not.toMatch(/NaN|undefined|Infinity/);
        expect((svg.match(/class="cv /g) ?? []).length).toBe(rows.length);
        expect(svg).toContain('class="hz"');
      }
  });
});
