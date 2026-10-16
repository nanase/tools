/**
 * 結晶の中の光路の図: ハロごとに、そのハロへ向かう光線を 1 本探し（CPU の追跡）、結晶と光の通り道を斜めから描く
 */
import { minus } from '../../lib/format';
import { altaz, CHA_MIN, CZA_MAX, chaAlt, czaAlt, minDev, N550, PAR_MAX, parAz, R22, R46, type V3 } from './labels';
import { type Crystal, crystal, family, orient, type Population, Rng, sunRay, traceRay } from './trace';

const D = Math.PI / 180;

/** 図にできるハロ */
export interface FigHalo {
  k: string;
  name: string;
  /** 結晶の説明 */
  cry: string;
  pop: Population;
  /** 光源の高度 e のとき出ないなら理由 */
  none?: (e: number) => string | null;
  ok: (path: number[], d: V3, e: number) => boolean;
}

const P = (o: Partial<Population>): Population => ({
  orient: 'random',
  ca: 1,
  tilt: 0,
  rot: 0,
  w: 1,
  d: 0,
  pyr: 0,
  ...o,
});
const ang = (a: V3, b: V3) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) / D;
const azOf = (d: V3) => Math.atan2(-d[1], d[0]) / D;
const altOf = (d: V3) => Math.asin(Math.max(-1, Math.min(1, d[2]))) / D;
const PLATE = P({ orient: 'plate', ca: 0.5 });

export const FIG: FigHalo[] = [
  {
    k: 'h22',
    name: '内暈',
    cry: '向きのそろわない六角柱',
    pop: P({}),
    ok: (p, d, e) =>
      p.length === 2 &&
      family(p) === 1 &&
      Math.abs(ang(d, altaz(e, 0)) - R22 - 0.4) < 0.4 &&
      d[2] > 0.03 &&
      azOf(d) < -5,
  },
  {
    k: 'par',
    name: '幻日',
    cry: '板状の結晶（底面が水平）',
    pop: PLATE,
    none: (e) =>
      Number.isNaN(parAz(e))
        ? `光源の高度が ${PAR_MAX.toFixed(1)}° を超えると、側面から入った光が次の側面で全反射して出られないため、幻日は出ない。`
        : null,
    ok: (p, d, e) => p.length === 2 && family(p) === 1 && Math.abs(altOf(d) - e) < 0.6 && azOf(d) < -10,
  },
  {
    k: 'cza',
    name: '環天頂アーク',
    cry: '板状の結晶（底面が水平）',
    pop: PLATE,
    none: (e) =>
      Number.isNaN(czaAlt(e))
        ? e < 0
          ? '光源が地平線の下にあると、光が上の底面に入れないため、環天頂アークは出ない。'
          : `光源の高度が ${CZA_MAX.toFixed(1)}° を超えると、上の底面から入った光が側面で全反射して出られないため、環天頂アークは出ない。`
        : null,
    ok: (p, d) => p.length === 2 && p[0] === 1 && family(p) === 2 && Math.abs(azOf(d)) < 8 && d[2] > 0,
  },
  {
    k: 'uta',
    name: '上端接弧',
    cry: '柱状の結晶（c 軸が水平）',
    pop: P({ orient: 'column', ca: 2 }),
    ok: (p, d, e) => p.length === 2 && family(p) === 1 && Math.abs(azOf(d)) < 3 && altOf(d) > e + 15,
  },
  {
    k: 'pc',
    name: '幻日環',
    cry: '板状の結晶（底面が水平）',
    pop: PLATE,
    ok: (p, d) => p.length === 1 && p[0] >= 3 && Math.abs(azOf(d) - 70) < 15,
  },
  {
    k: 'h46',
    name: '外暈',
    cry: '向きのそろわない六角柱',
    pop: P({}),
    ok: (p, d, e) =>
      p.length === 2 && family(p) === 2 && d[2] > 0.05 && Math.abs(ang(d, altaz(e, 0)) - R46 - 0.6) < 0.6,
  },
  {
    k: 'cha',
    name: '環水平アーク',
    cry: '板状の結晶（底面が水平）',
    pop: PLATE,
    none: (e) =>
      Number.isNaN(chaAlt(e))
        ? `光源の高度が ${CHA_MIN.toFixed(1)}° より低いと、側面から入った光が下の底面で全反射して出られないため、環水平アークは出ない。`
        : null,
    ok: (p, d) => p.length === 2 && p[1] === 2 && family(p) === 2 && Math.abs(azOf(d)) < 8 && d[2] > 0,
  },
  {
    k: 'pil',
    name: '太陽柱',
    cry: '少し傾いた薄い板',
    pop: P({ orient: 'plate', ca: 0.15, tilt: 4 }),
    none: (e) => (e > 15 ? '光源が高いと、柱は短く淡くなり、見分けにくい。' : null),
    ok: (_p, d, e) => Math.abs(azOf(d)) < 0.8 && altOf(d) > e + 1.5 && altOf(d) < e + 10,
  },
  {
    k: 'parry',
    name: 'パリーアーク',
    cry: 'Parry の向きの柱（側面 2 枚が水平）',
    pop: P({ orient: 'parry', ca: 2 }),
    ok: (p, d, e) =>
      p.length === 2 &&
      family(p) === 1 &&
      Math.abs(azOf(d)) < (e > 35 ? 20 : 3) &&
      altOf(d) > e + R22 + 0.8 &&
      altOf(d) < e + 40,
  },
  {
    k: 'p9',
    name: '9° の暈',
    cry: '錐面のある結晶（向きはランダム）',
    pop: P({ ca: 0.3, pyr: 0.6 }),
    ok: (p, d, e) =>
      p.length === 2 && family(p) === 5 && Math.abs(ang(d, altaz(e, 0)) - minDev(N550, 28) - 0.3) < 0.4 && d[2] > 0,
  },
];

