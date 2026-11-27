import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activates, onPick, pickAct, wakeOnRelease } from '../../src/lib/gesture';

const ev = (type: string, more: { pointerType?: string; key?: string; isTrusted?: boolean } = {}) => ({
  isTrusted: true,
  type,
  ...more,
});

describe('音を鳴らし始めてよい操作', () => {
  it('マウスは押したとき、指とペンは離したとき', () => {
    expect(activates(ev('pointerdown', { pointerType: 'mouse' }))).toBe(true);
    expect(activates(ev('pointerup', { pointerType: 'mouse' }))).toBe(false);
    for (const p of ['touch', 'pen']) {
      expect(activates(ev('pointerdown', { pointerType: p }))).toBe(false);
      expect(activates(ev('pointerup', { pointerType: p }))).toBe(true);
    }
  });
  it('キーは Esc 以外', () => {
    expect(activates(ev('keydown', { key: ' ' }))).toBe(true);
    expect(activates(ev('keydown', { key: 'ArrowUp' }))).toBe(true);
    expect(activates(ev('keydown', { key: 'Escape' }))).toBe(false);
    expect(activates(ev('keyup', { key: ' ' }))).toBe(false);
  });
  it('クリックは当たり、ポインタの移動は当たらない', () => {
    expect(activates(ev('click'))).toBe(true);
    expect(activates(ev('pointermove', { pointerType: 'mouse' }))).toBe(false);
  });
  it('スクリプトから送ったイベントは当たらない', () => {
    expect(activates(ev('click', { isTrusted: false }))).toBe(false);
    expect(activates(ev('pointerdown', { pointerType: 'mouse', isTrusted: false }))).toBe(false);
    expect(activates(ev('keydown', { key: ' ', isTrusted: false }))).toBe(false);
  });
});

describe('pickAct', () => {
  const user = { isTrusted: true },
    prog = { isTrusted: false };

  it('利用者が止まっている間に選んだら鳴らし始める', () => {
    expect(pickAct(user, false)).toBe('start');
    expect(pickAct(user, false, true)).toBe('start');
  });

  it('鳴り続ける音は、鳴っている間に選んでも何もしない（選択の処理が音を変える）', () => {
    expect(pickAct(user, true)).toBe('none');
  });

  it('1 回鳴って終わる音は、鳴っている途中で選び直したら鳴らし直す', () => {
    expect(pickAct(user, true, true)).toBe('restart');
  });

  it('プログラムからの選択（設定の復元・初期化）では鳴らさない', () => {
    for (const e of [prog, null, undefined]) {
      expect(pickAct(e, false)).toBe('none');
      expect(pickAct(e, true, true)).toBe('none');
    }
  });
});

describe('onPick', () => {
  /** 群の要素の代わり。押した要素は closest で選択肢か（無効か）を返す */
  function group() {
    let on: ((e: Event) => void) | null = null;
    const inside = new Set<object>();
    const root = {
      addEventListener: (_: string, f: (e: Event) => void) => {
        on = f;
      },
      contains: (b: object) => inside.has(b),
    } as unknown as Element;
    const button = (disabled = false, own = true) => {
      const b = { disabled };
      if (own) inside.add(b);
      return b;
    };
    const press = (target: unknown, isTrusted = true) =>
      on?.({ isTrusted, target: { closest: () => target } } as unknown as Event);
    return { root, button, press };
  }

  it('利用者が群の中の選択肢を押したときだけ呼ぶ', () => {
    const g = group(),
      fn = vi.fn();
    onPick(g.root, fn);
    g.press(g.button());
    expect(fn).toHaveBeenCalledTimes(1);
    g.press(g.button(), false);
    g.press(null);
    g.press(g.button(true));
    g.press(g.button(false, false));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

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
