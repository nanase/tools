import { describe, expect, it } from 'vitest';
import { distortion, dof, halfAngle, illum, pupilTable, spot } from '../src/tools/lens/analysis';
import { CATALOG, LC, LD, LF, model, nAt, SPECTRAL, sellmeier } from '../src/tools/lens/glass';
import { LENSES, lensOf } from '../src/tools/lens/lenses';
import {
  build,
  cardinal,
  focus,
  HALF_DIAG,
  hit,
  inStop,
  mat,
  minFocus,
  objRay,
  polyR,
  type Ray,
  seidel,
  thinLens,
  traceFwd,
} from '../src/tools/lens/optics';
import { curveSvg, mapDynamic, sectionSvg, spotSvg } from '../src/tools/lens/plot';
import { angRadius, BOARDS, basis, bodyFrame, EYE, intersect, SKY, sceneGlsl } from '../src/tools/lens/scene';
import { traceFrag } from '../src/tools/lens/shader';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe('硝材', () => {
  it('Sellmeier の係数がカタログの nd・νd を再現する', () => {
    for (const g of Object.values(CATALOG)) {
      const nd = sellmeier(g, LD),
        vd = (nd - 1) / (sellmeier(g, LF) - sellmeier(g, LC));
      expect(Math.abs(nd - g.nd), g.name).toBeLessThan(2e-5);
      expect(Math.abs(vd - g.vd), g.name).toBeLessThan(0.02);
    }
  });
  it('模型の硝材は指定の nd・νd になる', () => {
    const m = model(1.658, 57.0, 'N-SK16');
    expect(nAt(m, LD)).toBeCloseTo(1.658, 10);
    expect((nAt(m, LD) - 1) / (nAt(m, LF) - nAt(m, LC))).toBeCloseTo(57.0, 8);
    /* 分散は正常（短い波長ほど屈折率が高い） */
    expect(nAt(m, 0.45)).toBeGreaterThan(nAt(m, 0.65));
  });
});

describe('近軸の焦点距離（レンズデータの公称値）', () => {
  /* 出典の単位での焦点距離: Laikin の例は 20・4・5、Zemax のトリプレットは 50、Smith のダブルガウスは約 100 */
  const NOMINAL: Record<string, [number, number]> = {
    single: [100, 0.005],
    achro: [20, 0.001],
    triplet: [50, 0.001],
    tessar: [4, 0.002],
    dgauss: [100, 0.01],
    tele: [5, 0.001],
  };
  for (const [v, [f, tol]] of Object.entries(NOMINAL))
    it(`${v} の焦点距離は ${f}`, () => {
      const sys = build(lensOf(v), 100);
      expect(rel(100 / sys.k, f)).toBeLessThan(tol);
    });
  it('相似拡大した焦点距離は指定の値になる', () => {
    for (const rx of LENSES) for (const f of [24, 50, 135]) expect(cardinal(build(rx, f).s).f).toBeCloseTo(f, 9);
  });
});

describe('ピントと瞳', () => {
  const sys = build(lensOf('dgauss'), 50);
  it('無限遠では像面が後側の焦点にある', () => {
    const st = focus(sys, Infinity, 2, 0);
    expect(st.zs).toBeCloseTo(st.card.zF1, 9);
    expect(st.m).toBe(0);
    expect(st.Nw).toBeCloseTo(2, 9);
  });
  it('有限の距離では、物体の面の近軸の像がセンサーにでき、距離はセンサーから測る', () => {
    for (const D of [300, 1000, 5000]) {
      const st = focus(sys, D, 2.8, 0);
      expect(st.zs - st.zo).toBeCloseTo(D, 6);
      /* 物点から出た近軸光線が、センサーの面で光軸に戻る */
      const u0 = 0.01,
        M = mat(sys.s, 0, sys.s.length);
      const y1 = -u0 * st.zo,
        yk = M[0] * y1 + M[1] * u0,
        uk = M[2] * y1 + M[3] * u0;
      const zk = sys.s[sys.s.length - 1].z;
      expect(zk - yk / uk).toBeCloseTo(st.zs, 6);
      /* 実効 F 値は N(1 + |m|/p) の近似に近い（p は瞳倍率） */
      const p = st.rxp / st.rep;
      expect(rel(st.Nw, 2.8 * (1 + Math.abs(st.m) / p))).toBeLessThan(0.02);
    }
  });
  it('入射瞳の径は f/N', () => {
    for (const N of [2, 4, 11]) expect(2 * focus(sys, Infinity, N, 0).rep).toBeCloseTo(50 / N, 9);
  });
  it('最短撮影距離は倍率 1/2 のとき', () => {
    const st = focus(sys, minFocus(sys), 2, 0);
    expect(st.m).toBeCloseTo(-0.5, 6);
  });
});

