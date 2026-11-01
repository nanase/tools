/**
 * 窓の拡大・縮小と移動: ドラッグで動かし、ホイールと 2 本指で拡大する。動かさずに離すと onTap を呼ぶ
 */
export interface PanZoomOpt {
  min: number;
  max: number;
  onChange: () => void;
  onTap?: (x: number, y: number) => void;
}

export class PanZoom {
  z = 1;
  x = 0;
  y = 0;
  private ptrs = new Map<number, { x: number; y: number }>();
  private drag: { x: number; y: number; vx: number; vy: number; moved: boolean } | null = null;
  private pinch: { d: number; z: number } | null = null;

  constructor(
    private readonly el: HTMLElement,
    private readonly opt: PanZoomOpt,
  ) {
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      const p = this.at(e);
      this.ptrs.set(e.pointerId, p);
      if (this.ptrs.size === 1) this.drag = { ...p, vx: this.x, vy: this.y, moved: false };
      else if (this.ptrs.size === 2) {
        const [a, b] = [...this.ptrs.values()];
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.z };
        if (this.drag) this.drag.moved = true;
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.ptrs.has(e.pointerId)) return;
      const p = this.at(e);
      this.ptrs.set(e.pointerId, p);
      if (this.pinch && this.ptrs.size === 2) {
        const [a, b] = [...this.ptrs.values()];
        const f = (this.pinch.z * Math.hypot(a.x - b.x, a.y - b.y)) / this.pinch.d / this.z;
        this.zoomAbout((a.x + b.x) / 2, (a.y + b.y) / 2, f);
        return;
      }
      const d = this.drag;
      if (!d) return;
      const dx = p.x - d.x,
        dy = p.y - d.y;
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      d.moved = true;
      el.classList.add('drag');
      this.x = d.vx + dx;
      this.y = d.vy + dy;
      this.changed();
    });
    const end = (e: PointerEvent) => {
      if (!this.ptrs.has(e.pointerId)) return;
      this.ptrs.delete(e.pointerId);
      if (this.ptrs.size < 2) this.pinch = null;
      if (this.ptrs.size === 0) {
        if (this.drag && !this.drag.moved && e.type === 'pointerup') {
          const p = this.at(e);
          this.opt.onTap?.(p.x, p.y);
        }
        this.drag = null;
        el.classList.remove('drag');
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const p = this.at(e);
        this.zoomAbout(p.x, p.y, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)));
      },
      { passive: false },
    );
  }

  private at(e: PointerEvent | WheelEvent) {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  get moved(): boolean {
    return Math.abs(this.z - 1) > 1e-3 || Math.abs(this.x) > 0.5 || Math.abs(this.y) > 0.5;
  }

  /** 画面の点 (px, py) を動かさずに f 倍にする */
  zoomAbout(px: number, py: number, f: number): void {
    const W = this.el.clientWidth,
      H = this.el.clientHeight;
    const nz = Math.min(this.opt.max, Math.max(this.opt.min, this.z * f)),
      k = nz / this.z;
    this.x = px - W / 2 - (px - W / 2 - this.x) * k;
    this.y = py - H / 2 - (py - H / 2 - this.y) * k;
    this.z = nz;
    this.changed();
  }

  zoomCenter(f: number): void {
    this.zoomAbout(this.el.clientWidth / 2, this.el.clientHeight / 2, f);
  }

  reset(): void {
    this.z = 1;
    this.x = this.y = 0;
    this.changed();
  }

  /** 中心が窓の外へ出すぎないよう抑えて知らせる */
  private changed(): void {
    const lx = this.el.clientWidth * Math.max(1, this.z),
      ly = this.el.clientHeight * Math.max(1, this.z);
    this.x = Math.max(-lx, Math.min(lx, this.x));
    this.y = Math.max(-ly, Math.min(ly, this.y));
    this.el.style.touchAction = this.z > 1.01 ? 'none' : 'pan-y';
    this.opt.onChange();
  }
}
