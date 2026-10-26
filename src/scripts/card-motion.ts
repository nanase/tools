/**
 * カードの図柄: マウスを乗せている間（タッチでは指が触れている間）だけ、図柄の時刻を進めて描き直す。
 * 離すと時刻を逆に戻して止まっている絵へ帰る。1 周より長く動かしたときは、1 周で割った余りの分だけ戻す。
 * 図柄の式（lib/card-art.ts）は、初めて乗せたときに読み込む。動きを減らす設定では動かさない
 */
import { $$ } from '../lib/dom';
import { RM } from '../lib/motion';

type Arts = typeof import('../lib/card-art');

/** 戻すのにかける最長の時間 [s]。それより短く動かしたときは同じ速さで戻す */
const BACK = 0.6;

/** 動かしている図柄。進めているときは t = t1 + (now − at)、戻しているときは t1 から back 秒かけて 0 へ */
interface Live {
  at: number;
  t1: number;
  back: number;
}

let arts: Promise<Arts> | undefined;
/** 読み込み終えた図柄の式 */
let lib: Arts | undefined;
const live = new Map<SVGSVGElement, Live>();
/** ビルド時に出した、止まっているときの図柄 */
const still = new Map<SVGSVGElement, string>();
let raf = 0,
  tick = 0;

/** 図柄の今の時刻 [s]。戻し終えたら null */
function timeOf(m: Live, now: number): number | null {
  const s = Math.max(0, (now - m.at) / 1000);
  if (!m.back) return m.t1 + s;
  if (s >= m.back) return null;
  const p = s / m.back;
  return m.t1 * (1 - p * p * (3 - 2 * p));
}

function step(now: number, A: Arts['ART']): void {
  tick = performance.now();
  for (const [svg, m] of live) {
    const t = timeOf(m, now);
    if (t === null) {
      live.delete(svg);
      svg.innerHTML = still.get(svg) ?? svg.innerHTML;
    } else svg.innerHTML = A[svg.dataset.art ?? '']?.(t) ?? '';
  }
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
  const m = live.get(svg),
    now = performance.now();
  /* 戻している途中なら、その時刻から進め直す */
  live.set(svg, { at: now, t1: m ? (timeOf(m, now) ?? 0) : 0, back: 0 });
  arts ??= import('../lib/card-art');
  arts.then((a) => {
    lib = a;
    kick(a.ART);
  });
}

function stop(svg: SVGSVGElement): void {
  const m = live.get(svg);
  if (!m || m.back) return;
  const now = performance.now(),
    t = timeOf(m, now) ?? 0,
    /* t と t + 1 周は同じ絵なので、余りへ移しても見た目は変わらない */
    loop = lib?.LOOP[svg.dataset.art ?? ''],
    t1 = loop ? t % loop : t;
  if (t1 > 0) live.set(svg, { at: now, t1, back: Math.min(BACK, t1) });
  else {
    live.delete(svg);
    svg.innerHTML = still.get(svg) ?? svg.innerHTML;
  }
}

for (const svg of $$<SVGSVGElement>('a.unit svg[data-art]')) {
  const card = svg.closest('a') as HTMLAnchorElement;
  /* タッチでは指を置いたときに pointerenter、離すか画面を動かしたときに pointerleave が届く */
  card.addEventListener('pointerenter', () => play(svg));
  card.addEventListener('pointerleave', () => stop(svg));
}