describe('収差なしの薄いレンズ', () => {
  it('像の点はレンズの式どおり', () => {
    const f = 50,
      D = 2000,
      t = thinLens(f, D, 2.8);
    expect(t.si + t.so).toBeCloseTo(D, 9);
    expect(1 / t.si + 1 / t.so).toBeCloseTo(1 / f, 12);
    expect(t.a).toBeCloseTo(f / 5.6, 12);
    /* 物体の面の高さ Y の点から出た光線は、開口のどこを通っても（屈折で傾きが −y/f 変わる）像の点 −Y·si/so に集まる */
    const Y = 300;
    for (const ya of [-8, 0, 5]) {
      const slope = (ya - Y) / t.so - ya / f;
      const yi = ya + slope * t.si;
      expect(yi).toBeCloseTo((-Y * t.si) / t.so, 9);
    }
    expect(thinLens(f, Infinity, 2).si).toBe(f);
  });
});

describe('実光線の追跡', () => {
  it('凹面の遠くから来る光線も頂点の近くの交点をとる', () => {
    const r: Ray = { x: 0, y: 1, z: -100, dx: 0, dy: 0, dz: 1 };
    expect(hit(r, 38, -1 / 15.4)).toBe(true);
    expect(r.z).toBeGreaterThan(37.9);
    expect(r.z).toBeLessThan(38);
    const q: Ray = { x: 0, y: 2, z: 50, dx: 0, dy: 0, dz: -1 };
    expect(hit(q, 10, 1 / 20)).toBe(true);
    expect(q.z).toBeCloseTo(10 + 20 - Math.sqrt(400 - 4), 9);
  });
  it('光軸に近い光線は近軸の焦点に集まる', () => {
    for (const rx of LENSES) {
      const st = focus(build(rx, 50), Infinity, rx.fno, 0);
      const r = objRay(st, 0, 0, st.rep * 1e-3, 0);
      expect(traceFwd(st, r, LD)).toBe(-1);
      const z = r.z - (r.y * r.dz) / r.dy;
      expect(Math.abs(z - st.zs), rx.v).toBeLessThan(1e-3);
    }
  });
  it('絞りの多角形は面積が同じ円にそろう', () => {
    for (const n of [5, 6, 7, 9]) {
      const R = polyR(1, n);
      let k = 0;
      const N = 400;
      for (let i = 0; i < N; i++)
        for (let j = 0; j < N; j++) if (inStop(((i + 0.5) / N) * 2 * R - R, ((j + 0.5) / N) * 2 * R - R, R, n)) k++;
      expect(rel((k / (N * N)) * 4 * R * R, Math.PI)).toBeLessThan(0.005);
      /* 頂点の 1 つは真上 */
      expect(inStop(0, R * 0.999, R, n)).toBe(true);
      expect(inStop(0, -R * 0.999, R, n)).toBe(n % 2 === 0);
    }
  });
});

describe('ザイデルの係数', () => {
  it('単レンズの球面収差は 3 次の値と実光線が合う（F/16）', () => {
    const st = focus(build(lensOf('single'), 100), Infinity, 16, 0);
    const sd = seidel(st, HALF_DIAG);
    const r = objRay(st, 0, 0, st.rep, 0);
    expect(traceFwd(st, r, LD)).toBe(-1);
    const uk = -st.rep / st.sys.f;
    /* 上から入った光線は、補正不足（S_I > 0）なら近軸の像面で光軸の下に来る */
    expect(sd.S[0]).toBeGreaterThan(0);
    expect(r.y).toBeLessThan(0);
    expect(rel(r.y, sd.S[0] / (2 * uk))).toBeLessThan(0.03);
  });
  it('正のレンズのペッツバール和は正', () => {
    expect(seidel(focus(build(lensOf('single'), 50), Infinity, 4, 0), HALF_DIAG).S[3]).toBeGreaterThan(0);
  });
  it('軸上色収差の係数は F 線と C 線の近軸の焦点のずれに合う', () => {
    const sys = build(lensOf('single'), 100),
      st = focus(sys, Infinity, 8, 0);
    const sd = seidel(st, HALF_DIAG),
      uk = -st.rep / sys.f;
    const dz = cardinal(sys.s, LF).zF1 - cardinal(sys.s, LC).zF1;
    expect(dz).toBeLessThan(0);
    expect(rel(Math.abs(dz), sd.C[0] / (uk * uk))).toBeLessThan(0.03);
    /* アクロマートは単レンズより 1 桁以上小さい */
    const sa = focus(build(lensOf('achro'), 100), Infinity, 8, 0);
    expect(Math.abs(seidel(sa, HALF_DIAG).C[0])).toBeLessThan(Math.abs(sd.C[0]) / 10);
  });
  it('歪曲の係数の符号は実光線の歪曲と同じ', () => {
    for (const v of ['dgauss', 'tele', 'wide']) {
      const st = focus(build(lensOf(v), lensOf(v).f0), Infinity, 8, 0);
      expect(Math.sign(seidel(st, HALF_DIAG).S[4]), v).toBe(Math.sign(distortion(st, HALF_DIAG)));
    }
  });
});

