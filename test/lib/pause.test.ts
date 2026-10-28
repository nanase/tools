import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asleep, autoPause, clockLead, lookahead } from '../../src/lib/pause';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/**
 * 画面と音の出口の代わり。coarse はおもな入力が指か（スマートフォンとタブレット）。
 * lead は時計の先走り [s]（null は測れない）、playing は曲を演奏しているか
 */
function page(coarse = true) {
  const doc = { hidden: false, on: () => {} },
    st = { lead: null as number | null, playing: true },
    audio = { onLost: null as (() => void) | null, lead: () => st.lead },
    opt = { pause: vi.fn(() => st.playing), hidden: vi.fn(), msg: vi.fn() };
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
    st,
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
  it('時計の先走りが増えたら、一時停止して知らせる', () => {
    const x = page(false);
    for (const g of [0.03, 0.02, 0.4]) {
      x.st.lead = g;
      vi.advanceTimersByTime(500);
    }
    expect(x.opt.pause).not.toHaveBeenCalled();
    x.st.lead = 0.6;
    vi.advanceTimersByTime(500);
    expect(x.opt.pause).toHaveBeenCalledTimes(1);
    expect(x.opt.msg).toHaveBeenCalledWith('音の計算が間に合わないため、曲を一時停止しました');
    /* 止めたあとは、そこからの増え方を見る（先走りが残っていても、増えなければ止めない） */
    x.st.lead = 0.9;
    vi.advanceTimersByTime(500);
    expect(x.opt.pause).toHaveBeenCalledTimes(1);
  });
  it('出力の遅れの分は、大きくても数えない', () => {
    const x = page(false);
    x.st.lead = 0.3;
    vi.advanceTimersByTime(5000);
    expect(x.opt.pause).not.toHaveBeenCalled();
  });
  it('測れない間（AudioContext を止めている間など）は、いちばん小さい先走りを測り直す', () => {
    const x = page(false);
    x.st.lead = 0.02;
    vi.advanceTimersByTime(500);
    x.st.lead = null;
    vi.advanceTimersByTime(500);
    x.st.lead = 0.8;
    vi.advanceTimersByTime(1000);
    expect(x.opt.pause).not.toHaveBeenCalled();
  });
  it('曲を演奏していないときは、間に合っていないことだけを知らせる', () => {
    const x = page(false);
    x.st.playing = false;
    x.st.lead = 0.02;
    vi.advanceTimersByTime(500);
    x.st.lead = 1;
    vi.advanceTimersByTime(500);
    expect(x.opt.msg).toHaveBeenCalledWith('音の計算が間に合っていません（音が途切れます）');
  });
});

describe('時計の先走り', () => {
  const ctx = (state: string, ct: number, out: number) =>
    ({ state, currentTime: ct, getOutputTimestamp: () => ({ contextTime: out }) }) as unknown as AudioContext;
  it('AudioContext の時計から、出力している音の時刻を引く', () => {
    expect(clockLead(ctx('running', 10.5, 10))).toBeCloseTo(0.5);
  });
  it('止まっている・まだ出力していない・ないときは測れない', () => {
    expect(clockLead(ctx('suspended', 10.5, 10))).toBeNull();
    expect(clockLead(ctx('running', 0.1, 0))).toBeNull();
    expect(clockLead(null)).toBeNull();
  });
});
