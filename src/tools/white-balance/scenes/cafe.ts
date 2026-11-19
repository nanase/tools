/* カフェ: 窓の昼光（光 1）と電球（光 2）の下のケーキとメロンソーダ */
import { grain, HV, inEl, inQuad, LD, type Mat, type Out, type Scene } from '../scene';
import { ga, sg } from '../spectrum';

const mats = {
  wall: [234, 226, 208],
  frame: 0.85,
  sky: 1,
  bulb: 1,
  shade: [44, 86, 70],
  cord: 0.06,
  table: [150, 100, 62],
  plate: 0.84,
  cream: [246, 242, 232],
  sponge: [236, 200, 124],
  straw: (l: number) => 0.05 + 0.65 * sg(l, 600, 10),
  calyx: (l: number) => 0.04 + 0.2 * ga(l, 550, 30),
  soda: (l: number) => 0.05 + 0.55 * ga(l, 530, 26),
  glass: 0.7,
  ice: [247, 242, 226],
  cherry: (l: number) => 0.03 + 0.6 * sg(l, 610, 9),
  fork: 0.55,
  coaster: 0.86,
} satisfies Record<string, Mat>;
type Ids = Readonly<Record<keyof typeof mats, number>>;

/** 縦の円柱の陰影（左上から光）。nx は −1〜1 */
const cyl = (nx: number): number => {
  const t = Math.max(-1, Math.min(1, nx));
  return 0.18 + (0.82 * Math.max(0, -0.45 * t + 0.75 * Math.sqrt(1 - t * t))) / 0.875;
};
/** 楕円体の陰影。lo は影の底の明るさ、spk は鏡面の強さ */
function soft(
  o: Out,
  x: number,
  y: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  id: number,
  lo: number,
  spk: number,
): boolean {
  const nx = (x - cx) / rx,
    ny = (y - cy) / ry,
    q = nx * nx + ny * ny;
  if (q >= 1) return false;
  const nz = Math.sqrt(1 - q);
  const d = Math.max(0, nx * LD[0] + ny * LD[1] + nz * LD[2]);
  o.id = id;
  o.sh = lo + (1 - lo) * d;
  o.sp = spk > 0 ? spk * Math.max(0, nx * HV[0] + ny * HV[1] + nz * HV[2]) ** 40 : 0;
  return true;
}
const CAKE_TOP = [
  [196, 286],
  [304, 286],
  [332, 318],
  [168, 318],
] as const;

