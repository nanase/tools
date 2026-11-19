/* 水槽: 青い水がほとんどで、自動補正がだまされる。水を通った物は青みを帯びる */
import { inEl, type Mat, type Scene } from '../scene';
import { ga, sg } from '../spectrum';
import { ball, dirL, inTri } from './shape';

/** 水を通る分の色 */
const T = (l: number): number => 0.38 + 0.62 * ga(l, 495, 72);
const mats = {
  wall: [70, 70, 76],
  lid: 0.06,
  lamp: 1,
  water: (l: number) => 0.03 + 0.42 * ga(l, 482, 40) + 0.05 * ga(l, 530, 30),
  sand: (l: number) => 0.84 * T(l),
  rock: (l: number) => 0.3 * T(l),
  leaf: (l: number) => (0.04 + 0.16 * ga(l, 552, 30)) * T(l),
  leaf2: (l: number) => (0.05 + 0.3 * ga(l, 548, 34)) * T(l),
  gold: (l: number) => (0.05 + 0.82 * sg(l, 580, 11)) * (0.6 + 0.4 * T(l)),
  yfish: (l: number) => (0.06 + 0.76 * sg(l, 512, 12)) * (0.6 + 0.4 * T(l)),
  rfish: (l: number) => (0.04 + 0.66 * sg(l, 605, 10)) * (0.6 + 0.4 * T(l)),
  fin: (l: number) => (0.1 + 0.7 * sg(l, 575, 13)) * (0.6 + 0.4 * T(l)),
  eye: 0.04,
  bubble: 0.9,
  trim: 0.12,
  cab: 0.86,
} satisfies Record<string, Mat>;
type Ids = Readonly<Record<keyof typeof mats, number>>;

const LT = dirL(0, -0.85, 0.55);
/* 魚 [中心 x, y, rx, ry, 向き（1 は右）, 材質] */
const FISH = [
  [330, 196, 54, 30, 1, 'gold'],
  [524, 268, 42, 23, -1, 'gold'],
  [226, 288, 30, 15, 1, 'yfish'],
  [466, 148, 26, 13, -1, 'rfish'],
] as const;
/* 水草 [根元の x, y, 高さ, 揺れの位相, 材質] */
const PLANT = [
  [112, 378, 250, 0.0, 'leaf'],
  [140, 376, 190, 1.7, 'leaf2'],
  [172, 380, 140, 3.1, 'leaf'],
  [606, 378, 170, 0.6, 'leaf2'],
  [640, 380, 230, 2.2, 'leaf'],
  [676, 376, 150, 4.0, 'leaf2'],
] as const;
/* 泡 [x, y, r] */
const BUB = [
  [650, 330, 6],
  [656, 292, 5],
  [646, 254, 7],
  [654, 212, 5],
  [648, 170, 6],
  [655, 128, 4.5],
] as const;

export const SCENE: Scene = {
  id: 'aquarium',
  name: '水槽',
  pick: [250, 462],
  refs: [[250, 462, '水槽の台']],
  mats,
  emit: { lamp: 0 },
  f(o, x, y, M: Ids) {
    o.id = M.wall;
    o.sh = 0.14;
    /* 台 */
    if (y >= 410) {
      o.id = M.cab;
      o.sh = y < 420 ? 0.85 : 0.68;
      if (Math.abs(x - 400) < 1.5 && y > 424) o.sh = 0.3;
      if (inEl(x, y, 384, 460, 4, 4) || inEl(x, y, 416, 460, 4, 4)) o.sh = 0.35;
      if (x < 30 || x > 770) {
        o.id = M.wall;
        o.sh = 0.12;
      }
    }
    if (x < 60 || x > 740 || y < 50 || y >= 410) return;
    /* 枠・ふた・明かり */
    if (y < 74) {
      o.id = M.lid;
      o.sh = 0.7;
      return;
    }
    if (y < 80) {
      o.id = x > 70 && x < 730 ? M.lamp : M.lid;
      o.sh = 1.3;
      return;
    }
    if (x < 70 || x > 730 || y >= 400) {
      o.id = M.trim;
      o.sh = 0.6;
      return;
    }
    /* 水 */
    o.id = M.water;
    o.sh = y < 94 ? 0.62 : 0.98 - (0.5 * (y - 94)) / 306 + 0.07 * Math.max(0, Math.sin((x - 0.45 * y) * 0.022));
    if (y >= 92 && y < 95) {
      o.sh = 1.05;
    }
    /* 砂と石 */
    if (y > 350 + 9 * Math.sin(x * 0.016) + 4 * Math.sin(x * 0.05)) {
      o.id = M.sand;
      o.sh = 0.72 + (0.15 * (y - 350)) / 50;
    }
    ball(o, x, y, 214, 378, 54, 30, M.rock, LT, 0.3, 0.1);
    ball(o, x, y, 566, 384, 40, 22, M.rock, LT, 0.3, 0.1);
    /* 水草 */
    for (const p of PLANT) {
      const t = (p[1] - y) / p[2];
      if (t > 0 && t < 1) {
        const xc = p[0] + 14 * t * Math.sin(t * 4 + p[3]),
          hw = 9 * (1 - t * t);
        const e = (x - xc) / hw;
        if (e > -1 && e < 1) {
          o.id = M[p[4]];
          o.sh = 0.45 + 0.4 * Math.sqrt(1 - e * e) * (0.6 + 0.4 * (1 - t));
        }
      }
    }
    /* 魚 */
    for (const F of FISH) {
      const dx = (x - F[0]) * F[4];
      if (dx < -F[2] * 1.7 || dx > F[2] + 2 || Math.abs(y - F[1]) > F[3] * 1.6) continue;
      const tx = F[0] - F[4] * F[2] * 0.8;
      if (
        inTri(x, y, tx, F[1], F[0] - F[4] * F[2] * 1.6, F[1] - F[3] * 1.2, F[0] - F[4] * F[2] * 1.5, F[1] + F[3] * 1.1)
      ) {
        o.id = M.fin;
        o.sh = 0.75;
      }
      if (
        inTri(
          x,
          y,
          F[0] - F[4] * F[2] * 0.3,
          F[1] - F[3] * 0.7,
          F[0] + F[4] * F[2] * 0.25,
          F[1] - F[3] * 0.8,
          F[0] - F[4] * F[2] * 0.5,
          F[1] - F[3] * 1.45,
        )
      ) {
        o.id = M.fin;
        o.sh = 0.8;
      }
      ball(o, x, y, F[0], F[1], F[2], F[3], M[F[5]], LT, 0.32, 0.45);
      ball(
        o,
        x,
        y,
        F[0] + F[4] * F[2] * 0.58,
        F[1] - F[3] * 0.18,
        F[3] * 0.17 + 1.5,
        F[3] * 0.17 + 1.5,
        M.eye,
        LT,
        0.3,
        0.9,
      );
    }
    /* 泡 */
    if (x > 636 && x < 666)
      for (const b of BUB) {
        const q = ((x - b[0]) ** 2 + (y - b[1]) ** 2) / (b[2] * b[2]);
        if (q < 1 && (q > 0.55 || (x - b[0] + b[2] * 0.35) ** 2 + (y - b[1] + b[2] * 0.35) ** 2 < b[2] * b[2] * 0.06)) {
          o.id = M.bubble;
          o.sh = 0.95;
          o.sp = 0;
        }
      }
  },
};
