import { describe, expect, it } from 'vitest';
import { bands, dbfs, fitSlope, hist, psdOffset, stats, Welch } from '../src/tools/noise/analysis';
import { energy, type Filtered, grayTarget, makeFilt, resp } from '../src/tools/noise/color';
import {
  type Cfg,
  design,
  Gen,
  idealDb,
  type Kind,
  LEVEL_DB,
  psdDb,
  RMS,
  slopeOf,
  VOSS_ROWS,
} from '../src/tools/noise/gen';
import {
  cycle,
  expOfBit,
  expsOf,
  full,
  type LfsrCfg,
  lockState,
  orderOfX,
  PRESETS,
  periodOf,
  polyOf,
  primitive,
  stepper,
  TAPS,
  tableExps,
  tapBits,
} from '../src/tools/noise/lfsr';
import { Rng } from '../src/tools/noise/rng';

const FS = 48000;
const OCT = 10 * Math.log10(2);
const L = (n: number, exps: number, o: Partial<LfsrCfg> = {}): LfsrCfg => ({
  n,
  exps,
  form: 'fib',
  xnor: false,
  init: 1,
  ...o,
});
const cfg = (kind: Kind, o: Partial<Cfg> = {}): Cfg => ({
  kind,
  pm: 'kellett',
  den: 2000,
  lfsr: PRESETS[0].c,
  clk: PRESETS[0].clk,
  ...o,
});
/** 輪のバッファ（2 の累乗）に n 点作る */
function render(c: Cfg, n: number, seed = 1): Float32Array {
  const x = new Float32Array(n);
  new Gen(design(c, FS), seed).fill(x);
  return x;
}
/** dB の最大と最小の差の半分（log 周波数で 20 Hz〜20 kHz） */
function ripple(fn: (f: number) => number, slope: number, f0 = 20, f1 = 20000): number {
  let mx = -1e9,
    mn = 1e9;
  for (let i = 0; i <= 2000; i++) {
    const f = f0 * (f1 / f0) ** (i / 2000),
      y = fn(f) - slope * Math.log2(f);
    mx = Math.max(mx, y);
    mn = Math.min(mn, y);
  }
  return (mx - mn) / 2;
}
const db = (v: number) => 10 * Math.log10(v);

describe('乱数', () => {
  it('種が同じなら同じ並び、一様分布と正規分布の平均と分散', () => {
    const a = new Rng(7),
      b = new Rng(7);
    for (let i = 0; i < 10; i++) expect(a.u32()).toBe(b.u32());
    const r = new Rng(3),
      n = 200000;
    let s = 0,
      s2 = 0,
      g1 = 0,
      g2 = 0,
      g4 = 0;
    for (let i = 0; i < n; i++) {
      const u = r.uni();
      s += u;
      s2 += u * u;
      const g = r.gauss();
      g1 += g;
      g2 += g * g;
      g4 += g ** 4;
    }
    expect(s / n).toBeCloseTo(0.5, 2);
    expect(s2 / n - (s / n) ** 2).toBeCloseTo(1 / 12, 3);
    expect(g1 / n).toBeCloseTo(0, 2);
    expect(g2 / n).toBeCloseTo(1, 1);
    expect(g4 / n / (g2 / n) ** 2).toBeCloseTo(3, 1);
  });
});

