import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindRepeat } from '../../src/lib/repeat';

/** ボタンの代わり（イベントを受けて流すだけ） */
const fakeButton = () => new EventTarget() as unknown as HTMLElement;
const ev = (type: string, props: Record<string, unknown> = {}) => Object.assign(new Event(type), props);

describe('押し続けると繰り返す', () => {
  let win: EventTarget;
  beforeEach(() => {
    vi.useFakeTimers();
    win = new EventTarget();
    vi.stubGlobal('addEventListener', win.addEventListener.bind(win));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('押した瞬間に 1 回、待ち時間のあとは間隔ごとに繰り返し、離すと止まる', () => {
    const b = fakeButton();
    const fn = vi.fn();
    bindRepeat(b, fn, { delay: 450, every: 200 });
    b.dispatchEvent(ev('pointerdown', { button: 0, shiftKey: false }));
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(449);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1 + 600);
    expect(fn).toHaveBeenCalledTimes(4);
    b.dispatchEvent(ev('pointerup'));
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('既定は 420 ms 後から 90 ms ごと（数値欄の ‹ › と同じ）', () => {
    const b = fakeButton();
    const fn = vi.fn();
    bindRepeat(b, fn);
    b.dispatchEvent(ev('pointerdown', { button: 0 }));
    vi.advanceTimersByTime(420 + 90 * 2);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('ボタンの外で離しても止まる', () => {
    const b = fakeButton();
    const fn = vi.fn();
    bindRepeat(b, fn, { delay: 100, every: 100 });
    b.dispatchEvent(ev('pointerdown', { button: 0 }));
    win.dispatchEvent(ev('pointerup'));
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('キーボードの決定（click の detail が 0）では 1 回、ポインタの click では呼ばない', () => {
    const b = fakeButton();
    const fn = vi.fn();
    bindRepeat(b, fn);
    b.dispatchEvent(ev('click', { detail: 0 }));
    b.dispatchEvent(ev('click', { detail: 1 }));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
