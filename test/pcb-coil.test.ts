import { describe, expect, it } from 'vitest';
import { formatter, resolve, valueList } from '../src/lib/param-core';
import {
  ac,
  C0,
  calc,
  dIn,
  fRes,
  fSkin,
  fTenth,
  MU0,
  NMAX,
  nearE24,
  nGeo,
  nMax,
  polyLen,
  RHO_CU,
  type ShapeId,
  shapeOf,
  spiral,
} from '../src/tools/pcb-coil/coil';
import { dropDb, qMax, search } from '../src/tools/pcb-coil/design';
import { calcStack, EPS0, ER_FR4, ellipKE, layerDist, loopM, stackFor, stackOf } from '../src/tools/pcb-coil/layers';
import { doutPatch, fmtF, nPatch, PARAMS, roF, wPatch } from '../src/tools/pcb-coil/params';
import {
  coil3d,
  divOf,
  figPlot,
  frPlot,
  frRead,
  LX,
  layerPaths,
  symAxis,
  thickScale,
} from '../src/tools/pcb-coil/plot';

/** 相対誤差 */
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

/* 期待値は画面案の JS（calc・ac・nearE24・nGeo）で求めたもの。長さは mm、厚さは µm、結果は SI 単位 */
const MOCK: {
  in: [ShapeId, number, number, number, number, number, number];
  r: Record<string, number>;
  e24: number;
  nGeo: number;
}[] = [
  {
    in: ['sq', 5, 40, 0.5, 0.5, 35, 13.56e6],
    r: {
      din: 0.031000000000000003,
      rho: 0.12676056338028163,
      L: 0.000001995625387247142,
      Lmw: 0.0000019351456118203386,
      Lmn: 0.000002128234060054863,
      len: 0.709,
      rdc: 0.6985068,
      dl: 0.000017946159060973882,
      teff: 0.00001539359576693115,
      rac: 1.5881759122530128,
      q: 107.05820888229701,
      c: 6.903063431066273e-11,
      bw: 126660.06784130182,
    },
    e24: 6.8e-11,
    nGeo: 20,
  },
  {
    in: ['hex', 8, 30, 0.3, 0.2, 18, 6.78e6],
    r: {
      din: 0.0224,
      rho: 0.14503816793893126,
      L: 0.0000031423681609123026,
      Lmw: 0.0000031592444863620413,
      Lmn: 0.000003337978324538588,
      len: 0.7254983482636834,
      rdc: 2.3163550041507714,
      dl: 0.00002537970153653407,
      teff: 0.00001289228445423274,
      rac: 3.2340575654165744,
      q: 41.39223547514758,
      c: 1.7535728377306045e-10,
      bw: 163798.83623513876,
    },
    e24: 1.8e-10,
    nGeo: 30,
  },
  {
    in: ['oct', 3, 50, 1, 0.5, 70, 125e3],
    r: {
      din: 0.042,
      rho: 0.08695652173913043,
      L: 9.107974681105205e-7,
      Lmw: 8.944458716740843e-7,
      Lmn: 9.600904112210074e-7,
      len: 0.4551704525163373,
      rdc: 0.11210848245477388,
      dl: 0.00018691594507834732,
      teff: 0.000058386356530288744,
      rac: 0.13440800622253454,
      q: 5.3221432173964995,
      c: 0.000001779911555573942,
      bw: 23486.778708136277,
    },
    e24: 1.8e-6,
    nGeo: 16,
  },
  {
    in: ['cir', 10, 60, 0.4, 0.3, 35, 13.56e6],
    r: {
      din: 0.046599999999999996,
      rho: 0.125703564727955,
      L: 0.000009970291530186811,
      Lmw: NaN,
      Lmn: NaN,
      len: 1.6524087523155326,
      rdc: 2.0349413784765784,
      dl: 0.000017946159060973882,
      teff: 0.00001539359576693115,
      rac: 4.626790863229168,
      q: 183.59783084025764,
      c: 1.3816976756501225e-11,
      bw: 73857.08174187582,
    },
    e24: 1.3e-11,
    nGeo: 43,
  },
  {
    in: ['sq', 1, 10, 0.2, 0.2, 12, 27.12e6],
    r: {
      din: 0.009600000000000001,
      rho: 0.02040816326530609,
      L: 3.615285720161954e-8,
      Lmw: 2.7285852257357603e-8,
      Lmn: 3.476764599258999e-8,
      len: 0.0388,
      rdc: 0.2787295,
      dl: 0.000012689850768267035,
      teff: 0.000007760708830230269,
      rac: 0.43098563200453915,
      q: 14.293855494433108,
      c: 9.526168675954675e-10,
      bw: 1897318.747245078,
    },
    e24: 9.1e-10,
    nGeo: 12,
  },
  {
    in: ['cir', 2, 5, 0.15, 0.15, 105, 1e3],
    r: {
      din: 0.0041,
      rho: 0.09890109890109887,
      L: 3.677340808305595e-8,
      Lmw: NaN,
      Lmn: NaN,
      len: 0.02670896524670089,
      rdc: 0.029237413956721907,
      dl: 0.0020897837963690094,
      teff: 0.00010240579671337432,
      rac: 0.029978073155841816,
      q: 0.007707437905072652,
      c: 0.6888210049330692,
      bw: 129744.80136153282,
    },
    e24: 0.68,
    nGeo: 8,
  },
];

