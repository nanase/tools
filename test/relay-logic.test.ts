import { describe, expect, it } from 'vitest';
import { DEF, DEFS } from '../src/tools/relay-logic/circuits';
import { buildCircuit, conduct, ideal, loadsOn, type Pt, RELAY_BOX } from '../src/tools/relay-logic/net';
import { Sim } from '../src/tools/relay-logic/sim';
import { flowRuns } from '../src/tools/relay-logic/svg';

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

/** 線分の並び（線の辺だけ） */
const segsOf = (G: ReturnType<typeof buildCircuit>): [Pt, Pt][] =>
  G.D.flatMap((d) => (d.k === 'w' ? d.pts.slice(1).map((p, i) => [d.pts[i], p] as [Pt, Pt]) : []));
const key = (p: Pt) => `${p[0]},${p[1]}`;

describe('図の形', () => {
  const all = DEFS.map((d) => [d, buildCircuit(d.rungs, d.ins.length)] as const);
  it('線の端は別の線の途中に載らない（つながる所は必ず端どうし）', () => {
    for (const [d, G] of all) {
      const ss = segsOf(G);
      for (const [a, b] of ss)
        for (const p of [a, b])
          for (const [c, e] of ss) {
            const inX = c[1] === e[1] && p[1] === c[1] && p[0] > Math.min(c[0], e[0]) && p[0] < Math.max(c[0], e[0]);
            const inY = c[0] === e[0] && p[0] === c[0] && p[1] > Math.min(c[1], e[1]) && p[1] < Math.max(c[1], e[1]);
            expect(inX || inY, `${d.id} ${key(p)}`).toBe(false);
          }
    }
  });
  it('つながる所に丸、交わるだけの所には打たない', () => {
    const J = (id: string) => all.find(([d]) => d.id === id)?.[1].J.map(key) ?? [];
    expect(J('and')).toEqual([]);
    expect(J('or')).toHaveLength(2);
    /* XOR の X の交点（線どうしが交わるだけ）には打たない */
    const G = buildCircuit(DEF.xor.rungs, 2);
    const ss = segsOf(G).filter(([a, b]) => a[0] !== b[0] && a[1] !== b[1]);
    expect(ss.length).toBe(2);
    const [[a, b]] = ss;
    const xm = (a[0] + b[0]) / 2;
    expect(G.J.some((p) => Math.abs(p[0] - xm) < 2)).toBe(false);
  });
  it('どこにもつながらない端は XOR などにだけある', () => {
    const O = (id: string) => buildCircuit(DEF[id].rungs, DEF[id].ins.length).O.length;
    expect(O('xor')).toBe(1);
    expect(O('xnor')).toBe(1);
    expect(O('and')).toBe(0);
    expect(O('deco')).toBe(0);
    expect(O('mux')).toBe(0);
  });
  it('同じリレーの接点が縦に並ぶ所だけ点線でつなぐ', () => {
    const links = (id: string) => {
      const G = buildCircuit(DEF[id].rungs, DEF[id].ins.length);
      return G.L.map(([i, j]) => {
        const a = G.D[i],
          b = G.D[j];
        return `${'r' in a ? a.r : ''}-${'r' in b ? b.r : ''}`;
      });
    };
    expect(links('xor')).toEqual(['B-B']);
    expect(links('and')).toEqual([]);
    /* 多数決の B は離れているのでつながない */
    expect(links('maj').sort()).toEqual(['A-A', 'C-C']);
    expect(links('full')).toEqual(expect.arrayContaining(['B-B', 'C-C']));
  });
  it('コイルの段のリレーの絵は線にも入力の行にも重ならない', () => {
    for (const [d, G] of all)
      for (const x of G.D) {
        if (x.k !== 'load' || x.ld.kind === 'lamp') continue;
        const bx = x.x + RELAY_BOX[0],
          by = x.y + RELAY_BOX[1],
          bw = RELAY_BOX[2],
          bh = RELAY_BOX[3];
        expect(by, `${d.id} 入力の行`).toBeGreaterThan(96);
        for (const [a, b] of segsOf(G)) {
          const x0 = Math.min(a[0], b[0]),
            x1 = Math.max(a[0], b[0]),
            y0 = Math.min(a[1], b[1]),
            y1 = Math.max(a[1], b[1]);
          const hit = x1 > bx && x0 < bx + bw && y1 > by && y0 < by + bh;
          expect(hit, `${d.id} ${key(a)}-${key(b)}`).toBe(false);
        }
      }
  });
  it('どの回路にもリレーがある', () => {
    for (const [d, G] of all) expect(Object.keys(new Sim(d, G).R).length, d.id).toBeGreaterThan(0);
  });
  it('電流の向きは + から − へ途切れずに続く', () => {
    for (const [d, G] of all.filter(([x]) => x.g !== 'seq')) {
      const n = d.ins.length;
      for (let k = 0; k < 1 << n; k++) {
        const v: Record<string, number> = {};
        d.ins.forEach((q, j) => {
          v[q.id] = (k >> (n - 1 - j)) & 1;
        });
        const on = conduct(G, ideal(v));
        const inn = new Map<string, number>(),
          out = new Map<string, number>();
        for (const [i, dir] of on) {
          const e = G.E[i],
            [f, t] = dir > 0 ? [e.u, e.v] : [e.v, e.u];
          out.set(f, (out.get(f) ?? 0) + 1);
          inn.set(t, (inn.get(t) ?? 0) + 1);
          if (e.k === 'load') expect(dir).toBe(1);
        }
        for (const p of new Set([...inn.keys(), ...out.keys()])) {
          if (p === G.src || p === G.sink) continue;
          expect(!!inn.get(p), `${d.id} ${k} ${p}`).toBe(!!out.get(p));
        }
      }
    }
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
  it('遅れて切れる回路: 押すとコンデンサに充電の電流、離すとコイルへ放電の電流', () => {
    const s = mk('offd'),
      r = s.R.R1;
    expect(r.ic).toBe(0);
    s.set('PB', 1);
    s.advance(20);
    /* 押した直後は充電の電流が流れ、落ち着いていない */
    expect(r.ic).toBeGreaterThan(0.5);
    expect(s.idle).toBe(false);
    s.advance(1000);
    /* 満充電になると電流は止まる */
    expect(r.ic).toBeLessThan(0.01);
    s.set('PB', 0);
    s.advance(100);
    expect(r.held).toBe(true);
    expect(r.ic).toBeLessThan(-0.5);
    s.advance(1300);
    /* 放電は弱まりながら、復帰まで続く */
    expect(r.ic).toBeLessThan(0);
    expect(r.ic).toBeGreaterThan(-0.5);
    s.advance(300);
    expect(r.a).toBe(false);
    expect(r.ic).toBe(0);
  });
  it('遅れて切れる回路: コンデンサの枝とコイルの線が 1 つの輪になる', () => {
    const d = DEF.offd,
      runs = flowRuns(buildCircuit(d.rungs, d.ins.length));
    const cap = runs.filter((r) => r.cap === 'R1'),
      coil = runs.filter((r) => r.coil === 'R1');
    expect(cap).toHaveLength(2);
    expect(coil).toHaveLength(2);
    /* 充電の向きで、コンデンサの枝はコイルの左の線の始まりから出て、右の線の終わりへ戻る */
    expect(cap[0].pts[0]).toEqual(coil[0].pts[0]);
    expect(cap[1].pts.at(-1)).toEqual(coil[1].pts.at(-1));
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
