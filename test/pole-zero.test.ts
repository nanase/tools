import { describe, expect, it } from 'vitest';
import { formatter, resolve, valueList } from '../src/lib/param-core';
import { geoMath, mnum } from '../src/tools/pole-zero/math';
import { PARAMS, PRESETS, presetOf, SEL } from '../src/tools/pole-zero/params';
import { frAxis, frPlot, frWs, labels, plane, planeCursor, planePts, viewOf } from '../src/tools/pole-zero/plot';
import {
  at,
  coefs,
  conv,
  curves,
  expand,
  freeSpot,
  gainOf,
  impulse,
  order,
  type Pt,
  peak,
  polar,
  resOf,
  type Spot,
  sos,
  sosPoly,
  stability,
  vectors,
  wrap,
} from '../src/tools/pole-zero/pz';

const D = Math.PI / 180;
let nid = 1;
const ids = (s: Spot[]): Pt[] => s.map((p) => ({ ...p, id: nid++ }));
const pp = (r: number, deg: number) => polar('p', r, deg * D);
const zz = (r: number, deg: number) => polar('z', r, deg * D);
const preset = (v: string) => ids(presetOf(v)?.pts() ?? []);

/** 係数から直接 H(e^{jω}) = B(e^{−jω}) / A(e^{−jω}) を求める */
function direct(b: number[], a: number[], w: number): { mag: number; ph: number } {
  const ev = (c: number[]) => {
    let re = 0,
      im = 0;
    c.forEach((x, i) => {
      re += x * Math.cos(w * i);
      im -= x * Math.sin(w * i);
    });
    return [re, im];
  };
  const [br, bi] = ev(b),
    [ar, ai] = ev(a),
    d = ar * ar + ai * ai;
  const re = (br * ar + bi * ai) / d,
    im = (bi * ar - br * ai) / d;
  return { mag: Math.hypot(re, im), ph: Math.atan2(im, re) };
}

const close = (a: readonly number[], b: readonly number[], tol = 1e-12) => {
  expect(a.length).toBe(b.length);
  a.forEach((x, i) => {
    expect(x).toBeCloseTo(b[i], -Math.log10(tol));
  });
};

describe('多項式の展開', () => {
  it('共役の対は 1 − 2r cosθ z⁻¹ + r² z⁻²、実軸の点は 1 − c z⁻¹', () => {
    close(expand([zz(0.9, 60)], 'z'), [1, -2 * 0.9 * Math.cos(60 * D), 0.81]);
    close(expand([{ k: 'z', re: -0.5, im: 0 }], 'z'), [1, 0.5]);
    close(
      expand(
        [
          { k: 'p', re: 0.5, im: 0 },
          { k: 'p', re: -0.25, im: 0 },
        ],
        'p',
      ),
      [1, -0.25, -0.125],
    );
  });
  it('極と零点を分けて展開し、零点には利得 k を掛ける', () => {
    const c = coefs([zz(1, 90), pp(0.5, 0)], 2);
    close(c.b, [2, 0, 2]);
    close(c.a, [1, -0.5]);
  });
  it('8 点の移動平均の零点は 1 + z⁻¹ + … + z⁻⁷', () => {
    close(expand(preset('ma'), 'z'), Array(8).fill(1), 1e-12);
  });
  it('くし形の極は 1 − 0.8 z⁻⁸', () => {
    close(expand(preset('comb'), 'p'), [1, 0, 0, 0, 0, 0, 0, 0, -0.8], 1e-12);
  });
  it('conv は多項式の積', () => {
    expect(conv([1, 2], [1, 3])).toEqual([1, 5, 6]);
  });
});

