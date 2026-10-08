/**
 * 図の SVG（DOM に依存しない文字列）: 上から見た見取り図、レンズの断面と光線、スポットダイアグラムと収差の曲線
 */
import { distCurve, fieldCurve, type Spot, sphCurve } from './analysis';
import { LD } from './glass';
import { aimChief, fieldU, HALF_DIAG, objRay, type State, traceFwd } from './optics';
import { BOARDS, CYLS, STRINGS, WALL } from './scene';

const n1 = (x: number) => x.toFixed(1);
/** 1・2・5 の切りのよい値に切り上げる */
export function nice(x: number): number {
  const e = Math.floor(Math.log10(x)),
    m = x / 10 ** e;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * 10 ** e;
}
const num = (v: number) => {
  const s = Number(v.toPrecision(3)).toString();
  return s.replace(/^-/, '−');
};

/* ---------- 見取り図（上から、距離は対数の目盛り） ---------- */
export const MAP = { w: 400, h: 214, cx: 200, cy: 204, R: 190, r0: 0.4, rmax: 40 } as const;
const rho = (r: number) => (MAP.R * Math.log(1 + r / MAP.r0)) / Math.log(1 + MAP.rmax / MAP.r0);
/** 方位角 a [rad]（前が 0、右が正）と水平距離 r [m] の点 */
const mp = (a: number, r: number): [number, number] => {
  const p = rho(Math.min(r, MAP.rmax));
  return [MAP.cx + p * Math.sin(a), MAP.cy - p * Math.cos(a)];
};
const mxz = (x: number, z: number) => mp(Math.atan2(x, z), Math.hypot(x, z));
const P = (p: [number, number]) => `${n1(p[0])} ${n1(p[1])}`;

export interface MapIn {
  /** 方位 [°] */
  pan: number;
  /** 水平の半画角 [°] */
  hfov: number;
  /** ピントの距離・被写界深度の近い端と遠い端 [m]（Infinity は無限遠） */
  fd: number;
  near: number;
  far: number;
}

/** 撮影者の向きの前後の距離 d の面（水平に見た線）を、画角の中で折れ線にする */
function plane(a0: number, half: number, d: number, k = 24): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= k; i++) {
    const a = a0 - half + (2 * half * i) / k;
    out.push(mp(a, Number.isFinite(d) ? d / Math.cos(a - a0) : MAP.rmax));
  }
  return out;
}

/** 見取り図の静かな部分（距離の環と被写体）。ビルド時に出す */
export function mapStatic(): string {
  let s = '';
  for (const r of [0.5, 1, 2, 5, 10, 20]) {
    const p = rho(r);
    s += `<path class="mp-ring" d="M${n1(MAP.cx - p)} ${MAP.cy}A${n1(p)} ${n1(p)} 0 0 1 ${n1(MAP.cx + p)} ${MAP.cy}"/>`;
    s += `<text class="mp-t" x="${n1(MAP.cx - p + 2)}" y="${MAP.cy - 3}">${r}</text>`;
  }
  s += `<path class="mp-ring far" d="M${n1(MAP.cx - MAP.R)} ${MAP.cy}A${MAP.R} ${MAP.R} 0 0 1 ${n1(MAP.cx + MAP.R)} ${MAP.cy}"/>`;
  s += `<text class="mp-t" x="${MAP.cx + MAP.R - 4}" y="${MAP.cy - 3}" text-anchor="end">m</text>`;
  /* 壁 */
  const wall: string[] = [];
  for (let x = WALL.x0; x <= WALL.x1; x += 1) wall.push(P(mxz(x, WALL.z)));
  s += `<path class="mp-wall" d="M${wall.join('L')}"/>`;
  /* 柱（電飾の支柱を含む。板の支柱は板で描く） */
  for (const c of CYLS.slice(0, 4)) {
    const [x, y] = mxz(c.x, c.z);
    s += `<circle class="mp-obj" cx="${n1(x)}" cy="${n1(y)}" r="3.2"/>`;
  }
  /* 解像チャートの板 */
  for (const b of BOARDS) {
    const a = mxz(b.c[0] - b.r * 1.3, b.c[2]),
      c = mxz(b.c[0] + b.r * 1.3, b.c[2]),
      m = mxz(b.c[0], b.c[2]);
    s += `<path class="mp-brd" d="M${P(a)}L${P(c)}"/><circle class="mp-brdc" cx="${n1(m[0])}" cy="${n1(m[1])}" r="2.4"/>`;
  }
  /* 電飾 */
  for (const L of STRINGS)
    for (const b of L) {
      const [x, y] = mxz(b.c[0], b.c[2]);
      s += `<circle class="mp-bulb" cx="${n1(x)}" cy="${n1(y)}" r="1.3"/>`;
    }
  s += `<text class="mp-t" x="${MAP.cx}" y="10" text-anchor="middle">遠景（山並み・∞）</text>`;
  return s;
}