describe('calc（画面案と同じ値）', () => {
  it.each(MOCK.map((m) => [m.in.join(' '), m] as const))('%s', (_, m) => {
    const [sh, n, dout, w, s, t, f] = m.in;
    const r = calc(shapeOf(sh), { n, dout, w, s, t }, f);
    for (const [k, v] of Object.entries(m.r)) {
      const x = r[k as keyof typeof r] as number;
      if (Number.isNaN(v)) expect(x, k).toBeNaN();
      else expect(rel(x, v), k).toBeLessThan(1e-12);
    }
    expect(nearE24(r.c)).toBe(m.e24);
    expect(nGeo(dout, w, s)).toBe(m.nGeo);
  });
});

/*
 * Mohan らの表 IV の測定値との比較。表の誤差は e = (L_meas − L_式) / L_式 [%] で、
 * 巻数が整数の行のうち、表の値から式の値を 0.5 ポイント以内で再現できるもの（L_meas の丸めの範囲）を使う。
 * ほかの整数の行も多くは 1 ポイント以内だが、内径の扱いが論文と違うとみられる行（#33・#34・#52）は最大 4 ポイント離れる
 */
const TABLE4: [number, 'sq' | 'oct', number, number, number, number, number, number, number, number][] = [
  // [#, 形, n, dout µm, w, s, L_meas nH, e_mw, e_gmd, e_mon]
  [16, 'sq', 12, 180, 3.2, 2.1, 20.5, -1.0, -0.4, 3.9],
  [22, 'sq', 8, 226, 6.0, 6.0, 9.0, -1.0, -1.4, 0.7],
  [27, 'sq', 5, 300, 24.0, 4.0, 3.5, -5.2, -7.3, -1.6],
  [29, 'sq', 16, 300, 5.0, 4.0, 34.0, -4.2, -6.9, 1.6],
  [32, 'sq', 4, 300, 14.0, 4.0, 5.8, -4.4, -3.2, -2.6],
  [36, 'sq', 5, 154, 7.0, 5.0, 3.0, 3.9, 4.3, 5.8],
  [37, 'sq', 9, 250, 7.0, 5.0, 12.0, 0.2, -0.5, 3.7],
  [51, 'sq', 3, 700, 90.0, 6.0, 3.7, -4.9, -5.4, -6.7],
  [55, 'oct', 4, 346, 18.0, 2.0, 5.9, -1.1, -1.6, -3.6],
  [56, 'oct', 5, 346, 18.0, 2.0, 7.5, 2.7, 0.7, 0.3],
  [58, 'oct', 5, 326, 8.0, 12.0, 7.2, -1.0, -2.8, -5.6],
];

