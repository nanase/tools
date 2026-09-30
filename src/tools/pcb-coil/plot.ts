/**
 * 表示窓（10 × 6 div）に描く SVG の組み立て（DOM に依存しない）:
 * コイルの形（縮尺どおり）と、Q・交流抵抗の周波数特性（1 kHz – 100 MHz の対数）
 */
import { fmt, parts } from '../../lib/format';
import { DV, SH, SW } from '../../lib/scope';
import { type Ac, ac, type Coil, fSkin, fTenth, type Shape, spiral } from './coil';
import type { Conn, Stack } from './layers';
import { hzT, mmT, sig } from './params';

const tsub = (s: string) => `<tspan dy="3" font-size="0.75em">${s}</tspan>`;

/* ---------- コイルの形 ---------- */
/** 方眼の 1 div あたり [mm] の候補 */
const FDIV = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50];

export interface FigIn {
  sh: Shape;
  n: number;
  /** 画面の値 [mm] */
  dout: number;
  din: number;
  w: number;
  s: number;
}

export interface FigPlot {
  /** うずまきの中心線 */
  coil: string;
  /** 線の太さ（配線の幅を縮尺どおりに。細すぎるときは 0.8） */
  width: string;
  /** 両端のパッド */
  pads: string;
  /** 寸法線 */
  dim: string;
  /** 方眼の 1 div あたり [mm] */
  dv: number;
  label: string;
}

/** コイルを表示窓の中央に、外径が 216 × 128 に収まる方眼で描く。右に外径、左に内径の寸法線 */
export function figPlot({ sh, n, dout, din, w, s }: FigIn): FigPlot {
  const R = dout / 2,
    ext = sh.k === 6 ? 1 / Math.cos(Math.PI / 6) : 1;
  const dv = FDIV.find((d) => (dout / d) * DV <= 216 && ((R * ext) / d) * DV <= 128) ?? FDIV[FDIV.length - 1];
  const sc = DV / dv,
    cx = SW / 2,
    cy = SH / 2;
  const X = (x: number) => (cx + x * sc).toFixed(2),
    Y = (y: number) => (cy - y * sc).toFixed(2);
  const pts = spiral(sh.k, n, R - w / 2, w + s);
  const coil = pts.map((q, i) => `${i ? 'L' : 'M'}${X(q[0])} ${Y(q[1])}`).join('');
  const pr = Math.max(2.4, w * sc * 0.8).toFixed(2),
    a = pts[0],
    b = pts[pts.length - 1];
  const pads = `<circle class="pad" cx="${X(a[0])}" cy="${Y(a[1])}" r="${pr}"/><circle class="pad" cx="${X(b[0])}" cy="${Y(b[1])}" r="${pr}"/>`;
  /* 寸法線: 右に外径、左に内径（どちらも縦に、向かい合う辺の間） */
  const tn = sh.k ? Math.tan(Math.PI / sh.k) : 0;
  const arrows = (x: number, y1: string, y2: string) =>
    `<path class="dah" d="M${x} ${y1}l-3 6h6ZM${x} ${y2}l-3 -6h6Z"/>`;
  const xr = cx + R * ext * sc + 12,
    top = (cy - R * sc).toFixed(1),
    bot = (cy + R * sc).toFixed(1),
    xo = (cx + R * tn * sc + 3).toFixed(1);
  let h = `<path class="ext" d="M${xo} ${top}H${xr + 4}M${xo} ${bot}H${xr + 4}"/>`;
  h += `<path class="dim" d="M${xr} ${top}V${bot}"/>${arrows(xr, top, bot)}`;
  h += `<text class="dl" x="${xr + 6}" y="${cy - 4}">d${tsub('out')}</text><text class="dl" x="${xr + 6}" y="${cy + 14}">${mmT(dout)}</text>`;
  const ri = (din / 2) * sc;
  if (ri >= 7) {
    const xl = cx - R * ext * sc - 12,
      t2 = (cy - ri).toFixed(1),
      b2 = (cy + ri).toFixed(1),
      xs = (cx - (din / 2) * tn * sc - 3).toFixed(1);
    h += `<path class="ext" d="M${xs} ${t2}H${xl - 4}M${xs} ${b2}H${xl - 4}"/>`;
    h += `<path class="dim" d="M${xl} ${t2}V${b2}"/>${arrows(xl, t2, b2)}`;
    h += `<text class="dl" x="${xl - 6}" y="${cy - 4}" text-anchor="end">d${tsub('in')}</text><text class="dl" x="${xl - 6}" y="${cy + 14}" text-anchor="end">${mmT(din)}</text>`;
  }
  return {
    coil,
    width: `${Math.max(0.8, w * sc).toFixed(2)}px`,
    pads,
    dim: h,
    dv,
    label: `${sh.ab}のうずまきコイル。${n} 巻、外径 ${mmT(dout)}、内径 ${mmT(din)}、配線の幅 ${mmT(w)}、間隔 ${mmT(s)}。方眼は ${sig(dv, 2)} mm/div。`,
  };
}

