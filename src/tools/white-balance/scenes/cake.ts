/* ケーキ: ろうそくの光だけで、白いクリームといちごを写す */
import { inEl, inQuad, type Mat, type Scene } from '../scene';
import { ga, sg } from '../spectrum';
import { ball, dirL } from './shape';

const mats = {
  wall: [86, 84, 82],
  cloth: 0.84,
  plate: 0.8,
  cream: [248, 244, 232],
  berry: (l: number) => 0.04 + 0.62 * sg(l, 600, 10) + 0.02 * ga(l, 450, 30),
  calyx: (l: number) => 0.04 + 0.16 * ga(l, 550, 30),
  pink: [236, 128, 176],
  blue: (l: number) => 0.05 + 0.5 * ga(l, 468, 30),
  yel: (l: number) => 0.06 + 0.74 * sg(l, 512, 12),
  grn: [86, 176, 96],
  wax: 0.86,
  wick: 0.05,
  box: (l: number) => 0.04 + 0.42 * ga(l, 465, 32),
  ribbon: (l: number) => 0.05 + 0.7 * sg(l, 515, 12),
  juice: (l: number) => 0.05 + 0.8 * sg(l, 572, 11),
  glass: 0.6,
  flame: 1,
} satisfies Record<string, Mat>;
type Ids = Readonly<Record<keyof typeof mats, number>>;

/** ろうそくの炎の真ん中 */
const LX = 400,
  LY = 190;
/* ろうそくの根もとの x・y・色 */
const CAN = [
  [318, 262, 'pink'],
  [358, 250, 'blue'],
  [400, 246, 'yel'],
  [442, 250, 'grn'],
  [482, 262, 'pink'],
] as const;
/** 炎の中心 */
const FL = CAN.map((c) => [c[0], c[1] - 66] as const);
/* 縁の飾り（奥はクリーム、手前はいちごとクリームを交互） */
const RIM: { x: number; y: number; berry: boolean; front: boolean; L: ReturnType<typeof dirL> }[] = [];
for (let k = 0; k < 14; k++) {
  const t = (2 * Math.PI * k) / 14 + 0.11,
    x = 400 + 136 * Math.cos(t),
    y = 262 + 30 * Math.sin(t),
    front = Math.sin(t) > 0;
  const berry = front && k % 2 === 0;
  RIM.push({ x, y, berry, front, L: dirL((LX - x) * 0.6, -140, front ? 55 : 120) });
}
RIM.sort((a, b) => a.y - b.y);
const BACK = RIM.filter((r) => !r.front),
  FRONT = RIM.filter((r) => r.front);
const LBOX = dirL(1, -1, 0.6);
/* 贈り物の箱の前・上・右の面 */
const QB1 = [
  [70, 330],
  [200, 330],
  [200, 430],
  [70, 430],
] as const;
const QB2 = [
  [95, 312],
  [225, 312],
  [200, 330],
  [70, 330],
] as const;
const QB3 = [
  [200, 330],
  [225, 312],
  [225, 412],
  [200, 430],
] as const;