describe('Mohan らの表 IV', () => {
  it.each(TABLE4)('#%i', (_, sh, n, d, w, s, Lm, eMw, eGmd, eMon) => {
    const r = calc(shapeOf(sh), { n, dout: d / 1000, w: w / 1000, s: s / 1000, t: 1 }, 1e6);
    const e = (L: number) => ((Lm - L * 1e9) / (L * 1e9)) * 100;
    expect(Math.abs(e(r.Lmw) - eMw)).toBeLessThan(0.5);
    expect(Math.abs(e(r.L) - eGmd)).toBeLessThan(0.5);
    expect(Math.abs(e(r.Lmn) - eMon)).toBeLessThan(0.5);
  });
});

describe('形', () => {
  it('内径と巻数の上限', () => {
    expect(dIn(5, 40, 0.5, 0.5)).toBe(31);
    /* 20 巻で内径 1 mm、21 巻で −1 mm */
    expect(nGeo(40, 0.5, 0.5)).toBe(20);
    expect(nMax(40, 0.5, 0.5)).toBe(20);
    expect(nMax(200, 0.05, 0.05)).toBe(NMAX);
    /* 内径がちょうど 0 になる巻数は除く: 10 − 2·2·2 − 2·1·1 = 0 */
    expect(nGeo(10, 2, 1)).toBe(1);
  });

  it('多角形のうずまきの長さ: 辺 j の長さは両隣の辺までの距離の和', () => {
    const a0 = 10,
      p = 1.5;
    /* 1 巻: 3 辺が 2·a0、最後の辺だけ次の周へ p 寄る */
    expect(polyLen(spiral(4, 1, a0, p))).toBeCloseTo(8 * a0 - p, 12);
    const n = 3,
      dj = (j: number) => (j < 0 ? a0 : a0 - Math.floor(j / 4) * p);
    let want = 0;
    for (let j = 0; j < 4 * n; j++) want += dj(j - 1) + dj(j + 1);
    const P = spiral(4, n, a0, p);
    expect(P).toHaveLength(4 * n + 1);
    expect(polyLen(P)).toBeCloseTo(want, 12);
  });

  it('多角形の頂点は辺の面から a0 − ⌊j/k⌋·p の距離にある', () => {
    const k = 6,
      a0 = 20,
      p = 2,
      P = spiral(k, 2, a0, p);
    /* 1 本目の辺（上向き）: 最初の 2 点は y = a0 */
    expect(P[0][1]).toBeCloseTo(a0, 12);
    expect(P[1][1]).toBeCloseTo(a0, 12);
    /* 2 周目の上の辺: y = a0 − p */
    expect(P[k][1]).toBeCloseTo(a0 - p, 12);
    expect(P[k + 1][1]).toBeCloseTo(a0 - p, 12);
  });

  it('円はアルキメデスのらせん（解析的な弧長に近い）', () => {
    const a0 = 20,
      p = 1,
      n = 5,
      b = p / (2 * Math.PI);
    const F = (u: number) => (u * Math.hypot(u, b) + b * b * Math.log(u + Math.hypot(u, b))) / 2;
    const want = (F(a0) - F(a0 - n * p)) / b;
    const P = spiral(0, n, a0, p);
    expect(P).toHaveLength(180 * n + 1);
    expect(Math.hypot(...P[P.length - 1])).toBeCloseTo(a0 - n * p, 12);
    expect(rel(polyLen(P), want)).toBeLessThan(1e-4);
  });
});

