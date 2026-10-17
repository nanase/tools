/**
 * トランペットの図（DOM）: 横から見た楽器の気柱を圧力の色で塗り、ピストンのボタンを押し具合で下げる。
 * 唇とマウスピースの断面は、1 周期の位相ごとの唇の開き・マウスピースの圧力から描く。
 * 振れ幅の表示では、管の中の各点の圧力の振れ幅（1 周期の最大と最小の差の半分）を 33 段（白から朱）で塗り、
 * スローでは受け取った 1 周期を遅くして繰り返し、圧力を 65 段（負は青、正は朱）で塗る。管の中の値は読む点の間を
 * 線形に補う。唇の断面はどちらでもスローで動かす
 */
import { $ } from '../../lib/dom';
import { lipShapes } from './shapes';
import { AIR_LAYERS, AIR_STEPS, type AirLayer, type AirQuad, airQuads, airSpan, keyShapes } from './side';

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

/** 気柱の色の段の数（負・0・正） */
const QKEYS = 2 * AIR_STEPS + 1;

export class TrumpetFigure {
  /** 層ごとの、段ごとの色の気柱 */
  private airEls = new Map<AirLayer, SVGPathElement[]>();
  private keyEls: SVGPathElement[][] = [];
  private stems: SVGPathElement;
  private quads: AirQuad[] = [];
  /** 四角ごとの、はさむ 2 つの読む点と、その間の割合 */
  private qA: Int32Array = new Int32Array(0);
  private qB: Int32Array = new Int32Array(0);
  private qT: Float32Array = new Float32Array(0);
  private vKey = '';
  mode: FigMode = 'amp';
  slow = 800;
  /** スローで進める 1 周期の中の位置（0〜1）と、前に進めた時刻 [s] */
  private acc = 0;
  private last = -1;
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

  /** ピストンのボタン（押し具合 0〜1） */
  keys(press: readonly number[]): void {
    const k = keyShapes(press);
    this.stems.setAttribute('d', k.stems);
    for (let i = 0; i < 3; i++) {
      this.keyEls[i][0].setAttribute('d', k.caps[i]);
      this.keyEls[i][1].setAttribute('d', k.pearls[i]);
      this.keyEls[i][2].setAttribute('d', k.marks[i]);
    }
  }

  /** 気柱の四角を、押しているピストンの組に合わせて作り直す */
  private route(v: readonly boolean[]): void {
    const key = v.map(Number).join('');
    if (key === this.vKey) return;
    this.vKey = key;
    this.quads = airQuads(v);
    const sp = this.quads.map((q) => airSpan(q.el, q.s));
    this.qA = Int32Array.from(sp.map((x) => x[0]));
    this.qB = Int32Array.from(sp.map((x) => x[1]));
    this.qT = Float32Array.from(sp.map((x) => x[2]));
  }

  /**
   * 表示する位相: 時刻 now [s] まで、鳴っている音の周波数のスローの速さで 1 周期の中を進める。
   * 写し取りは周期ごとに始まりの位相が違うので、マウスピースの圧力が最も高い位相を始まりにそろえる
   */
  phaseOf(c: Cycle, now: number): number {
    const n = c.h.length,
      f = c.f0 > 0 ? c.f0 : 233;
    if (this.last >= 0) this.acc = (this.acc + (Math.min(0.1, Math.max(0, now - this.last)) * f) / this.slow) % 1;
    this.last = now;
    let k0 = 0;
    for (let i = 1; i < c.p.length; i++) if (c.p[i] > c.p[k0]) k0 = i;
    return (k0 + Math.floor(this.acc * n)) % n;
  }

  /** 気柱を塗る（振れ幅、またはスローの位相 k の分布）。ピストンは押し具合が半分を超えた側の通り道 */
  air(c: Cycle | null, k: number, press: readonly number[]): void {
    this.route(press.map((x) => x > 0.5));
    const D = new Map(AIR_LAYERS.map((l) => [l, new Array<string>(QKEYS).fill('')]));
    const n = c ? c.h.length : 0,
      np = c && n ? c.air.length / n : 0,
      amp = this.mode === 'amp';
    /* 読む点ごとの値: 振れ幅は 1 周期の（最大 − 最小）/ 2、スローは位相 k の圧力 */
    let val: Float32Array | null = null;
    if (c && np > 0) {
      val = new Float32Array(np);
      for (let j = 0; j < np; j++) {
        if (amp) {
          let lo = Infinity,
            hi = -Infinity;
          for (let i = 0; i < n; i++) {
            const x = c.air[i * np + j];
            lo = Math.min(lo, x);
            hi = Math.max(hi, x);
          }
          val[j] = (hi - lo) / 2;
        } else val[j] = c.air[k * np + j];
      }
      let mx = 0;
      for (let i = 0; i < c.air.length; i++) mx = Math.max(mx, Math.abs(c.air[i]));
      /* 目盛りは大きくなるときはすぐ、小さくなるときはゆっくり */
      this.scale = Math.max(50, mx > this.scale ? mx : this.scale * 0.97 + mx * 0.03);
    }
    for (let i = 0; i < this.quads.length; i++) {
      const q = this.quads[i],
        t = this.qT[i],
        v = val ? (val[this.qA[i]] * (1 - t) + val[this.qB[i]] * t) / this.scale : 0,
        j = Math.max(amp ? 0 : -AIR_STEPS, Math.min(AIR_STEPS, Math.round(AIR_STEPS * v))) + AIR_STEPS;
      (D.get(q.layer) as string[])[j] += q.d;
    }
    for (const l of AIR_LAYERS) {
      const ds = D.get(l) as string[],
        els = this.airEls.get(l) as SVGPathElement[];
      for (let j = 0; j < QKEYS; j++) {
        const d = ds[j] || 'M0 0';
        if (els[j].getAttribute('d') !== d) els[j].setAttribute('d', d);
      }
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
