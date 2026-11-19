/* 夜の書斎: 画面の光（光 1）と電球のスタンド（光 2）が混ざり、場所ごとに白の色が違う */
import { grain, inEl, inQuad, type Mat, type Scene } from '../scene';
import { ga, sg } from '../spectrum';
import { cyl, cylSp, seg2 } from './shape';

const mats = {
  wall: [214, 206, 190],
  wood: (l: number) => 0.06 + 0.36 * sg(l, 590, 30),
  bezel: 0.06,
  screen: 1,
  bulb: 1,
  keys: 0.7,
  keyTop: 0.82,
  paper: 0.86,
  shade: (l: number) => 0.04 + 0.36 * ga(l, 500, 30),
  metal: 0.12,
  book1: (l: number) => 0.05 + 0.58 * sg(l, 602, 10),
  book2: (l: number) => 0.06 + 0.7 * sg(l, 515, 12),
  book3: (l: number) => 0.05 + 0.42 * ga(l, 470, 28),
  pages: 0.8,
  mug: (l: number) => 0.06 + 0.7 * sg(l, 574, 12),
  pencil: (l: number) => 0.04 + 0.2 * ga(l, 540, 32),
} satisfies Record<string, Mat>;
type Ids = Readonly<Record<keyof typeof mats, number>>;

const KEYS = [
  [170, 356],
  [386, 356],
  [402, 396],
  [156, 396],
] as const;
const PAPER1 = [
  [70, 410],
  [216, 402],
  [232, 472],
  [80, 482],
] as const;
const PAPER2 = [
  [462, 392],
  [600, 402],
  [592, 470],
  [446, 462],
] as const;
/* 本の山 [左, 上, 右, 下, 材質] */
const BOOKS = [
  [486, 334, 640, 350, 'book1'],
  [496, 318, 628, 334, 'book2'],
  [480, 302, 622, 318, 'book3'],
] as const;

