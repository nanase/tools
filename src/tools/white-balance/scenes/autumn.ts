/* 紅葉の林: 黄・橙・赤の葉ばかりで、自動補正が青に転ぶ。白樺の白い幹が手がかりになる */
import { hash, inEl, inQuad, LD, type Mat, type Scene } from '../scene';
import { sg } from '../spectrum';

const mats = {
  yel: (l: number) => 0.06 + 0.8 * sg(l, 510, 11),
  ora: (l: number) => 0.05 + 0.78 * sg(l, 575, 11),
  red: (l: number) => 0.04 + 0.62 * sg(l, 606, 9),
  deep: [96, 48, 30],
  litter: (l: number) => 0.05 + 0.42 * sg(l, 585, 16),
  path: [160, 140, 112],
  birch: 0.8,
  bark: 0.06,
} satisfies Record<string, Mat>;
type Ids = Readonly<Record<keyof typeof mats, number>>;
type Leaf = 'yel' | 'ora' | 'red';

const LX = LD[0],
  LY = LD[1],
  LZ = LD[2];
/** 円柱の陰影（nx は −1〜1） */
const cyl = (nx: number): number =>
  0.22 + (0.78 * Math.max(0, -0.45 * nx + 0.75 * Math.sqrt(Math.max(0, 1 - nx * nx)))) / 0.875;

/* 葉のかたまり [cx, cy, r, 材質]。x 40 px ごとの列に分けて引く */
const PF: (readonly [number, number, number, Leaf])[] = [];
for (let j = 0; j < 6; j++)
  for (let i = 0; i < 12; i++) {
    const h = hash(i + 3, j + 7),
      h2 = hash(j + 11, i + 5);
    const r = j < 4 ? 50 + 16 * h : 30 + 12 * h;
    PF.push([
      i * 72 - 14 + 26 * (h - 0.5) + (j % 2) * 36,
      j * 56 + 6 + 18 * (h2 - 0.5),
      r,
      h2 < 0.42 ? 'yel' : h2 < 0.74 ? 'ora' : 'red',
    ]);
  }
const BK: number[][] = [];
for (let c = 0; c < 20; c++) {
  const L: number[] = [];
  PF.forEach((p, k) => {
    if (p[0] + p[2] >= c * 40 && p[0] - p[2] <= c * 40 + 40) L.push(k);
  });
  BK.push(L);
}
/* 白樺 [x, 半幅, 根元の y] と、右下へ落ちる影 */
const TR = [
  [118, 22, 420],
  [292, 14, 372],
  [612, 27, 458],
  [718, 16, 382],
] as const;
const SHQ = TR.map(
  ([bx, hw, by]) =>
    [
      [bx - hw, by - 4],
      [bx + hw, by - 4],
      [bx + hw + 150 * (hw / 20), by + 24 * (hw / 20)],
      [bx - hw + 120 * (hw / 20), by + 26 * (hw / 20)],
    ] as const,
);

export const SCENE: Scene = {
  id: 'autumn',
  name: '紅葉の林',
  pick: [600, 300],
  refs: [[600, 300, '白樺の幹']],
  mats,
  f(o, x, y, M: Ids) {
    if (y < 348) {
      o.id = M.deep;
      o.sh = 0.55 + (0.25 * y) / 348;
      const L = BK[Math.min(19, Math.max(0, (x / 40) | 0))] as number[];
      for (let k = L.length - 1; k >= 0; k--) {
        const p = PF[L[k] as number] as (typeof PF)[number],
          dx = (x - p[0]) / p[2],
          dy = (y - p[1]) / p[2],
          q = dx * dx + dy * dy;
        if (q < 1.2) {
          let e = 1;
          if (q > 0.72) {
            const a = Math.atan2(dy, dx);
            e = 1 + 0.045 * Math.sin(5 * a + p[0]) + 0.03 * Math.sin(9 * a + p[1]);
            e *= e;
          }
          if (q < e) {
            const nz = Math.sqrt(Math.max(0, 1 - q / e));
            o.id = M[p[3]];
            o.sh = 0.32 + 0.66 * Math.max(0, (dx * LX + dy * LY) / Math.sqrt(e) + nz * LZ);
            break;
          }
        }
      }
    } else {
      const t = (y - 348) / 152;
      o.id = M.litter;
      o.sh = 0.62 + 0.3 * t;
      const hl = 44 + 170 * t;
      if (x > 400 - hl && x < 400 + hl) {
        o.id = M.path;
        o.sh = 0.7 + 0.22 * t;
        /* 道に落ちた葉 */
        const cx = Math.floor(x / 30),
          cy = Math.floor(y / 16),
          h = hash(cx, cy);
        if (h < 0.22 && inEl(x, y, cx * 30 + 15, cy * 16 + 8, 5 + 7 * t, 2.5 + 3 * t)) {
          o.id = h < 0.12 ? M.red : h < 0.24 ? M.yel : M.ora;
          o.sh = 0.8;
        }
      }
      for (let k = 0; k < 4; k++)
        if (inQuad(x, y, SHQ[k] as (typeof SHQ)[number])) {
          o.sh *= 0.5;
          break;
        }
    }
    for (let k = 0; k < 4; k++) {
      const T = TR[k] as (typeof TR)[number],
        nx = (x - T[0]) / T[1];
      if (nx > -1 && nx < 1 && y < T[2] + T[1] * 0.3 * Math.sqrt(1 - nx * nx)) {
        o.id = M.birch;
        o.sh = cyl(nx);
        /* 横の黒い筋 */
        const yy = y + k * 37,
          c = Math.floor(yy / 24),
          hm = hash(k + 1, c);
        if (hm < 0.6 && yy - c * 24 < 3 + 4 * hm) {
          const a = hash(c, k + 2) * 1.4 - 1.2;
          if (nx > a && nx < a + 0.5 + 0.8 * hm) o.id = M.bark;
        }
        if (y > T[2] - 8) o.id = M.bark;
      }
    }
  },
};
