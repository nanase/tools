import { afterEach, describe, expect, it, vi } from 'vitest';
import { asleep, autoPause, lookahead } from '../../src/lib/pause';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 画面と音の出口の代わり。coarse はおもな入力が指か（スマートフォンとタブレット） */
function page(coarse = true) {
  const doc = { hidden: false, on: () => {} },
    audio: { onLost: (() => void) | null } = { onLost: null },
    opt = { pause: vi.fn(), hidden: vi.fn() };
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(pointer: coarse)' && coarse }));
  vi.stubGlobal('document', {
    get hidden() {
      return doc.hidden;
    },
    addEventListener: (_: string, f: () => void) => {
      doc.on = f;
    },
  });
  autoPause(audio, opt);
  return {
    audio,
    opt,
    hide: (v: boolean) => {
      doc.hidden = v;
      doc.on();
    },
  };
}

describe('演奏の自動の一時停止', () => {
  it('スマートフォンでは、画面が隠れたら一時停止する（戻っても自動では再開しない）', () => {
    const x = page();
    expect(asleep()).toBe(false);
    x.hide(true);
    expect(x.opt.pause).toHaveBeenCalledTimes(1);
    expect(asleep()).toBe(true);
    x.hide(false);
    expect(x.opt.pause).toHaveBeenCalledTimes(1);
    expect(x.opt.hidden).not.toHaveBeenCalled();
  });
  it('PC では、画面が隠れても一時停止せず、先の分まで予約させる', () => {
    const x = page(false);
    x.hide(true);
    expect(x.opt.pause).not.toHaveBeenCalled();
    expect(x.opt.hidden).toHaveBeenCalledTimes(1);
    expect(asleep()).toBe(false);
    expect(lookahead(0.3)).toBe(2);
    expect(lookahead(3)).toBe(3);
    x.hide(false);
    expect(x.opt.hidden).toHaveBeenCalledTimes(1);
    expect(lookahead(0.3)).toBe(0.3);
  });
  it('ブラウザが AudioContext を止めたら一時停止する', () => {
    const x = page(false);
    x.audio.onLost?.();
    expect(x.opt.pause).toHaveBeenCalledTimes(1);
  });
});
