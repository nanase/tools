import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PATH = '/tools/timer555/';
const KEY = `settings:${PATH}`;

class Mem {
  readonly m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
}

/** ページを開いたときと同じく、保存（localStorage）を用意してから store.ts を読み込む */
async function open(saved?: string) {
  const ls = new Mem(),
    reload = vi.fn();
  if (saved != null) ls.setItem(KEY, saved);
  vi.stubGlobal('location', { pathname: PATH, reload });
  vi.stubGlobal('localStorage', ls);
  vi.stubGlobal('addEventListener', vi.fn());
  vi.resetModules();
  const m = await import('../../src/lib/store');
  const read = () => {
    const s = ls.getItem(KEY);
    return s == null ? null : JSON.parse(s);
  };
  return { m, ls, read, reload };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('設定の保存', () => {
  it('開いたときに保存した値を読む', async () => {
    const { m } = await open(JSON.stringify({ 'p:r1': 4700, 'c:p-x': 'a' }));
    expect(m.stored('p:r1')).toBe(4700);
    expect(m.stored('c:p-x')).toBe('a');
    expect(m.stored('p:r2')).toBeUndefined();
  });

  it('値は少し待ってまとめて書く', async () => {
    const { m, read } = await open(JSON.stringify({ 'p:r1': 4700 }));
    m.store('p:r2', 1000);
    m.store('m:g-in', true);
    expect(read()).toEqual({ 'p:r1': 4700 });
    vi.advanceTimersByTime(300);
    expect(read()).toEqual({ 'p:r1': 4700, 'p:r2': 1000, 'm:g-in': true });
  });

  it('既定値に戻した項目は保存から消す。空になればキーごと消す', async () => {
    const { m, read, ls } = await open(JSON.stringify({ 'p:r1': 4700, 'c:p-x': 'a' }));
    m.forget('p:r1');
    expect(m.stored('p:r1')).toBeUndefined();
    vi.advanceTimersByTime(300);
    expect(read()).toEqual({ 'c:p-x': 'a' });
    m.forget('c:p-x');
    vi.advanceTimersByTime(300);
    expect(ls.getItem(KEY)).toBeNull();
  });

  it('保存していない項目を消しても書き直さない', async () => {
    const { m, ls } = await open(JSON.stringify({ 'p:r1': 4700 }));
    const set = vi.spyOn(ls, 'setItem');
    m.forget('p:r2');
    vi.advanceTimersByTime(300);
    expect(set).not.toHaveBeenCalled();
  });

  it('壊れた保存は無視して既定値で動く', async () => {
    const { m } = await open('{"p:r1":');
    expect(m.stored('p:r1')).toBeUndefined();
    const b = await open('[1, 2]');
    expect(b.m.stored('0')).toBeUndefined();
  });

  it('ページ見出しの ↺ はすべて消して読み込み直す', async () => {
    const { m, ls, reload } = await open(JSON.stringify({ 'p:r1': 4700 }));
    m.store('p:r2', 1000);
    m.resetAll();
    expect(ls.getItem(KEY)).toBeNull();
    expect(reload).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(300);
    expect(ls.getItem(KEY)).toBeNull();
  });

  it('localStorage を使えない環境でも例外を出さない', async () => {
    const { m, ls } = await open();
    vi.spyOn(ls, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    m.store('p:r1', 1);
    expect(() => vi.advanceTimersByTime(300)).not.toThrow();
    expect(m.stored('p:r1')).toBe(1);
  });
});