/** 見取り図の動く部分（画角・ピントの面・被写界深度・撮影者） */
export function mapDynamic(m: MapIn): string {
  const a0 = (m.pan * Math.PI) / 180,
    h = (m.hfov * Math.PI) / 180;
  const nearL = plane(a0, h, m.near),
    farL = plane(a0, h, m.far);
  let s = `<path class="mp-dof" d="M${nearL.map(P).join('L')}L${farL.reverse().map(P).join('L')}Z"/>`;
  const e1 = mp(a0 - h, MAP.rmax),
    e2 = mp(a0 + h, MAP.rmax);
  s += `<path class="mp-fov" d="M${P(e1)}L${MAP.cx} ${MAP.cy}L${P(e2)}"/>`;
  s += `<path class="mp-fp" d="M${plane(a0, h, m.fd).map(P).join('L')}"/>`;
  const f = mp(a0, 0.45),
    l = mp(a0 - 0.6, 0.2),
    r = mp(a0 + 0.6, 0.2);
  s += `<path class="mp-cam" d="M${P(f)}L${P(l)}L${P(r)}Z"/>`;
  return s;
}

/** 見取り図の読み上げ */
export const mapLabel = (m: MapIn): string =>
  `上から見た見取り図。撮影者は手前の中央で、方位 ${num(m.pan)}°、水平の画角 ${num(2 * m.hfov)}°。` +
  `ピントは ${Number.isFinite(m.fd) ? `${num(m.fd)} m` : '無限遠'}、被写界深度は ${num(m.near)} m から ${Number.isFinite(m.far) ? `${num(m.far)} m` : '無限遠'} まで`;

/* ---------- レンズの断面と光線 ---------- */
export const SEC = { w: 400, h: 200 } as const;

const sag = (c: number, y: number) => {
  const cy = Math.min(Math.abs(c * y), 0.999);
  return c === 0 ? 0 : (c * y * y) / (1 + Math.sqrt(1 - cy * cy));
};

export interface SecIn {
  st: State;
  ideal: boolean;
  /** 収差なしの薄いレンズの像距離・物体距離（0 は無限遠）・半径 */
  si: number;
  so: number;
  a: number;
}

export function sectionSvg(p: SecIn): { svg: string; label: string } {
  const { st } = p,
    s = st.sys.s;
  const zEnd = st.zs,
    zLen = zEnd;
  const ymax = Math.max(...s.map((x) => x.sd), HALF_DIAG) * 1.08;
  const z0 = -0.28 * zLen,
    z1 = zEnd + 0.03 * zLen;
  const k = Math.min((SEC.w - 16) / (z1 - z0), (SEC.h - 16) / (2 * ymax));
  const ox = (SEC.w - (z1 - z0) * k) / 2 - z0 * k,
    oy = SEC.h / 2;
  const X = (z: number) => n1(ox + z * k),
    Y = (y: number) => n1(oy - y * k);
  let g = `<path class="ls-ax" d="M4 ${oy}H${SEC.w - 4}"/>`;
  if (!p.ideal) {
    /* レンズ（ガラスの区間ごと）。縁は 2 面の大きいほうの径にそろえる */
    for (let i = 0; i < s.length - 1; i++) {
      const a = s[i],
        b = s[i + 1];
      if (a.stop || a.m.nd === 1) continue;
      const e = Math.max(a.sd, b.stop ? 0 : b.sd);
      const pts: string[] = [];
      for (let j = 0; j <= 16; j++) {
        const y = -e + (2 * e * j) / 16;
        pts.push(`${X(a.z + sag(a.c, y))} ${Y(y)}`);
      }
      for (let j = 16; j >= 0; j--) {
        const y = -e + (2 * e * j) / 16;
        pts.push(`${X(b.z + sag(b.c, y))} ${Y(y)}`);
      }
      g += `<path class="ls-g ${a.m.vd < 50 ? 'fl' : 'cr'}" d="M${pts.join('L')}Z"/>`;
    }
    /* 絞り: 今の開きと、開放の開き（破線） */
    const zs = s[st.sys.si].z,
      r = st.rs,
      R = s[st.sys.si].sd * 1.3;
    g += `<path class="ls-stop" d="M${X(zs)} ${Y(r)}V${Y(R)}M${X(zs)} ${Y(-r)}V${Y(-R)}"/>`;
  } else {
    const zl = st.zs - p.si;
    g += `<path class="ls-ideal" d="M${X(zl)} ${Y(p.a * 1.15)}V${Y(-p.a * 1.15)}"/>`;
    g += `<path class="ls-ideal-h" d="M${X(zl)} ${Y(p.a * 1.15)}l-4 6h8zM${X(zl)} ${Y(-p.a * 1.15)}l-4 -6h8z"/>`;
  }
  /* センサー（対角の長さ） */
  g += `<path class="ls-sen" d="M${X(st.zs)} ${Y(HALF_DIAG)}V${Y(-HALF_DIAG)}"/>`;
  /* 光線: 軸上の光束（ピントの面の中心から）と、隅（対角の端）へ向かう光束。d 線 */
  const bundles: [string, number][] = [
    ['ls-r1', 0],
    ['ls-r2', HALF_DIAG],
  ];
  for (const [cls, h] of bundles) {
    let d = '';
    if (p.ideal) d = idealRays(p, h, X, Y, z0);
    else {
      const u = fieldU(st, h),
        yc = h ? aimChief(st, u, LD) : 0;
      for (let j = 0; j < 7; j++) {
        const py = ((2 * j) / 6 - 1) * st.rep;
        const r = objRay(st, u, 0, py, yc);
        /* 描く範囲の左端（物体がそれより遠いとき）から始める */
        if (r.z < z0) {
          const t = (z0 - r.z) / r.dz;
          r.x += t * r.dx;
          r.y += t * r.dy;
          r.z = z0;
        }
        const pts: string[] = [`${X(r.z)} ${Y(r.y)}`];
        const at = traceFwd(st, r, LD, (_i, _x, y, z) => pts.push(`${X(z)} ${Y(y)}`));
        if (at < 0) pts.push(`${X(r.z)} ${Y(r.y)}`);
        d += `M${pts.join('L')}`;
      }
    }
    g += `<path class="${cls}" d="${d}"/>`;
  }
  const label = p.ideal
    ? '収差なしの薄いレンズと光線の断面図'
    : `${st.sys.rx.name}の断面図。軸上の光束と、像の隅へ向かう光束を描く。レンズは ${s.filter((x, i) => !x.stop && x.m.nd !== 1 && i < s.length - 1).length} 枚`;
  return { svg: g, label };
}