describe('LFSR', () => {
  it('表のタップ（XAPP052）は、2〜20 ビットで総当たりの周期が 2ⁿ−1（フィボナッチ形とガロア形）', () => {
    for (let n = 2; n <= 20; n++)
      for (const form of ['fib', 'gal'] as const)
        expect(cycle(L(n, tableExps(n), { form }), 2 ** n)?.period, `n=${n} ${form}`).toBe(2 ** n - 1);
  });
  it('表の多項式は 2〜32 ビットのすべてで原始多項式', () => {
    for (let n = 2; n <= 32; n++) expect(primitive(polyOf({ n, exps: tableExps(n) })), `n=${n}`).toBe(true);
    expect(Object.keys(TAPS)).toHaveLength(31);
  });
  it('32 ビットの表のタップは、多項式の位数から周期 2³²−1', () => {
    const p = periodOf(L(32, tableExps(32)));
    expect(p.period).toBe(2 ** 32 - 1);
    expect(p.prim).toBe(true);
  });
  it('既約で原始でない多項式は、x の位数で周期が決まる（x⁴ + x³ + x² + x + 1 は 5）', () => {
    const c = L(4, expsOf([3, 2, 1]));
    expect(orderOfX(polyOf(c))).toBe(5);
    expect(cycle(c, 16)?.period).toBe(5);
    expect(primitive(polyOf(c))).toBe(false);
    /* 既約でない（x⁴ + 1 = (x + 1)⁴） */
    expect(orderOfX(polyOf(L(4, 0)))).toBeNull();
  });
  it('NES: 長周期 32767、短周期は初期値 1 から 93 ステップ、ほかに 31 ステップの輪', () => {
    const [nes, nes93] = PRESETS;
    expect(periodOf(nes.c).period).toBe(32767);
    expect(periodOf(nes93.c).period).toBe(93);
    const sizes = new Map<number, number>();
    for (let s = 1; s < 1 << 15; s++) {
      const p = cycle({ ...nes93.c, init: s }, 1 << 15)?.period ?? 0;
      sizes.set(p, (sizes.get(p) ?? 0) + 1);
    }
    expect([...sizes].sort((a, b) => a[0] - b[0])).toEqual([
      [31, 31],
      [93, 32736],
    ]);
  });
  it('ゲームボーイ（XNOR）は 32767 と 127、SN76489 は 32767、セガの VDP は 57337、周期ノイズは 15', () => {
    const per = (v: string) => periodOf(PRESETS.find((p) => p.v === v)?.c ?? L(2, 0)).period;
    expect(per('gb15')).toBe(32767);
    expect(per('gb7')).toBe(127);
    expect(per('sn')).toBe(32767);
    expect(per('sega')).toBe(57337);
    expect(per('snp')).toBe(15);
  });
  it('XNOR の止まった状態はすべて 1、XOR はすべて 0。止まった状態から始めると周期 1', () => {
    for (const form of ['fib', 'gal'] as const)
      for (const xnor of [false, true]) {
        const c = L(9, tableExps(9), { form, xnor });
        const s = lockState(c);
        expect(stepper(c)(s)).toBe(s);
        expect(periodOf({ ...c, init: s })).toMatchObject({ period: 1, locked: true });
        expect(periodOf({ ...c, init: s ^ 1 }).period).toBe(511);
      }
  });
  it('XNOR は、XOR を反転した状態で動かしたものの反転', () => {
    for (const form of ['fib', 'gal'] as const) {
      const a = stepper(L(11, tableExps(11), { form, xnor: true })),
        b = stepper(L(11, tableExps(11), { form }));
      for (let s = 0; s < 2048; s += 37) expect(a(s)).toBe(~b(~s & full(11)) & full(11));
    }
  });
  it('同じ多項式なら、フィボナッチ形とガロア形の周期の分布は同じ', () => {
    for (let ex = 0; ex < 1 << 7; ex += 2) {
      const dist = (form: 'fib' | 'gal') => {
        const m = new Map<number, number>();
        for (let s = 0; s < 256; s++) {
          const p = cycle(L(8, ex, { form, init: s }), 256)?.period ?? 0;
          m.set(p, (m.get(p) ?? 0) + 1);
        }
        return [...m].sort((a, b) => a[0] - b[0]);
      };
      expect(dist('gal'), `exps=${ex}`).toEqual(dist('fib'));
    }
  });
  it('図のビットと多項式の項: フィボナッチはビット e、ガロアはビット e−1', () => {
    const f = L(15, expsOf([1])),
      g = { ...f, form: 'gal' as const };
    expect(tapBits(f)).toBe(0b11);
    expect(tapBits(g)).toBe((1 << 14) | 1);
    expect(expOfBit(f, 1)).toBe(1);
    expect(expOfBit(f, 0)).toBe(0);
    expect(expOfBit(g, 0)).toBe(1);
    expect(expOfBit(g, 14)).toBe(0);
  });
  it('周期の出力の平均: 最大周期の列は 1 が 1 つ多い（−1/P）、周期ノイズは 13/15', () => {
    expect(periodOf(L(5, tableExps(5))).mean).toBeCloseTo(-1 / 31, 12);
    expect(periodOf(PRESETS[6].c).mean).toBeCloseTo(13 / 15, 12);
  });
});