export const SCENE: Scene = {
  id: 'cafe',
  name: 'カフェ',
  pick: [180, 402],
  refs: [
    [130, 410, 'ケーキの皿'],
    [585, 422, 'コースター'],
  ],
  lights: ['cloud', 'bulb'],
  mats,
  emit: { sky: 0, bulb: 1 },
  f(o, x, y, M: Ids) {
    o.sp = 0;
    if (y < 300) {
      o.id = M.wall;
      o.sh = 0.9;
    } else {
      o.id = M.table;
      o.sh = (0.86 - (0.25 * (y - 300)) / 200) * grain(x, y * 2);
    }
    /* 窓 */
    if (x >= 36 && x <= 264 && y >= 36 && y <= 262) {
      const pane = x > 46 && x < 254 && y > 46 && y < 252 && Math.abs(x - 150) > 5 && Math.abs(y - 149) > 5;
      o.id = pane ? M.sky : M.frame;
      o.sh = pane ? 1.22 : 0.95;
    }
    if (x >= 26 && x <= 274 && y > 262 && y <= 274) {
      o.id = M.frame;
      o.sh = y < 266 ? 1 : 0.7;
    }
    /* つり下げの電球 */
    if (y < 34 && Math.abs(x - 600) < 2) {
      o.id = M.cord;
      o.sh = 0.6;
    }
    if (y >= 28 && y <= 84) {
      const t = (y - 28) / 56,
        hw = 18 + 50 * t;
      if (Math.abs(x - 600) < hw) {
        o.id = M.shade;
        o.sh = 0.25 + 0.7 * cyl((x - 600) / hw);
      }
    }
    if (y > 78 && inEl(x, y, 600, 84, 68, 10)) {
      o.id = M.bulb;
      o.sh = 1.1;
    }
    if (y > 80 && inEl(x, y, 600, 86, 19, 15)) {
      o.id = M.bulb;
      o.sh = 1.3;
    }
    /* ケーキの皿とフォーク */
    if (y > 360 && inEl(x, y, 252, 404, 146, 34)) {
      o.id = M.plate;
      o.sh = inEl(x, y, 252, 400, 110, 24) ? 0.84 : 0.97;
      if (inEl(x, y, 300, 398, 80, 14)) o.sh *= 0.62;
    }
    if (x > 90 && x < 330 && y > 436 && y < 462) {
      const t = (x - 90) / 240,
        yc = 454 - t * 8;
      if (Math.abs(y - yc) < (x < 135 ? 5 : 2.4)) {
        o.id = M.fork;
        o.sh = 0.85;
        o.sp = 0.3;
      }
    }
    /* ショートケーキ（切り口が手前） */
    if (x >= 168 && x <= 332 && y >= 318 && y <= 400) {
      const d = y - 318;
      o.sh = 0.95 - (0.12 * (x - 168)) / 164;
      if (d < 10) o.id = M.cream;
      else if (d < 32) o.id = M.sponge;
      else if (d < 46) {
        o.id = M.cream;
        for (let i = 0; i < 5; i++)
          if (inEl(x, y, 186 + i * 32, 357, 12, 6)) {
            o.id = M.straw;
            break;
          }
      } else if (d < 70) o.id = M.sponge;
      else o.id = M.cream;
    }
    if (inQuad(x, y, CAKE_TOP)) {
      o.id = M.cream;
      o.sh = 1.02;
    }
    soft(o, x, y, 212, 288, 16, 11, M.cream, 0.55, 0);
    soft(o, x, y, 292, 288, 16, 11, M.cream, 0.55, 0);
    if (soft(o, x, y, 252, 272, 20, 21, M.straw, 0.25, 0.5)) {
      if (y < 256 && inEl(x, y, 252, 252, 12, 5)) {
        o.id = M.calyx;
        o.sh = 0.7;
        o.sp = 0;
      }
    }
    /* メロンソーダ */
    if (inEl(x, y, 612, 416, 72, 15)) {
      o.id = M.coaster;
      o.sh = 0.95;
      if (inEl(x, y, 632, 414, 46, 9)) o.sh *= 0.6;
    }
    if (y >= 262 && y <= 414) {
      const t = (y - 262) / 152,
        hw = 38 - 7 * t;
      if (Math.abs(x - 604) < hw || (y > 404 && inEl(x, y, 604, 406, 34, 8))) {
        const nx = (x - 604) / hw;
        o.id = y < 292 ? M.glass : M.soda;
        o.sh = (y < 292 ? 0.85 : 0.95) * cyl(nx * 0.8);
        o.sp = 0.45 * Math.exp(-(((nx + 0.55) / 0.08) ** 2));
      }
    }
    if (x > 572 && x < 592 && y < 284 && y > 220) {
      const xc = 584 - (y - 284) * 0.1;
      if (Math.abs(x - xc) < 4) {
        o.id = M.straw;
        o.sh = 0.85;
        o.sp = 0;
      }
    }
    if (x > 566 && x < 642 && y > 252 && y < 302) soft(o, x, y, 604, 278, 36, 23, M.ice, 0.5, 0);
    if (y < 262 && y > 232 && Math.abs(x - 620 + (y - 248) * 0.25) < 1.3) {
      o.id = M.cord;
      o.sh = 0.8;
      o.sp = 0;
    }
    soft(o, x, y, 617, 256, 10, 10, M.cherry, 0.25, 0.6);
  },
  w(x, y) {
    const w0 = 1.25 * Math.exp(-(x - 40) / 300) * (y < 300 ? 1 : 0.95),
      w1 = 1.2 / (1 + ((x - 600) ** 2 + (y - 130) ** 2) / (190 * 190));
    return [w0, w1];
  },
};
