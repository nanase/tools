/**
 * 月の位置（DOM に依存しない）
 *
 * 式は Meeus『Astronomical Algorithms』第 2 版 47 章（ELP-2000/82 を切り詰めた級数）で、
 * 係数表は ERFA の eraMoon98（BSD-3-Clause、末尾に許諾文）から写した。eraMoon98 は光差を除いた平均黄経
 * 218.31665436° を使うが、ここでは Meeus の 218.3164477°（光差込み）に戻している。
 * 章動・恒星時・歳差は lib/astro/frame.ts、太陽は lib/astro/sun.ts
 */
import { type Ecl, rev } from '../../lib/astro/frame';

const D = Math.PI / 180;

/** 度で表した多項式 c0 + c1 T + … を [rad] で */
const polyDeg = (c: number[], t: number) => (c.reduceRight((s, k) => s * t + k, 0) % 360) * D;

/**
 * 経度と距離の項（Meeus 表 47.A）: D, M, M′, F の倍数、Σl の係数 [1e−6°]、Σr の係数 [m]
 */
// biome-ignore format: 表
const LR = [
  0,0,1,0,6288774,-20905355, 2,0,-1,0,1274027,-3699111, 2,0,0,0,658314,-2955968, 0,0,2,0,213618,-569925,
  0,1,0,0,-185116,48888, 0,0,0,2,-114332,-3149, 2,0,-2,0,58793,246158, 2,-1,-1,0,57066,-152138,
  2,0,1,0,53322,-170733, 2,-1,0,0,45758,-204586, 0,1,-1,0,-40923,-129620, 1,0,0,0,-34720,108743,
  0,1,1,0,-30383,104755, 2,0,0,-2,15327,10321, 0,0,1,2,-12528,0, 0,0,1,-2,10980,79661,
  4,0,-1,0,10675,-34782, 0,0,3,0,10034,-23210, 4,0,-2,0,8548,-21636, 2,1,-1,0,-7888,24208,
  2,1,0,0,-6766,30824, 1,0,-1,0,-5163,-8379, 1,1,0,0,4987,-16675, 2,-1,1,0,4036,-12831,
  2,0,2,0,3994,-10445, 4,0,0,0,3861,-11650, 2,0,-3,0,3665,14403, 0,1,-2,0,-2689,-7003,
  2,0,-1,2,-2602,0, 2,-1,-2,0,2390,10056, 1,0,1,0,-2348,6322, 2,-2,0,0,2236,-9884,
  0,1,2,0,-2120,5751, 0,2,0,0,-2069,0, 2,-2,-1,0,2048,-4950, 2,0,1,-2,-1773,4130,
  2,0,0,2,-1595,0, 4,-1,-1,0,1215,-3958, 0,0,2,2,-1110,0, 3,0,-1,0,-892,3258,
  2,1,1,0,-810,2616, 4,-1,-2,0,759,-1897, 0,2,-1,0,-713,-2117, 2,2,-1,0,-700,2354,
  2,1,-2,0,691,0, 2,-1,0,-2,596,0, 4,0,1,0,549,-1423, 0,0,4,0,537,-1117,
  4,-1,0,0,520,-1571, 1,0,-2,0,-487,-1739, 2,1,0,-2,-399,0, 0,0,2,-2,-381,-4421,
  1,1,1,0,351,0, 3,0,-2,0,-340,0, 4,0,-3,0,330,0, 2,-1,2,0,327,0,
  0,2,1,0,-323,1165, 1,1,-1,0,299,0, 2,0,3,0,294,0, 2,0,-1,-2,0,8752,
];

