import { describe, expect, it } from 'vitest';
import { FB, fromDec, fromFix, toFix } from '../src/tools/mandelbrot/fixed';
import { famOf, type Formula, isInt, maxIter, nu, q1024 } from '../src/tools/mandelbrot/formula';
import { orbit } from '../src/tools/mandelbrot/orbit';

const F = (o: Partial<Formula> = {}): Formula => ({ p: 2, pre: 0, post: 0, conj: false, ...o });

/** 倍精度で直接くり返した軌道 */
function direct(cr: number, ci: number, f: Formula, n: number): [number, number][] {
  const out: [number, number][] = [[0, 0]];
  let x = 0,
    y = 0;
  for (let k = 0; k < n; k++) {
    const a = x + f.pre * (Math.abs(x) - x),
      b = (y + f.pre * (Math.abs(y) - y)) * (f.conj ? -1 : 1);
    let wr = a,
      wi = b;
    for (let j = 1; j < f.p; j++) [wr, wi] = [wr * a - wi * b, wr * b + wi * a];
    wr += f.post * (Math.abs(wr) - wr);
    x = wr + cr;
    y = wi + ci;
    out.push([x, y]);
  }
  return out;
}

describe('固定小数点', () => {
  it('10 進の文字列と倍精度から同じ値になる', () => {
    expect(fromDec('-0.75')).toBe(toFix(-0.75));
    expect(fromDec('1')).toBe(1n << FB);
    expect(fromDec('0')).toBe(0n);
  });
  it('倍精度へ戻すと元の値', () => {
    for (const v of [0.3, -1.75, 1e-30, -3.2e-25, 2]) expect(fromFix(toFix(v)) / v).toBeCloseTo(1, 12);
  });
});

describe('式', () => {
  it('種類は混ぜる量と共役だけで決まる', () => {
    expect(famOf(F())).toBe('m');
    expect(famOf(F({ p: 3, pre: 1 }))).toBe('bs');
    expect(famOf(F({ conj: true }))).toBe('tc');
    expect(famOf(F({ post: 1 }))).toBe('ce');
    expect(famOf(F({ pre: 1, post: 1 }))).toBe('bu');
    expect(famOf(F({ pre: 0.5 }))).toBeNull();
  });
  it('混ぜる量は 1/1024 刻み、べきの整数の判定', () => {
    expect(q1024(0.30001)).toBe(307 / 1024);
    expect(isInt(3)).toBe(true);
    expect(isInt(2.5)).toBe(false);
  });
  it('反復の上限は倍率から', () => {
    expect(maxIter(1)).toBe(200);
    expect(maxIter(0.5)).toBe(200);
    expect(maxIter(1e29)).toBe(27170);
    expect(maxIter(1e60)).toBe(60000);
  });
  it('発散の速さは |z_k| = R で整数になり、内側は N + 1', () => {
    expect(nu(0, 0, F(), 50, 1000)).toBe(51);
    const v = nu(1, 0, F(), 50, 1000);
    expect(v).toBeGreaterThan(1);
    expect(v).toBeLessThan(7);
  });
});

describe('基準の軌道', () => {
  const cases: [string, Formula][] = [
    ['マンデルブロ', F()],
    ['べき 3', F({ p: 3 })],
    ['バーニングシップ', F({ pre: 1 })],
    ['トリコーン', F({ conj: true })],
    ['セルティック', F({ post: 1 })],
    ['混ぜた途中', F({ pre: q1024(0.3), post: q1024(0.6) })],
  ];
  for (const [name, f] of cases)
    it(`${name}: 倍精度の直接計算と合う`, () => {
      const cr = -0.1,
        ci = 0.65,
        o = orbit(toFix(cr), toFix(ci), f, 40),
        d = direct(cr, ci, f, 40);
      for (let k = 0; k < Math.min(o.len, 30); k++) {
        /* 単精度の列なので相対誤差で比べる */
        for (const j of [0, 1]) {
          const want = d[k][j];
          expect(Math.abs(o.data[2 * k + j] - want), `${k}`).toBeLessThan(1e-6 * Math.max(1, Math.abs(want)));
        }
      }
    });
  it('発散しない点は最後まで、発散する点は早く止まる', () => {
    expect(orbit(0n, fromDec('1'), F(), 500).len).toBe(501);
    expect(orbit(fromDec('1'), 0n, F(), 500).len).toBeLessThan(10);
  });
});
