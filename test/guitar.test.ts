import { describe, expect, it } from 'vitest';
import { parse } from '../src/lib/parse';
import { admittance, BODY_TYPES, C, makeBody } from '../src/tools/guitar/body';
import { bodyDesc, Engine } from '../src/tools/guitar/engine';
import { coefAt, type Guitar, modesOf, pluckOf, shapeOf, t60, tuneCoupled } from '../src/tools/guitar/model';
import { slideNoise } from '../src/tools/guitar/noise';
import { finger, midiOf, PIECES, seq } from '../src/tools/guitar/score';
import {
  betaOf,
  etaAir,
  f1Of,
  fretX,
  noteHz,
  noteName,
  SETS,
  setOf,
  stringPhys,
  tensionFor,
  tuningOf,
} from '../src/tools/guitar/strings';

const FS = 48000;
const bodyOf = (v: 'classical' | 'dread') => {
  const t = BODY_TYPES.find((b) => b.v === v);
  if (!t) throw new Error(v);
  return makeBody({ type: v, wood: 'spruce', h: t.h, V: t.V, dh: t.dh });
};
/** 標準の調弦に合わせたギター */
function guitar(v: 'nylon' | 'steel'): Guitar {
  const set = setOf(v),
    notes = tuningOf('std').notes,
    g: Guitar = {
      L: set.L,
      frets: set.frets,
      str: set.strings.map((s, i) => {
        const p = stringPhys(s);
        return { ...p, T: tensionFor(p, set.L, noteHz(notes[i])) };
      }),
      body: bodyOf(v === 'nylon' ? 'classical' : 'dread'),
    };
  g.str = g.str.map((p, i) => ({ ...p, T: tuneCoupled(g, i, noteHz(notes[i])) }));
  return g;
}
const cents = (a: number, b: number) => 1200 * Math.log2(a / b);

describe('弦', () => {
  it('クラシックの線密度は Woodhouse の表（0.38〜6.24 g/m）に 2% で合う', () => {
    const want = [0.38, 0.52, 0.9, 1.95, 3.61, 6.24];
    setOf('nylon').strings.forEach((s, i) => {
      expect(stringPhys(s).mu * 1000).toBeCloseTo(want[i], 1);
      expect(Math.abs(stringPhys(s).mu * 1000 - want[i]) / want[i]).toBeLessThan(0.02);
    });
  });
  it('スチール弦の線密度は D’Addario EJ16 の表に 4% で合う', () => {
    const want = [0.5697, 1.0128, 2.0862, 3.7534, 6.558, 10.172];
    setOf('steel').strings.forEach((s, i) => {
      expect(Math.abs(stringPhys(s).mu * 1000 - want[i]) / want[i]).toBeLessThan(0.04);
    });
  });
  it('調弦に合わせた張力で、第 1 部分音が平均律の音になる（張力はセットの表に 5% で近い）', () => {
    for (const set of SETS)
      set.strings.forEach((s, i) => {
        const f = noteHz(tuningOf('std').notes[i]),
          p = stringPhys(s),
          T = tensionFor(p, set.L, f);
        expect(f1Of({ ...p, T }, set.L)).toBeCloseTo(f, 9);
        expect(Math.abs(T - s.T) / s.T).toBeLessThan(0.05);
      });
  });
  it('非調和性係数は π² EI / (T L²)、フレットの位置は L (1 − 2^(−n/12))', () => {
    const p = { ...stringPhys(setOf('steel').strings[5]), T: 110 };
    expect(betaOf(p, 0.645)).toBeCloseTo((Math.PI ** 2 * p.B) / (110 * 0.645 ** 2), 15);
    expect(fretX(0.65, 12)).toBeCloseTo(0.325, 12);
    expect(fretX(0.65, 0)).toBe(0);
  });
  it('空気の粘性の損失は周波数とともに減り、細く軽い弦ほど大きい', () => {
    expect(etaAir(0.65e-3, 0.38e-3, 330)).toBeGreaterThan(etaAir(0.65e-3, 0.38e-3, 3300));
    expect(etaAir(0.65e-3, 0.38e-3, 330)).toBeGreaterThan(etaAir(1.18e-3, 6.24e-3, 330));
  });
  it('音名', () => {
    expect(noteName(60)).toBe('C4');
    expect(noteName(64)).toBe('E4');
    expect(noteName(37)).toBe('C♯2');
  });
});

