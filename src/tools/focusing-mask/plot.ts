/**
 * ピントの目盛り・グラフ・横から見た光の通り道（SVG の文字列、DOM に依存しない）
 */
import { minus } from '../../lib/format';

const f1 = (v: number) => String(Math.round(v * 10) / 10);
/** 符号つきの整数（+100、−50、0） */
export const sgn = (v: number, d = 0): string => (v > 0 ? '+' : '') + minus(v.toFixed(d));

/* ---------- ピントの目盛り ---------- */
export const FSC = { w: 640, h: 74, x0: 20, x1: 620 };
const fx = (dz: number, R: number) => FSC.x0 + ((dz + R) / (2 * R)) * (FSC.x1 - FSC.x0);
/** 目盛りの x 座標 → ピントの位置（µm） */
export const fscValue = (x: number, R: number): number => ((x - FSC.x0) / (FSC.x1 - FSC.x0)) * 2 * R - R;

/** ピントの目盛り: 範囲 ±R、臨界焦点範囲 ±cfz、今の位置 dz（µm） */
export function fscSvg(R: number, cfz: number, dz: number): string {
  const a = fx(-cfz, R),
    b = fx(cfz, R);
  let minor = '',
    major = '',
    lab = '';
  /* R/4 ごとに長い目盛りと数字、その間に短い目盛り */
  for (let i = 0; i <= 8; i++) {
    const v = -R + (i * R) / 4,
      x = f1(fx(v, R));
    major += `M${x} 32V44`;
    lab += `<text x="${x}" y="62" text-anchor="middle">${v === 0 ? '0' : sgn(v)}</text>`;
    if (i < 8) minor += `M${f1(fx(v + R / 8, R))} 38V44`;
  }
  const k = fx(Math.max(-R, Math.min(R, dz)), R);
  return (
    `<rect class="cfz" x="${f1(a)}" y="14" width="${f1(b - a)}" height="30"/>` +
    `<text class="cfz-t" x="${f1((a + b) / 2)}" y="10" text-anchor="middle">臨界焦点範囲 ±${f1(cfz)} µm</text>` +
    `<path class="trk" d="M${FSC.x0} 44H${FSC.x1}"/><path class="tk" d="${minor}"/><path class="tk mj" d="${major}"/>${lab}` +
    `<path class="knob-l" d="M${f1(k)} 28V48"/><path class="knob" d="M${f1(k - 7)} 18L${f1(k + 7)} 18L${f1(k)} 28Z"/>`
  );
}

/** 目盛りの範囲: 臨界焦点範囲の約 7.5 倍を、切りのよい値に */
export function scaleRange(cfz: number): number {
  const L = [50, 100, 150, 200, 300, 400, 500, 600, 800, 1000, 1500, 2000, 3000, 4000, 5000];
  return L.find((v) => v >= cfz * 7.4) ?? L[L.length - 1];
}

/* ---------- グラフ ---------- */
export const GP = { w: 1000, h: 320, x0: 60, x1: 940, y0: 30, y1: 270 };

/** 切りのよい上限（1・2・5 の 10 のべき） */
export function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const e = 10 ** Math.floor(Math.log10(v)),
    m = v / e;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * e;
}

export interface Curve {
  cls: string;
  /** 縦軸: 1 は左（±y1）、2 は右（0〜y2） */
  ax: 1 | 2;
  /** [Δz（µm）, 値] */
  pts: [number, number][];
}

