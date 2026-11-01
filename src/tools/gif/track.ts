/**
 * 楽器のページの位置の欄（.tp-trk）と同じ形のスライダー。押すかドラッグでその値へ移り、矢印キーで 1 つずつ動かす。
 * 小節と曲に結びついた lib/transport.ts の代わりに、0〜max の整数だけを扱う
 */
export class Track {
  private v = 0;
  private max = 1;

  constructor(
    private readonly root: HTMLElement,
    onSeek: (v: number) => void,
  ) {
    const at = (e: PointerEvent): number => {
      const r = root.getBoundingClientRect();
      return Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * this.max);
    };
    const seek = (v: number): void => {
      if (v !== this.v) onSeek(v);
    };
    root.addEventListener('pointerdown', (e) => {
      root.setPointerCapture(e.pointerId);
      seek(at(e));
    });
    root.addEventListener('pointermove', (e) => {
      if (root.hasPointerCapture(e.pointerId)) seek(at(e));
    });
    root.addEventListener('keydown', (e) => {
      const big = Math.max(1, Math.round(this.max / 10)),
        d: Record<string, number> = {
          ArrowLeft: this.v - 1,
          ArrowDown: this.v - 1,
          ArrowRight: this.v + 1,
          ArrowUp: this.v + 1,
          PageDown: this.v - big,
          PageUp: this.v + big,
          Home: 0,
          End: this.max,
        },
        n = d[e.key];
      if (n === undefined) return;
      e.preventDefault();
      seek(Math.max(0, Math.min(this.max, n)));
    });
  }

  /** 値を表示に反映する（onSeek は呼ばない） */
  set(v: number, max: number): void {
    this.v = v;
    this.max = Math.max(1, max);
    const p = `${(v / this.max) * 100}%`;
    (this.root.querySelector('.tp-fill') as HTMLElement).style.width = p;
    (this.root.querySelector('.tp-th') as HTMLElement).style.left = p;
    this.root.setAttribute('aria-valuemax', String(this.max));
    this.root.setAttribute('aria-valuenow', String(v));
  }
}