describe('交流', () => {
  it('表皮の深さが厚さに等しい周波数と、波長の 1/10', () => {
    const t = 35e-6,
      f = fSkin(t);
    expect(rel(ac(f, 1e-6, 1, 1e-3, t).dl, t)).toBeLessThan(1e-12);
    expect(rel(fTenth(1), C0 / 10)).toBeLessThan(1e-15);
  });

  it('低い周波数では交流抵抗が直流抵抗に近づく（実効厚さ → t）', () => {
    const r = calc(shapeOf('sq'), { n: 5, dout: 40, w: 0.5, s: 0.5, t: 35 }, 1e3);
    expect(rel(r.rac, r.rdc)).toBeLessThan(0.01);
    expect(rel(r.rdc, (RHO_CU * r.len) / (0.5e-3 * 35e-6))).toBeLessThan(1e-12);
  });

  it('共振: C と f、E24 の値', () => {
    const r = MOCK[0].r;
    expect(rel(fRes(r.L, r.c), 13.56e6)).toBeLessThan(1e-12);
    expect(nearE24(4.4e-9)).toBe(4.3e-9);
    expect(nearE24(9.6e-12)).toBe(1e-11);
  });
});

describe('入力の依存', () => {
  const def = (k: string) => {
    const d = PARAMS.find((x) => x.k === k);
    if (!d) throw new Error(k);
    return d;
  };
  const fix = (k: string, patch: object, v: number) => {
    const d = { ...def(k), ...patch },
      L = valueList(d, 12);
    return resolve(d, L, formatter(d), v);
  };

  it('巻数: 整数に丸め、内径が 0 以下になる巻数は上限にする', () => {
    const p = nPatch(40, 0.5, 0.5);
    expect(p.max).toBe(20);
    expect(p.sub).toBe('内径が残るのは 20 巻まで');
    expect(fix('n', p, 5.4)).toEqual({ w: 5, why: '巻数は整数のため 5 巻にしました' });
    expect(fix('n', p, 25)).toEqual({ w: 20, why: '内径が 0 以下になるため 20 巻にしました' });
    expect(fix('n', p, 0.3)).toEqual({ w: 1, why: '下限 1 にしました' });
    expect(nPatch(200, 0.05, 0.05).sub).toBe('1〜60');
    expect(fix('n', nPatch(200, 0.05, 0.05), 70)).toEqual({ w: 60, why: '上限 60 にしました' });
  });

  it('幅: 外径の 1/2 未満', () => {
    const p = wPatch(1.5);
    expect(p.max).toBe(0.75);
    expect(p.list).toEqual([0.05, 0.08, 0.1, 0.12, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6]);
    expect(fix('w', p, 0.8)).toEqual({ w: 0.6, why: '外径の 1/2（0.75 mm）未満にするため 0.6 mm にしました' });
    expect(fix('w', wPatch(40), 12)).toEqual({ w: 10, why: '12 mm は範囲外のため上限 10 mm にしました' });
  });

  it('外径: 幅の 2 倍より大きい', () => {
    const p = doutPatch(2);
    expect((p.list as number[])[0]).toBe(5);
    expect(fix('dout', p, 3)).toEqual({ w: 5, why: '配線の幅の 2 倍（4 mm）より大きくするため 5 mm にしました' });
    expect(fix('dout', p, 250)).toEqual({ w: 200, why: '250 mm は範囲外のため上限 200 mm にしました' });
  });

  it('範囲外の言い回しと表記', () => {
    expect(fix('f', {}, 2e8)).toEqual({ w: 1e8, why: '200 MHz は範囲外のため上限 100 MHz にしました' });
    expect(fix('t', {}, 2)).toEqual({ w: 5, why: '2 µm は範囲外のため下限 5 µm にしました' });
    const f = formatter(def('f'));
    expect(f.input(13.56e6)).toBe('13.56 M');
    expect(f.step(6.78e6)).toBe('6.78M');
    expect(formatter(def('n')).text(5)).toBe('5 巻');
  });

  it('容量は 1 pF 未満を fF で書く', () => {
    expect(fmtF(5.786e-13)).toBe('578.6 fF');
    expect(fmtF(5.6e-13, 3)).toBe('560 fF');
    expect(fmtF(9.99996e-13)).toBe('1 pF');
    expect(fmtF(6.903e-11, 3)).toBe('69 pF');
    expect(roF(1.8e-6)).toBe('1.8<span class="u">μF</span>');
  });
});

describe('表示窓', () => {
  it('縦軸の刻み', () => {
    expect(divOf(100)).toBe(20);
    expect(divOf(115)).toBe(20);
    expect(divOf(116)).toBe(50);
    expect(divOf(0.3)).toBe(0.1);
  });

  it('コイルの形: 外径に合う方眼と寸法線', () => {
    const p = figPlot({ sh: shapeOf('sq'), n: 5, dout: 40, din: 31, w: 0.5, s: 0.5 });
    expect(p.dv).toBe(10);
    expect(p.width).toBe('2.00px');
    expect(p.dim).toContain('40 mm');
    expect(p.dim).toContain('31 mm');
    /* 内径が小さすぎると内径の寸法線を出さない */
    expect(figPlot({ sh: shapeOf('sq'), n: 20, dout: 40, din: 1, w: 0.5, s: 0.5 }).dim).not.toContain('1 mm');
  });

  it('周波数特性: 波長の 1/10 を超える先を破線に分ける', () => {
    const r = calc(shapeOf('cir'), { n: 10, dout: 60, w: 0.4, s: 0.3, t: 35 }, 13.56e6);
    const p = frPlot(r);
    /* 1.65 m → 18.1 MHz から先が破線 */
    expect(p.lambda).toBe(`M${LX(fTenth(r.len)).toFixed(1)} 0V240`);
    expect(p.q.startsWith('M0.0 ')).toBe(true);
    expect(p.qOver).not.toBe('');
    expect(p.label).toContain('より上は配線の長さが波長の 1/10 を超えるため破線');
    expect(frRead(r, null).html).toBe('f <b>13.56 MHz</b> Q <b>184</b> R <b>4.63 Ω</b>');
  });
});

describe('多層', () => {
  const sq = shapeOf('sq'),
    X = { n: 5, dout: 40, w: 0.5, s: 0.5, t: 35 },
    F = 13.56e6;

  it('完全楕円積分と同軸の円形ループの相互インダクタンス', () => {
    const [K, E] = ellipKE(0.5);
    expect(rel(K, 1.685750354812596)).toBeLessThan(1e-12);
    expect(rel(E, 1.467462209339427)).toBeLessThan(1e-12);
    /* 遠く離れたループは磁気双極子の近似 μ0 π a² b² / (2 h³) に近づく */
    expect(rel(loopM(0.01, 0.01, 1), (MU0 * Math.PI * 1e-8) / 2)).toBeLessThan(1e-3);
    expect(rel(loopM(0.01, 0.02, 0.003), loopM(0.02, 0.01, 0.003))).toBeLessThan(1e-12);
  });

  it('1 層は calc と同じ', () => {
    const a = calc(sq, X, F),
      b = calcStack(sq, X, F, stackFor(1), 'ser');
    expect(b.L).toBe(a.L);
    expect(b.rac).toBe(a.rac);
    expect(b.srf).toBe(Infinity);
  });

  it('2 層: 直列は 2(1 + k) 倍、並列は (1 + k)/2 倍、層の間の容量は 1/3', () => {
    const st = stackOf('2-16'),
      s = calcStack(sq, X, F, st, 'ser'),
      p = calcStack(sq, X, F, st, 'par'),
      k = s.k[0];
    expect(k).toBeGreaterThan(0.5);
    expect(k).toBeLessThan(0.95);
    expect(rel(s.L, s.L1 * 2 * (1 + k))).toBeLessThan(1e-12);
    expect(rel(p.L, p.L1 * ((1 + k) / 2))).toBeLessThan(1e-12);
    expect(rel(p.rdc * 4, s.rdc)).toBeLessThan(1e-12);
    const c = (EPS0 * ER_FR4 * 0.5e-3 * s.len1) / 1.53e-3;
    expect(rel(s.cSum, c)).toBeLessThan(1e-12);
    expect(rel(s.cp, c / 3)).toBeLessThan(1e-12);
    expect(p.srf).toBe(Infinity);
  });

  it('層が近いほど結合が強く、層が多いほど L が増える', () => {
    const k = (v: string) => calcStack(sq, X, F, stackOf(v), 'ser').k[0];
    expect(k('2-08')).toBeGreaterThan(k('2-10'));
    expect(k('2-10')).toBeGreaterThan(k('2-16'));
    const l4 = calcStack(sq, X, F, stackOf('4-16'), 'ser');
    expect(l4.L / l4.L1).toBeGreaterThan(10);
    expect(l4.L / l4.L1).toBeLessThan(16);
    expect(layerDist(stackOf('4-16'), 0, 3, 35e-6)).toBeCloseTo((0.21 + 1.07 + 0.21) * 1e-3 + 3 * 35e-6, 12);
  });
});