export const figOf = (k: string): FigHalo => FIG.find((f) => f.k === k) ?? FIG[1];

/** 見つけた光線（世界の座標） */
export interface FigRay {
  e: number;
  path: number[];
  verts: V3[];
  /** 面の番号・外向きの法線・面の中心 */
  faces: { id: number; n: V3; c: V3; poly: number[] }[];
  pts: V3[];
  inDir: V3;
  outDir: V3;
}

/** 結晶の頂点（側面 6 枚と、錐面があれば上下の六角形を縮めたもの）と、面ごとの頂点の番号 */
function geometry(C: Crystal): { verts: V3[]; polys: Map<number, number[]> } {
  /* 平面の交わりから頂点を求める（3 枚ずつ。凸多面体の内側にあるものだけ） */
  const np = C.h.length,
    vs: V3[] = [],
    of: number[][] = [];
  const nrm = (i: number): V3 => [C.n[3 * i], C.n[3 * i + 1], C.n[3 * i + 2]];
  for (let i = 0; i < np; i++)
    for (let j = i + 1; j < np; j++)
      for (let k = j + 1; k < np; k++) {
        const a = nrm(i),
          b = nrm(j),
          c = nrm(k),
          det =
            a[0] * (b[1] * c[2] - b[2] * c[1]) -
            a[1] * (b[0] * c[2] - b[2] * c[0]) +
            a[2] * (b[0] * c[1] - b[1] * c[0]);
        if (Math.abs(det) < 1e-9) continue;
        const bc = [b[1] * c[2] - b[2] * c[1], b[2] * c[0] - b[0] * c[2], b[0] * c[1] - b[1] * c[0]],
          ca = [c[1] * a[2] - c[2] * a[1], c[2] * a[0] - c[0] * a[2], c[0] * a[1] - c[1] * a[0]],
          ab = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
          p: V3 = [0, 1, 2].map((q) => (C.h[i] * bc[q] + C.h[j] * ca[q] + C.h[k] * ab[q]) / det) as V3;
        let inside = true;
        for (let m = 0; m < np && inside; m++)
          if (nrm(m)[0] * p[0] + nrm(m)[1] * p[1] + nrm(m)[2] * p[2] > C.h[m] + 1e-7) inside = false;
        if (!inside) continue;
        let idx = vs.findIndex((v) => Math.hypot(v[0] - p[0], v[1] - p[1], v[2] - p[2]) < 1e-6);
        if (idx < 0) {
          idx = vs.length;
          vs.push(p);
          of.push([]);
        }
        for (const f of [i, j, k]) if (!of[idx].includes(f)) of[idx].push(f);
      }
  /* 面ごとに頂点を法線のまわりの角で並べる */
  const polys = new Map<number, number[]>();
  for (let f = 0; f < np; f++) {
    const ids = of.map((fs, i) => (fs.includes(f) ? i : -1)).filter((i) => i >= 0);
    if (ids.length < 3) continue;
    const n = nrm(f),
      cx = [0, 1, 2].map((q) => ids.reduce((s, i) => s + vs[i][q], 0) / ids.length),
      t = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0],
      u = [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]],
      v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]],
      angOf = (i: number) => {
        const w = [vs[i][0] - cx[0], vs[i][1] - cx[1], vs[i][2] - cx[2]];
        return Math.atan2(w[0] * v[0] + w[1] * v[1] + w[2] * v[2], w[0] * u[0] + w[1] * u[1] + w[2] * u[2]);
      };
    polys.set(
      f,
      ids.sort((a, b) => angOf(a) - angOf(b)),
    );
  }
  return { verts: vs, polys };
}

/**
 * 光線を探す（見つからなければ null）。budget 本まで試す。重い探索は呼び出し側で分けて、何回かに分けて呼ぶ
 */
