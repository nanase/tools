import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { wakeOnRelease } from '../../src/lib/wake';

/** state と resume の回数だけを持つ AudioContext の代わり */
const fakeAc = (state: AudioContextState) => {
  const ac = { state, resume: vi.fn(() => Promise.resolve()) };
  return ac as typeof ac & AudioContext;
};

describe('指で押したときの AudioContext の動かし直し', () => {
  beforeEach(() => {
    vi.stubGlobal('document', new EventTarget());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('止まっていれば、次に指を離したときに 1 回だけ resume する', () => {
    const ac = fakeAc('suspended');
    wakeOnRelease(ac);
    wakeOnRelease(ac);
    expect(ac.resume).not.toHaveBeenCalled();
    document.dispatchEvent(new Event('pointerup'));
    document.dispatchEvent(new Event('click'));
    expect(ac.resume).toHaveBeenCalledTimes(1);
  });

  it('click と keydown でも動かす', () => {
    for (const t of ['click', 'keydown']) {
      const ac = fakeAc('suspended');
      wakeOnRelease(ac);
      document.dispatchEvent(new Event(t));
      expect(ac.resume).toHaveBeenCalledTimes(1);
    }
  });

  it('もう動いていれば何もしない', () => {
    const ac = fakeAc('running');
    wakeOnRelease(ac);
    document.dispatchEvent(new Event('pointerup'));
    expect(ac.resume).not.toHaveBeenCalled();
  });

  it('離すまでに動いたら resume しない', () => {
    const ac = fakeAc('suspended');
    wakeOnRelease(ac);
    (ac as { state: AudioContextState }).state = 'running';
    document.dispatchEvent(new Event('pointerup'));
    expect(ac.resume).not.toHaveBeenCalled();
  });
});
