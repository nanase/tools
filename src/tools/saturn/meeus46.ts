/**
 * 土星の 8 衛星（ミマス〜イアペトゥス）の土星中心の位置（DOM に依存しない）
 *
 * Meeus『Astronomical Algorithms』46 章の式。astronomia（commenthol）の saturnmoons.js の計算を TypeScript に写し、
 * 空での X・Y ではなく直交座標を返すように変えた。式の座標は B1950.0 の黄道で、長さは土星の半径の単位である。
 *
 * Copyright (c) 2013 Sonia Keys
 * Copyright (c) 2016 commenthol
 * MIT License
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 * documentation files (the "Software"), to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
 * Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
 * WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
 * OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
import type { Vec3 } from '../../lib/astro/vec';

const d = Math.PI / 180;
const S1 = Math.sin(28.0817 * d);
const C1 = Math.cos(28.0817 * d);
const S2 = Math.sin(168.8112 * d);
const C2 = Math.cos(168.8112 * d);

/** 軌道の経度・半径・傾き・昇交点 */
type R4 = [number, number, number, number];

/** i・Ω が土星の赤道に近い衛星（レア・タイタン・ヒペリオン・イアペトゥス）の共通の計算 */
function subr(lp: number, p: number, e: number, a: number, Om: number, i: number): R4 {
  const M = lp - p;
  const e2 = e * e;
  const e3 = e2 * e;
  const e4 = e2 * e2;
  const e5 = e3 * e2;
  const C =
    (2 * e - 0.25 * e3 + 0.0520833333 * e5) * Math.sin(M) +
    (1.25 * e2 - 0.458333333 * e4) * Math.sin(2 * M) +
    (1.083333333 * e3 - 0.671875 * e5) * Math.sin(3 * M) +
    1.072917 * e4 * Math.sin(4 * M) +
    1.142708 * e5 * Math.sin(5 * M);
  const r = (a * (1 - e2)) / (1 + e * Math.cos(M + C));
  const g = Om - 168.8112 * d;
  const si = Math.sin(i),
    ci = Math.cos(i),
    sg = Math.sin(g),
    cg = Math.cos(g);
  const a1 = si * sg;
  const a2 = C1 * si * cg - S1 * ci;
  const gam = Math.asin(Math.hypot(a1, a2));
  const u = Math.atan2(a1, a2);
  const h = C1 * si - S1 * ci * cg;
  const psi = Math.atan2(S1 * sg, h);
  return [lp + C + u - g - psi, r, gam, 168.8112 * d + u];
}