describe('条件から探す', () => {
  const base = {
    f: 50e3,
    st: stackOf('2-16'),
    conn: 'ser' as const,
    t: 35,
    dmax: 80,
    wmin: 0.2,
    smin: 0.2,
    band: 20,
    rmin: 16,
    rmax: 100,
  };

  it('帯域 ±20 % の両端を −3 dB に収める Q の上限', () => {
    expect(qMax(20)).toBeCloseTo(1 / 0.45, 12);
    expect(dropDb(qMax(20), 0.8)).toBeCloseTo(-10 * Math.log10(2), 12);
    expect(qMax(0)).toBe(Infinity);
  });

  it('条件を満たす候補を磁界の強い順に返す', () => {
    const r = search(base);
    expect(r.length).toBeGreaterThan(3);
    for (let i = 1; i < r.length; i++) expect(r[i].h1).toBeLessThanOrEqual(r[i - 1].h1);
    for (const c of r) {
      expect(c.rTot).toBeGreaterThanOrEqual(16 * (1 - 1e-9));
      expect(c.rTot).toBeLessThanOrEqual(100 * (1 + 1e-9));
      expect(c.q).toBeLessThanOrEqual(qMax(20) * (1 + 1e-9));
      expect(c.w).toBeGreaterThanOrEqual(0.2);
      expect(c.s).toBe(0.2);
    }
    expect(r[0].sh.v).toBe('sq');
    expect(r[0].dout).toBe(80);
    /* 六角形は角が 80 mm に収まる外径 */
    expect(r.find((c) => c.sh.v === 'hex')?.dout).toBe(69.2);
    expect(search({ ...base, rmax: 1 })).toEqual([]);
  });
});

