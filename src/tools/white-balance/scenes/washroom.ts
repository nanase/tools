/* 洗面所: 青いタイルと紺の棚ばかりで、写真全体の平均で合わせる自動補正がだまされる */
import { hash, inEl, type Mat, type Scene, sph } from '../scene';
import { ga, sg } from '../spectrum';
import { cyl, cylSp, seg2 } from './shape';

const mats = {
  tile: (l: number) => 0.08 + 0.62 * ga(l, 472, 36) + 0.05 * ga(l, 530, 30),
  grout: 0.72,
  navy: (l: number) => 0.05 + 0.42 * ga(l, 466, 32),
  counter: [168, 180, 192],
  sink: 0.86,
  towel: 0.84,
  stripe: (l: number) => 0.05 + 0.6 * sg(l, 600, 10),
  chrome: 0.5,
  cup: (l: number) => 0.06 + 0.62 * sg(l, 592, 14) + 0.06 * ga(l, 440, 25),
  brushY: (l: number) => 0.06 + 0.72 * sg(l, 512, 12),
  brushG: (l: number) => 0.04 + 0.3 * ga(l, 535, 30),
  bristle: 0.85,
  duck: (l: number) => 0.05 + 0.8 * sg(l, 515, 11),
  beak: (l: number) => 0.05 + 0.78 * sg(l, 575, 11),
  eye: 0.04,
} satisfies Record<string, Mat>;
type Ids = Readonly<Record<keyof typeof mats, number>>;

