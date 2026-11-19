/**
 * しくみの枠（components/HowSteps.astro）の図を、工程のカードに指を乗せている間だけ動かす。
 * 止まっているときは完成した絵（k = 1）を出し、乗せると k = 0 から順に進め、終わりで少し止まってから初めへ戻る。
 * 離すと完成した絵へ戻す。タッチでは押すと 1 周だけ動かす。動きを減らす設定では動かさない。
 * コマ送り（1 秒に 12 回）で描き、カードの図柄と動きの手触りをそろえる
 */
import { RM } from './motion';

/** k は 0〜1 の進み。1 が完成した絵 */
export type HowDraw = (c: CanvasRenderingContext2D, k: number) => void;
export interface HowFig {
  draw: HowDraw;
  /** 0 から 1 まで進む秒数 */
  dur: number;
}
export interface HowAnimOpts {
  /** 図の大きさ（CSS の画素） */
  w: number;
  h: number;
  /** 描く前に色などを読み直す（初めとテーマが変わったとき） */
  prepare?: () => void;
}

/** 終わりで止まる秒数 */
const HOLD = 1.2;
const FPS = 12;

export function mountHowAnim(host: HTMLElement, figs: readonly HowFig[], o: HowAnimOpts): void {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const cards = [...host.querySelectorAll<HTMLElement>('.how-c')].flatMap((el, i) => {
    const cv = el.querySelector('canvas'),
      fig = figs[i],
      c = cv?.getContext('2d');
    if (!cv || !fig || !c) return [];
    cv.width = o.w * dpr;
    cv.height = o.h * dpr;
    return [{ el, c, fig, t0: -1, loop: false, k: 1 }];
  });
  type Card = (typeof cards)[number];
  const paint = (s: Card, k: number): void => {
    s.k = k;
    s.c.setTransform(dpr, 0, 0, dpr, 0, 0);
    s.c.clearRect(0, 0, o.w, o.h);
    s.fig.draw(s.c, k);
  };
  let raf = 0;
  const tick = (ms: number): void => {
    raf = 0;
    let busy = false;
    for (const s of cards) {
      if (s.t0 < 0) continue;
      const per = s.fig.dur + HOLD;
      let t = (ms - s.t0) / 1000;
      if (!s.loop && t >= per) {
        s.t0 = -1;
        paint(s, 1);
        continue;
      }
      t = Math.floor((t % per) * FPS) / FPS;
      const k = Math.min(1, t / s.fig.dur);
      if (k !== s.k) paint(s, k);
      busy = true;
    }
    if (busy) raf = requestAnimationFrame(tick);
  };
  const start = (s: Card, loop: boolean): void => {
    if (RM.matches) return;
    s.t0 = performance.now();
    s.loop = loop;
    paint(s, 0);
    if (!raf) raf = requestAnimationFrame(tick);
  };
  const stop = (s: Card): void => {
    if (s.t0 < 0) return;
    s.t0 = -1;
    paint(s, 1);
  };
  for (const s of cards) {
    s.el.addEventListener('pointerenter', (e) => e.pointerType !== 'touch' && start(s, true));
    s.el.addEventListener('pointerleave', (e) => e.pointerType !== 'touch' && stop(s));
    s.el.addEventListener('pointerdown', (e) => e.pointerType === 'touch' && start(s, false));
  }
  /* 見えてから描く（画素ごとの計算が重い図があるため） */
  let shown = false;
  const all = (): void => {
    o.prepare?.();
    for (const s of cards) paint(s, s.k);
  };
  new IntersectionObserver((e) => {
    if (shown || !e[e.length - 1].isIntersecting) return;
    shown = true;
    all();
  }).observe(host);
  new MutationObserver(() => shown && all()).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => shown && all());
}
