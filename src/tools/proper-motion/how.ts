/**
 * しくみの枠の 6 つの図。止まっているときは完成した絵で、工程のカードに指を乗せると初めから順に進む（lib/how-anim.ts）。
 * 図の数値は fixed.ts の星（HYG の位置と速度）から計算する
 */

import { cross, unit, type Vec3 } from '../../lib/astro/vec';
import { type HowFig, mountHowAnim } from '../../lib/how-anim';
import { FIXED } from './fixed';
import { GAL } from './format';
import { NOW, poleAt, speeds } from './model';

type G = CanvasRenderingContext2D;
const CW = 172,
  CH = 104;
const D = Math.PI / 180;
const C = { a: '', b: '', ink: '', grid: '', star: '', sans: '' };

const fixed = (nm: string) => {
  const f = FIXED.find((x) => x[0] === nm);
  if (!f) throw new Error(nm);
  return f;
};
/** 年 y の位置 [pc] と向き */
const posAt = (nm: string, y: number): Vec3 => {
  const f = fixed(nm),
    t = (y - 2000) / 1000;
  return [f[1][0] + f[2][0] * t, f[1][1] + f[2][1] * t, f[1][2] + f[2][2] * t];
};
const dirAt = (nm: string, y: number): Vec3 => unit(posAt(nm, y));
const ang = (a: Vec3, b: Vec3): number =>
  Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) / D;
/** k を n コマに刻む */
const fr = (k: number, n: number): number => Math.min(n, Math.floor(k * n + 1e-9)) / n;
const fmtRel = (dy: number): string => {
  const a = Math.round(Math.abs(dy) / 100) * 100;
  if (!a) return '今';
  const man = Math.floor(a / 10000),
    rest = a % 10000;
  return `${man ? `${man} 万${rest ? ` ${rest} ` : ''}` : `${rest} `}年${dy > 0 ? '後' : '前'}`;
};
const fmtDeg = (a: number): string => `${a < 1 ? a.toFixed(2) : a < 10 ? a.toFixed(1) : Math.round(a)}°`;

function arrow(c: G, x0: number, y0: number, x1: number, y1: number, col: string, w = 1.5): void {
  c.strokeStyle = col;
  c.fillStyle = col;
  c.lineWidth = w;
  c.beginPath();
  c.moveTo(x0, y0);
  c.lineTo(x1, y1);
  c.stroke();
  if (Math.hypot(x1 - x0, y1 - y0) < 3) return;
  const a = Math.atan2(y1 - y0, x1 - x0),
    s = 6;
  c.beginPath();
  c.moveTo(x1, y1);
  c.lineTo(x1 - s * Math.cos(a - 0.45), y1 - s * Math.sin(a - 0.45));
  c.lineTo(x1 - s * Math.cos(a + 0.45), y1 - s * Math.sin(a + 0.45));
  c.closePath();
  c.fill();
}
function text(c: G, s: string, x: number, y: number, col: string, al: CanvasTextAlign = 'left', sz = 11): void {
  c.font = `500 ${sz}px ${C.sans}`;
  c.fillStyle = col;
  c.textAlign = al;
  c.textBaseline = 'alphabetic';
  c.fillText(s, x, y);
}
function dot(c: G, x: number, y: number, r: number, col: string): void {
  c.fillStyle = col;
  c.beginPath();
  c.arc(x, y, r, 0, 2 * Math.PI);
  c.fill();
}
const toGal = (v: Vec3): Vec3 => GAL.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]) as Vec3;

/* 1 星はそれぞれ動く: 太陽のまわりの明るい星を銀河の北から見下ろし、10 万年ぶん進める */
const NEAR = ['シリウス', 'プロキオン', 'アルタイル', 'ベガ', 'リギル・ケンタウルス', 'フォーマルハウト'];
const F1: HowFig = {
  dur: 2,
  draw(c, k) {
    const cx = 92,
      cy = 54,
      s = 5.6,
      T = NOW + 100000 * fr(k, 24);
    dot(c, cx, cy, 3.2, C.a);
    text(c, '太陽', 8, CH - 8, C.ink);
    dot(c, 36, CH - 12, 3.2, C.a);
    for (const nm of NEAR) {
      const a = toGal(posAt(nm, NOW)),
        b = toGal(posAt(nm, T));
      arrow(c, cx + a[0] * s, cy - a[1] * s, cx + b[0] * s, cy - b[1] * s, C.b, 1.3);
      dot(c, cx + b[0] * s, cy - b[1] * s, 2.2, C.star);
    }
    text(c, fmtRel(T - NOW), CW - 6, 14, C.ink, 'right');
  },
};

