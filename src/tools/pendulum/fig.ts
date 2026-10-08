/**
 * 台車・レール・振子・力の矢印の図（SVG）。座標は実際の寸法 [m] を一様に縮めたもの。
 * 図を押すと、押した側から振子か台車を押す（onPush）
 */
export interface Geo {
  /** 台車が動ける範囲 [m] */
  rail: number;
  /** 振子を描く長さと、重心までの長さ [m] */
  rod: number;
  l: number;
}
/** 押す先: 台車か、振子の軸からの長さ [m] */
export type Target = { cart: true } | { cart: false; r: number };

const NS = 'http://www.w3.org/2000/svg';
const f1 = (v: number) => v.toFixed(1);

export class Figure {
  private g: Geo = { rail: 0.8, rod: 0.6, l: 0.3 };
  /** 1 m あたりの長さ（viewBox の単位）と、台車などの大きさの倍率 */
  private s = 400;
  private k = 1;
  private cx = 0;
  private cy = 0;
  private el: Record<'cart' | 'rod' | 'cog' | 'piv' | 'fa' | 'ft' | 'push', SVGElement>;
  /* 今の状態（押す先を決める） */
  private x = 0;
  private th = 0;
  private pushAt = -1e9;
  private pushD = '';

  constructor(
    readonly svg: SVGSVGElement,
    onPush: (t: Target, dir: 1 | -1, at: [number, number]) => void,
  ) {
    const mk = (tag: string, cls: string) => {
      const e = document.createElementNS(NS, tag) as SVGElement;
      e.setAttribute('class', cls);
      return e;
    };
    this.el = {
      cart: mk('g', 'pf-cg'),
      fa: mk('path', 'pf-f'),
      ft: mk('text', 'pf-ft'),
      rod: mk('path', 'pf-rod'),
      cog: mk('path', 'pf-cog'),
      piv: mk('circle', 'pf-piv'),
      push: mk('path', 'pf-push'),
    };
    svg.addEventListener('click', (e) => {
      const m = svg.getScreenCTM();
      if (!m) return;
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse()),
        wx = (p.x - this.cx) / this.s,
        wy = (this.cy - p.y) / this.s,
        hit = this.target(wx, wy);
      if (hit) onPush(hit.t, hit.dir, [wx, wy]);
    });
  }

  /** 台車の大きさ [m] */
  private get cw() {
    return 0.15 * this.k;
  }
  private get ch() {
    return 0.07 * this.k;
  }

  /** 寸法が変わったら描き直す */
  setGeo(g: Geo): void {
    this.g = g;
    const span = Math.max(g.rail, 2 * g.rod);
    this.k = Math.min(3, Math.max(0.6, span / 1.4));
    /* 横はレールの端の止めと、台車がレールの端にいるときの振子の先（rail/2 + rod）の外側まで、縦は振子の長さまで。
       振子がどの向きでも図に収まる最小の範囲にして、振子をできるだけ大きく描く */
    const rod = Math.max(g.rod, 0.1),
      half = g.rail / 2 + this.cw / 2 + 0.02 * this.k,
      pad = 0.03 * this.k,
      wx = Math.max(half + 0.018 * this.k, g.rail / 2 + rod) + pad,
      up = rod + pad,
      down = Math.max(rod, this.ch / 2 + 0.03 * this.k) + pad,
      W = 800,
      s = W / (2 * wx),
      H = Math.max((up + down) * s, W / 3);
    this.s = s;
    this.cx = W / 2;
    this.cy = H / 2 + ((up - down) * s) / 2;
    this.svg.setAttribute('viewBox', `0 0 ${W} ${f1(H)}`);
    const X = (v: number) => f1(this.cx + v * s),
      Y = (v: number) => f1(this.cy - v * s);
    /* 方眼（10 cm ごと。長いときは 50 cm・1 m） */
    const step = [0.1, 0.5, 1, 5].find((q) => (2 * wx) / q <= 60) ?? 10;
    let grid = '';
    for (let v = Math.ceil(-wx / step) * step; v <= wx; v += step) grid += `M${X(v)} 0V${f1(H)}`;
    for (let v = Math.ceil(-down / step) * step; v <= H / s; v += step) {
      const y = this.cy - v * s;
      if (y >= 0 && y <= H) grid += `M0 ${f1(y)}H${W}`;
    }
    const wr = 0.012 * this.k,
      top = -this.ch / 2 - 2 * wr,
      th = 0.016 * this.k,
      stop = 0.018 * this.k;
    const parts = [
      `<path class="pf-grid" d="${grid}"/>`,
      `<rect class="pf-rail" x="${X(-half - stop)}" y="${Y(top)}" width="${f1((2 * half + 2 * stop) * s)}" height="${f1(th * s)}" rx="2"/>`,
      `<rect class="pf-stop" x="${X(-half - stop)}" y="${Y(top + 0.05 * this.k)}" width="${f1(stop * s)}" height="${f1(0.05 * this.k * s)}"/>`,
      `<rect class="pf-stop" x="${X(half)}" y="${Y(top + 0.05 * this.k)}" width="${f1(stop * s)}" height="${f1(0.05 * this.k * s)}"/>`,
      `<path class="pf-tgt" d="M${X(0)} ${Y(top - th)}v${f1(0.03 * this.k * s)}"/>`,
    ];
    this.svg.innerHTML = parts.join('');
    /* 台車（原点が軸の位置） */
    const cw = this.cw * s,
      ch = this.ch * s,
      w = wr * s;
    this.el.cart.innerHTML =
      `<rect class="pf-cart" x="${f1(-cw / 2)}" y="${f1(-ch / 2)}" width="${f1(cw)}" height="${f1(ch)}" rx="3"/>` +
      `<circle class="pf-wh" cx="${f1(-cw / 3)}" cy="${f1(ch / 2 + w)}" r="${f1(w)}"/><circle class="pf-wh" cx="${f1(cw / 3)}" cy="${f1(ch / 2 + w)}" r="${f1(w)}"/>`;
    this.el.piv.setAttribute('r', f1(Math.max(3.5, 0.014 * this.k * s)));
    this.el.ft.setAttribute('text-anchor', 'middle');
    for (const k of ['cart', 'fa', 'ft', 'rod', 'cog', 'piv', 'push'] as const) this.svg.appendChild(this.el[k]);
  }

  /** 押した点に近い方（台車か振子）と、押す向き（押した側から反対側へ） */
  private target(wx: number, wy: number): { t: Target; dir: 1 | -1 } | null {
    const { x, th } = this,
      cw = this.cw,
      ch = this.ch;
    if (Math.abs(wx - x) <= cw / 2 + 0.03 * this.k && Math.abs(wy) <= ch / 2 + 0.05 * this.k)
      return { t: { cart: true }, dir: wx < x ? 1 : -1 };
    const ux = Math.sin(th),
      uy = Math.cos(th),
      r = Math.max(0, Math.min(this.g.rod, (wx - x) * ux + wy * uy)),
      px = x + r * ux,
      py = r * uy,
      dist = Math.hypot(wx - px, wy - py);
    if (dist > 0.18 * this.k) return null;
    return { t: { cart: false, r: Math.max(r, 0.15 * this.g.rod) }, dir: wx < px ? 1 : -1 };
  }

  /** ボタンで押すときに印を出す点 [m]: 台車なら押す側の面、振子なら軸から r の点 */
  pushPoint(t: Target, dir: 1 | -1): [number, number] {
    if (t.cart) return [this.x - dir * (this.cw / 2 + 0.01 * this.k), 0];
    return [this.x + Math.sin(this.th) * t.r, Math.cos(this.th) * t.r];
  }

  /** 押した印（矢印）を出す。at は押した点 [m]、dir は押す向き */
  showPush(at: [number, number], dir: 1 | -1, now: number): void {
    const s = this.s,
      L = 0.09 * this.k * s,
      x = this.cx + at[0] * s - dir * 6,
      y = this.cy - at[1] * s,
      h = 7;
    this.pushD = `M${f1(x - dir * L)} ${f1(y)}H${f1(x)}M${f1(x - dir * h)} ${f1(y - h)}L${f1(x)} ${f1(y)}L${f1(x - dir * h)} ${f1(y + h)}`;
    this.pushAt = now;
  }

  /**
   * 状態を描く。F は駆動の力 [N]、Fref は矢印の長さの基準（静止時に出せる最大の力）、now は時刻 [ms]
   */
  draw(x: number, th: number, F: number, Fref: number, now: number): void {
    this.x = x;
    this.th = th;
    const { s, el } = this,
      px = this.cx + x * s,
      py = this.cy,
      tx = px + Math.sin(th) * this.g.rod * s,
      ty = py - Math.cos(th) * this.g.rod * s,
      gx = px + Math.sin(th) * this.g.l * s,
      gy = py - Math.cos(th) * this.g.l * s,
      r = Math.max(4.5, 0.02 * this.k * s);
    el.cart.setAttribute('transform', `translate(${f1(px)} ${f1(py)})`);
    el.rod.setAttribute('d', `M${f1(px)} ${f1(py)}L${f1(tx)} ${f1(ty)}`);
    /* 重心の印（円を 4 つに分けて交互に塗る） */
    el.cog.setAttribute(
      'd',
      `M${f1(gx)} ${f1(gy)}m${-r} 0a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0` +
        `M${f1(gx)} ${f1(gy)}h${r}a${r} ${r} 0 0 0 ${-r} ${-r}zM${f1(gx)} ${f1(gy)}h${-r}a${r} ${r} 0 0 0 ${r} ${r}z`,
    );
    el.piv.setAttribute('cx', f1(px));
    el.piv.setAttribute('cy', f1(py));
    /* 力の矢印: 台車の後ろから押す向きに。長さは Fref で台車の幅の 2 倍 */
    const a = Math.max(-1.5, Math.min(1.5, Fref > 0 ? F / Fref : 0)),
      L = Math.abs(a) * 2 * this.cw * s,
      dir = Math.sign(a) || 1,
      x1 = px - dir * (this.cw / 2) * s - dir * 3,
      x0 = x1 - dir * L,
      hy = 6;
    if (L > 1.5) {
      const hl = Math.min(9, L);
      el.fa.setAttribute(
        'd',
        `M${f1(x0)} ${f1(py)}H${f1(x1 - dir * hl)}M${f1(x1)} ${f1(py)}L${f1(x1 - dir * hl)} ${f1(py - hy)}V${f1(py + hy)}Z`,
      );
      el.ft.textContent = `${Math.abs(F).toFixed(1)} N`;
      el.ft.setAttribute('x', f1((x0 + x1) / 2));
      el.ft.setAttribute('y', f1(py - 10));
    } else {
      el.fa.setAttribute('d', '');
      el.ft.textContent = '';
    }
    /* 押した印は 0.4 s で消す */
    const age = now - this.pushAt;
    el.push.setAttribute('d', age < 400 ? this.pushD : '');
    el.push.style.opacity = age < 400 ? f1(1 - age / 400) : '0';
  }

  /** 押した印が残っているか（描き続ける必要があるか） */
  pushing(now: number): boolean {
    return now - this.pushAt < 400;
  }
}
