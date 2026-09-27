/** プレビュー: ライト・ダークの 2 画面で位置と倍率を共有し、ドラッグ・ホイール・2 本指・キーで動かす */
import { actualView, fitView, type View, zoomText, zoomView } from './view';

export class Preview {
  /** 描く SVG の大きさ（px） */
  W = 300;
  H = 150;
  /** 画像を出しているか */
  shown = false;
  private st: View = { x: 0, y: 0, s: 1 };
  /** 利用者が動かした（大きさが変わっても自動で全体表示に戻さない） */
  private touched = false;

  constructor(
    readonly panes: HTMLElement[],
    readonly imgs: HTMLImageElement[],
    private readonly zoomEl: HTMLElement,
  ) {
    for (const pv of panes) this.bind(pv);
    new ResizeObserver(() => (this.touched ? this.apply() : this.whole())).observe(panes[0] as HTMLElement);
  }

  private box(): { w: number; h: number } {
    const p = this.panes[0] as HTMLElement;
    return { w: p.clientWidth, h: p.clientHeight };
  }
  apply(): void {
    const { s, x, y } = this.st;
    for (const im of this.imgs) {
      /* 倍率は大きさで与える（transform の拡大より線がぼやけない） */
      im.style.width = `${this.W * s}px`;
      im.style.height = `${this.H * s}px`;
      im.style.transform = `translate(${x}px,${y}px)`;
    }
    this.zoomEl.textContent = this.shown ? zoomText(s) : '—';
  }
  whole(): void {
    const { w, h } = this.box();
    if (!w || !h) return;
    this.st = fitView(this.W, this.H, w, h);
    this.touched = false;
    this.apply();
  }
  /** 描き直したとき。force か、大きさが変わって利用者が動かしていなければ全体表示に戻す */
  refit(force: boolean, changed: boolean): void {
    if (force || (changed && !this.touched)) this.whole();
    else this.apply();
  }
  actual(): void {
    const { w, h } = this.box();
    this.st = actualView(this.W, this.H, w, h);
    this.touched = true;
    this.apply();
  }
  zoomAt(px: number, py: number, f: number): void {
    this.st = zoomView(this.st, px, py, f);
    this.touched = true;
    this.apply();
  }
  zoomMid(f: number): void {
    const { w, h } = this.box();
    this.zoomAt(w / 2, h / 2, f);
  }
  pan(dx: number, dy: number): void {
    this.st = { ...this.st, x: this.st.x + dx, y: this.st.y + dy };
    this.touched = true;
    this.apply();
  }

  private bind(pv: HTMLElement): void {
    const local = (cx: number, cy: number): [number, number] => {
      const r = pv.getBoundingClientRect();
      return [cx - r.left - pv.clientLeft, cy - r.top - pv.clientTop];
    };
    pv.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (!e.deltaY) return;
        this.zoomAt(...local(e.clientX, e.clientY), e.deltaY < 0 ? 1.1 : 1 / 1.1);
      },
      { passive: false },
    );
    /* 1 本指（マウス）で移動、2 本指で拡大縮小 */
    const ptr = new Map<number, { x: number; y: number }>();
    type G = { n: number; x: number; y: number; d: number };
    let last: G | null = null;
    const gesture = (): G | null => {
      const p = [...ptr.values()].slice(0, 2),
        n = p.length;
      const [a, b] = p;
      if (!a) return null;
      const x = p.reduce((s, q) => s + q.x, 0) / n,
        y = p.reduce((s, q) => s + q.y, 0) / n;
      return { n, x, y, d: b ? Math.hypot(a.x - b.x, a.y - b.y) : 0 };
    };
    pv.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      pv.setPointerCapture(e.pointerId);
      ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
      pv.classList.add('grab');
      last = gesture();
    });
    pv.addEventListener('pointermove', (e) => {
      if (!ptr.has(e.pointerId)) return;
      ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const g = gesture();
      if (g && last && g.n === last.n) {
        if (g.n > 1 && last.d > 0) this.zoomAt(...local(g.x, g.y), g.d / last.d);
        this.pan(g.x - last.x, g.y - last.y);
      }
      last = g;
    });
    const end = (e: PointerEvent) => {
      ptr.delete(e.pointerId);
      last = gesture();
      if (!ptr.size) pv.classList.remove('grab');
    };
    for (const n of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) pv.addEventListener(n, end);
    pv.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const d = e.shiftKey ? 80 : 20;
      const act: Record<string, () => void> = {
        ArrowLeft: () => this.pan(d, 0),
        ArrowRight: () => this.pan(-d, 0),
        ArrowUp: () => this.pan(0, d),
        ArrowDown: () => this.pan(0, -d),
        '+': () => this.zoomMid(1.25),
        '=': () => this.zoomMid(1.25),
        '-': () => this.zoomMid(0.8),
        '0': () => this.whole(),
        '1': () => this.actual(),
      };
      const f = act[e.key];
      if (f) {
        e.preventDefault();
        f();
      }
    });
  }
}
