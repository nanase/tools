/* 雪の店先: 光 1 は夕暮れの空、光 2 は店の電球。雪だるまと店先の雪で白の色が違う */
import { inEl, inQuad, type Mat, type Scene, sph } from '../scene';
import { ga, sg } from '../spectrum';
import { ball, dirL, inTri } from './shape';

const mats = {
  sky: 1,
  win: 1,
  snow: 0.9,
  far: [58, 60, 72],
  roof: 0.1,
  plank: [150, 102, 66],
  frame: [84, 58, 40],
  awnR: (l: number) => 0.05 + 0.6 * sg(l, 600, 10),
  awnW: 0.84,
  door: [44, 104, 84],
  knob: (l: number) => 0.06 + 0.74 * sg(l, 512, 12),
  hat: (l: number) => 0.05 + 0.5 * ga(l, 468, 30),
  bread: [200, 132, 66],
  scarf: (l: number) => 0.04 + 0.62 * sg(l, 600, 10),
  carrot: (l: number) => 0.05 + 0.8 * sg(l, 572, 11),
  coal: 0.05,
  twig: [96, 68, 44],
} satisfies Record<string, Mat>;
type Ids = Readonly<Record<keyof typeof mats, number>>;

/** 線分からの距離 < r */
const nearSeg = (x: number, y: number, ax: number, ay: number, bx: number, by: number, r: number): boolean => {
  const vx = bx - ax,
    vy = by - ay;
  let t = ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = x - ax - t * vx,
    dy = y - ay - t * vy;
  return dx * dx + dy * dy < r * r;
};

const LS = dirL(-0.45, -0.55, 0.7);
const LB = dirL(0.1, -1, 0.5);
/** 窓のパンの x */
const BX = [499, 532, 580, 613] as const;
const QS = [
  [252, 354],
  [270, 354],
  [276, 404],
  [258, 406],
] as const;
const QH = [
  [222, 262],
  [258, 262],
  [266, 290],
  [214, 290],
] as const;
/* 遠くの家 [左, 右, 壁の上, 屋根の頂点 x, 頂点 y] */
const HOUSES = [
  [24, 112, 182, 68, 162],
  [150, 232, 190, 191, 170],
  [292, 392, 178, 342, 152],
] as const;