describe('周波数応答', () => {
  const pts = ids([zz(1, 120), { k: 'z', re: 0.3, im: 0 }, pp(0.9, 40), { k: 'p', re: -0.6, im: 0 }, pp(0.7, 100)]);
  const { b, a } = coefs(pts, 1);
  it('積の形の振幅・位相が係数から直接求めた値に合う', () => {
    for (const w of [0, 0.3, 1, 2, 3, Math.PI]) {
      const r = at(pts, w),
        d = direct(b, a, w);
      expect(Math.exp(r.lm)).toBeCloseTo(d.mag, 9);
      expect(Math.cos(r.ph - d.ph)).toBeCloseTo(1, 9);
    }
  });
  it('群遅延は位相の差分の −1 倍に合う', () => {
    const h = 1e-6;
    for (const w of [0.2, 0.7, 1.5, 2.5]) {
      const num = -(at(pts, w + h).ph - at(pts, w - h).ph) / (2 * h);
      expect(at(pts, w).gd).toBeCloseTo(num, 5);
    }
  });
  it('実軸の 1 個の極 p の直流の群遅延は p / (1 − p)', () => {
    expect(at(ids([{ k: 'p', re: 0.8, im: 0 }]), 0).gd).toBeCloseTo(0.8 / 0.2, 12);
  });
  it('単位円の上の零点の周波数で振幅は 0（−∞ dB）', () => {
    expect(at(preset('notch'), Math.PI / 4).lm).toBe(-Infinity);
  });
  it('curves は dB・度・群遅延の列。k を掛ける', () => {
    const ws = Float64Array.from([0, 1, 2]),
      c = curves(pts, ws, 10);
    expect(c.db[1]).toBeCloseTo(20 * Math.log10(10 * Math.exp(at(pts, 1).lm)), 9);
    expect(c.deg[2]).toBeCloseTo((wrap(at(pts, 2).ph) * 180) / Math.PI, 9);
    expect(Math.abs(c.deg[2])).toBeLessThanOrEqual(180);
  });
  it('オールパスは k = r² で振幅が 1', () => {
    const p = preset('ap');
    for (const w of [0, 0.5, 1, 2, 3]) expect(0.64 * Math.exp(at(p, w).lm)).toBeCloseTo(1, 12);
  });
  it('バターワース 4 次は直流を 0 dB にすると fc = fs/8 で −3.01 dB', () => {
    const p = preset('lpf'),
      db = (20 / Math.LN10) * (at(p, Math.PI / 4).lm - at(p, 0).lm);
    expect(db).toBeCloseTo(-3.0103, 3);
    expect(stability(p).s).toBe('stable');
  });
});

describe('距離と角度', () => {
  it('長さの積の比と角度の和の差が H に一致する（原点に足した根を含む）', () => {
    for (const v of ['notch', 'res', 'ma', 'comb', 'dc', 'ap']) {
      const p = preset(v);
      for (const w of [0.1, 0.9, 2.2]) {
        const vs = vectors(p, w);
        let m = 0,
          ph = 0;
        for (const x of vs) {
          const s = x.k === 'z' ? 1 : -1;
          m += s * x.n * Math.log(x.d);
          ph += s * x.n * x.phi;
        }
        const r = at(p, w);
        expect(m).toBeCloseTo(r.lm, 10);
        expect(ph).toBeCloseTo(r.ph, 10);
        /* 足した根を含めると極と零点の個数がそろう */
        const n = (k: string) => vs.filter((x) => x.k === k).reduce((s, x) => s + x.n, 0);
        expect(n('z')).toBe(n('p'));
      }
    }
  });
  it('共振器は原点に零点を 2 個足す', () => {
    const vs = vectors(preset('res'), 1);
    expect(vs.find((x) => x.id == null)).toMatchObject({ k: 'z', n: 2, d: 1, phi: 1 });
  });
  it('式は k・積・角度の和を代入する', () => {
    const m = geoMath({ k: 1, pz: 0.5, pp: 0.25, sz: 30, sp: -20 });
    expect(m).toContain('<mn>2.000</mn>');
    expect(m).toContain('<mn>50.00</mn>');
    expect(mnum(1.5e-7)).toContain('<mn>1.500</mn>');
    expect(mnum(1.5e-7)).toContain('<mn>−7</mn>');
  });
});

describe('最大の利得と k', () => {
  it('共振器の最大を細かく求める（総当たりと比べる）', () => {
    const p = ids([pp(0.999, 30)]),
      pk = peak(p);
    let best = -Infinity;
    for (let i = 0; i <= 200000; i++) best = Math.max(best, at(p, (i / 200000) * Math.PI).lm);
    expect(pk.lm).toBeGreaterThanOrEqual(best - 1e-9);
    expect(pk.w).toBeCloseTo(30 * D, 3);
  });
  it('単位円の上の極では最大は ∞ で、最大を 0 dB にする k は決められない', () => {
    const p = ids([pp(1, 60)]);
    expect(peak(p).lm).toBe(Infinity);
    expect(gainOf(p, 'peak')).toEqual({ k: 1, ok: false });
  });
  it('最大を 0 dB・直流を 0 dB にする k', () => {
    const p = preset('res'),
      k = gainOf(p, 'peak').k;
    expect(Math.log(k) + peak(p).lm).toBeCloseTo(0, 12);
    const m = preset('ma');
    expect(gainOf(m, 'dc').k).toBeCloseTo(1 / 8, 12);
    expect(gainOf(preset('dc'), 'dc').ok).toBe(false);
    expect(gainOf(m, 'one')).toEqual({ k: 1, ok: true });
  });
});