/* ---------- 周波数特性 ---------- */
export const F0 = 1e3,
  F1 = 1e8;
/** 周波数 → x */
export const LX = (f: number): number => (Math.log10(f / F0) / Math.log10(F1 / F0)) * SW;
/** x → 周波数 */
export const XF = (x: number): number => F0 * (F1 / F0) ** (x / SW);
/** 縦軸の 1 div あたりの候補（1-2-5） */
const STEPS = (() => {
  const o: number[] = [];
  for (let e = -4; e <= 6; e++) for (const b of [1, 2, 5]) o.push(Number((b * 10 ** e).toPrecision(2)));
  return o;
})();
/** 最大値が 6 div に 4 % の余裕をもって入る刻み */
export const divOf = (mx: number): number => STEPS.find((d) => d * 6 >= mx * 1.04) ?? STEPS[STEPS.length - 1];

/** 目盛り（ビルド時に使う）: 1 桁 2 div の対数、10 の累乗は実線、間は点線 */
export function frGrid(): string {
  let g = '';
  for (let d = 3; d <= 8; d++)
    for (let m = 1; m < 10; m++) {
      const f = m * 10 ** d;
      if (f <= F0 || f >= F1) continue;
      g += `<path class="${m === 1 ? 'gl' : 'gl2'}" d="M${LX(f).toFixed(1)} 0V${SH}"/>`;
    }
  for (let j = 1; j < 6; j++) g += `<path class="gl" d="M0 ${j * DV}H${SW}"/>`;
  for (let y = 8; y < SH; y += 8) g += `<path class="gb" d="M0 ${y}h4M${SW} ${y}h-4"/>`;
  return `${g}<rect class="gb" x="0" y="0" width="${SW}" height="${SH}"/>`;
}

export interface FrPlot {
  /** Q・交流抵抗（実線と、波長の 1/10 を超える先の破線） */
  q: string;
  qOver: string;
  r: string;
  rOver: string;
  /** 波長の 1/10 の縦線、f の縦線、δ = t の縦線、自己共振の縦線（範囲外なら空） */
  lambda: string;
  srf: string;
  fLine: string;
  skin: string;
  axes: string;
  /** 縦軸の 1 div あたり（Q と Ω） */
  qd: number;
  rd: number;
  label: string;
}