/** グラフ: 横軸 ±R（µm）、左の軸 ±y1、右の軸 0〜y2。今の位置 dz に縦の線と点 */
export function gpSvg(R: number, cfz: number, y1: number, y2: number, curves: Curve[], dz: number): string {
  const { x0, x1, y0, y1: yb } = GP,
    X = (z: number) => x0 + ((z + R) / (2 * R)) * (x1 - x0),
    Y1 = (v: number) => (y0 + yb) / 2 - (v / y1) * ((yb - y0) / 2),
    Y2 = (v: number) => yb - (v / y2) * (yb - y0);
  let g = '';
  for (let i = 0; i <= 8; i++) g += `M${f1(x0 + (i * (x1 - x0)) / 8)} ${y0}V${yb}`;
  for (let j = 0; j <= 6; j++) if (j !== 3) g += `M${x0} ${f1(y0 + (j * (yb - y0)) / 6)}H${x1}`;
  let s =
    `<rect class="cfzb" x="${f1(X(-cfz))}" y="${y0}" width="${f1(X(cfz) - X(-cfz))}" height="${yb - y0}"/>` +
    `<path class="gl" d="${g}"/><path class="gb" d="M${x0} ${(y0 + yb) / 2}H${x1}"/>`;
  const now = Math.max(-R, Math.min(R, dz));
  let dots = '';
  for (const c of curves) {
    const Y = c.ax === 1 ? Y1 : Y2,
      d = c.pts.map(([z, v], i) => `${i ? 'L' : 'M'}${f1(X(z))} ${f1(Y(v))}`).join('');
    s += `<path class="${c.cls}" d="${d}"/>`;
    /* 今の位置の値（線の上を補間） */
    for (let i = 1; i < c.pts.length; i++) {
      const [za, va] = c.pts[i - 1],
        [zb, vb] = c.pts[i];
      if (now < za || now > zb) continue;
      const v = va + ((vb - va) * (now - za)) / (zb - za || 1);
      dots += `<circle class="dot${c.ax}" cx="${f1(X(now))}" cy="${f1(Y(v))}" r="5"/>`;
      break;
    }
  }
  s += `<path class="now" d="M${f1(X(now))} ${y0}V${yb}"/>${dots}`;
  const t = (x: number, y: number, a: string, v: string, c = '') =>
    `<text${c ? ` class="${c}"` : ''} x="${f1(x)}" y="${y}" text-anchor="${a}">${v}</text>`;
  s +=
    t(X(-R), yb + 22, 'middle', sgn(-R)) +
    t(X(-R / 2), yb + 22, 'middle', sgn(-R / 2)) +
    t(X(0), yb + 22, 'middle', '0') +
    t(X(R / 2), yb + 22, 'middle', sgn(R / 2)) +
    t(X(R), yb + 22, 'middle', `${sgn(R)} µm`) +
    t(x0 - 8, y0 + 4, 'end', sgn(y1, y1 < 10 ? 1 : 0)) +
    t(x0 - 8, (y0 + yb) / 2 + 4, 'end', '0') +
    t(x0 - 8, yb + 4, 'end', minus((-y1).toFixed(y1 < 10 ? 1 : 0))) +
    t(x1 + 8, y0 + 4, 'start', f1(y2), 'ax2') +
    t(x1 + 8, yb + 4, 'start', '0', 'ax2') +
    t(X(0), y0 - 8, 'middle', '臨界焦点範囲');
  return s;
}

/* ---------- 横から見た光の通り道 ---------- */
export const RAY = { w: 520, h: 220, lens: 40, focus: 440, cy: 110, half: 70 };

/** 光束: 開口の縦の範囲（半径を 1、上が正）と色 */
export interface Beam {
  cls: 'b1' | 'b2';
  y0: number;
  y1: number;
}

/** 横から見た光の通り道。センサーの位置は焦点から sx（px）だけ右 */
export function raySvg(beams: Beam[], sx: number): string {
  const { lens, focus, cy, half } = RAY,
    Ys = (y: number) => cy - y * half,
    at = (ya: number, x: number) => ya + ((x - lens) * (cy - ya)) / (focus - lens),
    xs = focus + sx;
  let s =
    `<path class="ax" d="M20 ${cy}H510"/>` +
    `<path class="lens" d="M${lens} ${cy - half - 4}C${lens + 12} ${cy - 40} ${lens + 12} ${cy + 40} ${lens} ${cy + half + 4}C${lens - 12} ${cy + 40} ${lens - 12} ${cy - 40} ${lens} ${cy - half - 4}Z"/>`;
  let hits = '';
  for (const b of beams) {
    const a = Ys(b.y1),
      c = Ys(b.y0);
    s += `<path class="${b.cls}" d="M${lens} ${f1(a)}L${lens} ${f1(c)}L500 ${f1(at(c, 500))}L500 ${f1(at(a, 500))}Z"/>`;
    hits += `<path class="${b.cls === 'b1' ? 'e1' : 'e2'}" d="M${f1(xs)} ${f1(at(a, xs))}V${f1(at(c, xs))}" stroke-width="5"/>`;
  }
  return (
    s +
    `<path class="fp" d="M${focus} 40V180"/><path class="sen" d="M${f1(xs)} 50V170"/>${hits}` +
    `<text x="${lens}" y="204" text-anchor="middle">対物</text><text x="${focus}" y="30" text-anchor="middle">焦点</text>` +
    `<text x="${f1(xs)}" y="204" text-anchor="middle">センサー</text>`
  );
}
