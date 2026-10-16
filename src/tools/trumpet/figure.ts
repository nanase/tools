/**
 * トランペットの図（DOM）: 横から見た楽器の気柱を圧力の色で塗り、弁のボタンを押し具合で下げる。
 * 唇とマウスピースの断面は、1 周期の位相ごとの唇の開き・マウスピースの圧力から描く。
 * 気柱の色は 9 段（負は青、正は朱）。振れ幅の表示では、マウスピースの圧力が最も高い位相の分布を描き、
 * スローでは受け取った 1 周期を遅くして繰り返す
 */
import { $ } from '../../lib/dom';
import { lipShapes } from './shapes';
import { AIR_LAYERS, type AirLayer, type AirQuad, airIndex, airQuads, keyShapes } from './side';

export type FigMode = 'amp' | 'slow';

/** worklet から届いた 1 周期の写し */
export interface Cycle {
  h: Float32Array;
  p: Float32Array;
  u: Float32Array;
  air: Float32Array;
  /** 鳴っている音の高さ [Hz]（0 なら鳴っていない）と口の圧力 [Pa] */
  f0: number;
  pm: number;
}

const QKEYS = 9;

export class TrumpetFigure {
  /** 層ごとの、9 段の色の気柱 */
  private airEls = new Map<AirLayer, SVGPathElement[]>();
  private keyEls: SVGPathElement[][] = [];
  private stems: SVGPathElement;
  private quads: AirQuad[] = [];
  private qIdx: Int32Array = new Int32Array(0);
  private vKey = '';
  mode: FigMode = 'amp';
  slow = 400;
  /** 断面の図の位相（振れ幅の表示で ◀ ▶ が動かす。スローでは自動で進む） */
  phase = 0;
  /** 気柱の色の目盛り [Pa]（届いた周期の最大でゆっくり追う） */
  scale = 1000;
  constructor() {
    for (const l of AIR_LAYERS)
      this.airEls.set(
        l,
        Array.from({ length: QKEYS }, (_, i) => $<SVGPathElement>(`#air-${l}-${i}`)),
      );
    for (let i = 0; i < 3; i++) this.keyEls.push([...$(`#k-${i}`).querySelectorAll<SVGPathElement>('path')]);
    this.stems = $<SVGPathElement>('#k-stems');
    this.keys([0, 0, 0]);
  }

  /** 弁のボタン（押し具合 0〜1） */
  keys(press: readonly number[]): void {
    const k = keyShapes(press);
    this.stems.setAttribute('d', k.stems);
    for (let i = 0; i < 3; i++) {
      this.keyEls[i][0].setAttribute('d', k.caps[i]);
      this.keyEls[i][1].setAttribute('d', k.pearls[i]);
      this.keyEls[i][2].setAttribute('d', k.marks[i]);
    }
  }

  /** 気柱の四角を、押している弁の組に合わせて作り直す */
  private route(v: readonly boolean[]): void {
    const key = v.map(Number).join('');
    if (key === this.vKey) return;
    this.vKey = key;
    this.quads = airQuads(v);
    this.qIdx = Int32Array.from(this.quads.map((q) => airIndex(q.el, q.s)));
  }

  /** 表示する位相: スローは時刻 now [s] から、振れ幅はマウスピースの圧力が最も高い位相 */
  phaseOf(c: Cycle, now: number): number {
    if (this.mode === 'slow') {
      const f = c.f0 > 0 ? c.f0 : 233;
      return Math.floor(((now * f) / this.slow) * c.h.length) % c.h.length;
    }
    let k = 0;
    for (let i = 1; i < c.p.length; i++) if (c.p[i] > c.p[k]) k = i;
    return k;
  }

  /** 気柱を塗る（位相 k の分布）。弁は押し具合が半分を超えた側の通り道 */
  air(c: Cycle | null, k: number, press: readonly number[]): void {
    this.route(press.map((x) => x > 0.5));
    const D = new Map(AIR_LAYERS.map((l) => [l, new Array<string>(QKEYS).fill('')]));
    const np = c ? c.air.length / c.h.length : 0;
    if (c && np > 0) {
      let mx = 0;
      for (let i = 0; i < c.air.length; i++) mx = Math.max(mx, Math.abs(c.air[i]));
      /* 目盛りは大きくなるときはすぐ、小さくなるときはゆっくり */
      this.scale = Math.max(50, mx > this.scale ? mx : this.scale * 0.97 + mx * 0.03);
    }
    for (let i = 0; i < this.quads.length; i++) {
      const q = this.quads[i],
        v = c && np > 0 ? c.air[k * np + this.qIdx[i]] / this.scale : 0,
        j = Math.max(-4, Math.min(4, Math.round(4 * v))) + 4;
      (D.get(q.layer) as string[])[j] += q.d;
    }
    for (const l of AIR_LAYERS) {
      const ds = D.get(l) as string[],
        els = this.airEls.get(l) as SVGPathElement[];
      for (let j = 0; j < QKEYS; j++) els[j].setAttribute('d', ds[j] || 'M0 0');
    }
  }

  /** 唇とマウスピースの断面（位相 k） */
  lips(c: Cycle | null, k: number): void {
    const n = c?.h.length ?? 0,
      h = c && c.f0 > 0 ? Math.max(0, c.h[k] * 1000) : 0,
      dh = c && n ? c.h[(k + 1) % n] - c.h[(k + n - 1) % n] : 0,
      s = lipShapes(h, dh > 0);
    $('#mp-tissue').setAttribute('d', s.tissue);
    $('#mp-red').setAttribute('d', s.red);
    $('#mp-jet').setAttribute('d', c && c.f0 > 0 ? s.jet : 'M0 0');
    $('#mp-arrow').setAttribute('d', c && c.f0 > 0 ? s.arrow : 'M0 0');
    $('#mp-dim').setAttribute('d', c && c.f0 > 0 ? s.dim : 'M0 0');
    const p = c && c.f0 > 0 ? c.p[k] : 0,
      cls = (x: number) => {
        const q = Math.max(-4, Math.min(4, Math.round((4 * x) / this.scale)));
        return q === 0 ? 'pq0' : `pq${q}`;
      };
    $('#mp-cup').setAttribute('class', cls(p));
    $('#mp-lp').setAttribute('class', cls(p));
    $('#mp-mouth').setAttribute('class', cls(c ? c.pm : 0));
  }
}