describe('胴', () => {
  it('クラシックは Christensen・Vistisen の例（f₋ ≈ 100 Hz、fₕ ≈ 123〜135 Hz、f₊ ≈ 214 Hz）に近い', () => {
    const b = bodyOf('classical');
    expect(b.fm).toBeGreaterThan(95);
    expect(b.fm).toBeLessThan(115);
    expect(b.fh).toBeGreaterThan(120);
    expect(b.fh).toBeLessThan(140);
    expect(b.fpl).toBeGreaterThan(200);
    expect(b.fpl).toBeLessThan(230);
    /* 結合した周波数の 2 乗の和は、結合前の和に等しい */
    expect(b.fm ** 2 + b.fpl ** 2).toBeCloseTo(b.fh ** 2 + b.fp ** 2, 6);
  });
  it('高いモードの平均の間隔は Woodhouse の 38 Hz に近く、同じ設定なら同じ胴になる', () => {
    const b = bodyOf('classical');
    expect(b.df).toBeGreaterThan(32);
    expect(b.df).toBeLessThan(44);
    const c = bodyOf('classical');
    expect(c.stat.map((m) => m.f)).toEqual(b.stat.map((m) => m.f));
  });
  it('容積を大きくするとヘルムホルツ共振が下がり、穴を大きくすると上がる', () => {
    const base = bodyOf('classical'),
      big = makeBody({ ...base.spec, V: 2 * base.spec.V }),
      hole = makeBody({ ...base.spec, dh: 1.2 * base.spec.dh });
    expect(big.fh).toBeLessThan(base.fh);
    expect(hole.fh).toBeGreaterThan(base.fh);
  });
  it('駒のアドミタンスの実部は正（受け身の構造）', () => {
    const b = bodyOf('dread');
    for (const f of [60, 100, 200, 450, 1000, 3000, 5000])
      for (const pol of [0, 1] as const) expect(admittance(b, C.cx(2 * Math.PI * f), pol).re).toBeGreaterThan(0);
  });
});

describe('弦と胴のモード', () => {
  it('胴との結合を補って調弦すると、開放弦の第 1 部分音は調弦の音から 0.1 セント以内', () => {
    for (const v of ['nylon', 'steel'] as const) {
      const g = guitar(v);
      for (let si = 0; si < 6; si++) {
        const m = modesOf(g, si, 0, FS);
        expect(Math.abs(cents(m.w[0] / (2 * Math.PI), noteHz(tuningOf('std').notes[si])))).toBeLessThan(0.1);
      }
    }
  });
  it('12 フレットは 1 オクターブ上、高い部分音は曲げ剛性で整数倍より高い', () => {
    const g = guitar('steel'),
      m0 = modesOf(g, 5, 0, FS),
      m12 = modesOf(g, 5, 12, FS);
    expect(Math.abs(cents(m12.w[0], 2 * m0.w[0]))).toBeLessThan(3);
    expect(m0.w[19] / m0.w[0]).toBeGreaterThan(20);
  });
  it('胴へ逃げる分だけ、垂直の偏波は弦だけより早く減衰する。T60 はもっともらしい範囲', () => {
    const g = guitar('nylon');
    for (let si = 0; si < 6; si++) {
      const m = modesOf(g, si, 0, FS);
      expect(m.s[0]).toBeGreaterThanOrEqual(m.s0[0]);
      expect(t60(m.s[0])).toBeGreaterThan(1);
      expect(t60(m.s[0])).toBeLessThan(20);
      /* 高い部分音ほど早く消える */
      expect(t60(m.s[m.N - 1])).toBeLessThan(t60(m.s0[0]));
    }
  });
  it('弦の長さの 1/5 の点で弾くと、5 倍音（とその倍数）は出ない', () => {
    const g = guitar('nylon'),
      m = modesOf(g, 0, 0, FS),
      pl = pluckOf(g, 0, m, { pos: m.L / 5, amp: 1e-3, width: 0, rel: 0, angle: Math.PI / 2 });
    expect(Math.abs(pl.a[4])).toBeLessThan(1e-12);
    expect(Math.abs(pl.a[9])).toBeLessThan(1e-12);
    expect(Math.abs(pl.a[0])).toBeGreaterThan(1e-4);
    /* 平行の偏波は sin(90°) の向きでは 0 */
    expect(Math.abs(pl.a[m.N])).toBeLessThan(1e-12);
  });
  it('離す瞬間の形は、弾く点を頂点とする三角形（変位 A）', () => {
    const g = guitar('nylon'),
      m = modesOf(g, 2, 0, FS),
      pl = pluckOf(g, 2, m, { pos: 0.13, amp: 1.5e-3, width: 0, rel: 0, angle: Math.PI / 4 }),
      c = coefAt(pl, 0, 0, Math.PI / 4, m.N);
    expect(shapeOf(c, m.L, 0.13)).toBeCloseTo(1.5e-3, 4);
    expect(shapeOf(c, m.L, 0.065)).toBeCloseTo(0.75e-3, 4);
  });
  it('指の腹（広く、ゆっくり離れる）は爪より高い倍音が弱い', () => {
    const g = guitar('steel'),
      m = modesOf(g, 0, 0, FS),
      sp = { pos: 0.1, amp: 1e-3, angle: Math.PI / 2 },
      nail = pluckOf(g, 0, m, { ...sp, width: 3e-3, rel: 3e-5 }),
      flesh = pluckOf(g, 0, m, { ...sp, width: 12e-3, rel: 8e-5 });
    expect(Math.abs(flesh.a[20])).toBeLessThan(Math.abs(nail.a[20]) * 0.5);
  });
});

