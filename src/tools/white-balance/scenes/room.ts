/* 部屋: 窓の昼光（光 1）とランプ（光 2）が混ざり、窓側とランプ側の紙の色が違う */
import { grain, inEl, inQuad, type Mat, type Scene, sph } from '../scene';
import { arr, ga, sg } from '../spectrum';

const mats = {
  wall: [226, 216, 196],
  wood: arr((l) => 0.06 + 0.42 * sg(l, 578, 32)),
  paper: 0.86,
  gray: 0.18,
  frame: 0.82,
  dark: 0.07,
  apple: arr((l) => 0.045 + 0.6 * sg(l, 602, 9) + 0.03 * ga(l, 450, 30)),
  orange: arr((l) => 0.05 + 0.78 * sg(l, 572, 11)),
  sky: 1,
  shade: 1,
  mug: arr((l) => 0.05 + 0.5 * ga(l, 468, 30)),
  lemon: arr((l) => 0.06 + 0.74 * sg(l, 512, 12)),
  leaf: arr((l) => 0.035 + 0.13 * ga(l, 552, 30) + 0.5 * sg(l, 712, 10)),
  leaf2: arr((l) => 0.05 + 0.25 * ga(l, 548, 34) + 0.5 * sg(l, 712, 10)),
  pblue: [120, 160, 205],
  stem: arr((l) => 0.04 + 0.14 * sg(l, 580, 40)),
} satisfies Record<string, Mat>;
type Ids = Readonly<Record<keyof typeof mats, number>>;

const PAPER1 = [
  [50, 392],
  [245, 382],
  [262, 478],
  [60, 490],
] as const;
const PAPER2 = [
  [540, 382],
  [738, 392],
  [728, 490],
  [524, 478],
] as const;

export const SCENE: Scene = {
  id: 'room',
  name: '部屋',
  pick: [150, 436],
  refs: [
    [150, 436, '窓側の紙'],
    [630, 436, 'ランプ側の紙'],
  ],
  lights: ['cloud', 'bulb'],
  mats,
  emit: { sky: 0, shade: 1 },
  f(o, x, y, M: Ids) {
    o.sp = 0;
    if (y < 300) {
      o.id = M.wall;
      o.sh = 0.9;
    } else {
      o.id = M.wood;
      o.sh = 0.8 * grain(x, y);
    }
    /* 窓 */
    if (x >= 40 && x <= 240 && y >= 40 && y <= 252) {
      const inPane = x > 48 && x < 232 && y > 48 && y < 244 && Math.abs(x - 140) > 4 && Math.abs(y - 146) > 4;
      o.id = inPane ? M.sky : M.frame;
      o.sh = inPane ? 1.25 : 0.92;
    }
    /* ランプ: 柱・台・かさ */
    if (x >= 682 && x <= 690 && y >= 185 && y <= 335) {
      o.id = M.dark;
      o.sh = 0.6;
    }
    if (inEl(x, y, 686, 335, 30, 7)) {
      o.id = M.dark;
      o.sh = 0.5;
    }
    if (y >= 110 && y <= 190) {
      const t = (y - 110) / 80,
        xl = 655 - 20 * t,
        xr = 717 + 20 * t;
      if (x >= xl && x <= xr) {
        o.id = M.shade;
        o.sh = 1.05;
      }
    }
    /* 額の絵 */
    if (x >= 466 && x <= 614 && y >= 66 && y <= 180) {
      if (x < 476 || x > 604 || y < 76 || y > 170) {
        o.id = M.stem;
        o.sh = 0.75;
      } else {
        o.id = M.pblue;
        o.sh = 0.9;
        if (inEl(x, y, 515, 104, 13, 13)) {
          o.id = M.lemon;
          o.sh = 1;
        }
        if (inEl(x, y, 585, 190, 95, 58)) {
          o.id = M.leaf2;
          o.sh = 0.85;
        }
        if (inEl(x, y, 490, 200, 90, 52)) {
          o.id = M.leaf;
          o.sh = 0.8;
        }
      }
    }
    if (x >= 360 && x <= 430 && y >= 185 && y <= 338) {
      o.id = M.gray;
      o.sh = 0.86;
    }
    /* 本 */
    if (x >= 560 && x <= 652 && y >= 306 && y <= 340) {
      const b = Math.floor((y - 306) / 11.4);
      o.id = b === 0 ? M.mug : b === 1 ? M.lemon : M.apple;
      o.sh = x > 644 ? 0.55 : 0.85 - 0.05 * b;
      if ((y - 306) % 11.4 < 1.2) o.sh *= 0.6;
    }
    /* マグカップ */
    if ((x >= 388 && x <= 436 && y >= 330 && y <= 384) || inEl(x, y, 412, 384, 24, 6)) {
      o.id = M.mug;
      const nx = Math.max(-1, Math.min(1, (x - 412) / 24));
      o.sh = 0.18 + (0.82 * Math.max(0, -0.45 * nx + 0.75 * Math.sqrt(1 - nx * nx))) / 0.875;
      o.sp = 0.3 * Math.exp(-(((nx + 0.38) / 0.07) ** 2));
    }
    if (x > 434 && inEl(x, y, 440, 356, 16, 17) && !inEl(x, y, 440, 356, 8, 10)) {
      o.id = M.mug;
      o.sh = 0.45;
    }
    if (inEl(x, y, 412, 330, 24, 6)) {
      o.id = M.mug;
      o.sh = inEl(x, y, 412, 331, 21, 4.5) ? 0.22 : 0.7;
    }
    if (inQuad(x, y, PAPER1)) {
      o.id = M.paper;
      o.sh = 0.93;
    }
    if (inQuad(x, y, PAPER2)) {
      o.id = M.paper;
      o.sh = 0.93;
    }
    sph(o, x, y, 300, 360, 38, 37, M.apple);
    sph(o, x, y, 500, 362, 36, 35, M.orange);
  },
  w(x, y) {
    const w0 = 1.25 * Math.exp(-(x - 40) / 260) * (y < 300 ? 1 : 0.95),
      w1 = 1.15 / (1 + ((x - 686) ** 2 + (y - 150) ** 2) / (150 * 150));
    return [w0, w1];
  },
};