/** 周波数特性。縦軸は実線の範囲（少なくとも左 1/5）の最大で決め、破線ははみ出す分を切る。srf は多層の自己共振 */
export function frPlot(g: Coil & { srf?: number }): FrPlot {
  const K = 200,
    F: number[] = [],
    Qs: number[] = [],
    Rs: number[] = [];
  for (let i = 0; i <= K; i++) {
    const f = F0 * (F1 / F0) ** (i / K),
      a = ac(f, g.L, g.len, g.w, g.t, g.rk);
    F.push(f);
    Qs.push(a.q);
    Rs.push(a.rac);
  }
  const fl = fTenth(g.len),
    cut = F.findIndex((f) => f > fl),
    k1 = cut < 0 ? K : Math.max(0, cut - 1),
    kv = Math.max(k1, K / 5);
  const qd = divOf(Math.max(...Qs.slice(0, kv + 1))),
    rd = divOf(Math.max(...Rs.slice(0, kv + 1)));
  const YQ = (v: number) => (SH - (v / qd) * DV).toFixed(1),
    YR = (v: number) => (SH - (v / rd) * DV).toFixed(1);
  const pth = (Y: (v: number) => string, V: number[], a: number, b: number) =>
    b <= a
      ? ''
      : F.slice(a, b + 1)
          .map((f, i) => `${i ? 'L' : 'M'}${LX(f).toFixed(1)} ${Y(V[a + i])}`)
          .join('');
  const xf = LX(g.f).toFixed(1),
    ft = fSkin(g.t),
    inX = (f: number) => f > F0 && f < F1;
  let a = '';
  for (let j = 0; j <= 6; j++) a += `<text x="-10" y="${SH - j * DV + 4}" text-anchor="end">${sig(j * qd, 3)}</text>`;
  for (let j = 0; j <= 6; j++)
    a += `<text class="p2" x="${SW + 10}" y="${SH - j * DV + 4}">${j ? parts(j * rd, '', 3).join('') : '0'}</text>`;
  for (let d = 3; d <= 8; d++)
    a += `<text x="${LX(10 ** d).toFixed(1)}" y="${SH + 17}" text-anchor="middle">${parts(10 ** d, '', 3).join('')}</text>`;
  a += `<text x="${xf}" y="-5" text-anchor="middle">f</text>`;
  if (inX(ft)) a += `<text class="dl" x="${(LX(ft) + 4).toFixed(1)}" y="${SH - 8}">δ = t</text>`;
  if (fl < F1) a += `<text class="dl" x="${(LX(Math.max(fl, F0)) + 4).toFixed(1)}" y="16">λ/10</text>`;
  const fs = g.srf ?? Infinity,
    srfIn = inX(fs);
  if (srfIn) a += `<text class="dl" x="${(LX(fs) + 4).toFixed(1)}" y="32">SRF</text>`;
  return {
    q: pth(YQ, Qs, 0, k1),
    qOver: pth(YQ, Qs, k1, K),
    r: pth(YR, Rs, 0, k1),
    rOver: pth(YR, Rs, k1, K),
    lambda: fl < F1 ? `M${LX(Math.max(fl, F0)).toFixed(1)} 0V${SH}` : '',
    srf: srfIn ? `M${LX(fs).toFixed(1)} 0V${SH}` : '',
    fLine: `M${xf} 0V${SH}`,
    skin: inX(ft) ? `M${LX(ft).toFixed(1)} 0V${SH}` : '',
    axes: a,
    qd,
    rd,
    label:
      `Q と交流抵抗の周波数特性。横軸は 1 kHz から 100 MHz の対数、縦軸は Q ${sig(qd, 2)}/div と交流抵抗 ${fmt(rd, 'Ω', 2)}/div。${hzT(g.f)} で Q ${sig(g.q, 3)}、交流抵抗 ${fmt(g.rac, 'Ω')}。` +
      (inX(ft) ? `表皮の深さが銅箔の厚さと等しくなるのは ${fmt(ft, 'Hz', 3)}。` : '') +
      (fl < F1 ? `${fmt(Math.max(fl, F0), 'Hz', 3)} より上は配線の長さが波長の 1/10 を超えるため破線。` : '') +
      (srfIn ? `層の間の容量による自己共振は ${fmt(fs, 'Hz', 3)}。` : ''),
  };
}

/** カーソルの読み取り（x が null なら f の値） */
export function frRead(g: Coil, x: number | null): { f: number; a: Ac; html: string } {
  const f = x == null ? g.f : XF(x),
    a = ac(f, g.L, g.len, g.w, g.t, g.rk);
  return {
    f,
    a,
    html: `${x == null ? 'f' : 'CUR'} <b>${fmt(f, 'Hz', 4)}</b> Q <b>${sig(a.q, 3)}</b> R <b>${fmt(a.rac, 'Ω', 3)}</b>`,
  };
}

/* ---------- 立体 ---------- */
export interface View3d {
  sh: Shape;
  n: number;
  /** 画面の値 [mm] */
  dout: number;
  w: number;
  s: number;
  st: Stack;
  conn: Conn;
  /** 方位角・仰角 [rad]（仰角 π/2 で真上、−π/2 で真下から） */
  az: number;
  el: number;
  /** 拡大率（1 でどの向きでも基板が収まる大きさ） */
  zoom: number;
}
export interface Plot3d {
  svg: string;
  label: string;
}

type P2 = readonly [number, number];
/** 原点を通り、角度 th [rad] の向きの直線での鏡映 */
const reflect = (P: readonly P2[], th: number): P2[] => {
  const ux = Math.cos(th),
    uy = Math.sin(th);
  return P.map(([x, y]) => {
    const d = 2 * (x * ux + y * uy);
    return [d * ux - x, d * uy - y] as const;
  });
};
/**
 * 点 j に最も近い、形の対称軸の角度。多角形の対称軸は面の向き（90°、90° − 360°/k …）と頂点の向きで、
 * 180°/k ごとにある。円はどの向きも対称軸なので j の向きそのもの
 */
export function symAxis(k: number, j: P2): number {
  const a = Math.atan2(j[1], j[0]);
  if (!k) return a;
  const st = Math.PI / k,
    m = Math.round((a - Math.PI / 2) / st);
  return Math.PI / 2 + m * st;
}
/** 折れ線を間引く（円のうずまきは 1 周 180 点あるので、立体では 1 周 45 点にする） */
const thin = (P: readonly P2[], k: number): P2[] => P.filter((_, i) => i % k === 0 || i === P.length - 1);

/** 層と層をつなぐビア: 位置と、つなぐ層の範囲（a 〜 b） */
export interface Via {
  p: P2;
  a: number;
  b: number;
}

/**
 * 各層の配線を、電流の流れる順（端子 A から B へ）の折れ線で返す。どの層も表面から見て時計回りに流れる。
 * 直列: 次の層は、つなぎ目（内側の端か外側の端）に最も近い形の対称軸で前の層を鏡映した形（向きが傾かない）。
 * ビアはその対称軸の上に、内側のつなぎ目では最も内側の巻線よりさらに内へ、外側のつなぎ目では外へ置き、
 * 両方の層の端から短い線でつなぐ（ほかの巻線や端子と重ならない。深い層のビアほど離す）。
 * 並列: どの層も同じ形で、外側と内側の端をそれぞれ 1 本のビアで全層につなぐ。k は形の辺の数（円は 0）、p は巻線の間隔
 */