describe('音', () => {
  it('弾くと音が出て、減衰し、止めると消える', () => {
    const g = guitar('nylon'),
      e = new Engine(FS);
    e.setBody(bodyDesc(g.body));
    const m = modesOf(g, 4, 2, FS),
      pl = pluckOf(g, 4, m, { pos: 0.13, amp: 1.2e-3, width: 12e-3, rel: 8e-5, angle: Math.PI / 4 });
    e.pluck({ si: 4, N: m.N, w: m.w, s: m.s, f: pl.f });
    const y = new Float32Array(FS);
    for (let i = 0; i < y.length; i += 128) e.render(y, i, 128);
    const rms = (a: number, b: number) => {
      let s = 0;
      for (let i = a; i < b; i++) s += y[i] * y[i];
      return Math.sqrt(s / (b - a));
    };
    expect(y.every(Number.isFinite)).toBe(true);
    expect(rms(0, 4800)).toBeGreaterThan(1e-3);
    expect(rms(0, 4800)).toBeLessThan(1);
    expect(rms(43200, 48000)).toBeLessThan(rms(0, 4800));
    e.dampAll(0.005);
    for (let i = 0; i < y.length; i += 128) e.render(y, i, 128);
    expect(rms(24000, 48000)).toBeLessThan(1e-5);
  });
  it('ステレオの定位は再生だけに効き、モノラルの音は変わらない', () => {
    const g = guitar('nylon'),
      m = modesOf(g, 1, 3, FS),
      pl = pluckOf(g, 1, m, { pos: 0.13, amp: 1.2e-3, width: 12e-3, rel: 8e-5, angle: Math.PI / 4 }),
      msg = { si: 1, N: m.N, w: m.w, s: m.s, f: pl.f },
      run = (stereo: boolean, pan: number) => {
        const e = new Engine(FS, stereo),
          l = new Float32Array(FS / 2),
          r = new Float32Array(FS / 2);
        e.setBody(bodyDesc(g.body));
        e.pluck(msg, pan);
        for (let i = 0; i < l.length; i += 128) e.render(l, i, 128, r);
        return [l, r];
      },
      rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
    /* モノラルは pan を無視する */
    const [m0] = run(false, 0),
      [m1] = run(false, 0.8);
    expect(m1).toEqual(m0);
    /* 右へ寄せると右が大きい。中央でも胴のモードごとの定位で左右は少し違う */
    const [l, r] = run(true, 0.5);
    expect(rms(r)).toBeGreaterThan(rms(l) * 1.5);
    const [lc, rc] = run(true, 0);
    expect(rms(lc) / rms(rc)).toBeGreaterThan(0.8);
    expect(rms(lc) / rms(rc)).toBeLessThan(1.25);
    expect(lc).not.toEqual(rc);
  });
  it('何も弾かなければ無音', () => {
    const e = new Engine(FS),
      y = new Float32Array(1024);
    e.setBody(bodyDesc(bodyOf('dread')));
    for (let i = 0; i < y.length; i += 128) e.render(y, i, 128);
    expect(y.every((v) => v === 0)).toBe(true);
  });
  it('すべる音は距離に比例して大きく、すべらなければ 0', () => {
    const sp = { wound: true, pw: 0.3e-3, fL: 500, dur: 0.1, level: 1, seed: 1 };
    const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
    const a = slideNoise({ ...sp, dist: 0.03 }, FS),
      b = slideNoise({ ...sp, dist: 0.09 }, FS),
      z = slideNoise({ ...sp, dist: 0 }, FS);
    expect(rms(b)).toBeGreaterThan(rms(a));
    expect(rms(z)).toBe(0);
  });
});

