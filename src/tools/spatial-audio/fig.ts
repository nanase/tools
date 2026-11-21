/**
 * 立体音響の図: 上から見た場所・音源・聞き手。聞き手は頭（鼻と両耳）と向いている方の扇形で描き、
 * 頭の外側の輪（向きの取っ手）をドラッグすると向きが変わる。障害物は塗った四角で描く。
 * 選んだ音源からは、壁と障害物で 1 回跳ね返る道すじを破線で、障害物に遮られた直接音を点線で描く
 */
import { type Listener, type Obstacle, type Place, type Placed, paths, soundOf, TAU, TREES } from './model';

/** 図の中の色（CSS の変数から読む） */
interface Cols {
  screen: string;
  grid: string;
  grid2: string;
  ink: string;
  ink2: string;
  ink3: string;
  surface: string;
  le: string;
  ri: string;
}
const cssVar = (el: Element, n: string) => getComputedStyle(el).getPropertyValue(n).trim();

/** 頭の半径・向きの取っ手の位置 [px] */
const HEAD_R = 15,
  KNOB_R = 34;

export type Hit = { kind: 'src'; i: number } | { kind: 'move' } | { kind: 'turn' } | { kind: 'obs'; i: number } | null;

export class SceneView {
  private ctx: CanvasRenderingContext2D;
  private c: Cols | null = null;
  private w = 0;
  private h = 0;
  private k = 1;
  private cx = 0;
  private cy = 0;

  constructor(readonly cv: HTMLCanvasElement) {
    const ctx = cv.getContext('2d');
    if (!ctx) throw new Error('canvas');
    this.ctx = ctx;
  }

  recolor(): void {
    const e = this.cv;
    this.c = {
      screen: cssVar(e, '--screen'),
      grid: cssVar(e, '--grid'),
      grid2: cssVar(e, '--grid-2'),
      ink: cssVar(e, '--ink'),
      ink2: cssVar(e, '--ink-2'),
      ink3: cssVar(e, '--ink-3'),
      surface: cssVar(e, '--surface'),
      le: cssVar(e, '--ch2'),
      ri: cssVar(e, '--ch1'),
    };
  }