/* 2 横向きの動きだけが位置を変える: アルタイルの速さを、こちら向きと横向きに分ける */
const ALT = speeds(posAt('アルタイル', 2000), fixed('アルタイル')[2] as unknown as Vec3);
const F2: HowFig = {
  dur: 1.6,
  draw(c, k) {
    const ex = 14,
      ey = 70,
      sx = 124,
      sy = 70,
      t = fr(k, 16),
      rx = ALT.vr * 2.2,
      ty = -ALT.vt * 2.2;
    c.strokeStyle = C.grid;
    c.lineWidth = 1;
    c.setLineDash([2, 3]);
    c.beginPath();
    c.moveTo(ex, ey);
    c.lineTo(sx, sy);
    c.stroke();
    c.setLineDash([]);
    dot(c, ex, ey, 4, C.b);
    text(c, '地球', ex - 4, ey + 18, C.ink);
    arrow(c, sx, sy, sx + rx * t, sy, C.ink, 1.4);
    arrow(c, sx, sy, sx, sy + ty * t, C.a, 1.6);
    dot(c, sx, sy, 2.6 + t * 0.8, C.star);
    text(c, `近づく ${Math.round(-ALT.vr)} km/s`, sx + rx - 4, sy + 16, C.ink);
    text(c, `横 ${Math.round(ALT.vt)} km/s`, sx - 6, sy + ty * 0.55, C.a, 'right');
    text(c, 'アルタイル', sx, 14, C.ink, 'center');
  },
};

/* 3 近い星ほど大きく動く: アルクトゥルスとリゲルの 10 万年の角度 */
const F3: HowFig = {
  dur: 2,
  draw(c, k) {
    const t = fr(k, 20),
      ex = 10,
      ey = 88,
      row = (y: number, nm: string, len: number): number => {
        const a = ang(dirAt(nm, NOW), dirAt(nm, NOW + 100000 * t)),
          L = Math.hypot(len, y - ey),
          b0 = Math.atan2(y - ey, len),
          b1 = b0 - Math.min(a, 70) * D;
        c.strokeStyle = C.grid;
        c.lineWidth = 1;
        c.setLineDash([2, 3]);
        c.beginPath();
        c.moveTo(ex, ey);
        c.lineTo(ex + L * Math.cos(b0), ey + L * Math.sin(b0));
        c.stroke();
        c.setLineDash([]);
        c.beginPath();
        c.moveTo(ex, ey);
        c.lineTo(ex + L * Math.cos(b1), ey + L * Math.sin(b1));
        c.stroke();
        dot(c, ex + L * Math.cos(b1), ey + L * Math.sin(b1), 2.4, C.star);
        return a;
      };
    dot(c, ex, ey, 3.4, C.b);
    const a1 = row(62, 'アルクトゥルス', 48),
      a2 = row(30, 'リゲル', 150);
    const ly = (nm: string) => Math.round(Math.hypot(...posAt(nm, NOW)) * 3.261563777);
    text(c, `${ly('アルクトゥルス')} 光年 ${fmtDeg(a1)}`, 60, 80, C.a);
    text(c, `${ly('リゲル')} 光年 ${fmtDeg(a2)}`, 92, 46, C.ink);
    text(c, fmtRel(100000 * t), CW - 6, 14, C.ink, 'right');
  },
};

/* 4 1 年ではわずか: アルクトゥルスが月の幅（0.52°）を進む年数 */
export const ARC_YEARS =
  Math.round(0.52 / (ang(dirAt('アルクトゥルス', NOW), dirAt('アルクトゥルス', NOW + 1000)) / 1000) / 10) * 10;
const F4: HowFig = {
  dur: 1.6,
  draw(c, k) {
    const t = fr(k, 16),
      cx = 86,
      cy = 50,
      r = 30;
    c.strokeStyle = C.ink;
    c.lineWidth = 1.4;
    c.beginPath();
    c.arc(cx, cy, r, 0, 2 * Math.PI);
    c.stroke();
    text(c, '月の幅', cx, cy - r - 6, C.ink, 'center');
    arrow(c, cx - r, cy, cx - r + 2 * r * t, cy, C.a, 1.6);
    dot(c, cx - r + 2 * r * t, cy, 2.6, C.star);
    text(c, `${Math.round(ARC_YEARS * t)} 年`, cx, cy + r + 14, C.star, 'center', 12);
  },
};

