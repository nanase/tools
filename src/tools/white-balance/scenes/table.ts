/* 食卓: 白い紙・グレーカード・果物・青いマグ。光は 1 つで、補正の基本を見る */
import { grain, inEl, inQuad, type Mat, type Scene, sph } from '../scene';
import { arr, ga, sg } from '../spectrum';

const mats = {
  wall: [226, 216, 196],
  wood: arr((l) => 0.06 + 0.42 * sg(l, 578, 32)),
  paper: 0.86,
  gray: 0.18,
  plate: 0.8,
  apple: arr((l) => 0.045 + 0.6 * sg(l, 602, 9) + 0.03 * ga(l, 450, 30)),
  orange: arr((l) => 0.05 + 0.78 * sg(l, 572, 11)),
  lemon: arr((l) => 0.06 + 0.74 * sg(l, 512, 12)),
  leaf: arr((l) => 0.035 + 0.13 * ga(l, 552, 30) + 0.5 * sg(l, 712, 10)),
  leaf2: arr((l) => 0.05 + 0.25 * ga(l, 548, 34) + 0.5 * sg(l, 712, 10)),
  pot: arr((l) => 0.07 + 0.42 * sg(l, 592, 28)),
  mug: arr((l) => 0.05 + 0.5 * ga(l, 468, 30)),
  stem: arr((l) => 0.04 + 0.14 * sg(l, 580, 40)),
} satisfies Record<string, Mat>;
type Ids = Readonly<Record<keyof typeof mats, number>>;

/* 鉢の植物: 根元から扇に出る茎と、両端のとがった葉 [角度°, 茎の長さ, 葉の長さ, 葉の半幅, 材質] */
const PL = (
  [
    [-64, 22, 56, 13, 'leaf2'],
    [-38, 38, 66, 15, 'leaf'],
    [-13, 54, 70, 16, 'leaf2'],
    [13, 50, 68, 16, 'leaf'],
    [38, 36, 64, 15, 'leaf2'],
    [63, 20, 54, 13, 'leaf'],
  ] as const
).map(([a, s, L, w, m]) => {
  const r = (a * Math.PI) / 180;
  return { bx: 155, by: 252, dx: Math.sin(r), dy: -Math.cos(r), s, L, w, m };
});
const PAPER = [
  [55, 388],
  [258, 374],
  [292, 476],
  [72, 490],
] as const;

export const SCENE: Scene = {
  id: 'table',
  name: '食卓',
  pick: [170, 432],
  refs: [[170, 432, '白い紙']],
  mats,
  f(o, x, y, M: Ids) {
    o.sp = 0;
    if (y < 300) {
      o.id = M.wall;
      o.sh = 0.6 + 0.32 * Math.exp(-((x - 180) ** 2 + (y + 40) ** 2) / (2 * 330 * 330));
    } else {
      o.id = M.wood;
      o.sh = (0.8 - (0.2 * (y - 300)) / 200) * grain(x, y);
      if (
        inEl(x, y, 428, 440, 172, 40) ||
        inEl(x, y, 582, 364, 46, 9) ||
        inEl(x, y, 175, 334, 44, 7) ||
        (y > 300 && y < 340 && x > 706 && x < 706 + (340 - y) * 0.9)
      )
        o.sh *= 0.55;
    }
    for (const P of PL) {
      const qx = x - P.bx,
        qy = y - P.by,
        t = qx * P.dx + qy * P.dy,
        n = -qx * P.dy + qy * P.dx;
      if (t > 0 && t < P.s + 6 && Math.abs(n) < 1.6) {
        o.id = M.leaf;
        o.sh = 0.42;
        continue;
      }
      const u = t - P.s;
      if (u > 0 && u < P.L) {
        const hw = P.w * Math.sin(Math.PI * (u / P.L) ** 0.8);
        if (Math.abs(n) < hw) {
          o.id = M[P.m];
          o.sh = Math.abs(n) < 1.1 ? 0.42 : n < 0 ? 0.78 : 0.56;
        }
      }
    }
    if (y >= 245 && y <= 334) {
      const t = (y - 245) / 89,
        xl = 118 + 9 * t,
        xr = 192 - 9 * t;
      if (x >= xl && x <= xr) {
        o.id = M.pot;
        const u = (x - xl) / (xr - xl);
        o.sh = (0.3 + 0.62 * Math.sin(Math.PI * Math.min(1, 0.15 + u * 0.95))) * (y < 258 ? 1.12 : 1);
      }
    }
    if (x >= 620 && x <= 706 && y >= 176 && y <= 340) {
      o.id = M.gray;
      o.sh = 0.86;
    }
    if ((x >= 520 && x <= 592 && y >= 262 && y <= 362) || inEl(x, y, 556, 362, 36, 9)) {
      o.id = M.mug;
      const nx = Math.max(-1, Math.min(1, (x - 556) / 36));
      o.sh = 0.18 + (0.82 * Math.max(0, -0.45 * nx + 0.75 * Math.sqrt(1 - nx * nx))) / 0.875;
      o.sp = 0.35 * Math.exp(-(((nx + 0.38) / 0.07) ** 2));
    }
    if (x > 590 && inEl(x, y, 598, 312, 24, 26) && !inEl(x, y, 598, 312, 13, 15)) {
      o.id = M.mug;
      o.sh = 0.45;
    }
    if (inEl(x, y, 556, 262, 36, 9)) {
      o.id = M.mug;
      o.sh = inEl(x, y, 556, 263, 32, 7) ? 0.22 : 0.7;
    }
    if (inQuad(x, y, PAPER)) {
      o.id = M.paper;
      o.sh = 0.93;
    }
    if (inEl(x, y, 400, 412, 165, 50)) {
      o.id = M.plate;
      o.sh = inEl(x, y, 400, 408, 118, 34) ? 0.84 : 0.96;
      if (inEl(x, y, 372, 414, 58, 14) || inEl(x, y, 478, 418, 50, 12)) o.sh *= 0.6;
    }
    sph(o, x, y, 345, 368, 50, 48, M.apple);
    if (x >= 342 && x <= 348 && y >= 310 && y <= 324) {
      o.id = M.stem;
      o.sh = 0.6;
      o.sp = 0;
    }
    sph(o, x, y, 456, 374, 46, 45, M.orange);
    sph(o, x, y, 404, 428, 44, 27, M.lemon);
  },
};