describe('曲と運指', () => {
  it('音名と列', () => {
    expect(midiOf('C4')).toBe(60);
    expect(midiOf('F#3')).toBe(54);
    expect(midiOf('Bb2')).toBe(46);
    expect(seq(0, 'A4/1 r/1 C5+E5/2', -12)).toEqual([
      { t: 0, d: 1, n: 57 },
      { t: 2, d: 2, n: 60 },
      { t: 2, d: 2, n: 64 },
    ]);
  });
  it('どの曲も全部の音を、その曲の調弦のギターの弦とフレットに置ける', async () => {
    for (const p of PIECES) {
      const open = tuningOf(p.tuning).notes,
        pl = p.load ? await p.load() : finger(p.notes, open, 19);
      expect(pl.length).toBeGreaterThan(50);
      for (const x of pl) {
        expect(x.s).toBeGreaterThanOrEqual(0);
        expect(x.f).toBeGreaterThanOrEqual(0);
        expect(x.f).toBeLessThanOrEqual(19);
        expect(open[x.s] + x.f).toBe(x.n);
      }
      /* 同時に弾く音は別の弦 */
      const at = new Map<number, Set<number>>();
      for (const x of pl) {
        const s = at.get(x.t) ?? new Set();
        expect(s.has(x.s)).toBe(false);
        s.add(x.s);
        at.set(x.t, s);
      }
    }
  });
  it('小節の長さがそろう（弱起の後は小節の拍の数の倍数で終わる）', async () => {
    for (const p of PIECES) {
      const notes = p.load ? await p.load() : p.notes,
        end = Math.max(...notes.map((n) => n.t + n.d));
      expect(((end - p.pickup) / p.bar) % 1).toBeCloseTo(0, 9);
    }
  });
  it('シャコンヌ BWV 1004 は弱起 2 拍と 256 小節、原曲（G3〜G6）の 1 オクターブ下で標準の調弦に収まり、arpeggio の和音は分散する', async () => {
    const p = PIECES.find((x) => x.v === 'bwv1004');
    if (!p?.load) throw new Error('bwv1004');
    const pl = await p.load();
    expect(pl).toHaveLength(3675);
    /* arpeggio の指示のある小節（例: Mutopia の小節 95 = 拍 281〜284）は 32 分音符の分散和音 */
    const on = [...new Set(pl.filter((n) => n.t >= 281 && n.t < 284).map((n) => n.t))];
    expect(on).toEqual(Array.from({ length: 24 }, (_, k) => 281 + k / 8));
    expect(Math.max(...pl.map((n) => n.t + n.d))).toBe(2 + 3 * 256);
    expect(Math.min(...pl.map((n) => n.n))).toBe(midiOf('G2'));
    expect(Math.max(...pl.map((n) => n.n))).toBe(midiOf('G5'));
    /* 冒頭の和音 D3・F3・A3 */
    expect(
      pl
        .filter((n) => n.t === 0)
        .map((n) => n.n)
        .sort((a, b) => a - b),
    ).toEqual([midiOf('D3'), midiOf('F3'), midiOf('A3')]);
  });
  it('前奏曲 BWV 846 は 6 弦を D に下げて D2〜B5 に収まる', () => {
    const p = PIECES.find((x) => x.v === 'bwv846');
    if (!p) throw new Error('bwv846');
    expect(Math.min(...p.notes.map((n) => n.n))).toBe(midiOf('D2'));
    expect(Math.max(...p.notes.map((n) => n.n))).toBe(midiOf('B5'));
  });
});

describe('単位', () => {
  it('張力 N・容積 L・角度 °', () => {
    expect(parse('70.3N', 'N')).toBe(70.3);
    expect(parse('70.3', 'N')).toBe(70.3);
    expect(parse('13L', 'L')).toBe(13);
    expect(parse('13ℓ', 'L')).toBe(13);
    expect(parse('45°', '°')).toBe(45);
    expect(parse('45度', '°')).toBe(45);
    expect(parse('1k', 'N')).toBeNaN();
  });
});
