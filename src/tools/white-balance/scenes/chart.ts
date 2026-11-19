/* 色見本: 24 色の色見本を写し、補正で色がどう動くかを見る */
import type { Mat, Scene } from '../scene';
import { CHART } from '../spectrum';

const CK = CHART.map((_, i) => `c${i}`);
const mats: Record<string, Mat> = { backdrop: 0.22, board: 0.035 };
CHART.forEach((r, i) => {
  mats[CK[i] as string] = r;
});

export const SCENE: Scene = {
  id: 'chart',
  name: '色見本',
  pick: [132, 354],
  refs: [[132, 354, '白の見本']],
  mats,
  f(o, x, y, M) {
    o.sp = 0;
    o.id = M.backdrop as number;
    o.sh = 0.85;
    if (x >= 70 && x <= 730 && y >= 55 && y <= 445) {
      o.id = M.board as number;
      o.sh = 0.9;
      const c = Math.floor((x - 86) / 106),
        r = Math.floor((y - 71) / 94),
        px = x - 86 - c * 106,
        py = y - 71 - r * 94;
      if (c >= 0 && c < 6 && r >= 0 && r < 4 && px < 92 && py < 80) {
        o.id = M[CK[r * 6 + c] as string] as number;
        o.sh = 0.95 - 0.06 * (x / 800);
      }
    }
  },
};