export function findRay(h: FigHalo, e: number, budget: number, seed: number): FigRay | null {
  const g = new Rng(seed),
    C = crystal(h.pop.ca, h.pop.pyr ?? 0),
    M = new Float64Array(9),
    n = N550;
  for (let i = 0; i < budget; i++) {
    orient(h.pop, g, M);
    const [dx, dy, dz] = sunRay(e, g),
      pts: number[] = [],
      r = traceRay(C, M, dx, dy, dz, n, g, pts);
    if (!r) continue;
    const sky: V3 = [-r.x, -r.y, -r.z];
    if (!h.ok(r.path, sky, e)) continue;
    const w = (x: number, y: number, z: number): V3 => [
      M[0] * x + M[1] * y + M[2] * z,
      M[3] * x + M[4] * y + M[5] * z,
      M[6] * x + M[7] * y + M[8] * z,
    ];
    const geo = geometry(C),
      faces = [...geo.polys].map(([f, poly]) => ({
        id: C.id[f],
        n: w(C.n[3 * f], C.n[3 * f + 1], C.n[3 * f + 2]),
        c: w(C.n[3 * f] * C.h[f], C.n[3 * f + 1] * C.h[f], C.n[3 * f + 2] * C.h[f]),
        poly,
      }));
    const P: V3[] = [];
    for (let j = 0; j < pts.length; j += 3) P.push(w(pts[j], pts[j + 1], pts[j + 2]));
    return {
      e,
      path: r.path,
      verts: geo.verts.map((v) => w(v[0], v[1], v[2])),
      faces,
      pts: P,
      inDir: [dx, dy, dz],
      outDir: [r.x, r.y, r.z],
    };
  }
  return null;
}

const f1 = (v: number) => String(Math.round(v * 10) / 10);
/** 面の名前 */
export const faceName = (id: number): string => (id <= 2 ? `底面 ${id}` : id <= 8 ? `側面 ${id}` : `錐面 ${id}`);

/** 図の SVG（viewBox 0 0 560 380）の中身。small は全画面の左下の小さな図（文字を大きく） */
export function figureSvg(R: FigRay, small = false): string {
  const cph = -60 * D,
    cth = 20 * D,
    cam: V3 = [Math.cos(cth) * Math.cos(cph), Math.cos(cth) * Math.sin(cph), Math.sin(cth)],
    rt: V3 = [-Math.sin(cph), Math.cos(cph), 0],
    up: V3 = [cam[1] * rt[2] - cam[2] * rt[1], cam[2] * rt[0] - cam[0] * rt[2], cam[0] * rt[1] - cam[1] * rt[0]],
    dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  let rad = 0;
  for (const v of R.verts) rad = Math.max(rad, Math.hypot(v[0], v[1], v[2]));
  const k = 105 / rad,
    cx = 280,
    cy = 190,
    pr = (v: V3): [number, number] => [cx + k * dot(v, rt), cy - k * dot(v, up)],
    P2 = (v: V3) => {
      const p = pr(v);
      return `${f1(p[0])} ${f1(p[1])}`;
    };
  const vis = new Map<number, boolean>(R.faces.map((f) => [f.id, dot(f.n, cam) > 0]));
  /* 辺: 隣り合う 2 面のどちらかが見えていれば実線、どちらも裏なら破線 */
  const seen = new Set<string>();
  let edges = '',
    hidden = '',
    faces = '',
    hit = '';
  for (const f of R.faces) {
    const ps = f.poly;
    if (vis.get(f.id)) faces += `M${ps.map((i) => P2(R.verts[i])).join('L')}Z`;
    if (R.path.includes(f.id)) hit += `M${ps.map((i) => P2(R.verts[i])).join('L')}Z`;
    for (let j = 0; j < ps.length; j++) {
      const a = ps[j],
        b = ps[(j + 1) % ps.length],
        key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const other = R.faces.find((g) => g !== f && g.poly.includes(a) && g.poly.includes(b)),
        s = `M${P2(R.verts[a])}L${P2(R.verts[b])}`;
      if (vis.get(f.id) || (other && vis.get(other.id))) edges += s;
      else hidden += s;
    }
  }
  const hr = rad * 1.45;
  let hz = '';
  for (let i = 0; i <= 48; i++) {
    const t = (i / 48) * 2 * Math.PI;
    hz += (i ? 'L' : 'M') + P2([hr * Math.cos(t), hr * Math.sin(t), 0]);
  }
  const pts = R.pts,
    p0 = pts[0],
    pl = pts[pts.length - 1],
    a0: V3 = [p0[0] - R.inDir[0] * rad * 2.4, p0[1] - R.inDir[1] * rad * 2.4, p0[2] - R.inDir[2] * rad * 2.4],
    b1: V3 = [pl[0] + R.outDir[0] * rad * 2.6, pl[1] + R.outDir[1] * rad * 2.6, pl[2] + R.outDir[2] * rad * 2.6];
  let inside = '';
  for (let i = 1; i < pts.length; i++) inside += `M${P2(pts[i - 1])}L${P2(pts[i])}`;
  const head = (from: V3, to: V3, sz: number) => {
    const A = pr(from),
      B = pr(to),
      dx = B[0] - A[0],
      dy = B[1] - A[1],
      L = Math.hypot(dx, dy) || 1,
      ux = dx / L,
      uy = dy / L;
    return `M${f1(B[0])} ${f1(B[1])}L${f1(B[0] - sz * ux + sz * 0.5 * uy)} ${f1(B[1] - sz * uy - sz * 0.5 * ux)}L${f1(B[0] - sz * ux - sz * 0.5 * uy)} ${f1(B[1] - sz * uy + sz * 0.5 * ux)}Z`;
  };
  const mid: V3 = [(a0[0] + p0[0]) / 2, (a0[1] + p0[1]) / 2, (a0[2] + p0[2]) / 2],
    hs = small ? 22 : 12;
  let s =
    `<path class="xhz" d="${hz}"/><path class="xf" d="${faces}"/><path class="xfe" d="${hit}"/>` +
    `<path class="xh" d="${hidden}"/><path class="xe" d="${edges}"/>` +
    `<path class="xin" d="M${P2(a0)}L${P2(p0)}"/><path class="xray" d="${inside}"/><path class="xout" d="M${P2(pl)}L${P2(b1)}"/>` +
    `<path class="xar1" d="${head(a0, mid, hs)}"/><path class="xar" d="${head(pl, b1, hs)}"/>`;
  /* 面の番号: 見えている面と、光が通った面 */
  for (const f of R.faces) {
    if (!(vis.get(f.id) || R.path.includes(f.id)) || (small && !R.path.includes(f.id))) continue;
    const p = pr(f.c);
    s += `<text class="xn" x="${f1(p[0])}" y="${f1(p[1] + (small ? 10 : 4))}" text-anchor="middle">${f.id}</text>`;
  }
  if (!small) {
    const A0 = pr(a0),
      B1 = pr(b1);
    s +=
      `<text x="${f1(A0[0])}" y="${f1(A0[1] - 10)}" text-anchor="${A0[0] > 280 ? 'end' : 'start'}">${'光源から'}</text>` +
      `<text class="xc" x="${f1(B1[0])}" y="${f1(B1[1] + 20)}" text-anchor="${B1[0] > 280 ? 'end' : 'start'}">目へ</text>` +
      `<text x="14" y="368">破線の円は水平面</text>`;
  }
  return s;
}