describe('3D', () => {
  const sq = shapeOf('sq'),
    P = spiral(4, 5, 19.75, 1) as [number, number][],
    near = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9;
  /* 符号付き面積（x 右・y 上）: 時計回りは負 */
  const turn = (L: readonly (readonly number[])[]) => {
    let a = 0;
    for (let i = 1; i < L.length; i++) a += L[i - 1][0] * L[i][1] - L[i][0] * L[i - 1][1];
    return a;
  };

  it('直列は前の層の終わりから次の層が始まり、並列は同じ形', () => {
    for (const k of [0, 4]) {
      const L = layerPaths(P, 4, 'ser', k, 1).paths;
      for (let i = 0; i < 3; i++) expect(near(L[i][L[i].length - 1], L[i + 1][0])).toBe(true);
    }
    const Q = layerPaths(P, 2, 'par', 4, 1);
    expect(Q.paths[1]).toEqual(Q.paths[0]);
    expect(Q.vias).toEqual([
      { p: P[0], a: 0, b: 1 },
      { p: P[P.length - 1], a: 0, b: 1 },
    ]);
  });

  it('正方形の鏡映は対称軸で行い、向きが傾かない（辺が軸にそろう）', () => {
    const L = layerPaths(P, 2, 'ser', 4, 1).paths[1];
    /* つなぎの短い線（先頭）を除いた各辺が水平か垂直 */
    for (let i = 2; i < L.length; i++) {
      const dx = Math.abs(L[i][0] - L[i - 1][0]),
        dy = Math.abs(L[i][1] - L[i - 1][1]);
      expect(Math.min(dx, dy)).toBeLessThan(1e-9);
    }
    expect(symAxis(4, [-1, 1])).toBeCloseTo((3 * Math.PI) / 4, 12);
    expect(symAxis(6, [0, 1])).toBeCloseTo(Math.PI / 2, 12);
  });

  it('どの層も表面から見て時計回りに流れる', () => {
    for (const k of [0, 4]) for (const L of layerPaths(P, 6, 'ser', k, 1).paths) expect(turn(L)).toBeLessThan(0);
  });

  it('ビアはほかの巻線・端子と重ならない（1 巻でも）', () => {
    /* 点と線分の距離 */
    const dist = (q: readonly number[], a: readonly number[], b: readonly number[]) => {
      const dx = b[0] - a[0],
        dy = b[1] - a[1],
        t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dy);
    };
    for (const n of [1, 2, 5])
      for (const [k, a0] of [
        [4, 19.75],
        [6, 19.75],
        [8, 19.75],
        [0, 19.75],
      ] as const) {
        const Pn = spiral(k, n, a0, 1) as [number, number][],
          { paths, vias } = layerPaths(Pn, 4, 'ser', k, 1);
        for (const v of vias) {
          /* つなぐ 2 層では、ビアに入る・出る短い線を除いた配線から 0.3 間隔以上離れる */
          for (let i = v.a; i <= v.b; i++) {
            const L = paths[i];
            for (let x = 1; x < L.length; x++) {
              if (near(L[x - 1], v.p) || near(L[x], v.p)) continue;
              expect(dist(v.p, L[x - 1], L[x])).toBeGreaterThan(0.3);
            }
          }
          expect(Math.hypot(v.p[0] - Pn[0][0], v.p[1] - Pn[0][1])).toBeGreaterThan(0.3);
        }
        /* 別のつなぎ目のビアは同じ位置に重ねない */
        for (let x = 1; x < vias.length; x++)
          for (let y = 0; y < x; y++) expect(near(vias[x].p, vias[y].p)).toBe(false);
      }
  });

  it('ビアの数（直列は層の数 − 1、並列は 2）と、回しても変わらない大きさ', () => {
    const d = (st: string, conn: 'ser' | 'par', az = -0.5, el = 0.6) =>
      coil3d({ sh: sq, n: 5, dout: 40, w: 0.5, s: 0.5, st: stackOf(st), conn, az, el, zoom: 1 }).svg;
    const v = (x: string) => (x.match(/class="via"/g) ?? []).length;
    expect(v(d('4-16', 'ser'))).toBe(3);
    expect(v(d('4-16', 'par'))).toBe(2);
    expect(v(d('1', 'ser'))).toBe(0);
    /* ビアの ○ は、つなぐ層ごとに付く（直列 4 層は 3 本 × 2、並列 4 層は 2 本 × 4） */
    expect((d('4-16', 'ser').match(/class="vpad"/g) ?? []).length).toBe(6);
    expect((d('4-16', 'par').match(/class="vpad"/g) ?? []).length).toBe(8);
    /* 配線の太さ（倍率で決まる）は向きによらない */
    const wd = (x: string) => /stroke-width:([\d.]+)px/.exec(x)?.[1];
    expect(wd(d('2-16', 'ser', 0.3, -0.8))).toBe(wd(d('2-16', 'ser', -1, 0.2)));
  });

  it('基板の厚さが図の厚さに出る', () => {
    expect(thickScale(40)).toBeCloseTo(6.25, 12);
    expect(thickScale(4)).toBe(1);
    expect(thickScale(200)).toBe(10);
    /* 真横から見ると、表面と裏面の縦の差が板厚 × 拡大率 × 倍率に比例する */
    const span = (st: string) => {
      const x = coil3d({
          sh: sq,
          n: 5,
          dout: 40,
          w: 0.5,
          s: 0.5,
          st: stackOf(st),
          conn: 'ser',
          az: 0,
          el: 0,
          zoom: 1,
        }).svg,
        ys = [...x.matchAll(/class="vpad" cx="[\d.-]+" cy="([\d.-]+)"/g)].map((m) => Number(m[1]));
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(span('2-16') / span('2-08')).toBeGreaterThan(1.9);
  });
});
