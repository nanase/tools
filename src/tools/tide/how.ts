/**
 * しくみの枠の工程。絵は viewBox 0 0 160 86 の SVG の中身で、線と塗りの class は style.css の .td-how にある:
 * se 海、ld 陸、mo 月、ar 矢印の線、ah 矢じり、c1・c2 月の分・太陽の分の輪郭、pt 港、tx 文字
 */
import type { HowStep } from '../../lib/how';

/** (x0, y0) から (x1, y1) への矢印 */
function ah(x0: number, y0: number, x1: number, y1: number): string {
  const dx = x1 - x0,
    dy = y1 - y0,
    L = Math.hypot(dx, dy),
    ux = dx / L,
    uy = dy / L,
    h = 5,
    f = (v: number) => Math.round(v * 10) / 10;
  return (
    `<path class="ar" d="M${x0} ${y0}L${f(x1 - ux * h * 0.7)} ${f(y1 - uy * h * 0.7)}"/>` +
    `<path class="ah" d="M${x1} ${y1}L${f(x1 - ux * h - uy * h * 0.55)} ${f(y1 - uy * h + ux * h * 0.55)}L${f(x1 - ux * h + uy * h * 0.55)} ${f(y1 - uy * h - ux * h * 0.55)}Z"/>`
  );
}
const earth = '<circle class="se" cx="60" cy="42" r="24"/>';
const moon = '<circle class="mo" cx="140" cy="42" r="9"/>';
const bulge = '<ellipse class="se" cx="60" cy="42" rx="36" ry="24"/><circle class="ld" cx="60" cy="42" r="20"/>';

const FIG: readonly string[] = [
  /* 月の引力: 月に近い側ほど長い矢印 */
  `${earth}${moon}${ah(36, 42, 56, 42)}${ah(60, 42, 86, 42)}${ah(84, 42, 122, 42)}`,
  /* 中心との差: 月の側は月へ、裏側は月と反対へ、横は内へ */
  `${earth}${moon}${ah(84, 42, 104, 42)}${ah(36, 42, 16, 42)}${ah(60, 18, 60, 26)}${ah(60, 66, 60, 58)}<circle class="ah" cx="60" cy="42" r="2.5"/>`,
  /* 2 つの膨らみ */
  `${bulge}${moon}`,
  /* 地球の自転: 港が 2 つの膨らみの下を通る */
  `${bulge}<path class="ar" d="M60 30A12 12 0 1 0 48 42"/>${ah(50, 36, 48, 43)}<circle class="pt" cx="96" cy="42" r="3.5"/><circle class="pt" cx="24" cy="42" r="3.5"/>${moon}`,
  /* 太陽の分: 並ぶと膨らみが重なり（大潮）、直角でずれる（小潮） */
  '<ellipse class="c1" cx="50" cy="40" rx="34" ry="22"/><ellipse class="c2" cx="50" cy="40" rx="30" ry="25"/><ellipse class="c1" cx="128" cy="40" rx="22" ry="34"/><ellipse class="c2" cx="128" cy="40" rx="25" ry="30"/><text class="tx" x="50" y="82" text-anchor="middle">大潮</text><text class="tx" x="128" y="82" text-anchor="middle">小潮</text>',
];

const svg = (i: number): string => `<svg viewBox="0 0 160 86" aria-hidden="true">${FIG[i]}</svg>`;

export const STEPS: readonly HowStep[] = [
  { h: '月の引力', fig: svg(0), p: '月に近い側ほど強い' },
  { h: '中心との差', fig: svg(1), p: '中心の引力を引いた残りは、月の側と裏側で逆向き' },
  { h: '2 つの膨らみ', fig: svg(2), p: '海は月の側と反対側に寄る' },
  { h: '地球の自転', fig: svg(3), p: ['港が膨らみの下を通るたびに満潮', '1 日に 2 回'] },
  { h: '太陽の分', fig: svg(4), p: ['月の分の約半分', '並ぶと大潮、直角で小潮'] },
];