describe('収差の評価', () => {
  it('ダブルガウスの歪曲は小さく、超広角は大きな樽型、望遠は糸巻き型', () => {
    const d = (v: string) => distortion(focus(build(lensOf(v), lensOf(v).f0), Infinity, 8, 0), HALF_DIAG);
    expect(Math.abs(d('dgauss'))).toBeLessThan(3);
    expect(d('wide')).toBeLessThan(-10);
    expect(d('tele')).toBeGreaterThan(0);
  });
  it('ダブルガウスは単レンズよりスポットがずっと小さい', () => {
    const s = (v: string, h: number) => spot(focus(build(lensOf(v), 50), Infinity, 4, 0), h).rms;
    expect(s('dgauss', 0)).toBeLessThan(s('single', 0) / 3);
    expect(s('dgauss', HALF_DIAG)).toBeLessThan(s('single', HALF_DIAG) / 10);
    /* 絞ると中心のスポットは小さくなる */
    const st8 = focus(build(lensOf('dgauss'), 50), Infinity, 8, 0);
    expect(spot(st8, 0).rms).toBeLessThan(s('dgauss', 0));
  });
  it('瞳の表の中心は近軸の射出瞳を囲み、周辺光量は隅で下がる', () => {
    const st = focus(build(lensOf('dgauss'), 50), Infinity, 2, 0),
      tb = pupilTable(st);
    const [cx, hx, hy] = tb.rows[0];
    expect(Math.abs(cx)).toBeLessThan(st.rxp * 0.05);
    expect(hx).toBeGreaterThan(st.rxp);
    expect(hx).toBeLessThan(st.rxp * 1.15);
    expect(hy).toBeGreaterThan(st.rxp);
    expect(hy).toBeLessThan(st.rxp * 1.15);
    const il = illum(st, HALF_DIAG, tb);
    expect(il).toBeGreaterThan(0.05);
    expect(il).toBeLessThan(0.7);
    /* 絞ると明るくなる（けられが減る） */
    const s8 = focus(build(lensOf('dgauss'), 50), Infinity, 8, 0);
    expect(illum(s8, HALF_DIAG, pupilTable(s8))).toBeGreaterThan(il);
  });
  it('画角は対角 2·atan(21.6/f) に近い（歪曲の小さいレンズ）', () => {
    const st = focus(build(lensOf('dgauss'), 50), Infinity, 2, 0);
    const a = (2 * halfAngle(st, HALF_DIAG) * 180) / Math.PI;
    expect(Math.abs(a - (2 * Math.atan(HALF_DIAG / 50) * 180) / Math.PI)).toBeLessThan(1);
  });
});

describe('被写界深度', () => {
  it('近似式 H = f²/(Nc) + f と、近点・遠点の式に合う', () => {
    const f = 50,
      N = 2.8,
      c = 0.03;
    const sys = build(lensOf('dgauss'), f);
    const H = (f * f) / (N * c) + f;
    expect(rel(dof(focus(sys, 3000, N, 0), c).hyper, H)).toBeLessThan(0.03);
    for (const D of [1000, 3000, 8000]) {
      const st = focus(sys, D, N, 0),
        d = dof(st, c);
      /* 主点から測った近似式（センサーから測る分を足し引きする） */
      const off = st.zs - st.card.zH,
        s = D - off;
      const near = (s * (H - f)) / (H + s - 2 * f) + off,
        far = (s * (H - f)) / (H - s) + off;
      expect(rel(d.near, near), `near ${D}`).toBeLessThan(0.03);
      expect(rel(d.far, far), `far ${D}`).toBeLessThan(0.05);
      expect(d.near).toBeLessThan(D);
      expect(d.far).toBeGreaterThan(D);
    }
    /* 過焦点距離より遠くに合わせると遠点は無限遠 */
    expect(dof(focus(sys, 40000, N, 0), c).far).toBe(Infinity);
  });
});