export const SCENE: Scene = {
  id: 'cake',
  name: 'ケーキ',
  pick: [400, 322],
  refs: [[400, 322, 'クリーム']],
  mats,
  emit: { flame: 0 },
  f(o, x, y, M: Ids) {
    /* 光の届き方（炎からの距離） */
    const dx = x - LX,
      dy = y - LY;
    if (y < 300) {
      o.id = M.wall;
      o.sh = 0.02 + 0.4 / (1 + (dx * dx + dy * dy) / (150 * 150));
    } else {
      o.id = M.cloth;
      const u = dx / 230,
        v = (y - 330) / 150,
        q = 1 + u * u + v * v;
      o.sh = 0.03 + 1.0 / (q * q);
      if (inEl(x, y, 405, 358, 218, 55)) o.sh *= 0.7;
    }
    /* 炎のまわりのにじみ（壁の上だけ） */
    if (y < 258 && y > 110 && x > 276 && x < 524 && o.id === M.wall) {
      let g = 0;
      for (let i = 0; i < 5; i++) {
        const F = FL[i] as (typeof FL)[number],
          ex = x - F[0],
          ey = (y - F[1]) * 0.7;
        g += Math.exp(-(ex * ex + ey * ey) / (2 * 13 * 13));
      }
      const s = 0.24 * g - 0.003;
      if (s > 0) {
        o.id = M.flame;
        o.sh = Math.min(1, o.sh * 0.095 + s);
      }
    }
    /* 左: 贈り物の箱 */
    if (x > 18 && x < 200 && y > 286 && y < 440) {
      const xb = x + 40;
      const f2 = 0.55 + 0.45 / (1 + ((x - 400) / 260) ** 2);
      if (inQuad(xb, y, QB1)) {
        o.id = xb > 127 && xb < 143 ? M.ribbon : M.box;
        o.sh = 0.5 * f2;
      } else if (inQuad(xb, y, QB2)) {
        o.id = Math.abs(xb - 147 + (y - 321) * 1.39) < 8 || Math.abs(y - 321) < 4 ? M.ribbon : M.box;
        o.sh = 0.7 * f2;
      } else if (inQuad(xb, y, QB3)) {
        /* 上面の横向きの帯（奥行きの中ほど）が、そのまま側面を縦に下りる */
        o.id = Math.abs(xb - 212.5) < 5.5 ? M.ribbon : M.box;
        o.sh = 0.85 * f2;
      }
      if (
        ball(o, xb, y, 130, 304, 22, 13, M.ribbon, LBOX, 0.35, 0.15) ||
        ball(o, xb, y, 165, 304, 22, 13, M.ribbon, LBOX, 0.35, 0.15)
      ) {
        o.sh *= f2;
      }
      ball(o, xb, y, 148, 309, 9, 8, M.ribbon, LBOX, 0.35, 0.2);
    }
    /* 右: オレンジジュースのコップ */
    if (x > 646 && x < 726 && y > 270 && y < 412) {
      const xg = x - 50;
      const u = (xg - 636) / 36;
      if (Math.abs(u) < 1 && y > 300 && y < 400 + 6 * Math.sqrt(1 - u * u)) {
        o.id = M.juice;
        o.sh = 0.25 + 0.55 * Math.max(0, 0.8 - 0.6 * u) * Math.sqrt(1 - u * u);
        o.sp = 0.4 * Math.exp(-(((u + 0.45) / 0.07) ** 2));
      }
      if (inEl(xg, y, 636, 300, 36, 7)) {
        o.id = M.juice;
        o.sh = 0.75;
      }
      if (Math.abs(u) < 1 && y > 276 && y < 300 && Math.abs(u) > 0.9) {
        o.id = M.glass;
        o.sh = 0.6;
      }
      if (inEl(xg, y, 636, 276, 36, 7) && !inEl(xg, y, 636, 276, 33, 5.5)) {
        o.id = M.glass;
        o.sh = 0.75;
      }
    }
    /* 皿 */
    if (inEl(x, y, 400, 346, 192, 44)) {
      o.id = M.plate;
      o.sh = inEl(x, y, 400, 343, 172, 36) ? 0.5 : 0.62;
    }
    /* ケーキ */
    if (x > 246 && x < 554 && y > 150 && y < 380) {
      const u = (x - 400) / 150,
        uu = 1 - u * u;
      if (uu > 0 && y > 262 && y < 338 + 36 * Math.sqrt(uu)) {
        o.id = M.cream;
        const t = (y - 262) / (76 + 36 * Math.sqrt(uu));
        o.sh = (0.62 - 0.34 * t) * (0.55 + 0.45 * Math.sqrt(uu)) + 0.06 * Math.exp(-(((u + 0.2) / 0.25) ** 2));
      }
      if (inEl(x, y, 400, 262, 150, 36)) {
        o.id = M.cream;
        o.sh = 0.78 + 0.25 / (1 + (dx * dx + (y - 252) * (y - 252) * 4) / (110 * 110));
      }
      if (y < 296) {
        for (const r of BACK)
          if (Math.abs(x - r.x) < 15 && Math.abs(y - r.y) < 15)
            ball(o, x, y, r.x, r.y - 5, 14, 11, M.cream, r.L, 0.45, 0.12);
        /* ろうそく */
        for (let i = 0; i < 5; i++) {
          const c = CAN[i] as (typeof CAN)[number],
            ex = x - c[0];
          if (ex > -6 && ex < 6 && y > c[1] - 58 && y < c[1]) {
            const t = ex / 6;
            o.id = (((y + ex * 1.2) % 14) + 14) % 14 < 6 ? M.wax : M[c[2]];
            o.sh = 0.45 + 0.5 * Math.sqrt(1 - t * t);
          }
          if (Math.abs(ex) < 1.3 && y > c[1] - 66 && y <= c[1] - 58) {
            o.id = M.wick;
            o.sh = 0.5;
          }
          const fy = y - (FL[i] as (typeof FL)[number])[1];
          if (fy > -24 && fy < 12) {
            const hw =
              fy < 0
                ? 6.5 * Math.sqrt(1 - (fy / 24) ** 2) * (1 + (fy / 24) * 0.35)
                : 6.5 * Math.sqrt(1 - (fy / 12) ** 2);
            if (Math.abs(ex) < hw) {
              o.id = M.flame;
              o.sh = 1.3;
            }
          }
        }
      }
      for (const r of FRONT)
        if (Math.abs(x - r.x) < 17 && Math.abs(y - r.y + 4) < 20) {
          if (r.berry) {
            ball(o, x, y, r.x, r.y - 2, 15, 16, M.berry, r.L, 0.4, 0.45);
            if (inEl(x, y, r.x, r.y - 17, 9, 4)) {
              o.id = M.calyx;
              o.sh = 0.6;
              o.sp = 0;
            }
          } else ball(o, x, y, r.x, r.y - 5, 14, 11, M.cream, r.L, 0.45, 0.12);
        }
    }
  },
};
