/* 雪の夕暮れ: 光 1 は青空（日陰）、光 2 は夕日。同じ白い雪が日なたと日陰で違う色に写る */
import { hash, inEl, inQuad, type Mat, type Scene } from '../scene';
import { ga, sg } from '../spectrum';

const mats = {
  sky: [92, 148, 228],
  sun: 1,
  snow: 0.9,
  pine: (l: number) => 0.035 + 0.12 * ga(l, 550, 30) + 0.02 * sg(l, 600, 30),
  trunk: [92, 64, 44],
  scarf: (l: number) => 0.04 + 0.66 * sg(l, 604, 9),
  carrot: (l: number) => 0.05 + 0.78 * sg(l, 570, 11),
  coal: 0.05,
  bucket: (l: number) => 0.05 + 0.55 * ga(l, 465, 30),
  stick: [110, 78, 50],
} satisfies Record<string, Mat>;
type Ids = Readonly<Record<keyof typeof mats, number>>;
type P2 = readonly [number, number];
type Quad = readonly [P2, P2, P2, P2];

/** 線分 (ax, ay)-(bx, by) から 2.2 px 以内 */
const seg = (x: number, y: number, ax: number, ay: number, bx: number, by: number): boolean => {
  const ux = bx - ax,
    uy = by - ay,
    t = Math.max(0, Math.min(1, ((x - ax) * ux + (y - ay) * uy) / (ux * ux + uy * uy))),
    ex = x - ax - t * ux,
    ey = y - ay - t * uy;
  return ex * ex + ey * ey < 5;
};

const HY = 215;
/* 山の稜線 */
const RG: readonly P2[] = [
  [260, 215],
  [390, 132],
  [460, 166],
  [560, 96],
  [670, 168],
  [740, 138],
  [800, 150],
];
const ridge = (x: number): number => {
  for (let i = 0; i < RG.length - 1; i++) {
    const a = RG[i] as P2,
      b = RG[i + 1] as P2;
    if (x <= b[0]) return a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]);
  }
  return 999;
};
/** 夕日の側を向いた斜面か */
const ridgeUp = (x: number): boolean => {
  for (let i = 0; i < RG.length - 1; i++) if (x <= (RG[i + 1] as P2)[0]) return (RG[i + 1] as P2)[1] < (RG[i] as P2)[1];
  return false;
};
/* 木 [x, 根元の y, 高さ, 半幅] と、右へ伸びる影 */
const TS = [
  [200, 350, 200, 48],
  [300, 298, 130, 30],
  [700, 338, 176, 40],
] as const;
/** 夕日の向き */
const S = (() => {
  const v = [-0.82, -0.28, 0.3] as const,
    n = Math.hypot(...v);
  return [v[0] / n, v[1] / n, v[2] / n] as const;
})();
const shadowOf = (bx: number, by: number, L: number, wd: number): Quad => [
  [bx - 4, by - wd * 0.4],
  [bx + L, by + 0.1 * L - 2],
  [bx + L, by + 0.1 * L + 2],
  [bx - 4, by + wd * 0.6],
];
const SQ = TS.map(([bx, by, h, hw]) => shadowOf(bx, by, h * 1.9, hw * 0.9));
/* 雪だるまの球 [cx, cy, r] と影 */
const SM = [
  [520, 392, 56],
  [520, 318, 42],
  [520, 260, 30],
] as const;
const SMQ: Quad = [
  [470, 436],
  [520, 426],
  [760, 452],
  [700, 474],
];
const SCARF: Quad = [
  [530, 292],
  [546, 292],
  [558, 338],
  [543, 342],
];
/** 木の中なら 1（葉）か 2（幹）、外は 0 */
const tree = (x: number, y: number, T: (typeof TS)[number]): number => {
  const t = (y - (T[1] - T[2])) / T[2];
  if (t < 0 || t > 1) return 0;
  const dx = Math.abs(x - T[0]);
  if (t > 0.88) return dx < T[3] * 0.13 ? 2 : 0;
  for (let i = 2; i >= 0; i--) {
    const t0 = i * 0.25,
      t1 = t0 + 0.42;
    if (t >= t0 && t <= t1 && dx < (T[3] * (0.5 + 0.25 * i) * (t - t0)) / 0.42) return 1;
  }
  return 0;
};
/** 地平線の遠い林の上端 */
const far = (x: number): number => {
  const u = x / 15 - Math.floor(x / 15);
  return HY - 5 - (9 + 5 * hash(Math.floor(x / 15), 3)) * (1 - 2 * Math.abs(u - 0.5));
};
const WR: [number, number] = [0, 0];