/** 衛星 k の軌道の値（jde は光行時間だけ前の TT の JD） */
function orbit(k: number, jde: number): R4 {
  const t1 = jde - 2411093;
  const t2 = t1 / 365.25;
  const t3 = (jde - 2433282.423) / 365.25 + 1950;
  const t4 = jde - 2411368;
  const t5 = t4 / 365.25;
  const t6 = jde - 2415020;
  const t7 = t6 / 36525;
  const t8 = t6 / 365.25;
  const t9 = (jde - 2442000.5) / 365.25;
  const t10 = jde - 2409786;
  const t11 = t10 / 36525;
  const W0 = 5.095 * d * (t3 - 1866.39);
  const W1 = 74.4 * d + 32.39 * d * t2;
  const W2 = 134.3 * d + 92.62 * d * t2;
  const W3 = 42 * d - 0.5118 * d * t5;
  const W4 = 276.59 * d + 0.5118 * d * t5;
  const W5 = 267.2635 * d + 1222.1136 * d * t7;
  const W6 = 175.4762 * d + 1221.5515 * d * t7;
  const W7 = 2.4891 * d + 0.002435 * d * t7;
  const W8 = 113.35 * d - 0.2597 * d * t7;
  const sin = Math.sin,
    cos = Math.cos;
  switch (k) {
    case 0: {
      const L =
        127.64 * d + 381.994497 * d * t1 - 43.57 * d * sin(W0) - 0.72 * d * sin(3 * W0) - 0.02144 * d * sin(5 * W0);
      const p = 106.1 * d + 365.549 * d * t2;
      const M = L - p;
      const C = 2.18287 * d * sin(M) + 0.025988 * d * sin(2 * M) + 0.00043 * d * sin(3 * M);
      return [L + C, 3.06879 / (1 + 0.01905 * cos(M + C)), 1.563 * d, 54.5 * d - 365.072 * d * t2];
    }
    case 1: {
      const L = 200.317 * d + 262.7319002 * d * t1 + 0.25667 * d * sin(W1) + 0.20883 * d * sin(W2);
      const p = 309.107 * d + 123.44121 * d * t2;
      const M = L - p;
      const C = 0.55577 * d * sin(M) + 0.00168 * d * sin(2 * M);
      return [L + C, 3.94118 / (1 + 0.00485 * cos(M + C)), 0.0262 * d, 348 * d - 151.95 * d * t2];
    }
    case 2:
      return [
        285.306 * d +
          190.69791226 * d * t1 +
          2.063 * d * sin(W0) +
          0.03409 * d * sin(3 * W0) +
          0.001015 * d * sin(5 * W0),
        4.880998,
        1.0976 * d,
        111.33 * d - 72.2441 * d * t2,
      ];
    case 3: {
      const L = 254.712 * d + 131.53493193 * d * t1 - 0.0215 * d * sin(W1) - 0.01733 * d * sin(W2);
      const p = 174.8 * d + 30.82 * d * t2;
      const M = L - p;
      const C = 0.24717 * d * sin(M) + 0.00033 * d * sin(2 * M);
      return [L + C, 6.24871 / (1 + 0.002157 * cos(M + C)), 0.0139 * d, 232 * d - 30.27 * d * t2];
    }
    case 4: {
      const pp = 342.7 * d + 10.057 * d * t2;
      const a1 = 0.000265 * sin(pp) + 0.001 * sin(W4);
      const a2 = 0.000265 * cos(pp) + 0.001 * cos(W4);
      const N = 345 * d - 10.057 * d * t2;
      return subr(
        359.244 * d + 79.6900472 * d * t1 + 0.086754 * d * sin(N),
        Math.atan2(a1, a2),
        Math.hypot(a1, a2),
        8.725924,
        168.8034 * d + 0.736936 * d * sin(N) + 0.041 * d * sin(W3),
        28.0362 * d + 0.346898 * d * cos(N) + 0.0193 * d * cos(W3),
      );
    }
    case 5: {
      const e1 = 0.05589 - 0.000346 * t7;
      const L = 261.1582 * d + 22.57697855 * d * t4 + 0.074025 * d * sin(W3);
      const ip = 27.45141 * d + 0.295999 * d * cos(W3);
      const Op = 168.66925 * d + 0.628808 * d * sin(W3);
      const si = sin(ip),
        ci = cos(ip),
        sO = sin(Op - W8),
        cO = cos(Op - W8);
      const a1 = sin(W7) * sO;
      const a2 = cos(W7) * si - sin(W7) * ci * cO;
      const g0 = 102.8623 * d;
      const psi = Math.atan2(a1, a2);
      const s = Math.hypot(a1, a2);
      let g = W4 - Op - psi;
      let w = 0;
      for (let n = 0; n < 3; n++) {
        w = W4 + 0.37515 * d * (sin(2 * g) - sin(2 * g0));
        g = w - Op - psi;
      }
      const ep = 0.029092 + 0.00019048 * (cos(2 * g) - cos(2 * g0));
      const qq = 2 * (W5 - w);
      const b1 = si * sO;
      const b2 = cos(W7) * si * cO - sin(W7) * ci;
      const th = Math.atan2(b1, b2) + W8;
      const sq = sin(qq);
      const u = 2 * W5 - 2 * th + psi;
      const h = 0.9375 * ep * ep * sq + 0.1875 * s * s * sin(2 * (W5 - th));
      return subr(
        L - 0.254744 * d * (e1 * sin(W6) + 0.75 * e1 * e1 * sin(2 * W6) + h),
        w + 0.159215 * d * sq,
        ep + 0.002778797 * ep * cos(qq),
        20.216193,
        Op + (0.031843 * d * s * sin(u)) / si,
        ip + 0.031843 * d * s * cos(u),
      );
    }
    case 6: {
      const eta = 92.39 * d + 0.5621071 * d * t6;
      const z = 148.19 * d - 19.18 * d * t8;
      const th = 184.8 * d - 35.41 * d * t9;
      const thp = th - 7.5 * d;
      const as = 176 * d + 12.22 * d * t8;
      const bs = 8 * d + 24.44 * d * t8;
      const cs = bs + 5 * d;
      const w = 69.898 * d - 18.67088 * d * t8;
      const phi = 2 * (w - W5);
      const chi = 94.9 * d - 2.292 * d * t8;
      const a = 24.50601 - 0.08686 * cos(eta) - 0.00166 * cos(z + eta) + 0.00175 * cos(z - eta);
      const e =
        0.103458 -
        0.004099 * cos(eta) -
        0.000167 * cos(z + eta) +
        0.000235 * cos(z - eta) +
        0.02303 * cos(z) -
        0.00212 * cos(2 * z) +
        0.000151 * cos(3 * z) +
        0.00013 * cos(phi);
      const p =
        w +
        0.15648 * d * sin(chi) -
        0.4457 * d * sin(eta) -
        0.2657 * d * sin(z + eta) -
        0.3573 * d * sin(z - eta) -
        12.872 * d * sin(z) +
        1.668 * d * sin(2 * z) -
        0.2419 * d * sin(3 * z) -
        0.07 * d * sin(phi);
      const lp =
        177.047 * d +
        16.91993829 * d * t6 +
        0.15648 * d * sin(chi) +
        9.142 * d * sin(eta) +
        0.007 * d * sin(2 * eta) -
        0.014 * d * sin(3 * eta) +
        0.2275 * d * sin(z + eta) +
        0.2112 * d * sin(z - eta) -
        0.26 * d * sin(z) -
        0.0098 * d * sin(2 * z) -
        0.013 * d * sin(as) +
        0.017 * d * sin(bs) -
        0.0303 * d * sin(phi);
      const i =
        27.3347 * d + 0.6434886 * d * cos(chi) + 0.315 * d * cos(W3) + 0.018 * d * cos(th) - 0.018 * d * cos(cs);
      const Om =
        168.6812 * d + 1.40136 * d * cos(chi) + 0.68599 * d * sin(W3) - 0.0392 * d * sin(cs) + 0.0366 * d * sin(thp);
      return subr(lp, p, e, a, Om, i);
    }
    default: {
      const L = 261.1582 * d + 22.57697855 * d * t4;
      const wp = 91.796 * d + 0.562 * d * t7;
      const psi = 4.367 * d - 0.195 * d * t7;
      const th = 146.819 * d - 3.198 * d * t7;
      const phi = 60.47 * d + 1.521 * d * t7;
      const Ph = 205.055 * d - 2.091 * d * t7;
      const ep = 0.028298 + 0.001156 * t11;
      const w0 = 352.91 * d + 11.71 * d * t11;
      const mu = 76.3852 * d + 4.53795125 * d * t10;
      const ip = 18.4602 * d + t11 * (-0.9518 * d + t11 * (-0.072 * d + t11 * 0.0054 * d));
      const Op = 143.198 * d + t11 * (-3.919 * d + t11 * (0.116 * d + t11 * 0.008 * d));
      const l = mu - w0;
      const g = w0 - Op - psi;
      const g1 = w0 - Op - phi;
      const ls = W5 - wp;
      const gs = wp - th;
      const lT = L - W4;
      const gT = W4 - Ph;
      const u1 = 2 * (l + g - ls - gs);
      const u2 = l + g1 - lT - gT;
      const u3 = l + 2 * (g - ls - gs);
      const u4 = lT + gT - g1;
      const u5 = 2 * (ls + gs);
      const a = 58.935028 + 0.004638 * cos(u1) + 0.058222 * cos(u2);
      const e =
        ep -
        0.0014097 * cos(g1 - gT) +
        0.0003733 * cos(u5 - 2 * g) +
        0.000118 * cos(u3) +
        0.0002408 * cos(l) +
        0.0002849 * cos(l + u2) +
        0.000619 * cos(u4);
      const w =
        0.08077 * d * sin(g1 - gT) +
        0.02139 * d * sin(u5 - 2 * g) -
        0.00676 * d * sin(u3) +
        0.0138 * d * sin(l) +
        0.01632 * d * sin(l + u2) +
        0.03547 * d * sin(u4);
      const lp =
        mu -
        0.04299 * d * sin(u2) -
        0.00789 * d * sin(u1) -
        0.06312 * d * sin(ls) -
        0.00295 * d * sin(2 * ls) -
        0.02231 * d * sin(u5) +
        0.0065 * d * sin(u5 + psi);
      const c5 = l + g1 + lT + gT + phi;
      const i = ip + 0.04204 * d * cos(u5 + psi) + 0.00235 * d * cos(c5) + 0.0036 * d * cos(u2 + phi);
      const wq = 0.04204 * d * sin(u5 + psi) + 0.00235 * d * sin(c5) + 0.00358 * d * sin(u2 + phi);
      return subr(lp, w0 + w / ep, e, a, Op + wq / sin(ip), i);
    }
  }
}