export const SCENE: Scene = {
  id: 'study',
  name: '夜の書斎',
  pick: [150, 430],
  refs: [
    [150, 430, '画面の前の紙'],
    [530, 450, 'スタンドの下の紙'],
  ],
  lights: ['cloud', 'bulb'],
  mats,
  emit: { screen: 0, bulb: 1 },
  f(o, x, y, M: Ids) {
    if (y < 330) {
      o.id = M.wall;
      o.sh = 0.88;
    } else {
      o.id = M.wood;
      o.sh = 0.8 * grain(x, y);
      if (y > 476) o.sh = 0.5;
    }
    /* 画面の台の影 */
    if (inEl(x, y, 276, 346, 80, 10)) o.sh *= 0.55;
    /* モニタ */
    if (x >= 100 && x <= 450 && y >= 70 && y <= 346) {
      if (x >= 262 && x <= 290 && y >= 280 && y <= 340) {
        o.id = M.bezel;
        o.sh = 0.9;
      }
      if (inEl(x, y, 276, 342, 64, 9)) {
        o.id = M.bezel;
        o.sh = 1;
        if (y < 338) o.sh = 1.3;
      }
      if (x >= 104 && x <= 448 && y >= 74 && y <= 290) {
        o.id = M.bezel;
        o.sh = 1;
        if (x >= 116 && x <= 436 && y >= 86 && y <= 272) {
          o.id = M.screen;
          o.sh = 1.0;
          /* 白い文書の窓と文字の行 */
          if (x >= 150 && x <= 400 && y >= 100 && y <= 262) {
            o.sh = 1.22;
            if (
              x >= 170 &&
              x <= 380 &&
              ((y >= 122 && y <= 126) ||
                ((y - 136) % 14 < 5 && y >= 136 && y <= 246 && x <= 360 - ((Math.floor((y - 136) / 14) * 37) % 90)))
            )
              o.sh = 0.7;
          } else o.sh = 0.62;
        }
      }
    }
    /* キーボード */
    if (y >= 352 && y <= 400 && x >= 150 && x <= 420) {
      if (inQuad(x, y, KEYS)) {
        o.id = M.keys;
        o.sh = 0.75;
        const kx = Math.floor((x - 162) / 14),
          ky = Math.floor((y - 360) / 9),
          px = x - 162 - kx * 14,
          py = y - 360 - ky * 9;
        if (ky >= 0 && ky < 4 && px > 2 && px < 12 && py > 1 && py < 8 && x > 176 && x < 392) {
          o.id = M.keyTop;
          o.sh = 0.9;
        }
      }
      if (y > 396 && y <= 400 && x >= 156 && x <= 402) {
        o.id = M.keys;
        o.sh = 0.45;
      }
    }
    /* 紙（画面の前と、スタンドの下） */
    if (inQuad(x, y, PAPER1)) {
      o.id = M.paper;
      o.sh = 0.93;
    }
    if (inQuad(x, y, PAPER2)) {
      o.id = M.paper;
      o.sh = 0.93;
    }
    if (y >= 420 && y <= 440 && seg2(x, y, 476, 436, 560, 420) < 12) {
      o.id = M.pencil;
      o.sh = 0.8 - 0.25 * Math.max(0, Math.min(1, seg2(x, y, 476, 436, 560, 420) > 3 ? 1 : 0));
    }
    /* 本の山 */
    if (x >= 470 && x <= 650 && y >= 292 && y <= 352) {
      if (inEl(x, y, 560, 348, 86, 6)) o.sh *= 0.55;
      for (const b of BOOKS) {
        if (x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]) {
          if (x > b[2] - 12) {
            o.id = M.pages;
            o.sh = 0.85 - 0.15 * ((y - b[1]) % 3 < 1 ? 1 : 0);
          } else {
            o.id = M[b[4]];
            o.sh = 0.85 - (0.25 * (y - b[1])) / 16;
          }
        }
      }
    }
    /* マグカップ */
    if (x >= 700 && x <= 796 && y >= 360 && y <= 466) {
      if (inEl(x, y, 746, 458, 40, 7)) o.sh *= 0.55;
      if (x >= 768 && inEl(x, y, 770, 410, 20, 23) && !inEl(x, y, 770, 410, 10, 13)) {
        o.id = M.mug;
        o.sh = 0.5;
      }
      if (x >= 714 && x <= 770 && y >= 372 && y <= 452) {
        const nx = (x - 742) / 28;
        o.id = M.mug;
        o.sh = cyl(nx);
        o.sp = 0.35 * cylSp(nx);
      }
      if (inEl(x, y, 742, 452, 28, 6)) {
        o.id = M.mug;
        o.sh = 0.5;
      }
      if (inEl(x, y, 742, 372, 28, 6)) {
        o.id = M.mug;
        o.sh = inEl(x, y, 742, 372.5, 24, 4.3) ? 0.25 : 0.85;
      }
    }
    /* スタンド: 台・柱・腕 */
    if (x >= 560 && x <= 720 && y >= 100 && y <= 440) {
      if (inEl(x, y, 660, 430, 54, 11)) o.sh *= 0.5;
      if (inEl(x, y, 650, 422, 46, 11)) {
        o.id = M.metal;
        o.sh = y < 419 ? 1.1 : 0.6;
        o.sp = 0.15 * (y < 416 ? 1 : 0);
      }
      if (x >= 645 && x <= 655 && y >= 170 && y <= 420) {
        const nx = (x - 650) / 5;
        o.id = M.metal;
        o.sh = cyl(nx) * 1.1;
        o.sp = 0.3 * cylSp(nx);
      }
      if (seg2(x, y, 650, 172, 626, 138) < 20) {
        o.id = M.metal;
        o.sh = 0.8;
        o.sp = 0.1;
      }
      if (inEl(x, y, 650, 172, 7, 7)) {
        o.id = M.metal;
        o.sh = 1;
      }
    }
    /* かさ（台形の円すい）と電球の口 */
    if (y >= 122 && y <= 246 && x >= 520 && x <= 700) {
      const t = (y - 128) / 110,
        hw = 22 + 46 * t,
        cx = 618;
      if (t >= 0 && t <= 1 && Math.abs(x - cx) <= hw) {
        o.id = M.shade;
        const nx = (x - cx) / hw;
        o.sh = cyl(nx) * 0.95;
        o.sp = 0.4 * cylSp(nx);
      }
      if (inEl(x, y, 618, 128, 22, 5)) {
        o.id = M.shade;
        o.sh = 0.9;
      }
      if (inEl(x, y, 618, 238, 68, 10)) {
        o.id = M.shade;
        o.sh = 0.7;
        if (inEl(x, y, 618, 239, 62, 8)) {
          o.id = M.bulb;
          o.sh = 1.25;
        }
      }
    }
  },
  w(x, y) {
    const m = 0.06 + 1.05 / (1 + ((x - 276) ** 2 / (260 * 260) + (y - 250) ** 2 / (220 * 220)) * 1.6);
    let l = 1.35 / (1 + ((x - 618) ** 2 + ((y - 410) * 1.5) ** 2) / (150 * 150));
    if (y < 240) l *= 0.4 + 0.6 * Math.max(0, (y - 140) / 100);
    return [m, 0.05 + l];
  },
};