describe('安定判定', () => {
  it('極の最大の半径で決める', () => {
    expect(stability(ids([pp(0.99, 10)])).s).toBe('stable');
    expect(stability(ids([pp(1, 10)])).s).toBe('marginal');
    expect(stability(ids([pp(1.01, 10), zz(2, 50)])).s).toBe('unstable');
    expect(stability(ids([zz(3, 10)]))).toEqual({ s: 'stable', rmax: 0 });
  });
});

describe('双2次の縦続', () => {
  const cases: [string, Pt[]][] = [
    ['notch', preset('notch')],
    ['lpf', preset('lpf')],
    ['comb', preset('comb')],
    ['ma', preset('ma')],
    [
      'mix',
      ids([
        pp(0.9, 30),
        { k: 'p', re: 0.5, im: 0 },
        zz(1, 150),
        { k: 'z', re: 0.2, im: 0 },
        { k: 'z', re: -1, im: 0 },
        zz(0.5, 80),
      ]),
    ],
    ['none', []],
  ];
  it('段を掛け合わせると元の多項式になり、段の数は ⌈max(M, N) / 2⌉', () => {
    for (const [, p] of cases) {
      const k = 0.37,
        S = sos(p, k),
        sp = sosPoly(S),
        c = coefs(p, k),
        n = Math.max(order(p, 'p'), order(p, 'z'));
      expect(S.length).toBe(Math.max(1, Math.ceil(n / 2)));
      for (const s of S) expect(s.a[0]).toBe(1);
      const pad = (x: number[], m: number) => [...x, ...Array(Math.max(0, m - x.length)).fill(0)];
      const L = Math.max(sp.b.length, c.b.length),
        La = Math.max(sp.a.length, c.a.length);
      close(pad(sp.b, L), pad(c.b, L), 1e-10);
      close(pad(sp.a, La), pad(c.a, La), 1e-10);
    }
  });
  it('ノッチは 1 段に零点の対と極の対を組む', () => {
    const [s] = sos(preset('notch'), 1),
      c = Math.cos(45 * D);
    close(s.b, [1, -2 * c, 1]);
    close(s.a, [1, -2 * 0.95 * c, 0.9025]);
  });
  it('極が単位円に近い段を後ろにし、近い零点と組む', () => {
    const S = sos(ids([pp(0.5, 20), pp(0.98, 120), zz(1, 125), zz(1, 25)]), 1);
    expect(S[1].a[2]).toBeCloseTo(0.98 ** 2, 12);
    expect(S[1].b[1]).toBeCloseTo(-2 * Math.cos(125 * D), 12);
    expect(S[0].b[1]).toBeCloseTo(-2 * Math.cos(25 * D), 12);
  });
});

describe('インパルス応答', () => {
  it('2 次の共振器は h[n] = rⁿ sin((n + 1)θ) / sin θ', () => {
    const r = 0.9,
      th = 50 * D,
      h = impulse(sos(ids([pp(r, 50)]), 1), 40);
    for (let n = 0; n < 40; n++) expect(h[n]).toBeCloseTo((r ** n * Math.sin((n + 1) * th)) / Math.sin(th), 12);
  });
  it('移動平均（k = 1/8）は 8 サンプルだけ 1/8', () => {
    const h = impulse(sos(preset('ma'), 1 / 8), 12);
    for (let n = 0; n < 12; n++) expect(h[n]).toBeCloseTo(n < 8 ? 1 / 8 : 0, 12);
  });
  it('発散しても有限の値で頭打ちにする', () => {
    const h = impulse(sos(ids([pp(4, 30)]), 1), 600);
    expect(h.every(Number.isFinite)).toBe(true);
  });
});

