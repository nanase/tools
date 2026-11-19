/* 海辺: 空と海の青ばかりで、自動補正が黄に転ぶ。白い帆とパラソルが手がかりになる */
import { hash, inEl, inQuad, LD, type Mat, type Scene, sph } from '../scene';
import { sg } from '../spectrum';

const mats = {
  sky: [122, 172, 228],
  cloud: 0.94,
  hill: [74, 104, 62],
  sea: [24, 92, 162],
  foam: 0.85,
  sand: [222, 204, 170],
  sail: 0.88,
  hull: 0.82,
  mast: 0.4,
  red: (l: number) => 0.04 + 0.64 * sg(l, 604, 9),
  ball: (l: number) => 0.06 + 0.74 * sg(l, 515, 12),
  pole: 0.75,
} satisfies Record<string, Mat>;
type Ids = Readonly<Record<keyof typeof mats, number>>;

const LX = LD[0],
  LY = LD[1],
  LZ = LD[2];
const HZ = 238;
const shore = (x: number): number => 394 + 7 * Math.sin(x * 0.013 + 1);
const HULL = [
  [528, 280],
  [656, 280],
  [640, 298],
  [546, 298],
] as const;

export const SCENE: Scene = {
  id: 'beach',
  name: '海辺',
  pick: [612, 250],
  refs: [[612, 250, '白い帆']],
  mats,
  f(o, x, y, M: Ids) {
    if (y < HZ) {
      o.id = M.sky;
      o.sh = 0.78 + (0.24 * y) / HZ;
      if (
        y < 116 &&
        x < 320 &&
        (inEl(x, y, 150, 104, 62, 24) || inEl(x, y, 204, 88, 52, 32) || inEl(x, y, 256, 104, 46, 20))
      ) {
        o.id = M.cloud;
        o.sh = 1.1 - (0.28 * (y - 56)) / 60;
      }
      if (
        y < 78 &&
        x > 500 &&
        (inEl(x, y, 560, 70, 40, 15) || inEl(x, y, 600, 58, 36, 22) || inEl(x, y, 636, 70, 30, 13))
      ) {
        o.id = M.cloud;
        o.sh = 1.1 - (0.28 * (y - 36)) / 42;
      }
      if (inEl(x, y, 40, HZ, 150, 34)) {
        o.id = M.hill;
        o.sh = 0.55 + 0.3 * Math.max(0, -(x - 40) / 150);
      }
    } else {
      const sy = shore(x);
      if (y < sy) {
        o.id = M.sea;
        o.sh = 0.72 + (0.28 * (y - HZ)) / (sy - HZ);
        const r = Math.floor((y - HZ) / 14),
          h = hash(r, Math.floor((x + r * 53) / 90));
        if (h < 0.4 && y - HZ - r * 14 < 1.5 + r * 0.25 && (x + r * 53) % 90 < 30 + 40 * h) o.sh = 1.05;
        if (y > sy - 7) {
          o.id = M.foam;
          o.sh = 0.95;
        }
      } else {
        o.id = M.sand;
        o.sh = y < sy + 10 ? 0.68 : 0.84 + (0.1 * (y - sy)) / 120;
        if (inEl(x, y, 322, 478, 118, 16) || inEl(x, y, 496, 482, 30, 6)) o.sh *= 0.55;
      }
    }
    /* 帆船 */
    if (x > 524 && x < 660 && y > 170 && y < 300) {
      if (x >= 588 && x <= 591 && y >= 176 && y <= 284) {
        o.id = M.mast;
        o.sh = 0.8;
      }
      if (x > 592 && y > 184 && y < 278 && x - 592 < (y - 184) * 0.62) {
        o.id = M.sail;
        o.sh = 0.96;
      }
      if (x < 586 && y > 190 && y < 278 && 586 - x < (y - 190) * 0.5) {
        o.id = M.sail;
        o.sh = 0.8;
      }
      if (inQuad(x, y, HULL)) {
        o.id = M.hull;
        o.sh = y < 286 ? 0.95 : 0.8;
        if (y >= 289 && y < 293) o.id = M.red;
      }
    }
    /* パラソル */
    if (x >= 208 && x <= 212 && y >= 314 && y <= 484) {
      o.id = M.pole;
      o.sh = 0.7 + 0.25 * (x < 210 ? 1 : 0);
    }
    if (y <= 362 && inEl(x, y, 210, 362, 124, 56)) {
      const u = (x - 210) / 124,
        v = (y - 362) / 56,
        q = u * u + v * v;
      if (y <= 360 + 6 * Math.abs(Math.sin(Math.asin(u) * 4))) {
        const nz = Math.sqrt(Math.max(0, 1 - q));
        o.sh = 0.3 + 0.7 * Math.max(0, u * LX + v * LY + nz * LZ);
        o.id = Math.floor((Math.asin(u) + Math.PI / 2) / (Math.PI / 8)) % 2 ? M.red : M.pole;
      }
    }
    if (y >= 300 && y <= 308 && x >= 207 && x <= 213) {
      o.id = M.pole;
      o.sh = 0.9;
    }
    sph(o, x, y, 470, 460, 28, 27, M.ball);
  },
};