export const SCENE: Scene = {
  id: 'snowdusk',
  name: '雪の夕暮れ',
  pick: [380, 420],
  refs: [
    [262, 360, '日陰の雪'],
    [380, 420, '日なたの雪'],
  ],
  lights: ['shadow', 'candle'],
  mats,
  emit: { sun: 1 },
  f(o, x, y, M: Ids) {
    if (y < HY) {
      o.id = M.sky;
      o.sh = 0.85 + (0.15 * y) / HY;
      if (inEl(x, y, 150, 200, 24, 24)) {
        o.id = M.sun;
        o.sh = 1.3;
      }
      if (y >= ridge(x)) {
        o.id = M.snow;
        o.sh = ridgeUp(x) ? 0.9 : 0.8;
      }
      if (y >= far(x)) {
        o.id = M.pine;
        o.sh = 0.6;
      }
    } else {
      o.id = M.snow;
      o.sh = 0.86 + (0.1 * (y - HY)) / 285;
    }
    for (let k = 0; k < 3; k++) {
      const T = TS[k] as (typeof TS)[number],
        r = tree(x, y, T);
      if (r) {
        o.id = r === 1 ? M.pine : M.trunk;
        o.sh = x < T[0] ? 0.95 : 0.7;
      }
    }
    /* 雪だるま */
    if (x > 420 && x < 620 && y > 210 && y < 450) {
      for (let k = 0; k < 3; k++) {
        const s = SM[k] as (typeof SM)[number],
          dx = (x - s[0]) / s[2],
          dy = (y - s[1]) / s[2],
          q = dx * dx + dy * dy;
        if (q < 1) {
          o.id = M.snow;
          o.sh = 0.78 + 0.2 * Math.sqrt(1 - q);
        }
      }
      const dx = x - 520;
      if (Math.abs(dx) < 38 && y > 284 + 5 * (dx / 38) ** 2 && y < 297 + 5 * (1 - (dx / 38) ** 2)) {
        o.id = M.scarf;
        o.sh = 0.9;
      }
      if (inQuad(x, y, SCARF)) {
        o.id = M.scarf;
        o.sh = 0.75;
      }
      if (y > 212 && y < 236 && Math.abs(dx) < 17 + (8 * (y - 212)) / 24) {
        o.id = M.bucket;
        o.sh = y < 217 ? 0.7 : 0.9;
      }
      if (y >= 236 && y < 241 && Math.abs(dx) < 28) {
        o.id = M.bucket;
        o.sh = 0.75;
      }
      if (x > 482 && x < 514 && Math.abs(y - 266) < (5 * (x - 482)) / 32) {
        o.id = M.carrot;
        o.sh = 0.95;
      }
      if (
        inEl(x, y, 510, 254, 3.5, 3.5) ||
        inEl(x, y, 532, 254, 3.5, 3.5) ||
        inEl(x, y, 520, 312, 4, 4) ||
        inEl(x, y, 520, 332, 4, 4) ||
        inEl(x, y, 520, 372, 4.5, 4.5)
      ) {
        o.id = M.coal;
        o.sh = 0.8;
      }
      /* 腕の枝 */
      if (
        seg(x, y, 484, 316, 436, 276) ||
        seg(x, y, 452, 289, 440, 268) ||
        seg(x, y, 556, 316, 604, 282) ||
        seg(x, y, 590, 292, 606, 270)
      ) {
        o.id = M.stick;
        o.sh = 0.8;
      }
    }
  },
  w(x, y) {
    /* 雪だるまの球: 夕日は向きで、空の光は上向きほど強い */
    for (let k = 2; k >= 0; k--) {
      const s = SM[k] as (typeof SM)[number],
        dx = (x - s[0]) / s[2],
        dy = (y - s[1]) / s[2],
        q = dx * dx + dy * dy;
      if (q < 1) {
        const nz = Math.sqrt(1 - q);
        WR[0] = 0.32 + 0.22 * Math.max(0, -dy) + 0.1 * nz;
        WR[1] = 1.1 * Math.max(0, dx * S[0] + dy * S[1] + nz * S[2]);
        return WR;
      }
    }
    if (y < HY) {
      if (y >= far(x)) {
        WR[0] = 0.45;
        WR[1] = 0.3;
        return WR;
      }
      if (y >= ridge(x)) {
        const up = ridgeUp(x);
        WR[0] = 0.5;
        WR[1] = up ? 0.75 : 0.04;
        return WR;
      }
      const dsun = ((x - 150) ** 2 + (y - 200) ** 2) / (2 * 110 * 110);
      WR[0] = 0.8;
      WR[1] = 0.45 * Math.exp(-(HY - y) / 50) + 1.0 * Math.exp(-dsun);
      return WR;
    }
    for (let k = 0; k < 3; k++) {
      const T = TS[k] as (typeof TS)[number];
      if (tree(x, y, T)) {
        WR[0] = 0.4;
        WR[1] = x < T[0] ? 0.55 : 0.04;
        return WR;
      }
    }
    WR[0] = 0.42;
    WR[1] = 0.82;
    for (let k = 0; k < 3; k++)
      if (inQuad(x, y, SQ[k] as Quad)) {
        WR[1] = 0;
        break;
      }
    if (inQuad(x, y, SMQ)) WR[1] = 0;
    return WR;
  },
};