/** 式の長さの単位 [km]。衛星ごとに 1993〜2045 年の Horizons の位置へ当てはめた（差は test/saturn.test.ts で確かめる） */
const UNIT_KM = [60435, 60396, 60372, 60399, 60402, 60438, 60429, 60434];

/** FK4 B1950.0 の黄道 → J2000.0 の赤道（FK5）の回転行列（Standish 1982 の B1950→J2000 に B1950 の黄道傾斜を掛けた） */
const EPS50 = 23.4457889 * d;
const B2J = [
  [0.9999256782, -0.0111820611, -0.0048579477],
  [0.011182061, 0.9999374784, -0.0000271765],
  [0.0048579479, -0.0000271474, 0.9999881997],
];
const ceps = Math.cos(EPS50),
  seps = Math.sin(EPS50);

/** 衛星 k の土星中心の位置（ICRF）[km]。jdTT は光行時間だけ前の TT の JD */
export function moonPos(k: number, jdTT: number): Vec3 {
  const [lam, r, gam, Om] = orbit(k, jdTT);
  const u = lam - Om;
  const w = Om - 168.8112 * d;
  const su = Math.sin(u),
    cu = Math.cos(u),
    sw = Math.sin(w),
    cw = Math.cos(w),
    sg = Math.sin(gam),
    cg = Math.cos(gam);
  const X = r * (cu * cw - su * cg * sw);
  const Y = r * (su * cw * cg + cu * sw);
  const Z = r * su * sg;
  /* 土星の赤道（Meeus の基準の面）から B1950.0 の黄道へ */
  const b0 = C1 * Y - S1 * Z;
  const c = S1 * Y + C1 * Z;
  const xe = C2 * X - S2 * b0;
  const ye = S2 * X + C2 * b0;
  const ze = c;
  /* B1950.0 の黄道 → 赤道 → J2000.0 の赤道 */
  const ex = xe;
  const ey = ceps * ye - seps * ze;
  const ez = seps * ye + ceps * ze;
  const un = UNIT_KM[k];
  return [
    (B2J[0][0] * ex + B2J[0][1] * ey + B2J[0][2] * ez) * un,
    (B2J[1][0] * ex + B2J[1][1] * ey + B2J[1][2] * ez) * un,
    (B2J[2][0] * ex + B2J[2][1] * ey + B2J[2][2] * ez) * un,
  ];
}