/* 5 数万年で形が変わる: 北斗七星の今（点線）と 10 万年後 */
const DIP = ['アルカイド', 'ミザール', 'アリオト', 'メグレズ', 'ドゥーベ', 'メラク', 'フェクダ', 'メグレズ'];
const dipProj = (y: number): [number, number][] => {
  const c0 = unit(
    DIP.slice(0, 7).reduce<Vec3>(
      (a, nm) => {
        const v = dirAt(nm, NOW);
        return [a[0] + v[0], a[1] + v[1], a[2] + v[2]];
      },
      [0, 0, 0],
    ),
  );
  const e = unit(cross([0, 0, 1], c0)),
    n = cross(c0, e);
  return DIP.map((nm) => {
    const v = dirAt(nm, y),
      z = v[0] * c0[0] + v[1] * c0[1] + v[2] * c0[2];
    return [-(v[0] * e[0] + v[1] * e[1] + v[2] * e[2]) / z, (v[0] * n[0] + v[1] * n[1] + v[2] * n[2]) / z];
  });
};
const DIP0 = dipProj(NOW),
  DIP1 = dipProj(NOW + 100000);
const F5: HowFig = {
  dur: 2,
  draw(c, k) {
    const t = fr(k, 24),
      s = 330,
      pt = (p: [number, number]): [number, number] => [CW / 2 + p[0] * s, 56 - p[1] * s],
      line = (ps: [number, number][], col: string, dash: number[]) => {
        c.strokeStyle = col;
        c.lineWidth = 1.3;
        c.setLineDash(dash);
        c.beginPath();
        ps.forEach((p, j) => {
          const q = pt(p);
          if (j) c.lineTo(q[0], q[1]);
          else c.moveTo(q[0], q[1]);
        });
        c.stroke();
        c.setLineDash([]);
      };
    line(DIP0, C.grid, [3, 3]);
    const cur = DIP0.map((p, j): [number, number] => [
      p[0] + ((DIP1[j] as [number, number])[0] - p[0]) * t,
      p[1] + ((DIP1[j] as [number, number])[1] - p[1]) * t,
    ]);
    line(cur, C.ink, []);
    for (const p of cur.slice(0, 7)) {
      const q = pt(p);
      dot(c, q[0], q[1], 2.2, C.star);
    }
    text(c, fmtRel(100000 * t), CW - 6, 14, C.ink, 'right');
  },
};

/* 6 地軸の首振り: 天の北極の道すじ（2 万 6 千年）とポラリス・ベガ・トゥバン。黄道の北極が中心 */
const ECL: Vec3 = [0, -Math.sin(23.44 * D), Math.cos(23.44 * D)];
const F6: HowFig = {
  dur: 2.2,
  draw(c, k) {
    const e = unit(cross([0, 0, 1], ECL)),
      n = cross(ECL, e),
      cx = 80,
      cy = 56,
      s = 84,
      P = (v: Vec3): [number, number] => {
        const q = 2 / (1 + v[0] * ECL[0] + v[1] * ECL[1] + v[2] * ECL[2]);
        return [
          cx - (v[0] * e[0] + v[1] * e[1] + v[2] * e[2]) * q * s,
          cy - (v[0] * n[0] + v[1] * n[1] + v[2] * n[2]) * q * s,
        ];
      };
    c.strokeStyle = C.grid;
    c.lineWidth = 1.2;
    c.setLineDash([2, 3]);
    c.beginPath();
    for (let y = 0; y <= 26000; y += 400) {
      const p = P(poleAt(NOW + y));
      if (y) c.lineTo(p[0], p[1]);
      else c.moveTo(p[0], p[1]);
    }
    c.stroke();
    c.setLineDash([]);
    for (const nm of ['ポラリス', 'ベガ', 'トゥバン']) {
      const p = P(dirAt(nm, NOW));
      dot(c, p[0], p[1], 2.4, C.star);
      if (nm === 'ベガ') text(c, nm, p[0] - 5, p[1] + 4, C.ink, 'right');
      else text(c, nm, p[0] + 5, p[1] - 4, C.ink);
    }
    const y = NOW + 26000 * fr(k, 26),
      p = P(poleAt(y)),
      p2 = P(poleAt(y + 600));
    arrow(c, p[0], p[1], p2[0], p2[1], C.a, 1.6);
    text(c, fmtRel(y - NOW), CW - 6, CH - 6, C.ink, 'right');
  },
};

/** しくみの図を動かす */
export function mountHow(host: HTMLElement): void {
  mountHowAnim(host, [F1, F2, F3, F4, F5, F6], {
    w: CW,
    h: CH,
    prepare() {
      const css = getComputedStyle(document.documentElement),
        v = (k: string): string => css.getPropertyValue(k).trim();
      Object.assign(C, {
        a: v('--ch1'),
        b: v('--ch2'),
        ink: v('--screen-ink'),
        grid: v('--grid-2'),
        star: v('--ink'),
        sans: v('--sans'),
      });
    },
  });
}