function idealRays(p: SecIn, h: number, X: (z: number) => string, Y: (y: number) => string, z0: number): string {
  const { st, si, so, a } = p;
  const zl = st.zs - si;
  /* 像の点（センサーの上）と、その共役の物点 */
  const yi = h,
    yo = so > 0 ? (-yi * so) / si : 0;
  let d = '';
  for (let j = 0; j < 7; j++) {
    const ya = ((2 * j) / 6 - 1) * a;
    let zs0: number, ys0: number;
    if (so > 0) {
      const zo = zl - so;
      if (zo >= z0) {
        zs0 = zo;
        ys0 = yo;
      } else {
        zs0 = z0;
        ys0 = ya + ((yo - ya) * (zl - z0)) / so;
      }
    } else {
      /* 無限遠: 主光線（レンズの中心を通る）と平行 */
      const sl = yi / si;
      zs0 = z0;
      ys0 = ya - sl * (zl - z0);
    }
    d += `M${X(zs0)} ${Y(ys0)}L${X(zl)} ${Y(ya)}L${X(st.zs)} ${Y(yi)}`;
  }
  return d;
}

/* ---------- 収差の図 ---------- */
export const ABR = { w: 400, h: 152 } as const;
const BOX = 118,
  GAP = 13;
const bx = (i: number) => 4 + i * (BOX + GAP);

/** スポットダイアグラム 3 つ（中心・0.7・隅）。点は d 線の重心から、µm */
export function spotSvg(sp: Spot[], Nw: number): { svg: string; label: string; scale: number } {
  let m = 1e-3;
  for (const s of sp) for (const L of s.pts) for (let i = 0; i < L.length; i++) m = Math.max(m, Math.abs(L[i]));
  const half = nice(m * 1000 * 1.05);
  const airy = 1.22 * LD * Nw;
  let g = '';
  const names = ['中心', '0.7', '隅'];
  sp.forEach((s, i) => {
    const x0 = bx(i),
      y0 = 4,
      c = BOX / 2,
      k = c / half;
    g += `<rect class="gb" x="${x0}" y="${y0}" width="${BOX}" height="${BOX}"/>`;
    g += `<path class="gl" d="M${x0 + c} ${y0}V${y0 + BOX}M${x0} ${y0 + c}H${x0 + BOX}"/>`;
    const ar = airy * k;
    if (ar > 0.6) g += `<circle class="sp-airy" cx="${x0 + c}" cy="${y0 + c}" r="${n1(Math.min(ar, c))}"/>`;
    ['sp-f', 'sp-d', 'sp-c'].forEach((cls, w) => {
      const L = s.pts[w];
      let d = '';
      for (let j = 0; j < L.length; j += 2) {
        const x = x0 + c + L[j] * 1000 * k,
          y = y0 + c - L[j + 1] * 1000 * k;
        if (x < x0 || x > x0 + BOX || y < y0 || y > y0 + BOX) continue;
        d += `M${n1(x - 0.7)} ${n1(y - 0.7)}h1.4v1.4h-1.4z`;
      }
      g += `<path class="${cls}" d="${d}"/>`;
    });
    const rms = s.rms * 1000;
    g += `<text class="ab-t" x="${x0 + c}" y="${y0 + BOX + 12}" text-anchor="middle">${names[i]} ${num(s.h)} mm</text>`;
    g += `<text class="ab-t2" x="${x0 + c}" y="${y0 + BOX + 24}" text-anchor="middle">${s.pass > 0 ? `RMS ${num(rms)} µm` : '光が届かない'}</text>`;
  });
  return {
    svg: g,
    scale: half,
    label: `スポットダイアグラム。中心・0.7・隅の像の点の広がり。枠の半幅 ${half} µm。RMS 半径 ${sp.map((s) => `${num(s.rms * 1000)} µm`).join('・')}`,
  };
}