/** 緯度の項（Meeus 表 47.B）: D, M, M′, F の倍数、Σb の係数 [1e−6°] */
// biome-ignore format: 表
const B = [
  0,0,0,1,5128122, 0,0,1,1,280602, 0,0,1,-1,277693, 2,0,0,-1,173237, 2,0,-1,1,55413, 2,0,-1,-1,46271,
  2,0,0,1,32573, 0,0,2,1,17198, 2,0,1,-1,9266, 0,0,2,-1,8822, 2,-1,0,-1,8216, 2,0,-2,-1,4324,
  2,0,1,1,4200, 2,1,0,-1,-3359, 2,-1,-1,1,2463, 2,-1,0,1,2211, 2,-1,-1,-1,2065, 0,1,-1,-1,-1870,
  4,0,-1,-1,1828, 0,1,0,1,-1794, 0,0,0,3,-1749, 0,1,-1,1,-1565, 1,0,0,1,-1491, 0,1,1,1,-1475,
  0,1,1,-1,-1410, 0,1,0,-1,-1344, 1,0,0,-1,-1335, 0,0,3,1,1107, 4,0,0,-1,1021, 4,0,-1,1,833,
  0,0,1,-3,777, 4,0,-2,1,671, 2,0,0,-3,607, 2,0,2,-1,596, 2,-1,1,-1,491, 2,0,-2,1,-451,
  0,0,3,-1,439, 2,0,2,1,422, 2,0,-3,-1,421, 2,1,-1,1,-366, 2,1,0,1,-351, 4,0,0,1,331,
  2,-1,1,1,315, 2,-2,0,-1,302, 0,0,1,3,-283, 2,1,1,-1,-229, 1,1,0,-1,223, 1,1,0,1,223,
  0,1,-2,-1,-220, 2,1,-1,-1,-220, 1,0,1,1,-185, 2,-1,-2,-1,181, 0,1,2,1,-177, 4,0,-2,-1,176,
  4,-1,-1,-1,166, 1,0,1,-1,-164, 4,0,1,-1,132, 1,0,-1,-1,-119, 4,-1,0,-1,115, 2,-2,0,1,107,
];

/** 月の地心位置（Meeus 47 章）。T は J2000.0 からの TT のユリウス世紀 */
export function moonEcl(t: number): Ecl {
  const lp = polyDeg([218.3164477, 481267.88123421, -0.0015786, 1 / 538841, -1 / 65194000], t);
  const d = polyDeg([297.8501921, 445267.1114034, -0.0018819, 1 / 545868, 1 / 113065000], t);
  const m = polyDeg([357.5291092, 35999.0502909, -0.0001536, 1 / 24490000], t);
  const mp = polyDeg([134.9633964, 477198.8675055, 0.0087414, 1 / 69699, -1 / 14712000], t);
  const f = polyDeg([93.272095, 483202.0175233, -0.0036539, 1 / 3526000, 1 / 863310000], t);
  const a1 = (119.75 + 131.849 * t) * D;
  const a2 = (53.09 + 479264.29 * t) * D;
  const a3 = (313.45 + 481266.484 * t) * D;
  const e = 1 - 0.002516 * t - 0.0000074 * t * t;
  const ek = (k: number) => (k === 0 ? 1 : k === 1 || k === -1 ? e : e * e);
  let sl = 3958 * Math.sin(a1) + 1962 * Math.sin(lp - f) + 318 * Math.sin(a2);
  let sr = 0;
  for (let k = 0; k < LR.length; k += 6) {
    const arg = LR[k] * d + LR[k + 1] * m + LR[k + 2] * mp + LR[k + 3] * f;
    const w = ek(LR[k + 1]);
    sl += LR[k + 4] * w * Math.sin(arg);
    sr += LR[k + 5] * w * Math.cos(arg);
  }
  let sb =
    -2235 * Math.sin(lp) +
    382 * Math.sin(a3) +
    175 * Math.sin(a1 - f) +
    175 * Math.sin(a1 + f) +
    127 * Math.sin(lp - mp) -
    115 * Math.sin(lp + mp);
  for (let k = 0; k < B.length; k += 5) {
    sb += B[k + 4] * ek(B[k + 1]) * Math.sin(B[k] * d + B[k + 1] * m + B[k + 2] * mp + B[k + 3] * f);
  }
  return { lon: rev(lp + sl * 1e-6 * D), lat: sb * 1e-6 * D, dist: 385000.56 + sr / 1000 };
}

/*
 * 月の級数の係数表の出典 ERFA（https://github.com/liberfa/erfa、src/moon98.c）の許諾文:
 *
 * Copyright (C) 2013-2023, NumFOCUS Foundation.
 * All rights reserved.
 *
 * This library is derived, with permission, from the International
 * Astronomical Union's "Standards of Fundamental Astronomy" library,
 * available from http://www.iausofa.org.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 * 1 Redistributions of source code must retain the above copyright
 *   notice, this list of conditions and the following disclaimer.
 *
 * 2 Redistributions in binary form must reproduce the above copyright
 *   notice, this list of conditions and the following disclaimer in
 *   the documentation and/or other materials provided with the
 *   distribution.
 *
 * 3 Neither the name of the Standards Of Fundamental Astronomy Board,
 *   the International Astronomical Union nor the names of its
 *   contributors may be used to endorse or promote products derived
 *   from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS
 * FOR A PARTICULAR PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL THE
 * COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT,
 * INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING,
 * BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
 * LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN
 * ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */
