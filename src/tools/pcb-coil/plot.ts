/**
 * 表示窓（10 × 6 div）に描く SVG の組み立て（DOM に依存しない）:
 * コイルの形（縮尺どおり）と、Q・交流抵抗の周波数特性（1 kHz – 100 MHz の対数）
 */
import { fmt, parts } from '../../lib/format';
import { DV, SH, SW } from '../../lib/scope';
import { type Ac, ac, type Coil, fSkin, fTenth, type Shape, spiral } from './coil';
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
  /** 波長の 1/10 の縦線、f の縦線、δ = t の縦線（範囲外なら空） */
  lambda: string;
  fLine: string;
  skin: string;
  axes: string;
  /** 縦軸の 1 div あたり（Q と Ω） */
  qd: number;
  rd: number;
  label: string;
}

/** 周波数特性。縦軸は実線の範囲（少なくとも左 1/5）の最大で決め、破線ははみ出す分を切る */
export function frPlot(g: Coil): FrPlot {
  const K = 200,
    F: number[] = [],
    Qs: number[] = [],
    Rs: number[] = [];
  for (let i = 0; i <= K; i++) {
    const f = F0 * (F1 / F0) ** (i / K),
      a = ac(f, g.L, g.len, g.w, g.t);
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
  return {
    q: pth(YQ, Qs, 0, k1),
    qOver: pth(YQ, Qs, k1, K),
    r: pth(YR, Rs, 0, k1),
    rOver: pth(YR, Rs, k1, K),
    lambda: fl < F1 ? `M${LX(Math.max(fl, F0)).toFixed(1)} 0V${SH}` : '',
    fLine: `M${xf} 0V${SH}`,
    skin: inX(ft) ? `M${LX(ft).toFixed(1)} 0V${SH}` : '',
    axes: a,
    qd,
    rd,
    label:
      `Q と交流抵抗の周波数特性。横軸は 1 kHz から 100 MHz の対数、縦軸は Q ${sig(qd, 2)}/div と交流抵抗 ${fmt(rd, 'Ω', 2)}/div。${hzT(g.f)} で Q ${sig(g.q, 3)}、交流抵抗 ${fmt(g.rac, 'Ω')}。` +
      (inX(ft) ? `表皮の深さが銅箔の厚さと等しくなるのは ${fmt(ft, 'Hz', 3)}。` : '') +
      (fl < F1 ? `${fmt(Math.max(fl, F0), 'Hz', 3)} より上は配線の長さが波長の 1/10 を超えるため破線。` : ''),
  };
}

/** カーソルの読み取り（x が null なら f の値） */
export function frRead(g: Coil, x: number | null): { f: number; a: Ac; html: string } {
  const f = x == null ? g.f : XF(x),
    a = ac(f, g.L, g.len, g.w, g.t);
  return {
    f,
    a,
    html: `${x == null ? 'f' : 'CUR'} <b>${fmt(f, 'Hz', 4)}</b> Q <b>${sig(a.q, 3)}</b> R <b>${fmt(a.rac, 'Ω', 3)}</b>`,
  };
}