describe('極の共振', () => {
  it('アナログの 2 次系の極 s を z = e^{s/fs} に移すと Q と周波数が戻る', () => {
    const fs = 48e3,
      Q = 5,
      wn = 2 * Math.PI * 1000,
      sr = -wn / (2 * Q),
      si = wn * Math.sqrt(1 - 1 / (4 * Q * Q)),
      p = { k: 'p' as const, re: Math.exp(sr / fs) * Math.cos(si / fs), im: Math.exp(sr / fs) * Math.sin(si / fs) },
      r = resOf(p, fs);
    expect(r.q).toBeCloseTo(Q, 9);
    expect(r.f).toBeCloseTo(si / (2 * Math.PI), 6);
    expect(r.tau).toBeCloseTo(-1 / sr, 9);
  });
  it('実軸の極は Q なし、単位円の上は ∞', () => {
    expect(resOf({ k: 'p', re: 0.5, im: 0 }, 48e3).q).toBeNaN();
    expect(resOf(pp(1, 30), 48e3).q).toBe(Infinity);
    expect(resOf(pp(1, 30), 48e3).tau).toBe(Infinity);
  });
});

describe('点の位置と図', () => {
  it('polar は 0° と 180° を実軸の 1 個にする', () => {
    expect(polar('p', 0.5, Math.PI)).toEqual({ k: 'p', re: -0.5, im: 0 });
    expect(polar('z', 1, 0)).toEqual({ k: 'z', re: 1, im: 0 });
  });
  it('足す点はほかの点から離す', () => {
    const s = freeSpot(preset('notch'), 'p');
    expect(Math.hypot(s.re, s.im)).toBeCloseTo(0.5, 12);
    expect(freeSpot([s, ...preset('notch')], 'z')).not.toEqual(s);
  });
  it('表示の範囲は点がすべて入るもの', () => {
    expect(viewOf(preset('notch'))).toBe(1.5);
    expect(viewOf(preset('ap'))).toBe(1.5);
    expect(viewOf(ids([zz(2, 10)]))).toBe(2.5);
    expect(viewOf(ids([zz(4, 10)]))).toBe(4.5);
    const P = plane(1.5);
    expect(P.re(P.x(0.7))).toBeCloseTo(0.7, 12);
    expect(P.im(P.y(-0.3))).toBeCloseTo(-0.3, 12);
  });
  it('点の名前は極と零点で別に数え、原点に足した根を描く', () => {
    const p = preset('notch'),
      lab = labels(p);
    expect([...lab.values()]).toEqual(['z1', 'p1']);
    expect(planePts(plane(1.5), p, p[0].id)).toContain('class="psel"');
    expect(planePts(plane(1.5), preset('res'), null)).toContain('zz imp');
    expect(planeCursor(plane(1.5), preset('res'), 1).lines.match(/<path/g)?.length).toBe(3);
  });
  it('周波数特性の図は線形・対数の横軸と、位相・群遅延の CH2 を描く', () => {
    const p = preset('res');
    for (const lin of [true, false])
      for (const ch2 of ['ph', 'gd'] as const) {
        const ax = frAxis(lin, 48e3),
          ws = frWs(ax, 201),
          f = frPlot({ ax, ws, c: curves(p, ws, 1), bot: -60, ch2 });
        expect(ws[200]).toBe(Math.PI);
        expect(ax.W(ax.X(1))).toBeCloseTo(1, 12);
        expect(f.mag.startsWith('M')).toBe(true);
        expect(f.ch2.startsWith('M')).toBe(true);
        expect(f.dv).toBeGreaterThan(0);
      }
  });
});

describe('入力の定義', () => {
  it('プリセットの名前は重ならず、点の数は上限以内', () => {
    expect(new Set(PRESETS.map((p) => p.v)).size).toBe(PRESETS.length);
    for (const p of PRESETS) {
      const s = p.pts();
      expect(order(s, 'p')).toBeLessThanOrEqual(24);
      expect(order(s, 'z')).toBeLessThanOrEqual(24);
    }
  });
  it('半径の並びは小さい順で 0 と 1 を含み、範囲外は丸める', () => {
    const d = SEL[0],
      L = valueList(d, 12);
    expect(L).toEqual([...L].sort((a, b) => a - b));
    expect(L).toContain(0);
    expect(L).toContain(1);
    expect(resolve(d, L, formatter(d), 5).w).toBe(4);
  });
  it('角度は 0 … 180°', () => {
    const d = SEL[1];
    expect(resolve(d, valueList(d, 12), formatter(d), 200)).toMatchObject({ w: 180 });
    expect(PARAMS.find((x) => x.k === 'vol')?.v).toBe(-30);
  });
});
