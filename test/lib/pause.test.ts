import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioPause, type PauseAudio, PauseClock, Pauser } from '../../src/lib/pause';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('一時停止できる時計', () => {
  it('止めている間は進まず、動かすと続きから進む', () => {
    const c = new PauseClock(),
      t0 = c.now();
    vi.advanceTimersByTime(1000);
    expect(c.now() - t0).toBeCloseTo(1, 6);
    c.pause();
    vi.advanceTimersByTime(5000);
    expect(c.now() - t0).toBeCloseTo(1, 6);
    c.resume();
    vi.advanceTimersByTime(500);
    expect(c.now() - t0).toBeCloseTo(1.5, 6);
  });
  it('予約した呼び出しは、止めていた時間だけ遅れる', () => {
    const c = new PauseClock(),
      fn = vi.fn();
    c.at(c.now() + 0.3, fn);
    vi.advanceTimersByTime(200);
    c.pause();
    vi.advanceTimersByTime(10000);
    expect(fn).not.toHaveBeenCalled();
    c.resume();
    vi.advanceTimersByTime(95);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('止めている間に予約した呼び出しも、動かしてから呼ぶ', () => {
    const c = new PauseClock(),
      fn = vi.fn();
    c.pause();
    c.at(c.now() - 1, fn);
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
    c.resume();
    vi.advanceTimersByTime(0);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

/** AudioContext の代わり: 状態と、音量に予約した変化の記録だけを持つ */
function fakeContext() {
  const on = new Set<() => void>(),
    calls: [string, number, number][] = [],
    ac = {
      state: 'running' as AudioContextState,
      currentTime: 10,
      addEventListener: (_: string, f: () => void) => on.add(f),
      suspend: vi.fn(async () => set('suspended')),
      resume: vi.fn(async () => set('running')),
    },
    set = (s: AudioContextState) => {
      if (ac.state === s) return;
      ac.state = s;
      for (const f of on) f();
    },
    param = {
      setTargetAtTime: (v: number, t: number) => calls.push(['target', v, t]),
      setValueAtTime: (v: number, t: number) => calls.push(['value', v, t]),
      cancelScheduledValues: (t: number) => calls.push(['cancel', 0, t]),
    };
  return { ac, set, calls, master: { gain: param } as unknown as GainNode };
}

describe('AudioContext の一時停止', () => {
  it('音量を絞ってから止め、解くと無音から音量を戻す', async () => {
    const f = fakeContext(),
      h = new AudioPause(f.ac as unknown as AudioContext, f.master, () => 0.5),
      p = h.pause();
    expect(h.paused).toBe(true);
    expect(f.calls).toEqual([['target', 0, 10]]);
    expect(f.ac.suspend).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(40);
    await p;
    expect(f.ac.state).toBe('suspended');
    h.release();
    expect(h.paused).toBe(false);
    expect(f.calls.slice(1)).toEqual([
      ['cancel', 0, 10],
      ['value', 0, 10],
      ['target', 0.5, 10.02],
    ]);
  });
  it('fast なら待たずに止める', () => {
    const f = fakeContext(),
      h = new AudioPause(f.ac as unknown as AudioContext, f.master, () => 1);
    void h.pause(true);
    expect(f.ac.suspend).toHaveBeenCalledTimes(1);
    expect(f.calls).toEqual([]);
  });
  it('絞るのを待つ間に解いたら、止めない', async () => {
    const f = fakeContext(),
      h = new AudioPause(f.ac as unknown as AudioContext, f.master, () => 1),
      p = h.pause();
    h.release();
    await vi.advanceTimersByTimeAsync(40);
    await p;
    expect(f.ac.suspend).not.toHaveBeenCalled();
  });
  it('止めている間にブラウザが動かしたら止め直し、止めていないのに止まったら知らせる', async () => {
    const f = fakeContext(),
      h = new AudioPause(f.ac as unknown as AudioContext, f.master, () => 1),
      lost = vi.fn();
    h.onLost = lost;
    await h.pause(true);
    expect(lost).not.toHaveBeenCalled();
    f.set('running');
    expect(f.ac.suspend).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    expect(f.ac.state).toBe('suspended');
    h.release();
    f.set('running');
    expect(f.ac.suspend).toHaveBeenCalledTimes(2);
    f.set('suspended');
    expect(lost).toHaveBeenCalledTimes(1);
  });
});

/** 画面と音の出口の代わり */
function page(ok = true) {
  const doc = { hidden: false, on: () => {} },
    audio = {
      ready: vi.fn(async () => ok),
      pause: vi.fn(async () => {}),
      onLost: null,
    } satisfies PauseAudio as PauseAudio & { ready: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn> },
    st = { playing: true, changed: vi.fn(), failed: vi.fn() };
  vi.stubGlobal('document', {
    get hidden() {
      return doc.hidden;
    },
    addEventListener: (_: string, f: () => void) => {
      doc.on = f;
    },
  });
  const p = new Pauser(audio, { playing: () => st.playing, changed: st.changed, failed: st.failed });
  return {
    p,
    audio,
    st,
    hide: (v: boolean) => {
      doc.hidden = v;
      doc.on();
    },
  };
}

describe('演奏の一時停止の進行', () => {
  it('画面が隠れたら、演奏中だけ、すぐ一時停止する（戻っても自動では再開しない）', async () => {
    const x = page();
    x.st.playing = false;
    x.hide(true);
    expect(x.p.paused).toBe(false);
    x.hide(false);
    x.st.playing = true;
    const t0 = x.p.clock.now();
    x.hide(true);
    expect(x.p.paused).toBe(true);
    expect(x.audio.pause).toHaveBeenCalledWith(true);
    vi.advanceTimersByTime(60000);
    x.hide(false);
    await Promise.resolve();
    expect(x.p.paused).toBe(true);
    expect(x.p.clock.now()).toBe(t0);
    expect(x.audio.ready).not.toHaveBeenCalled();
  });
  it('再開すると時計が続きから進む', async () => {
    const x = page();
    await x.p.pause();
    expect(x.audio.pause).toHaveBeenCalledWith(false);
    const t0 = x.p.clock.now();
    vi.advanceTimersByTime(3000);
    await x.p.resume();
    expect(x.p.paused).toBe(false);
    expect(x.st.changed).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(250);
    expect(x.p.clock.now() - t0).toBeCloseTo(0.25, 6);
  });
  it('再開で音を出せなければ、一時停止のまま知らせる', async () => {
    const x = page(false);
    await x.p.pause();
    await x.p.resume();
    expect(x.p.paused).toBe(true);
    expect(x.st.failed).toHaveBeenCalledTimes(1);
    expect(x.audio.pause).toHaveBeenLastCalledWith(true);
  });
  it('ブラウザが AudioContext を止めたら一時停止し、演奏を止めたら解く', () => {
    const x = page();
    x.audio.onLost?.();
    expect(x.p.paused).toBe(true);
    x.p.clear();
    expect(x.p.paused).toBe(false);
    const t0 = x.p.clock.now();
    vi.advanceTimersByTime(100);
    expect(x.p.clock.now() - t0).toBeCloseTo(0.1, 6);
  });
});
