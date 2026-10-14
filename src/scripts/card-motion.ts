/**
 * カードの図柄: マウスを乗せている間だけ、図柄の時刻を進めて描き直す。
 * 図柄の式（lib/card-art.ts）は、初めて乗せたときに読み込む。タッチと動きを減らす設定では動かさない
 */
import { $$ } from '../lib/dom';
import { RM } from '../lib/motion';

type Arts = typeof import('../lib/card-art');

let arts: Promise<Arts> | undefined;
/** 動かしている図柄と、動かし始めた時刻 [ms] */
const live = new Map<SVGSVGElement, number>();
/** ビルド時に出した、止まっているときの図柄 */
const still = new Map<SVGSVGElement, string>();
let raf = 0,
  tick = 0;

function step(now: number, A: Arts['ART']): void {
  tick = performance.now();
  for (const [svg, t0] of live) svg.innerHTML = A[svg.dataset.art ?? '']?.(Math.max(0, (now - t0) / 1000)) ?? '';
  raf = live.size ? requestAnimationFrame((n) => step(n, A)) : 0;
}

/** 描画を予約する。予約したまま描画が届かなくなっていたら（画面が隠れた間に落ちたなど）予約し直す */
function kick(A: Arts['ART']): void {
  if (!live.size || (raf && performance.now() - tick < 250)) return;
  if (raf) cancelAnimationFrame(raf);
  tick = performance.now();
  raf = requestAnimationFrame((n) => step(n, A));
}

function play(svg: SVGSVGElement): void {
  if (RM.matches) return;
  if (!still.has(svg)) still.set(svg, svg.innerHTML);
  live.set(svg, performance.now());
  arts ??= import('../lib/card-art');
  arts.then((m) => kick(m.ART));
}

function stop(svg: SVGSVGElement): void {
  if (!live.delete(svg)) return;
  svg.innerHTML = still.get(svg) ?? svg.innerHTML;
}

for (const svg of $$<SVGSVGElement>('a.unit svg[data-art]')) {
  const card = svg.closest('a') as HTMLAnchorElement;
  card.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && play(svg));
  card.addEventListener('pointerleave', () => stop(svg));
}
