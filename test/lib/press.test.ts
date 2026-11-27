import { describe, expect, it, vi } from 'vitest';
import { onPick, pickAct } from '../../src/lib/press';

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
