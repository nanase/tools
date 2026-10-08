/**
 * 図の SVG（DOM に依存しない文字列）: 上から見た見取り図、レンズの断面と光線、スポットダイアグラムと収差の曲線
 */
import { distCurve, fieldCurve, type Spot, sphCurve } from './analysis';
import { LD, SPECTRAL } from './glass';
import { aimChief, fieldU, HALF_DIAG, objRay, type State, traceFwd } from './optics';
import { BOARDS, CYLS, SKY, STRINGS, WALL } from './scene';

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
  /* 空の天体（無限遠）: 遠景の環の上に方位と名前 */
  for (const b of SKY) {
    const a = (b.az * Math.PI) / 180,
      [x, y] = mp(a, MAP.rmax),
      l = b.az < 0;
    s += `<circle class="mp-sky" cx="${n1(x)}" cy="${n1(y)}" r="2.6"/>`;
    s += `<text class="mp-t" x="${n1(x + (l ? -6 : 6))}" y="${n1(y + 4)}"${l ? ' text-anchor="end"' : ''}>${b.name}</text>`;
  }
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
  `ピントは ${Number.isFinite(m.fd) ? `${num(m.fd)} m` : '無限遠'}、被写界深度は ${num(m.near)} m から ${Number.isFinite(m.far) ? `${num(m.far)} m` : '無限遠'} まで。` +
  `空に ${SKY.map((b) => `${b.name}（方位 ${num(b.az)}°・仰角 ${b.el}°）`).join('、')}`;

/* ---------- レンズの断面と光線 ---------- */
/** 断面図の全体（上の top までがレンズ、その下にセンサーの付近の拡大図を 2 つ） */
export const SEC = { w: 400, h: 296, top: 200 } as const;
/** 拡大図の位置と大きさ */
const INS = { y: 212, w: 192, h: 64, gap: 8 } as const;

const sag = (c: number, y: number) => {
  const cy = Math.min(Math.abs(c * y), 0.999);
  return c === 0 ? 0 : (c * y * y) / (1 + Math.sqrt(1 - cy * cy));
};

export interface SecIn {
  st: State;
  ideal: boolean;
  /** 可視光の 7 波長で描く（false は d 線だけ） */
  spec: boolean;
  /** 収差なしの薄いレンズの像距離・物体距離（0 は無限遠）・半径 */
  si: number;
  so: number;
  a: number;
}

/**
 * センサーの付近の光線（子午面の直線）: センサーの面での高さ y と傾き dy/dz、波長の番号（SPECTRAL の順、
 * d 線だけなら -1）、瞳の中心を通る光線か
 */
interface Line {
  y: number;
  s: number;
  w: number;
  c: boolean;
}
/** 拡大図の 1 つ: 光線、波長ごとの印（中心はピントの位置 z、隅はセンサーの上の高さ y）、縦の中心 */
interface Inset {
  lines: Line[];
  marks: { w: number; v: number }[];
  yc: number;
}

/** 描く波長: [記号, 波長, 番号] */
const waves = (spec: boolean): [string, number, number][] =>
  spec ? SPECTRAL.map(([n, l], i) => [n, l, i]) : [['d', LD, -1]];
const wcls = (w: number) => (w < 0 ? '' : ` s-${SPECTRAL[w][0]}`);
/** 拡大図の光線の、入射瞳の高さの割合（中心・隅） */
const FAN = { ax: [-1, -0.7, -0.4, 0.4, 0.7, 1], cn: [-1, -0.5, 0, 0.5, 1] } as const;