  /** 大きさと場所に合わせて倍率を決める */
  private layout(place: Place): void {
    const dpr = window.devicePixelRatio || 1,
      w = this.cv.clientWidth || 600,
      [vx0, vx1, vy0, vy1] = place.view;
    /* 狭い画面では、図の高さを場所の縦横比に合わせる（上下に余白を作らない） */
    if (w < 620) {
      const hh = `${Math.round(Math.max(240, (w * (vy1 - vy0)) / (vx1 - vx0)))}px`;
      if (this.cv.style.height !== hh) this.cv.style.height = hh;
    } else if (this.cv.style.height) this.cv.style.height = '';
    const h = this.cv.clientHeight || 400;
    if (this.cv.width !== Math.round(w * dpr) || this.cv.height !== Math.round(h * dpr)) {
      this.cv.width = Math.round(w * dpr);
      this.cv.height = Math.round(h * dpr);
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const [x0, x1, y0, y1] = place.view;
    this.w = w;
    this.h = h;
    this.k = Math.min(w / (x1 - x0), h / (y1 - y0));
    this.cx = w / 2 - ((x0 + x1) / 2) * this.k;
    this.cy = h / 2 + ((y0 + y1) / 2) * this.k;
  }

  sx = (x: number): number => this.cx + x * this.k;
  sy = (y: number): number => this.cy - y * this.k;
  /** 画面の px から世界の座標 [m] へ */
  toWorld(px: number, py: number): [number, number] {
    return [(px - this.cx) / this.k, (this.cy - py) / this.k];
  }

  /** 格子の間隔 [m]: 図の上で 28 px 以上になる 1・2・5 の並びの最小 */
  gridStep(): number {
    for (const s of [1, 2, 5, 10, 20, 50, 100]) if (s * this.k >= 28) return s;
    return 200;
  }

  /** 押した所にあるもの（音源・聞き手の頭・向きの取っ手・障害物） */
  hit(px: number, py: number, srcs: readonly Placed[], lis: Listener, obs: readonly Obstacle[] = []): Hit {
    for (let i = srcs.length - 1; i >= 0; i--)
      if (Math.hypot(this.sx(srcs[i].x) - px, this.sy(srcs[i].y) - py) < 16) return { kind: 'src', i };
    const lx = this.sx(lis.x),
      ly = this.sy(lis.y),
      d = Math.hypot(px - lx, py - ly);
    if (d < HEAD_R + 5) return { kind: 'move' };
    if (d < KNOB_R + 14) return { kind: 'turn' };
    const [wx, wy] = this.toWorld(px, py),
      /* 細い障害物もつかめるよう、図の上で 5 px の余裕を持たせる */
      m = 5 / this.k;
    for (let i = obs.length - 1; i >= 0; i--) {
      const o = obs[i];
      if (Math.abs(wx - o.x) <= o.w / 2 + m && Math.abs(wy - o.y) <= o.d / 2 + m) return { kind: 'obs', i };
    }
    return null;
  }

  /** 頭の中心から見た押した所の向き（時計回り [rad]、上が 0） */
  angleAt(px: number, py: number, lis: Listener): number {
    return Math.atan2(px - this.sx(lis.x), this.sy(lis.y) - py);
  }

  draw(
    place: Place,
    srcs: readonly Placed[],
    lis: Listener,
    sel: number,
    playing: readonly boolean[],
    obs: readonly Obstacle[] = [],
    selObs = -1,
  ): void {
    if (!this.c) this.recolor();
    const c = this.c as Cols;
    this.layout(place);
    const { ctx, w, h, k } = this;
    ctx.clearRect(0, 0, w, h);
    /* 格子（ホールは 2 m ごと） */
    const step = this.gridStep(),
      [wx0, wy0] = this.toWorld(0, h),
      [wx1, wy1] = this.toWorld(w, 0);
    ctx.strokeStyle = c.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.ceil(wx0 / step) * step; x <= wx1; x += step) {
      ctx.moveTo(Math.round(this.sx(x)) + 0.5, 0);
      ctx.lineTo(Math.round(this.sx(x)) + 0.5, h);
    }
    for (let y = Math.ceil(wy0 / step) * step; y <= wy1; y += step) {
      ctx.moveTo(0, Math.round(this.sy(y)) + 0.5);
      ctx.lineTo(w, Math.round(this.sy(y)) + 0.5);
    }
    ctx.stroke();
    this.drawPlace(place, c);
    /* 向いている方の扇形（障害物の下に敷く） */
    const lx = this.sx(lis.x),
      ly = this.sy(lis.y),
      a = lis.yaw - Math.PI / 2;
    ctx.fillStyle = c.grid;
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.arc(lx, ly, Math.max(60, 1.6 * k), a - Math.PI / 6, a + Math.PI / 6);
    ctx.closePath();
    ctx.fill();
    obs.forEach((o, i) => {
      this.drawObs(o, i === selObs, c);
    });
    /* 選んだ音源の、跳ね返る道すじと遮られた直接音 */
    const s = srcs[sel];
    if (s) this.drawPaths(place, s, lis, obs, c);
    /* 向きの取っ手の輪 */
    ctx.strokeStyle = c.grid2;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.arc(lx, ly, KNOB_R, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = c.ink2;
    ctx.beginPath();
    ctx.arc(lx + KNOB_R * Math.cos(a), ly + KNOB_R * Math.sin(a), 4.5, 0, TAU);
    ctx.fill();
    this.drawHead(lx, ly, lis.yaw, c);
    srcs.forEach((p, i) => {
      this.drawSrc(this.sx(p.x), this.sy(p.y), soundOf(p.sound).short, i === sel, playing[i] ?? false, c);
    });
  }

  private drawPlace(place: Place, c: Cols): void {
    const { ctx, h } = this;
    if (place.walls === 'box') {
      const xs = place.planes.filter((p) => p.ax === 0).map((p) => p.v),
        ys = place.planes.filter((p) => p.ax === 1).map((p) => p.v);
      const x0 = this.sx(Math.min(...xs)),
        x1 = this.sx(Math.max(...xs)),
        y0 = this.sy(Math.max(...ys)),
        y1 = this.sy(Math.min(...ys));
      ctx.strokeStyle = c.ink2;
      ctx.lineWidth = 4;
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    } else if (place.walls === 'sides') {
      ctx.fillStyle = c.grid2;
      for (const p of place.planes) {
        if (p.ax !== 1) continue;
        const y = this.sy(p.v);
        if (p.v > 0) ctx.fillRect(0, 0, this.w, y);
        else ctx.fillRect(0, y, this.w, h - y);
      }
    }
    if (place.trees) {
      ctx.strokeStyle = c.ink3;
      ctx.lineWidth = 1.5;
      /* 木の冠の半径は広さに合わせ、図の上で 6〜22 px に収める */
      const rk = Math.min(place.w, place.d) / 40;
      for (const [fx, fy, r] of TREES) {
        const x = this.sx((fx * place.w) / 2),
          y = this.sy((fy * place.d) / 2);
        ctx.beginPath();
        ctx.arc(x, y, Math.min(22, Math.max(6, r * rk * this.k)), 0, TAU);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, TAU);
        ctx.stroke();
      }
    }
    if (place.water) {
      /* 田んぼの畦（25 m ごと） */
      ctx.strokeStyle = c.grid2;
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let x = -Math.floor(place.w / 50) * 25; x <= place.w / 2; x += 25) {
        ctx.moveTo(this.sx(x), this.sy(place.d / 2));
        ctx.lineTo(this.sx(x), this.sy(-place.d / 2));
      }
      for (let y = -Math.floor(place.d / 50) * 25; y <= place.d / 2; y += 25) {
        ctx.moveTo(this.sx(-place.w / 2), this.sy(y));
        ctx.lineTo(this.sx(place.w / 2), this.sy(y));
      }
      ctx.stroke();
    }
  }

  private drawPaths(place: Place, s: Placed, lis: Listener, obs: readonly Obstacle[], c: Cols): void {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = c.ink3;
    ctx.lineWidth = 1.2;
    for (const q of paths([s.x, s.y, 0], [lis.x, lis.y, 0], place, obs)) {
      if (q.key === 'd') {
        if (!q.occ.fc) continue;
        ctx.setLineDash([1.5, 3.5]);
        ctx.beginPath();
        ctx.moveTo(this.sx(s.x), this.sy(s.y));
        ctx.lineTo(this.sx(lis.x), this.sy(lis.y));
        ctx.stroke();
        continue;
      }
      if (!q.hit) continue;
      ctx.setLineDash(q.occ.fc ? [1.5, 3.5] : [4, 4]);
      ctx.beginPath();
      ctx.moveTo(this.sx(s.x), this.sy(s.y));
      ctx.lineTo(this.sx(q.hit[0]), this.sy(q.hit[1]));
      ctx.lineTo(this.sx(lis.x), this.sy(lis.y));
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawObs(o: Obstacle, sel: boolean, c: Cols): void {
    const { ctx } = this,
      x = this.sx(o.x - o.w / 2),
      y = this.sy(o.y + o.d / 2),
      w = Math.max(2, o.w * this.k),
      h = Math.max(2, o.d * this.k);
    ctx.fillStyle = c.grid2;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = sel ? c.ink : c.ink2;
    ctx.lineWidth = sel ? 2.5 : 1.2;
    ctx.strokeRect(x, y, w, h);
    ctx.font = '500 12px system-ui,"Hiragino Sans","Noto Sans JP","Yu Gothic UI",Meiryo,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(o.name).width;
    /* 入らないときは上に出す */
    const inside = tw + 6 <= w && h >= 15,
      ty = inside ? y + h / 2 : y - 8;
    if (!inside) {
      ctx.lineWidth = 4;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = c.screen;
      ctx.strokeText(o.name, x + w / 2, ty);
    }
    ctx.fillStyle = c.ink;
    ctx.fillText(o.name, x + w / 2, ty);
  }

  private drawHead(x: number, y: number, yaw: number, c: Cols): void {
    const { ctx } = this,
      r = HEAD_R;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(yaw);
    ctx.fillStyle = c.surface;
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(-r * 0.3, -r * 0.93);
    ctx.lineTo(0, -r * 1.35);
    ctx.lineTo(r * 0.3, -r * 0.93);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r * 1.04, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = c.le;
    ctx.beginPath();
    ctx.ellipse(-r - 2, 0, 3.2, 6.5, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = c.ri;
    ctx.beginPath();
    ctx.ellipse(r + 2, 0, 3.2, 6.5, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  private drawSrc(x: number, y: number, label: string, sel: boolean, on: boolean, c: Cols): void {
    const { ctx } = this;
    if (sel) {
      ctx.strokeStyle = c.ink;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 14, 0, TAU);
      ctx.stroke();
    }
    ctx.fillStyle = c.ink;
    ctx.beginPath();
    ctx.arc(x, y, 9.5, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = c.surface;
    ctx.fillStyle = c.surface;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x - 4.5, y - 2.2);
    ctx.lineTo(x - 1.5, y - 2.2);
    ctx.lineTo(x + 2, y - 5);
    ctx.lineTo(x + 2, y + 5);
    ctx.lineTo(x - 1.5, y + 2.2);
    ctx.lineTo(x - 4.5, y + 2.2);
    ctx.closePath();
    ctx.fill();
    if (on) {
      ctx.beginPath();
      ctx.arc(x + 2.5, y, 4.5, -0.9, 0.9);
      ctx.stroke();
    }
    ctx.font = '600 13px system-ui,"Hiragino Sans","Noto Sans JP","Yu Gothic UI",Meiryo,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = c.screen;
    ctx.strokeText(label, x, y - 13);
    ctx.fillStyle = c.ink;
    ctx.fillText(label, x, y - 13);
  }
}