/** 光路の文（図の下の説明） */
export function caption(
  h: FigHalo,
  R: FigRay,
  moon: boolean,
): { path: string; text: string; wedge: string; minDev: string; dev: string } {
  const fam = family(R.path),
    dev = `${minus((Math.acos(Math.max(-1, Math.min(1, R.inDir[0] * R.outDir[0] + R.inDir[1] * R.outDir[1] + R.inDir[2] * R.outDir[2]))) / D).toFixed(2))}°`,
    src = moon ? '月' : '太陽';
  if (fam === 0)
    return {
      path: `${faceName(R.path[0])} で反射`,
      text: `${h.cry}。${src}の光が鉛直な${faceName(R.path[0])}の外側で反射し、${src}と同じ高度の別の方位へ向かう。`,
      wedge: '—',
      minDev: '—',
      dev,
    };
  const a = R.path[0],
    b = R.path[R.path.length - 1];
  /* くさびの角は、入った面と出た面の法線のなす角から */
  const fa = R.faces.find((f) => f.id === a),
    fb = R.faces.find((f) => f.id === b);
  let wedge = Number.NaN;
  if (fa && fb && R.path.length === 2)
    wedge = 180 - Math.acos(Math.max(-1, Math.min(1, fa.n[0] * fb.n[0] + fa.n[1] * fb.n[1] + fa.n[2] * fb.n[2]))) / D;
  const w = Number.isNaN(wedge) ? '—' : `${wedge.toFixed(1)}°`,
    md = Number.isNaN(wedge) ? '—' : `${minDev(N550, wedge).toFixed(2)}°`,
    mid = R.path.length > 2 ? `、中で ${R.path.slice(1, -1).map(faceName).join('・')} に反射してから` : '';
  return {
    path: R.path.map(faceName).join(' → '),
    text:
      `${h.cry}。${src}の光は${faceName(a)}から入り${mid}、${faceName(b)}から出る。` +
      (R.path.length === 2 ? `2 つの面のなす角は ${w} で、プリズムと同じように光を曲げる。` : ''),
    wedge: w,
    minDev: md,
    dev,
  };
}
