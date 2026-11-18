/**
 * 回路図の動き: 配線と部品を電圧の色で塗り、電流を黄色い粒で流す。
 * 粒は枝の電流を線分ごとに足した値で動き、速さは電流の大きさで決まる（pxPerSec）
 */
import type { State } from './circuits';
import { type Drawing, type Seg, segments } from './schematic';

const NS = 'http://www.w3.org/2000/svg';
/** 粒の間隔 */
const GAP = 14;

/** 電流 [A] → 粒の速さ [図の単位/秒]。20 mA で 160、10 倍ごとに約 2.2 倍（0.35 乗）。1 μA 未満は止める */
export function pxPerSec(i: number): number {
  const a = Math.abs(i);
  return a < 1e-6 ? 0 : Math.max(4, 160 * (a / 0.02) ** 0.35);
}

/** 色の文字列（#rrggbb・rgb()）を [r, g, b] に */
function rgbOf(s: string): [number, number, number] {
  const h = s.trim();
  if (h.startsWith('#')) {
    const x = h.length === 4 ? [...h.slice(1)].map((c) => c + c).join('') : h.slice(1, 7);
    return [0, 2, 4].map((i) => Number.parseInt(x.slice(i, i + 2), 16)) as [number, number, number];
  }
  const m = h.match(/[\d.]+/g) ?? ['0', '0', '0'];
  return [Number(m[0]), Number(m[1]), Number(m[2])];
}

interface Run {
  seg: Seg;
  dots: SVGCircleElement[];
  gap: number;
  phase: number;
}

export class FlowView {
  private runs: Run[] = [];
  private nets: Element[] = [];
  private c0: [number, number, number] = [150, 150, 150];
  private c1: [number, number, number] = [100, 180, 40];
  private colorAt = 0;

  constructor(private readonly svg: SVGSVGElement) {}

  /** 図を差し替え、粒を作り直す */
  set(d: Drawing): void {
    this.svg.innerHTML = `${d.svg}<g class="t5-pts"></g>`;
    this.nets = [...this.svg.querySelectorAll('[data-n]')];
    const g = this.svg.querySelector('.t5-pts') as SVGGElement;
    this.runs = segments(d.branches).map((seg) => {
      const n = Math.max(1, Math.round(seg.len / GAP)),
        dots: SVGCircleElement[] = [];
      for (let i = 0; i < n; i++) {
        const c = document.createElementNS(NS, 'circle');
        c.setAttribute('r', '2.6');
        c.setAttribute('class', 't5-pt');
        c.setAttribute('visibility', 'hidden');
        g.appendChild(c);
        dots.push(c);
      }
      return { seg, dots, gap: seg.len / n, phase: 0 };
    });
    this.colorAt = 0;
  }

  /** 電圧 0 → vmax を灰 → 黄緑で */
  private color(v: number, vmax: number): string {
    const t = vmax > 0 ? Math.max(0, Math.min(1, v / vmax)) : 0,
      a = this.c0,
      b = this.c1;
    return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
  }

  /** 1 フレーム分。dt は粒を動かす実際の時間（一時停止中は 0） */
  update(st: State, vmax: number, dt: number, branchK: string[]): void {
    /* 配色の切り替えに追従する（毎フレーム読むと重いので 0.5 秒ごと） */
    this.colorAt -= Math.max(dt, 1 / 60);
    if (this.colorAt <= 0) {
      const cs = getComputedStyle(this.svg);
      this.c0 = rgbOf(cs.getPropertyValue('--t5-v0') || '#9aa2a8');
      this.c1 = rgbOf(cs.getPropertyValue('--t5-v1') || '#6aa800');
      this.colorAt = 0.5;
    }
    for (const el of this.nets) {
      const c = this.color(st.n[(el as HTMLElement).dataset.n as string] ?? 0, vmax);
      if (el.tagName === 'stop') el.setAttribute('stop-color', c);
      else (el as SVGElement).style.stroke = c;
    }
    for (const r of this.runs) {
      let i = 0;
      for (const [bi, dir] of r.seg.of) i += dir * (st.I[branchK[bi] as string] ?? 0);
      const v = pxPerSec(i);
      if (!v) {
        for (const c of r.dots) c.setAttribute('visibility', 'hidden');
        continue;
      }
      r.phase = (((r.phase + Math.sign(i) * v * dt) % r.gap) + r.gap) % r.gap;
      const { a, b, len } = r.seg;
      r.dots.forEach((c, k) => {
        const f = ((r.phase + k * r.gap) % len) / len;
        c.setAttribute('cx', (a[0] + (b[0] - a[0]) * f).toFixed(1));
        c.setAttribute('cy', (a[1] + (b[1] - a[1]) * f).toFixed(1));
        c.setAttribute('visibility', 'visible');
      });
    }
  }
}