export function layerPaths(P: readonly P2[], nl: number, conn: Conn, k = 0, p = 1): { paths: P2[][]; vias: Via[] } {
  if (conn === 'par' || nl <= 1)
    return {
      paths: Array.from({ length: nl }, () => P.slice()),
      vias: nl > 1 ? [P[0], P[P.length - 1]].map((q) => ({ p: q, a: 0, b: nl - 1 })) : [],
    };
  const paths: P2[][] = [P.slice()],
    vias: Via[] = [];
  let shape: P2[] = P.slice();
  for (let i = 1; i < nl; i++) {
    const inner = i % 2 === 1,
      j = inner ? shape[shape.length - 1] : shape[0],
      th = symAxis(k, j);
    shape = reflect(shape, th);
    const j2 = inner ? shape[shape.length - 1] : shape[0],
      m: P2 = [(j[0] + j2[0]) / 2, (j[1] + j2[1]) / 2];
    /* 軸の外向きの単位ベクトル。内側は中心へ、外側は外へ、深い層ほど遠くへ置く */
    let ux = Math.cos(th),
      uy = Math.sin(th);
    if (ux * m[0] + uy * m[1] < 0) {
      ux = -ux;
      uy = -uy;
    }
    const d = p * 0.7 * Math.ceil(i / 2) * (inner ? -1 : 1),
      v: P2 = [m[0] + ux * d, m[1] + uy * d];
    paths[i - 1].push(v);
    const flow = inner ? shape.slice().reverse() : shape.slice();
    flow.unshift(v);
    paths.push(flow);
    vias.push({ p: v, a: i - 1, b: i });
  }
  return { paths, vias };
}

/** 厚さの向きの拡大率: 外径で決め（1〜10 倍）、基板の厚さの違いはそのまま比に出る */
export const thickScale = (dout: number): number => Math.min(10, Math.max(1, (dout * 0.25) / 1.6));

/**
 * 基板と配線を斜めから見た図（正射影）。厚さの向きは thickScale 倍にする（1 層は 1.6 mm 厚の基板とみなす）。
 * どの向きから見ても基板が収まる大きさを 1 とし、zoom 倍にする（回しても大きさは変わらない）。
 * 奥のものから描く: 奥の面の銅箔 → 奥の面 → 側面 → 内層 → 手前の面 → 手前の面の銅箔 → ビアと端子
 */