export function sectionSvg(p: SecIn): { svg: string; label: string } {
  const { st } = p,
    s = st.sys.s;
  const zEnd = st.zs,
    zLen = zEnd;
  const ymax = Math.max(...s.map((x) => x.sd), HALF_DIAG) * 1.08;
  const z0 = -0.28 * zLen,
    z1 = zEnd + 0.03 * zLen;
  const k = Math.min((SEC.w - 16) / (z1 - z0), (SEC.top - 16) / (2 * ymax));
  const ox = (SEC.w - (z1 - z0) * k) / 2 - z0 * k,
    oy = SEC.top / 2;
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
  /* 光線: 軸上の光束（ピントの面の中心から）と、隅（対角の端）へ向かう光束。物体側の光線はどの波長も
     同じ（d 線の主光線に合わせる）で、レンズの中で波長ごとに分かれる */
  const bundles: [string, number][] = [
    ['ls-r1', 0],
    ['ls-r2', HALF_DIAG],
  ];
  const ws = waves(p.spec && !p.ideal);
  for (const [cls, h] of bundles) {
    if (p.ideal) {
      g += `<path class="${cls}" d="${idealRays(p, h, X, Y, z0)}"/>`;
      continue;
    }
    const u = fieldU(st, h),
      yc = h ? aimChief(st, u, LD) : 0;
    for (const [, l, w] of ws) {
      let d = '';
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
        const at = traceFwd(st, r, l, (_i, _x, y, z) => pts.push(`${X(z)} ${Y(y)}`));
        if (at < 0) pts.push(`${X(r.z)} ${Y(r.y)}`);
        d += `M${pts.join('L')}`;
      }
      g += `<path class="${w < 0 ? cls : `ls-w${wcls(w)}`}" d="${d}"/>`;
    }
  }
  /* センサーの付近の拡大図（中心・隅） */
  const cap: string[] = [];
  [0, HALF_DIAG].forEach((h, i) => {
    const r = insetSvg(p, insetOf(p, h, ws), i, i ? '隅の像の付近' : '中心の像の付近');
    g += r.svg;
    cap.push(r.label);
  });
  const nl = s.filter((x, i) => !x.stop && x.m.nd !== 1 && i < s.length - 1).length;
  const how = p.ideal ? '' : p.spec ? '可視光の 7 波長（405〜707 nm）で' : 'd 線で';
  const label = `${p.ideal ? '収差なしの薄いレンズ' : `${st.sys.rx.name}（レンズは ${nl} 枚）`}と光線の断面図。軸上の光束と、像の隅へ向かう光束を${how}描く。下はセンサーの付近の拡大図: ${cap.join('。')}`;
  return { svg: g, label };
}

/** 拡大図の光線（センサーの面での直線）と、波長ごとの印 */
function insetOf(p: SecIn, h: number, ws: [string, number, number][]): Inset {
  const { st } = p;
  const lines: Line[] = [],
    marks: Inset['marks'] = [];
  const fan = h ? FAN.cn : FAN.ax;
  if (p.ideal) {
    for (const f of fan) lines.push({ y: h, s: (h - f * p.a) / p.si, w: -1, c: f === 0 });
    return { lines, marks, yc: h };
  }
  const u = fieldU(st, h),
    yc0 = h ? aimChief(st, u, LD) : 0;
  const ray = (py: number, l: number): Omit<Line, 'w' | 'c'> | null => {
    const r = objRay(st, u, 0, py * st.rep, yc0);
    return traceFwd(st, r, l) < 0 && r.dz > 0 ? { y: r.y, s: r.dy / r.dz } : null;
  };
  let yc = h;
  for (const [, l, w] of ws) {
    for (const f of fan) {
      const ln = ray(f, l);
      if (ln) lines.push({ ...ln, w, c: f === 0 });
    }
    if (h) {
      /* 隅: 波長ごとの主光線がセンサーに当たる高さ（倍率色収差） */
      const c = ray(0, l);
      if (c) {
        marks.push({ w, v: c.y });
        if (l === LD) yc = c.y;
      }
    } else {
      /* 中心: 瞳の中心の近くの光線が光軸を横切る位置（波長ごとの近軸のピント） */
      const c = ray(0.05, l);
      if (c && c.s !== 0) marks.push({ w, v: st.zs - c.y / c.s });
    }
  }
  return { lines, marks, yc };
}