describe('被写体', () => {
  it('撮影者の正面の向きのベクトルは正規直交', () => {
    const b = basis(20, -10);
    const dot = (a: number[], c: number[]) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
    expect(dot(b.r, b.u)).toBeCloseTo(0, 12);
    expect(dot(b.r, b.f)).toBeCloseTo(0, 12);
    expect(dot(b.f, b.f)).toBeCloseTo(1, 12);
  });
  it('チャートの板の中心までの距離は表記どおり', () => {
    for (const b of BOARDS) {
      const o: [number, number, number] = [0, EYE, 0],
        L = Math.hypot(b.c[0], b.c[1] - EYE, b.c[2]);
      const d: [number, number, number] = [b.c[0] / L, (b.c[1] - EYE) / L, b.c[2] / L];
      const t = intersect(o, d);
      expect(t * d[2]).toBeCloseTo(Number(b.label), 6);
    }
  });
  it('上を向けば空（無限遠）', () => {
    expect(intersect([0, EYE, 0], [0, 1, 0])).toBe(Infinity);
  });
  it('天体の見かけの直径は地球から見た値（月 31.1′・木星 50.1″・土星 20.6″・天王星 4.09″）', () => {
    const as = (id: string) => (2 * angRadius(SKY.find((b) => b.id === id) ?? SKY[0]) * 180 * 3600) / Math.PI;
    expect(as('moon') / 60).toBeCloseTo(31.08, 1);
    expect(as('jupiter')).toBeCloseTo(50.1, 1);
    expect(as('saturn')).toBeCloseTo(20.6, 1);
    expect(as('uranus')).toBeCloseTo(4.09, 2);
    expect(as('venus')).toBeCloseTo(24.2, 1);
    expect(as('mars')).toBeCloseTo(25.7, 1);
  });
  it('天体は空にあり、どの物体にも隠れない', () => {
    for (const b of SKY) {
      const { c, e1, e2 } = bodyFrame(b);
      const dot = (a: number[], d: number[]) => a[0] * d[0] + a[1] * d[1] + a[2] * d[2];
      expect(dot(c, e1)).toBeCloseTo(0, 12);
      expect(dot(c, e2)).toBeCloseTo(0, 12);
      expect(dot(e1, e2)).toBeCloseTo(0, 12);
      expect(intersect([0, EYE, 0], c), b.id).toBe(Infinity);
      /* 仰角の上限 30° と方位の範囲 ±60° で向けられる */
      expect(b.el).toBeLessThan(30);
      expect(Math.abs(b.az)).toBeLessThan(60);
    }
  });
});

describe('図とシェーダ', () => {
  const st = focus(build(lensOf('tessar'), 50), 2000, 4.5, 6);
  it('SVG に数でない値が入らない', () => {
    const t = thinLens(50, 2000, 4.5);
    for (const s of [
      sectionSvg({ st, ideal: false, spec: true, si: t.si, so: t.so, a: t.a }).svg,
      sectionSvg({ st, ideal: false, spec: false, si: t.si, so: t.so, a: t.a }).svg,
      sectionSvg({ st, ideal: true, spec: true, si: t.si, so: t.so, a: t.a }).svg,
      curveSvg(st).svg,
      spotSvg(
        [0, 0.7, 1].map((k) => spot(st, k * HALF_DIAG, 11)),
        st.Nw,
      ).svg,
      mapDynamic({ pan: 10, hfov: 20, fd: 2, near: 1.8, far: Infinity }),
    ])
      expect(s).not.toMatch(/NaN|Infinity|undefined/);
  });
  it('断面図は 7 波長で描き分け、d 線だけにもできる', () => {
    const t = thinLens(50, 2000, 4.5);
    const a = sectionSvg({ st, ideal: false, spec: true, si: t.si, so: t.so, a: t.a }).svg,
      b = sectionSvg({ st, ideal: false, spec: false, si: t.si, so: t.so, a: t.a }).svg;
    for (const [n] of SPECTRAL) expect(a).toContain(`ls-w s-${n}`);
    expect(b).not.toContain('ls-w');
    expect(b).toContain('ls-r1');
  });
  it('単レンズの軸上色収差（h 線と r 線のピントの差）は近軸の見積もりに近い', () => {
    const s1 = focus(build(lensOf('single'), 50), Infinity, 4, 0);
    const t = thinLens(50, Infinity, 4);
    const lab = sectionSvg({ st: s1, ideal: false, spec: true, si: t.si, so: t.so, a: t.a }).label;
    const m = lab.match(/波長によるピントの差 ([\d.]+) mm/);
    /* N-BK7 の f 50 mm: h 線と r 線のピントの差はおよそ f·(n_h − n_r)/(n_d − 1) ≈ 1.3 mm */
    expect(m).not.toBeNull();
    expect(Number(m?.[1])).toBeGreaterThan(0.9);
    expect(Number(m?.[1])).toBeLessThan(1.8);
  });
  it('シェーダは面の数と被写体の定数を含む', () => {
    const g = traceFrag(11);
    expect(g).toContain('#define NS 11');
    expect(g).not.toMatch(/NaN|Infinity|undefined/);
    expect(sceneGlsl()).toContain(`const int NB = ${BOARDS.length};`);
  });
});