export function coil3d(v: View3d): Plot3d {
  const { sh, n, dout, w, s, st, conn, az, el, zoom } = v,
    nl = st.n,
    R = dout / 2;
  const base = spiral(sh.k, n, R - w / 2, w + s),
    P = thin(base, sh.k ? 1 : 4),
    { paths: L, vias } = layerPaths(P, nl, conn, sh.k, w + s);
  /* 層の高さ（上の層ほど高い、表面が 0）。誘電体の厚さを拡大して積む */
  const ex = thickScale(dout),
    zs: number[] = [0];
  for (let i = 1; i < nl; i++) zs.push(zs[i - 1] - st.gaps[i - 1] * ex);
  const zb = nl > 1 ? zs[nl - 1] : -1.6 * ex;
  const ca = Math.cos(az),
    sa = Math.sin(az),
    se = Math.sin(el),
    ce = Math.cos(el);
  const pr = (x: number, y: number, z: number): P2 => [x * ca - y * sa, -(x * sa + y * ca) * se - (z - zb / 2) * ce];
  /* 基板の外形（外径より少し大きい正方形）。これを包む球が 400 × 280 に収まる大きさを 1 とする */
  const B = R * (sh.k === 6 ? 1 / Math.cos(Math.PI / 6) : 1) + Math.max(2, dout * 0.08),
    corners: P2[] = [
      [-B, -B],
      [B, -B],
      [B, B],
      [-B, B],
    ];
  const rb = Math.hypot(B * Math.SQRT2, zb / 2),
    sc = (130 / rb) * zoom;
  const f = (q: P2) => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`,
    at = (x: number, y: number, z: number): P2 => {
      const q = pr(x, y, z);
      return [200 + q[0] * sc, 140 + q[1] * sc];
    };
  const wp = Math.max(0.8, w * sc).toFixed(2);
  const face = (z: number, cl: string) =>
    `<path class="${cl}" d="M${corners.map(([x, y]) => f(at(x, y, z))).join('L')}Z"/>`;
  const sides = () =>
    corners
      .map(([x, y], i) => {
        const [x2, y2] = corners[(i + 1) % 4];
        return `<path class="pcb side" d="M${f(at(x, y, 0))}L${f(at(x2, y2, 0))}L${f(at(x2, y2, zb))}L${f(at(x, y, zb))}Z"/>`;
      })
      .join('');
  const layer = (i: number) => {
    const pts = L[i].map(([x, y]) => at(x, y, zs[i])),
      d = `M${pts.map(f).join('L')}`;
    return `<path class="tr l${i + 1}" d="${d}" style="stroke-width:${wp}px"/>` + `<path class="cur flow" d="${d}"/>`;
  };
  /* 上から見ているか（奥が裏面）、下から見ているか（奥が表面） */
  const up = se >= 0,
    order = Array.from({ length: nl }, (_, i) => (up ? nl - 1 - i : i));
  const outer = nl > 1 ? [order[0], order[nl - 1]] : [0, 0];
  let o = '';
  if (nl > 1) o += layer(outer[0]);
  else if (!up) o += layer(0);
  o += face(up ? zb : 0, `pcb ${up ? 'bot' : 'top'}`) + sides();
  for (const i of order) if (!outer.includes(i)) o += layer(i);
  o += face(up ? 0 : zb, `pcb ${up ? 'top' : 'bot'}`);
  if (nl > 1) o += layer(outer[1]);
  else if (up) o += layer(0);
  /* 層の名前（表面・裏面を添える）は、画面でいちばん左の角の横に */
  const left = corners.reduce((a, c) => (pr(c[0], c[1], 0)[0] < pr(a[0], a[1], 0)[0] ? c : a));
  const names: [number, string][] = zs.map((z, i) => [z, `L${i + 1}${i === 0 ? ' 表' : i === nl - 1 ? ' 裏' : ''}`]);
  if (nl === 1) names.push([zb, '裏']);
  /* 真上・真下に近いと層が重なるので、名前は 13 px 以上離して並べる */
  const lq = names.map(([z, t]) => [at(left[0], left[1], z), t] as const).sort((p, q) => p[0][1] - q[0][1]);
  let ly = -Infinity;
  for (const [q, t] of lq) {
    ly = Math.max(q[1] + 4, ly + 13);
    o += `<text x="${(q[0] - 6).toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="end">${t}</text>`;
  }
  /* ビア（層の間を縦の点線で結び、つなぐ各層に ○）と端子（白抜きの丸と A・B） */
  const pad = (q: P2) => `<circle class="vpad" cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="3.4"/>`;
  for (const { p: q, a, b } of vias) {
    o += `<path class="via" d="M${f(at(q[0], q[1], zs[a]))}L${f(at(q[0], q[1], zs[b]))}"/>`;
    for (let i = a; i <= b; i++) o += pad(at(q[0], q[1], zs[i]));
  }
  const term = (q: P2, z: number, l: string) => {
    const t = at(q[0], q[1], z);
    return `<circle class="term" cx="${t[0].toFixed(1)}" cy="${t[1].toFixed(1)}" r="3.6"/><text x="${(t[0] + 6).toFixed(1)}" y="${(t[1] - 5).toFixed(1)}">${l}</text>`;
  };
  if (nl > 1 && conn === 'par') o += term(P[0], zs[0], 'A') + term(P[P.length - 1], zs[0], 'B');
  else {
    const last = L[nl - 1];
    o += term(P[0], zs[0], 'A') + term(last[last.length - 1], zs[nl - 1], 'B');
  }
  o += `<text class="ex" x="10" y="270">厚さ ×${sig(ex, 2)}</text>`;
  const label =
    `${sh.ab}のうずまきコイルを斜めから見た図。${n} 巻、外径 ${mmT(dout)}、配線の幅 ${mmT(w)}、間隔 ${mmT(s)}。` +
    (nl > 1
      ? `${nl} 層を${conn === 'ser' ? '直列につなぎ、次の層は前の層を鏡に映した形で内側と外側で交互につなぐ' : '並列につなぎ、外側と内側の端で全層をつなぐ'}。`
      : '') +
    '電流は端子 A から B へ、どの層も表面から見て時計回りに流れる。';
  return { svg: o, label };
}