export const SCENE: Scene = {
  id: 'snowshop',
  name: '雪の店先',
  pick: [236, 398],
  refs: [
    [214, 402, '雪だるま'],
    [560, 380, '店先の雪'],
  ],
  lights: ['shadow', 'bulb'],
  mats,
  emit: { sky: 0, win: 1 },
  f(o, x, y, M: Ids) {
    /* 空と地面 */
    if (y < 214) {
      o.id = M.sky;
      o.sh = 0.07 + 0.7 * (y / 214) ** 1.8;
      if (inEl(x, y, 96, 64, 15, 15)) {
        o.sh = 1.3;
      }
    } else {
      o.id = M.snow;
      o.sh = 0.78 + (0.12 * (y - 214)) / 286 + 0.03 * Math.sin(x * 0.012 + y * 0.02);
    }
    /* 遠くの家 */
    if (y > 140 && y < 216 && x < 430)
      for (const h of HOUSES) {
        if (x > h[0] && x < h[1]) {
          if (y > h[2] && y < 216) {
            o.id = M.far;
            o.sh = 0.5;
            const wx = (x - h[0]) % 34,
              wy = y - h[2];
            if (wx > 12 && wx < 24 && wy > 9 && wy < 21 && x < h[1] - 8) {
              o.id = M.win;
              o.sh = 0.95;
            }
          } else if (inTri(x, y, h[0] - 6, h[2], h[1] + 6, h[2], h[3], h[4])) {
            o.id = y < h[2] - 5 ? M.snow : M.far;
            o.sh = 0.6;
          }
        }
      }
    /* 店 */
    if (x >= 430 && y >= 22 && y < 336) {
      if (y > 62 && y < 330 + 4 * Math.sin(x * 0.05)) {
        o.id = M.plank;
        o.sh = (y - 62) % 22 < 2 ? 0.55 : 0.8;
      }
      if (y >= 40 && y <= 64 && x >= 418) {
        o.id = M.roof;
        o.sh = 0.6;
      }
      if (y < 46 && x >= 422 && y > 26 + 5 * Math.sin(x * 0.04) + (x < 440 ? 440 - x : 0)) {
        o.id = M.snow;
        o.sh = 0.95;
      }
      /* 日よけ（赤と白の縞、裾は波） */
      if (x > 452 && x < 790 && y > 112 && y < 160) {
        const k = Math.floor((x - 452) / 26),
          px = x - 452 - k * 26,
          yb = 146 + 8 * Math.sqrt(Math.max(0, 1 - ((px - 13) / 13) ** 2));
        if (y < yb && y > 118) {
          o.id = k % 2 ? M.awnW : M.awnR;
          o.sh = 0.72 + (0.2 * (y - 118)) / 40;
        }
        if (y >= 110 && y <= 121 && y <= 116 + 3 * Math.sin(x * 0.09) + 5) {
          o.id = M.snow;
          o.sh = 0.95;
        }
      }
      /* 窓 */
      if (x > 462 && x < 648 && y > 170 && y < 314) {
        o.id = M.frame;
        o.sh = 0.6;
        if (x > 472 && x < 638 && y > 180 && y < 302 && Math.abs(x - 555) > 4 && Math.abs(y - 241) > 4) {
          o.id = M.win;
          o.sh = 1.18 - (0.14 * (y - 180)) / 122;
        }
        if (y > 268 && y < 302)
          for (let i = 0; i < 4; i++) ball(o, x, y, BX[i] as number, 291, 20, 13, M.bread, LB, 0.35, 0.15);
        if (y > 300) {
          o.id = M.snow;
          o.sh = 0.9;
        }
      }
      /* 戸 */
      if (x > 672 && x < 764 && y > 168 && y < 334) {
        o.id = M.door;
        o.sh = 0.6 + 0.06 * Math.sin((x - 672) * 0.2);
        if (x > 688 && x < 748 && y > 184 && y < 244) {
          o.id = M.win;
          o.sh = 1.08;
        }
        ball(o, x, y, 748, 272, 6, 6, M.knob, LS, 0.3, 0.5);
      }
    }
    /* 雪の吹きだまり（店の足もと） */
    if (y > 318 && y < 346 && x > 420 && y > 332 - 6 * Math.sin(x * 0.03) - 4 * Math.sin(x * 0.11)) {
      o.id = M.snow;
      o.sh = 0.86;
    }
    /* 雪だるま */
    if (x > 120 && x < 330 && y > 250 && y < 470) {
      if (inEl(x, y, 250, 452, 82, 13) && o.id === M.snow) o.sh *= 0.62;
      sph(o, x, y, 240, 396, 60, 56, M.snow);
      if (
        nearSeg(x, y, 196, 370, 140, 330, 2.6) ||
        nearSeg(x, y, 160, 344, 150, 328, 2) ||
        nearSeg(x, y, 284, 368, 336, 336, 2.6) ||
        nearSeg(x, y, 322, 345, 334, 328, 2)
      ) {
        o.id = M.twig;
        o.sh = 0.6;
        o.sp = 0;
      }
      sph(o, x, y, 240, 316, 40, 38, M.snow);
      if (inEl(x, y, 240, 352, 42, 11) || inQuad(x, y, QS)) {
        o.id = M.scarf;
        o.sh = 0.88 - (0.2 * (x - 200)) / 80;
        o.sp = 0;
      }
      if (
        inEl(x, y, 226, 306, 4, 4.4) ||
        inEl(x, y, 256, 306, 4, 4.4) ||
        inEl(x, y, 240, 382, 5, 5) ||
        inEl(x, y, 240, 408, 5, 5)
      ) {
        o.id = M.coal;
        o.sh = 0.6;
        o.sp = 0;
      }
      if (inTri(x, y, 239, 316, 239, 327, 272, 322)) {
        o.id = M.carrot;
        o.sh = y < 321 ? 0.85 : 0.6;
        o.sp = 0;
      }
      if (inQuad(x, y, QH)) {
        o.id = M.hat;
        o.sh = 0.85 - (0.4 * (x - 214)) / 52;
        o.sp = 0;
      }
      if (inEl(x, y, 240, 290, 34, 6)) {
        o.id = M.hat;
        o.sh = 0.6;
        o.sp = 0;
      }
    }
  },
  w(x, y) {
    let w0 = 0.6,
      w1 = 0;
    /* 店の壁は空の半分しか見ない */
    if (x >= 430 && y < 336) w0 = y < 160 ? 0.52 : 0.32;
    else if (x < 430 && y > 140 && y < 216) w0 = 0.4;
    const u = (x - 560) / 150,
      v = (y - 330) / 95;
    w1 = 1.5 * Math.exp(-0.75 * (u * u + v * v));
    /* 窓の横の壁 */
    if (x >= 430 && y < 336 && y > 160) w1 = 0.5 * Math.exp(-(((x - 560) / 160) ** 2));
    if (y >= 40 && y < 160 && x >= 430) w1 = 0.04;
    if (x < 430 && y < 216) w1 = 0;
    /* 窓の中 */
    if (x > 472 && x < 638 && y > 180 && y < 302) {
      w0 = 0.12;
      w1 = 1.3;
    }
    return [w0, w1];
  },
};