/** 収差の曲線 3 つ: 球面収差（縦、3 波長）、非点収差（子午・球欠）、歪曲 */
export function curveSvg(st: State): { svg: string; label: string; ranges: [number, number, number] } {
  const sph = sphCurve(st),
    fc = fieldCurve(st),
    ds = distCurve(st);
  let g = '';
  /* 横の範囲（切りのよい値）。0 を中央に置く */
  const mx = (v: number[]) => v.reduce((a, b) => Math.max(a, Math.abs(b)), 0);
  const r1 = nice(Math.max(mx(sph.flat().map((p) => p[1])) * 1.1, 0.01));
  const r2 = nice(Math.max(mx(fc.flatMap((p) => [p.t, p.s])) * 1.1, 0.01));
  const r3 = nice(Math.max(mx(ds.map((p) => p[1])) * 1.1, 0.1));
  const frame = (i: number, title: string, xr: number, unit: string, note = '') => {
    const x0 = bx(i);
    let t = `<rect class="gb" x="${x0}" y="4" width="${BOX}" height="${BOX}"/>`;
    for (let j = 1; j < 4; j++) t += `<path class="gl" d="M${x0 + (BOX * j) / 4} 4V${4 + BOX}"/>`;
    for (let j = 1; j < 4; j++) t += `<path class="gl" d="M${x0} ${4 + (BOX * j) / 4}H${x0 + BOX}"/>`;
    t += `<path class="gl0" d="M${x0 + BOX / 2} 4V${4 + BOX}"/>`;
    t += `<text class="ab-t" x="${x0 + BOX / 2}" y="${4 + BOX + 12}" text-anchor="middle">${title}</text>`;
    t += `<text class="ab-t2" x="${x0 + BOX / 2}" y="${4 + BOX + 24}" text-anchor="middle">±${num(xr)} ${unit}${note}</text>`;
    return t;
  };
  const path = (i: number, xr: number, pts: [number, number][], ymax: number) => {
    const x0 = bx(i);
    return pts
      .map(
        ([v, y], j) =>
          `${j ? 'L' : 'M'}${n1(x0 + BOX / 2 + (Math.max(-xr, Math.min(xr, v)) / xr) * (BOX / 2))} ${n1(4 + BOX - (y / ymax) * BOX)}`,
      )
      .join('');
  };
  g += frame(0, '球面収差', r1, 'mm');
  ['sp-f', 'sp-d', 'sp-c'].forEach((cls, w) => {
    const pts = sph[w].map(([p, dz]) => [dz, p] as [number, number]);
    if (sph[w].length) pts.unshift([sph[w][0][1], 0]);
    g += `<path class="cv ${cls}" d="${path(0, r1, pts, 1)}"/>`;
  });
  g += frame(1, '非点収差', r2, 'mm', '・T 実線・S 破線');
  g += `<path class="cv sp-d" d="${path(
    1,
    r2,
    fc.map((p) => [p.t, p.h]),
    HALF_DIAG,
  )}"/>`;
  g += `<path class="cv sp-d dash" d="${path(
    1,
    r2,
    fc.map((p) => [p.s, p.h]),
    HALF_DIAG,
  )}"/>`;
  g += frame(2, '歪曲', r3, '%');
  g += `<path class="cv sp-d" d="${path(2, r3, [[0, 0], ...ds.map(([h, d]) => [d, h] as [number, number])], HALF_DIAG)}"/>`;
  const last = ds.at(-1);
  return {
    svg: g,
    ranges: [r1, r2, r3],
    label: `収差の曲線。球面収差（横 ±${num(r1)} mm、F・d・C 線）、非点収差（横 ±${num(r2)} mm、縦は像の高さ）、歪曲（横 ±${num(r3)} %${last ? `、隅で ${num(last[1])} %` : ''}）`,
  };
}