export const SCENE: Scene = {
  id: 'washroom',
  name: '洗面所',
  pick: [640, 215],
  refs: [[640, 215, '白いタオル']],
  mats,
  f(o, x, y, M: Ids) {
    /* 壁のタイル */
    if (y < 300) {
      const tx = Math.floor(x / 50),
        ty = Math.floor(y / 50),
        px = x - tx * 50,
        py = y - ty * 50;
      const lit = 0.72 + 0.22 * Math.exp(-((x - 120) ** 2 + (y + 60) ** 2) / (2 * 420 * 420));
      if (px < 3 || py < 3) {
        o.id = M.grout;
        o.sh = lit * 0.95;
      } else {
        o.id = M.tile;
        o.sh = lit * (0.95 + 0.07 * hash(tx, ty)) * (px < 7 || py < 7 ? 1.08 : px > 45 || py > 45 ? 0.86 : 1);
      }
    } else if (y < 326) {
      o.id = M.counter;
      o.sh = y < 318 ? 0.9 : 0.62;
    } else {
      /* 紺の棚 */
      o.id = M.navy;
      o.sh = 0.78 - (0.12 * (y - 326)) / 174;
      if (y < 334) o.sh = 0.45;
      if (Math.abs(x - 400) < 3) o.sh = 0.3;
      const inner = (x > 40 && x < 385 && y > 350 && y < 480) || (x > 415 && x < 760 && y > 350 && y < 480);
      if (
        inner &&
        (Math.abs(y - 350) < 3 ||
          Math.abs(y - 480) < 3 ||
          Math.abs(x - 40) < 3 ||
          Math.abs(x - 385) < 3 ||
          Math.abs(x - 415) < 3 ||
          Math.abs(x - 760) < 3)
      )
        o.sh *= 0.7;
      if (y > 385 && y < 445 && (Math.abs(x - 370) < 5 || Math.abs(x - 430) < 5)) {
        o.id = M.chrome;
        const nx = (x - (x < 400 ? 370 : 430)) / 5;
        o.sh = cyl(nx);
        o.sp = 0.6 * cylSp(nx);
      }
    }
    /* 台の上の影 */
    if (y >= 300 && y < 318) {
      if (inEl(x, y, 395, 314, 110, 6)) o.sh *= 0.6;
      if (inEl(x, y, 215, 314, 30, 4)) o.sh *= 0.6;
      if (inEl(x, y, 545, 314, 40, 4)) o.sh *= 0.6;
    }
    /* タオル掛けとタオル */
    if (x >= 560 && x <= 730) {
      if (y >= 132 && y <= 144) {
        o.id = M.chrome;
        const ny = (y - 138) / 6;
        o.sh = 0.25 + 0.75 * Math.max(0, 1 - Math.abs(ny + 0.4));
        o.sp = 0.6 * Math.exp(-(((ny + 0.5) / 0.2) ** 2));
      }
      if ((x <= 566 || x >= 724) && y >= 124 && y <= 150) {
        o.id = M.chrome;
        o.sh = 0.6;
      }
      if (x >= 582 && x <= 702 && y >= 140 && y <= 298) {
        const u = x - 582,
          bot = 292 + 4 * Math.sin(u * 0.08);
        if (y <= bot) {
          o.id = M.towel;
          o.sh = 0.86 + 0.08 * Math.sin(u * 0.11 + 0.6) - 0.12 * (u / 120);
          if (y < 162) {
            o.sh *= 1.05;
            if (y > 156) o.sh *= 0.72;
          }
          if (y > 254 && y < 270) {
            o.id = M.stripe;
            o.sh *= 0.95;
          }
          if (u < 3 || u > 117) o.sh *= 0.8;
        }
      }
    }
    /* 蛇口（グースネック） */
    if (x >= 350 && x <= 410 && y >= 150 && y <= 300) {
      if (x >= 353 && x <= 367 && y >= 178) {
        o.id = M.chrome;
        const nx = (x - 360) / 7;
        o.sh = cyl(nx);
        o.sp = 0.7 * cylSp(nx);
      }
      const r = Math.hypot(x - 381, y - 180);
      if (y < 180 && r >= 14 && r <= 28) {
        o.id = M.chrome;
        const t = (r - 21) / 7;
        o.sh = 0.3 + 0.7 * Math.max(0, (-(y - 180) / r) * 0.6 - t * 0.5 + 0.4);
        o.sp = 0.6 * Math.exp(-(((t + 0.3) / 0.25) ** 2)) * Math.max(0, -(y - 180) / r);
      }
      if (x >= 395 && x <= 409 && y >= 180 && y <= 204) {
        o.id = M.chrome;
        const nx = (x - 402) / 7;
        o.sh = cyl(nx);
        o.sp = 0.7 * cylSp(nx);
      }
    }
    /* 置き型の白い洗面ボウル */
    if (y >= 244 && y <= 318 && x >= 240 && x <= 480) {
      if (y >= 262 && y <= 312) {
        const t = (y - 262) / 50,
          hw = 118 * (1 - 0.52 * t * t);
        if (Math.abs(x - 360) <= hw) {
          o.id = M.sink;
          o.sh = cyl((x - 360) / hw) * (1 - 0.18 * t);
          o.sp = 0.35 * cylSp((x - 360) / hw);
        }
      }
      if (inEl(x, y, 360, 312, 56.6, 6)) {
        o.id = M.sink;
        o.sh = 0.55;
      }
      if (inEl(x, y, 360, 262, 118, 17)) {
        o.id = M.sink;
        o.sh = 0.97;
        if (inEl(x, y, 360, 263, 106, 12.5)) {
          o.sh = 0.5 + (0.32 * (x - 360)) / 106 + (0.12 * (y - 263)) / 12.5;
        }
      }
    }
    /* コップと歯ブラシ */
    if (x >= 160 && x <= 250 && y >= 180 && y <= 318) {
      const by = seg2(x, y, 201, 262, 178, 190),
        gy = seg2(x, y, 214, 262, 240, 192);
      if (by < 16) {
        o.id = M.brushY;
        o.sh = 0.85 - 0.3 * Math.max(0, Math.min(1, (x - 176) / 8));
      }
      if (x <= 184 && y >= 188 && y <= 210 && seg2(x, y, 178, 190, 178, 212) < 36 && x < 178) {
        o.id = M.bristle;
        o.sh = 0.85;
      }
      if (gy < 16) {
        o.id = M.brushG;
        o.sh = 0.85 - 0.3 * Math.max(0, Math.min(1, (x - 236) / 8));
      }
      if (x >= 241 && x <= 250 && y >= 192 && y <= 214) {
        o.id = M.bristle;
        o.sh = 0.8;
      }
      if (x >= 186 && x <= 242 && y >= 248 && y <= 314) {
        const nx = (x - 214) / 28;
        o.id = M.cup;
        o.sh = cyl(nx);
        o.sp = 0.35 * cylSp(nx);
      }
      if (inEl(x, y, 214, 314, 28, 4)) {
        o.id = M.cup;
        o.sh = 0.5;
      }
      if (inEl(x, y, 214, 248, 28, 6)) {
        o.id = M.cup;
        o.sh = inEl(x, y, 214, 248.5, 24, 4.4) ? 0.3 : 0.85;
      }
    }
    /* アヒルのおもちゃ */
    if (x >= 500 && x <= 600 && y >= 222 && y <= 320) {
      sph(o, x, y, 574, 272, 13, 17, M.duck);
      sph(o, x, y, 543, 292, 40, 24, M.duck);
      sph(o, x, y, 532, 252, 20, 20, M.duck);
      if (inEl(x, y, 512, 258, 10, 5.5)) {
        o.id = M.beak;
        o.sh = 0.85;
      }
      if (inEl(x, y, 526, 247, 3, 3.2)) {
        o.id = M.eye;
        o.sh = 0.5;
      }
    }
  },
};
