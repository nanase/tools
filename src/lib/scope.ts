/**
 * オシロスコープ風の表示窓（10 × 6 div）。
 * 目盛りの SVG はビルド時に .astro で出し、波形と軸の数値はブラウザで描く。
 */
import { $ } from './dom';
import { fmt } from './format';

export const SW = 400,
  SH = 240,
  DV = 40,
  GY = 200;

/** 目盛り（ビルド時に使う）。rows は縦の div の数（既定の 6 なら高さ SH） */
export function gridSvg(rows = 6): string {
  const h = rows * DV;
  let g = '';
  for (let i = 0; i <= 10; i++) g += `<path class="gl" d="M${i * DV} 0V${h}"/>`;
  for (let j = 0; j <= rows; j++) g += `<path class="gl" d="M0 ${j * DV}H${SW}"/>`;
  for (let x = 8; x < SW; x += 8) g += `<path class="gb" d="M${x} ${h / 2 - 3}v6"/>`;
  for (let y = 8; y < h; y += 8) g += `<path class="gb" d="M${SW / 2 - 3} ${y}h6"/>`;
  return `${g}<rect class="gb" x="0" y="0" width="${SW}" height="${h}"/>`;
}

/** 1-2-5 の切りのよい値に切り上げる */
export function nice(x: number): number {
  const e = Math.floor(Math.log10(x)),
    m = x / 10 ** e;
  return Number(((m <= 1.0001 ? 1 : m <= 2.0001 ? 2 : m <= 5.0001 ? 5 : 10) * 10 ** e).toPrecision(2));
}

/** 時間 0 を左から 1 div、電圧 0 を下から 1 div に置く座標変換 */
export const mapper = (td: number, vd: number) => ({
  X: (t: number) => (DV + (t / td) * DV).toFixed(2),
  Y: (v: number) => (GY - (v / vd) * DV).toFixed(2),
});

export interface Frame {
  /** 横軸・縦軸の 1 div あたり */
  td: number;
  vd: number;
  /** トリガレベル（右端の印） */
  trig: number;
  ch1: string;
  ch2?: string;
  label: string;
}

export class ScopeView {
  private readonly tr1: SVGPathElement;
  private readonly tr2: SVGPathElement | null;
  private readonly axes: SVGGElement;
  private readonly svg: SVGSVGElement;

  constructor(readonly root: HTMLElement) {
    this.tr1 = $('.t1', root);
    this.tr2 = root.querySelector('.t2');
    this.axes = $('.axes', root);
    this.svg = $('svg', root);
    const tg = root.querySelector<HTMLButtonElement>('.tg');
    tg?.addEventListener('click', () => {
      const on = tg.getAttribute('aria-pressed') !== 'true';
      tg.setAttribute('aria-pressed', String(on));
      $('.scope', root).classList.toggle('hide2', !on);
    });
  }

  draw(f: Frame): void {
    const { Y } = mapper(f.td, f.vd);
    this.tr1.setAttribute('d', f.ch1);
    if (this.tr2 && f.ch2) this.tr2.setAttribute('d', f.ch2);
    let a = '';
    for (let i = 1; i <= 9; i += 2)
      a += `<text x="${i * DV}" y="${SH + 17}" text-anchor="middle">${i === 1 ? '0' : fmt((i - 1) * f.td, 's', 3)}</text>`;
    for (let j = 0; j <= 5; j++)
      a += `<text x="-10" y="${GY - j * DV + 4}" text-anchor="end">${j ? fmt(j * f.vd, 'V', 3) : '0'}</text>`;
    a += `<path class="mk1" d="M-8 ${GY - 5}L-1 ${GY}L-8 ${GY + 5}Z"/><path class="mk1" d="M${DV - 5} -12L${DV + 5} -12L${DV} -5Z"/><path class="mk1" d="M${SW + 1} ${Y(f.trig)}l6 -5v10Z"/>`;
    this.axes.innerHTML = a;
    $('.s-vd', this.root).textContent = fmt(f.vd, 'V', 3);
    $('.s-td', this.root).textContent = fmt(f.td, 's', 3);
    this.svg.setAttribute('aria-label', f.label);
  }
}
