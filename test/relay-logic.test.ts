import { describe, expect, it } from 'vitest';
import { DEF, DEFS } from '../src/tools/relay-logic/circuits';
import { buildCircuit, conduct, ideal, loadsOn } from '../src/tools/relay-logic/net';
import { Sim } from '../src/tools/relay-logic/sim';

/** 組み合わせ回路の正しい出力（入力の値 → ランプの順の値） */
const want: Record<string, (v: Record<string, number>) => number[]> = {
  and: ({ A, B }) => [A & B],
  or: ({ A, B }) => [A | B],
  not: ({ A }) => [1 - A],
  nand: ({ A, B }) => [1 - (A & B)],
  nor: ({ A, B }) => [1 - (A | B)],
  xor: ({ A, B }) => [A ^ B],
  xnor: ({ A, B }) => [1 - (A ^ B)],
  and3: ({ A, B, C }) => [A & B & C],
  or3: ({ A, B, C }) => [A | B | C],
  maj: ({ A, B, C }) => [+(A + B + C >= 2)],
  stairs: ({ F1, F2 }) => [F1 ^ F2],
  half: ({ A, B }) => [A ^ B, A & B],
  full: ({ A, B, C }) => [A ^ B ^ C, +(A + B + C >= 2)],
  mux: ({ D0, D1, S }) => [S ? D1 : D0],
  deco: ({ A, B }) => [0, 1, 2, 3].map((k) => +(k === A * 2 + B)),
  eq: ({ A1, A0, B1, B0 }) => [+(A1 === B1 && A0 === B0)],
  parity: ({ A, B, C }) => [A ^ B ^ C],
};

describe('組み合わせ回路の真理値表', () => {
  for (const d of DEFS.filter((x) => x.g !== 'seq'))
    it(d.id, () => {
      const G = buildCircuit(d.rungs, d.ins.length);
      const lds = G.E.map((e, i) => [e, i] as const).filter(([e]) => e.k === 'load');
      const n = d.ins.length;
      for (let k = 0; k < 1 << n; k++) {
        const v: Record<string, number> = {};
        d.ins.forEach((q, j) => {
          v[q.id] = (k >> (n - 1 - j)) & 1;
        });
        const on = loadsOn(G, ideal(v));
        expect(
          lds.map(([, i]) => +on.has(i)),
          JSON.stringify(v),
        ).toEqual(want[d.id](v));
      }
    });
});

describe('電流の通る線', () => {
  it('ランプが点けば電池から − までつながり、消えれば何も光らない', () => {
    for (const d of DEFS.filter((x) => x.g !== 'seq')) {
      const G = buildCircuit(d.rungs, d.ins.length);
      const n = d.ins.length;
      for (let k = 0; k < 1 << n; k++) {
        const v: Record<string, number> = {};
        d.ins.forEach((q, j) => {
          v[q.id] = (k >> (n - 1 - j)) & 1;
        });
        const cs = ideal(v);
        const lit = loadsOn(G, cs).size > 0;
        const on = conduct(G, cs);
        expect(on.size > 0, `${d.id} ${k}`).toBe(lit);
        /* 光る負荷は loadsOn と同じ */
        for (const [i, e] of G.E.entries()) if (e.k === 'load') expect(on.has(i)).toBe(loadsOn(G, cs).has(i));
      }
    }
  });
  it('XOR で A だけ 1 のとき、行き止まりの線は光らない', () => {
    const d = DEF.xor,
      G = buildCircuit(d.rungs, 2);
    const on = conduct(G, ideal({ A: 1, B: 0 }));
    const wires = G.E.map((e, i) => [e, i] as const).filter(([e]) => e.k === 'w');
    expect(wires.some(([, i]) => !on.has(i))).toBe(true);
  });
});

/** 押して、ms 待つ */
function hold(s: Sim, id: string, v: number, ms = 60): void {
  s.set(id, v);
  s.advance(ms);
}

describe('順序回路', () => {
  const mk = (id: string) => {
    const d = DEF[id];
    const s = new Sim(d, buildCircuit(d.rungs, d.ins.length));
    s.settle();
    return s;
  };
  it('自己保持: セットを離しても入ったまま、リセットで切れる', () => {
    const s = mk('rst');
    hold(s, 'SET', 1);
    hold(s, 'SET', 0);
    expect(s.R.R1.a).toBe(true);
    hold(s, 'RST', 1);
    hold(s, 'RST', 0);
    expect(s.R.R1.a).toBe(false);
    /* 両方押すとリセット優先 */
    s.set('SET', 1);
    hold(s, 'RST', 1);
    expect(s.R.R1.a).toBe(false);
  });
  it('セット優先: 両方押すと入る', () => {
    const s = mk('setp');
    s.set('SET', 1);
    hold(s, 'RST', 1);
    expect(s.R.R1.a).toBe(true);
  });
  it('インターロック: 正転中に逆転を押しても入らない', () => {
    const s = mk('il');
    hold(s, 'FW', 1);
    hold(s, 'FW', 0);
    hold(s, 'RV', 1);
    expect(s.R.R1.a).toBe(true);
    expect(s.R.R2.a).toBe(false);
    hold(s, 'RV', 0);
    hold(s, 'STP', 1);
    hold(s, 'STP', 0);
    hold(s, 'RV', 1);
    expect(s.R.R1.a).toBe(false);
    expect(s.R.R2.a).toBe(true);
  });
  it('T フリップフロップ: 押すたびにランプが入り切りする', () => {
    const s = mk('tff');
    const seen: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      hold(s, 'PB', 1);
      hold(s, 'PB', 0);
      seen.push(s.R.R2.a);
    }
    expect(seen).toEqual([true, false, true, false]);
  });
  it('ブザー: 動作の間、入り切りを繰り返して音の出来事が続く', () => {
    const s = mk('buzz');
    const ev = s.advance(200);
    const on = ev.filter((e) => e.k === 'on').length;
    /* 1 周は動作 8 ms と復帰 4 ms ほど */
    expect(on).toBeGreaterThan(10);
    expect(on).toBeLessThan(25);
    hold(s, 'RUN', 0, 50);
    expect(s.advance(100).length).toBe(0);
  });
  it('遅れて切れる回路: 離してから約 1.5 秒で切れる', () => {
    const s = mk('offd');
    hold(s, 'PB', 1);
    hold(s, 'PB', 0, 1400);
    expect(s.R.R1.a).toBe(true);
    s.advance(200);
    expect(s.R.R1.a).toBe(false);
  });
});

describe('リレー', () => {
  it('a 接点は動作時間ほどで閉じ、閉じた直後に跳ねる', () => {
    const d = DEF.and;
    const s = new Sim(d, buildCircuit(d.rungs, 2));
    s.settle();
    const t0 = s.t;
    s.set('B', 1);
    const ev = s.advance(30);
    const on = ev.find((e) => e.k === 'on' && e.r === s.R.B);
    expect((on?.t ?? 0) - t0).toBeGreaterThan(6);
    expect((on?.t ?? 0) - t0).toBeLessThan(10);
    expect(ev.some((e) => e.k === 'tick')).toBe(true);
  });
  it('23 回路', () => {
    expect(DEFS.length).toBe(23);
    expect(new Set(DEFS.map((d) => d.id)).size).toBe(23);
  });
});