function insetSvg(p: SecIn, t: Inset, i: number, title: string): { svg: string; label: string } {
  const { st } = p;
  const x0 = 4 + i * (INS.w + INS.gap),
    y0 = INS.y,
    f = st.sys.f;
  /* 横（z）の範囲: 光線が光軸（隅は同じ波長の主光線）と交わる位置と、波長ごとのピントが収まる幅 */
  let mz = 0;
  for (const l of t.lines) {
    const ref = i ? t.lines.find((m) => m.c && m.w === l.w) : { y: 0, s: 0 };
    if (ref && l.s !== ref.s) mz = Math.max(mz, Math.min(Math.abs((l.y - ref.y) / (l.s - ref.s)), 0.2 * f));
  }
  if (!i) for (const m of t.marks) mz = Math.max(mz, Math.abs(m.v - st.zs));
  const Lz = nice(Math.max(mz * 1.25, 4e-4 * f, 1e-3));
  /* 縦（y）の範囲: 窓の両端での光線の広がり */
  let my = 0;
  for (const l of t.lines) for (const dz of [-Lz, Lz]) my = Math.max(my, Math.abs(l.y + l.s * dz - t.yc));
  if (i) for (const m of t.marks) my = Math.max(my, Math.abs(m.v - t.yc) * 1.3);
  const Ly = nice(Math.max(my * 1.05, 1e-4));
  const X = (z: number) => x0 + ((z - st.zs + Lz) / (2 * Lz)) * INS.w,
    Y = (y: number) => y0 + INS.h / 2 - ((y - t.yc) / Ly) * (INS.h / 2);
  const cx = x0 + INS.w / 2;
  let g = `<text class="ab-t" x="${x0}" y="${y0 - 4}">${title}</text>`;
  g += `<rect class="gb" x="${x0}" y="${y0}" width="${INS.w}" height="${INS.h}"/>`;
  g += `<clipPath id="ls-clip${i}"><rect x="${x0}" y="${y0}" width="${INS.w}" height="${INS.h}"/></clipPath><g clip-path="url(#ls-clip${i})">`;
  if (!i) g += `<path class="ls-ax" d="M${x0} ${n1(Y(0))}H${x0 + INS.w}"/>`;
  g += `<path class="ls-sen-i" d="M${n1(cx)} ${y0}V${y0 + INS.h}"/>`;
  /* 光線は波長ごとに 1 本の path */
  const by = new Map<number, string>();
  for (const l of t.lines)
    by.set(l.w, `${by.get(l.w) ?? ''}M${x0} ${n1(Y(l.y - l.s * Lz))}L${x0 + INS.w} ${n1(Y(l.y + l.s * Lz))}`);
  for (const [w, d] of by) g += `<path class="${w < 0 ? (i ? 'ls-r2' : 'ls-r1') : `ls-w${wcls(w)}`}" d="${d}"/>`;
  /* 波長ごとの印（中心は光軸の上のピントの位置、隅はセンサーの上の高さ）と、重ならない所に波長 [nm]（間隔はスマホの大きい字で決める） */
  const at = (v: number) => (i ? Y(v) : X(v));
  const ms = [...t.marks].sort((a, b) => at(a.v) - at(b.v));
  let lab = '',
    last = -1e9;
  for (const m of ms) {
    const q = at(m.v);
    g += i
      ? `<path class="ls-tk${wcls(m.w)}" d="M${n1(cx - 5)} ${n1(q)}H${n1(cx + 5)}"/>`
      : `<path class="ls-tk${wcls(m.w)}" d="M${n1(q)} ${n1(Y(0) - 5)}V${n1(Y(0) + 5)}"/>`;
    const lo = i ? y0 + 6 : x0 + 8,
      hi = i ? y0 + INS.h - 1 : x0 + INS.w - 8;
    if (m.w >= 0 && q - last >= (i ? 13 : 26) && q > lo && q < hi) {
      const nm = Math.round(SPECTRAL[m.w][1] * 1000);
      lab += i
        ? `<text class="ab-t2 ls-lab" x="${n1(cx + 8)}" y="${n1(q + 3)}">${nm}</text>`
        : `<text class="ab-t2 ls-lab" x="${n1(q)}" y="${n1(Y(0) + 14)}" text-anchor="middle">${nm}</text>`;
      last = q;
    }
  }
  g += `${lab}</g>`;
  g += `<text class="ab-t2" x="${x0 + INS.w}" y="${y0 + INS.h + 12}" text-anchor="end">横 ±${num(Lz)} mm・縦 ±${num(Ly * 1000)} µm</text>`;
  let label = `${title}（横 ±${num(Lz)} mm、縦 ±${num(Ly * 1000)} µm）`;
  const mv = t.marks.filter((m) => m.w >= 0).map((m) => m.v);
  if (mv.length > 1) {
    const d = Math.max(...mv) - Math.min(...mv);
    label += i ? `、波長による高さの差 ${num(d * 1000)} µm` : `、波長によるピントの差 ${num(d)} mm`;
  }
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
