/**
 * 式の板。四隅に各種類の全体の小さな絵を置き、横軸をかける前の |x|・|y|、縦軸をかけた後の |Re| を混ぜる量にする。
 * 浮かぶ枠の暗い地に描く（テーマに依らない）。つまみは現在地の印なので橙
 */
import type { FamId, Formula } from './formula';
import { FAMS } from './formula';

export const CORNERS: readonly (readonly [FamId, 0 | 1, 0 | 1])[] = [
  ['m', 0, 0],
  ['bs', 1, 0],
  ['ce', 0, 1],
  ['bu', 1, 1],
];
const INK = '#e6e8e4',
  BG = '#15191c',
  KNOB = '#e8833a';
/** 内側の正方形の余白（板の幅に対する割合） */
const MARGIN = 0.2;

export function drawPad(cv: HTMLCanvasElement, f: Formula, thumbs: Partial<Record<FamId, CanvasImageSource>>): void {
  const r = cv.getBoundingClientRect();
  if (!r.width) return;
  const dpr = Math.min(2, devicePixelRatio || 1),
    W = Math.round(r.width * dpr);
  if (cv.width !== W || cv.height !== W) {
    cv.width = W;
    cv.height = W;
  }
  const g = cv.getContext('2d');
  if (!g) return;
  g.clearRect(0, 0, W, W);
  const m = W * MARGIN,
    s = W - 2 * m;
  g.fillStyle = '#20262a';
  g.fillRect(m, m, s, s);
  g.strokeStyle = '#48525a';
  g.lineWidth = dpr;
  g.strokeRect(m, m, s, s);
  const tw = W * 0.38,
    th = tw * 0.63;
  for (const [k, a, b] of CORNERS) {
    const x = Math.min(W - tw, Math.max(0, m + a * s - tw / 2)),
      y = b ? W - th : 0,
      img = thumbs[k];
    g.save();
    g.beginPath();
    g.roundRect(x, y, tw, th, 5 * dpr);
    g.clip();
    g.fillStyle = '#000';
    g.fill();
    if (img) g.drawImage(img, x, y, tw, th);
    g.fillStyle = 'rgba(0,0,0,.55)';
    g.fillRect(x, y + th - 15 * dpr, tw, 15 * dpr);
    g.restore();
    g.fillStyle = INK;
    g.font = `${10.5 * dpr}px system-ui,sans-serif`;
    g.textAlign = 'left';
    g.fillText(FAMS.find((q) => q.id === k)?.n ?? '', x + 4 * dpr, y + th - 4 * dpr);
  }
  g.fillStyle = INK;
  g.font = `${11.5 * dpr}px system-ui,sans-serif`;
  g.textAlign = 'center';
  g.fillText('|x|, |y| →', W / 2, m + s / 2 - 8 * dpr);
  g.save();
  g.translate(m + 13 * dpr, W / 2 + 6 * dpr);
  g.rotate(-Math.PI / 2);
  g.fillText('|Re| →', 0, 0);
  g.restore();
  g.beginPath();
  g.arc(m + f.pre * s, m + f.post * s, 8 * dpr, 0, 7);
  g.fillStyle = KNOB;
  g.fill();
  g.lineWidth = 2 * dpr;
  g.strokeStyle = BG;
  g.stroke();
}

/** 押した点の混ぜる量（0〜1 に収める前の値） */
export function padHit(cv: HTMLCanvasElement, x: number, y: number): [number, number] {
  const r = cv.getBoundingClientRect(),
    m = r.width * MARGIN,
    s = r.width - 2 * m;
  return [(x - r.left - m) / s, (y - r.top - m) / s];
}