describe('色のフィルタ', () => {
  it('Kellett のピンクは 20 Hz〜20 kHz で 1/f から ±0.05 dB 以内（48 kHz）', () => {
    expect(ripple((f) => db(resp('pink', f, FS)), -OCT)).toBeLessThan(0.05);
  });
  it('ブラウン・ブルー・バイオレットは 20 Hz〜20 kHz で理想の傾きから ±0.2 dB 以内', () => {
    expect(ripple((f) => db(resp('brown', f, FS)), -2 * OCT)).toBeLessThan(0.2);
    expect(ripple((f) => db(resp('blue', f, FS)), OCT)).toBeLessThan(0.2);
    expect(ripple((f) => db(resp('violet', f, FS)), 2 * OCT)).toBeLessThan(0.2);
  });
  it('グレーは 20 Hz〜20 kHz で、A 特性の逆数 × 20 Hz の 4 次の高域通過から ±0.05 dB 以内（48 kHz・44.1 kHz）', () => {
    for (const fs of [48000, 44100])
      expect(ripple((f) => db(resp('gray', f, fs)) - 20 * Math.log10(grayTarget(f)), 0, 20, 20000)).toBeLessThan(0.05);
  });
  it('グレーの目標は 1 kHz に対して 20 Hz で +47 dB、10 kHz で +2.5 dB', () => {
    const r = (f: number) => 20 * Math.log10(grayTarget(f) / grayTarget(1000));
    expect(r(20)).toBeCloseTo(47.4, 1);
    expect(r(10000)).toBeCloseTo(2.5, 1);
  });
  it('インパルス応答のエネルギーは、白色雑音を通した出力の分散', () => {
    for (const k of ['pink', 'brown', 'blue', 'violet', 'gray'] as Filtered[]) {
      const f = makeFilt(k, FS),
        r = new Rng(5),
        n = 1 << 18;
      let s2 = 0;
      for (let i = 0; i < 40000; i++) f.step(r.gauss());
      for (let i = 0; i < n; i++) s2 += f.step(r.gauss()) ** 2;
      expect(db(s2 / n / energy(k, FS)), k).toBeCloseTo(0, 0);
    }
  });
});

describe('生成器', () => {
  const N = 1 << 20;
  const KINDS: Kind[] = ['wu', 'wg', 'pink', 'brown', 'blue', 'violet', 'gray', 'velvet', 'lfsr'];
  it('どのノイズも実効値は −20 dBFS（AES17）から ±0.3 dB 以内', () => {
    for (const k of KINDS) {
      const x = render(cfg(k), N);
      expect(Math.abs(dbfs(Math.SQRT2 * stats(x, N, N).rms) - LEVEL_DB), k).toBeLessThan(0.3);
    }
    const v = render(cfg('pink', { pm: 'voss' }), N);
    expect(Math.abs(dbfs(Math.SQRT2 * stats(v, N, N).rms) - LEVEL_DB)).toBeLessThan(0.3);
  });
  it('一様分布の白色雑音のピークは実効値の √3 倍、正規分布の尖度は 3', () => {
    const u = stats(render(cfg('wu'), N), N, N);
    expect(u.peak / RMS).toBeLessThanOrEqual(Math.sqrt(3) + 1e-6);
    expect(u.peak / RMS).toBeGreaterThan(Math.sqrt(3) * 0.999);
    expect(u.kurt).toBeCloseTo(1.8, 1);
    expect(stats(render(cfg('wg'), N), N, N).kurt).toBeCloseTo(3, 1);
  });
  it('平均したパワースペクトルの傾きは、目標から ±0.5 dB/oct 以内', () => {
    const B = bands(FS, 8192);
    const slope = (c: Cfg) => {
      const x = render(c, N),
        w = new Welch(8192, 1e9);
      for (let e = 8192; e <= N; e += 4096) w.add(x, e);
      return fitSlope(w.P, B)?.slope ?? Number.NaN;
    };
    for (const k of ['wu', 'wg', 'pink', 'brown', 'blue', 'violet', 'velvet'] as Kind[])
      expect(Math.abs(slope(cfg(k)) - (slopeOf(k) ?? 0)), k).toBeLessThan(0.5);
    expect(Math.abs(slope(cfg('pink', { pm: 'voss' })) + OCT)).toBeLessThan(0.5);
  });
  it('平均したパワースペクトル密度は、理論の値（psdDb）に 1 dB 以内で重なる', () => {
    const N2 = 1 << 19;
    for (const k of ['wg', 'pink', 'brown', 'violet', 'gray', 'velvet'] as Kind[]) {
      const c = cfg(k),
        sp = design(c, FS),
        x = render(c, N2),
        w = new Welch(4096, 1e9),
        off = psdOffset(4096, FS);
      for (let e = 4096; e <= N2; e += 2048) w.add(x, e);
      for (const f of [100, 1000, 10000]) {
        const kk = Math.round((f * 4096) / FS);
        let s = 0,
          t = 0;
        for (let i = kk - 4; i <= kk + 4; i++) {
          s += w.P[i];
          t += 10 ** (psdDb(sp, (i * FS) / 4096) / 10);
        }
        expect(Math.abs(db(s) + off - db(t)), `${k} ${f} Hz`).toBeLessThan(1);
      }
    }
  });
  it('参照線: ピンクは 1 kHz で生成器の値に合い、1 オクターブで −3.01 dB', () => {
    const sp = design(cfg('pink'), FS);
    expect(idealDb(sp, 1000)).toBeCloseTo(psdDb(sp, 1000), 9);
    expect(idealDb(sp, 2000) - idealDb(sp, 1000)).toBeCloseTo(-OCT, 9);
  });
  it('Voss–McCartney は行の数 + 1 の分散を持つ', () => {
    const sp = design(cfg('pink', { pm: 'voss' }), FS);
    expect(sp.g).toBeCloseTo(RMS / Math.sqrt(VOSS_ROWS + 1), 12);
  });
  it('ベルベット: 区間ごとに 1 つの ±g のパルスで、密度を下げすぎるとピークを 1 に抑える', () => {
    const c = cfg('velvet', { den: 1000 }),
      sp = design(c, FS),
      x = render(c, 48000);
    let cnt = 0;
    for (const v of x) {
      if (v !== 0) {
        cnt++;
        expect(Math.abs(Math.abs(v) - sp.g)).toBeLessThan(1e-6);
      }
    }
    expect(cnt).toBe(1000);
    for (let m = 0; m < 1000; m++) {
      let n = 0;
      for (let i = m * 48; i < (m + 1) * 48; i++) if (x[i]) n++;
      expect(n).toBe(1);
    }
    expect(design(cfg('velvet', { den: 100 }), FS).g).toBe(1);
  });
  it('LFSR: クロックの整数倍で零（sinc² の包絡）', () => {
    const c = cfg('lfsr', { lfsr: L(15, tableExps(15)), clk: 6000 }),
      x = render(c, N),
      w = new Welch(8192, 1e9);
    for (let e = 8192; e <= N; e += 4096) w.add(x, e);
    const at = (f: number) => {
      const k = Math.round((f * 8192) / FS);
      return db((w.P[k - 1] + w.P[k] + w.P[k + 1]) / 3);
    };
    expect(at(1000) - at(6000)).toBeGreaterThan(25);
    expect(at(1000) - at(12000)).toBeGreaterThan(25);
    expect(at(1000) - at(3000)).toBeLessThan(5);
  });
  it('LFSR の短い周期は線スペクトル: NES の 93 ステップを 8718.75 Hz で回すと 93.75 Hz おき', () => {
    /* 1 周期がちょうど 512 標本。32768 点の変換では 64 bin おき */
    const c = cfg('lfsr', { lfsr: PRESETS[1].c, clk: 8718.75 }),
      x = render(c, 1 << 18),
      w = new Welch(32768, 1e9);
    for (let e = w.N; e <= x.length; e += w.N / 2) w.add(x, e);
    /* 線の bin に、ほかの bin より 30 dB 以上大きい山 */
    let on = 0,
      off = 0;
    for (let k = 64; k < 64 * 40; k++) {
      if (k % 64 === 0) on += w.P[k];
      else if (k % 64 > 3 && k % 64 < 61) off += w.P[k];
    }
    expect(db(on / 39) - db(off / (39 * 57))).toBeGreaterThan(30);
  });
  it('LFSR: 止まった状態からは無音', () => {
    const c = cfg('lfsr', { lfsr: L(8, tableExps(8), { init: 0 }), clk: 1000 }),
      sp = design(c, FS);
    expect(sp.locked).toBe(true);
    expect(sp.g).toBe(0);
    expect(stats(render(c, 4096), 4096, 4096).peak).toBe(0);
  });
  it('LFSR: クロックが標本化周波数より速くても実効値をそろえる', () => {
    const c = cfg('lfsr', { lfsr: L(23, tableExps(23)), clk: 447000 }),
      x = render(c, N);
    expect(Math.abs(dbfs(Math.SQRT2 * stats(x, N, N).rms) - LEVEL_DB)).toBeLessThan(0.3);
  });
});

describe('解析', () => {
  it('1/3 オクターブ帯は 25 Hz〜20 kHz、bin のない帯は除く', () => {
    const B = bands(FS, 8192);
    expect(B[0].fc).toBeCloseTo(25.1, 1);
    expect(B[B.length - 1].fc).toBeCloseTo(19953, 0);
    /* 512 点（Δf = 93.75 Hz）では 100 Hz の帯から */
    expect(bands(FS, 512)[0].fc).toBeCloseTo(100, 6);
  });
  it('分布は確率密度（範囲の中の和 × 幅 = 1）', () => {
    const n = 1 << 16,
      x = render(cfg('wu'), n),
      h = hist(x, n, n, 0.25, 50);
    expect(h.reduce((a, b) => a + b, 0) * (0.5 / 50)).toBeCloseTo(1, 6);
  });
});
