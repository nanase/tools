import { afterEach, describe, expect, it, vi } from 'vitest';
import { logMap, MidiIn, type MidiSink, parseMidi, pedalOn, touchOf } from '../src/lib/midi';

describe('MIDI のメッセージ', () => {
  it('打鍵・離鍵・コントロールチェンジとチャンネル（1〜16）を読む', () => {
    expect(parseMidi([0x90, 60, 100])).toEqual({ ch: 1, t: 'on', note: 60, vel: 100 });
    expect(parseMidi([0x93, 61, 1])).toEqual({ ch: 4, t: 'on', note: 61, vel: 1 });
    expect(parseMidi([0x8f, 60, 64])).toEqual({ ch: 16, t: 'off', note: 60 });
    expect(parseMidi([0x90, 60, 0])).toEqual({ ch: 1, t: 'off', note: 60 });
    expect(parseMidi([0xb0, 64, 127])).toEqual({ ch: 1, t: 'cc', num: 64, v: 127 });
    expect(parseMidi([0xb5, 123, 0])).toEqual({ ch: 6, t: 'all' });
    expect(parseMidi([0xb0, 120, 0])).toEqual({ ch: 1, t: 'all' });
  });
  it('ほかのメッセージと短いメッセージは読まない', () => {
    expect(parseMidi([0xf8])).toBeNull();
    expect(parseMidi([0xc0, 5])).toBeNull();
    expect(parseMidi([0xe0, 0, 64])).toBeNull();
  });
});

describe('タッチの曲線', () => {
  it('1 で 0、127 で 1 になり、軽いほど強い', () => {
    for (const t of ['light', 'std', 'heavy'] as const) {
      expect(touchOf(1, t)).toBe(0);
      expect(touchOf(127, t)).toBe(1);
    }
    expect(touchOf(64, 'light')).toBeGreaterThan(touchOf(64, 'std'));
    expect(touchOf(64, 'std')).toBeGreaterThan(touchOf(64, 'heavy'));
    expect(touchOf(64, 'std')).toBeCloseTo(0.5, 6);
  });
  it('範囲の外のベロシティは端に丸める', () => {
    expect(touchOf(0, 'std')).toBe(0);
    expect(touchOf(200, 'std')).toBe(1);
  });
  it('対数の目盛りで、ハンマーの速さの範囲に割り当てる', () => {
    expect(logMap(0, 0.3, 7)).toBeCloseTo(0.3, 9);
    expect(logMap(1, 0.3, 7)).toBeCloseTo(7, 9);
    expect(logMap(0.5, 0.3, 7)).toBeCloseTo(Math.sqrt(0.3 * 7), 9);
  });
  it('ペダルは 64 以上で踏む', () => {
    expect(pedalOn(63)).toBe(false);
    expect(pedalOn(64)).toBe(true);
  });
});

/** Web MIDI の入力の機器の代わり */
interface FakePort {
  id: string;
  name: string;
  state: 'connected' | 'disconnected';
  onmidimessage: ((e: { data: Uint8Array }) => void) | null;
}
function fakeMidi(ports: FakePort[]) {
  const acc = { inputs: new Map(ports.map((p) => [p.id, p])), onstatechange: null as (() => void) | null };
  vi.stubGlobal('navigator', { requestMIDIAccess: () => Promise.resolve(acc) });
  return acc;
}
const port = (id: string, name: string): FakePort => ({ id, name, state: 'connected', onmidimessage: null });
const send = (p: FakePort, ...d: number[]) => p.onmidimessage?.({ data: new Uint8Array(d) });
function sink() {
  const log: string[] = [];
  const s: MidiSink = {
    on: (n, v) => log.push(`on ${n} ${v}`),
    off: (n) => log.push(`off ${n}`),
    cc: (n, v) => log.push(`cc ${n} ${v}`),
  };
  return { s, log };
}

describe('MIDI 入力', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('機器がなくても聞き始め、あとでつないだ機器も聞く', async () => {
    const a = port('a', 'A'),
      acc = fakeMidi([]),
      { s, log } = sink(),
      m = new MidiIn(s);
    expect(await m.start()).toBe('none');
    acc.inputs.set('a', a);
    acc.onstatechange?.();
    send(a, 0x90, 60, 90);
    expect(log).toEqual(['on 60 90']);
    expect(m.inputs()).toEqual([{ id: 'a', name: 'A' }]);
  });

  it('許可されなければ denied', async () => {
    vi.stubGlobal('navigator', { requestMIDIAccess: () => Promise.reject(new Error('no')) });
    expect(await new MidiIn(sink().s).start()).toBe('denied');
  });

  it('選んだ機器だけを聞き、選び直すと外した機器で押していた鍵を離す', async () => {
    const a = port('a', 'A'),
      b = port('b', 'B');
    fakeMidi([a, b]);
    const { s, log } = sink(),
      m = new MidiIn(s);
    expect(await m.start()).toBe('ok');
    send(a, 0x90, 60, 90);
    send(b, 0x90, 62, 80);
    m.select('B');
    expect(a.onmidimessage).toBeNull();
    send(b, 0x80, 62, 0);
    expect(log).toEqual(['on 60 90', 'on 62 80', 'off 60', 'off 62']);
  });

  it('抜いた機器と止めたときは、押している鍵を離す', async () => {
    const a = port('a', 'A'),
      b = port('b', 'B'),
      acc = fakeMidi([a, b]),
      { s, log } = sink(),
      m = new MidiIn(s);
    await m.start();
    send(a, 0x90, 60, 90);
    send(b, 0x90, 64, 70);
    a.state = 'disconnected';
    acc.onstatechange?.();
    expect(log).toEqual(['on 60 90', 'on 64 70', 'off 60']);
    m.stop();
    expect(log.at(-1)).toBe('off 64');
    expect(b.onmidimessage).toBeNull();
    expect(m.running).toBe(false);
  });

  it('選んだチャンネルだけを聞き、選び直すと外したチャンネルで押していた鍵を離す', async () => {
    const a = port('a', 'A');
    fakeMidi([a]);
    const { s, log } = sink(),
      m = new MidiIn(s);
    await m.start();
    send(a, 0x90, 60, 90);
    send(a, 0x91, 62, 80);
    m.channel(2);
    send(a, 0x90, 64, 70);
    send(a, 0xb0, 64, 127);
    send(a, 0xb1, 64, 127);
    send(a, 0x81, 62, 0);
    expect(log).toEqual(['on 60 90', 'on 62 80', 'off 60', 'cc 64 127', 'off 62']);
  });

  it('すべてのチャンネルでは、同じ音でもチャンネルごとに離す', async () => {
    const a = port('a', 'A');
    fakeMidi([a]);
    const { s, log } = sink(),
      m = new MidiIn(s);
    await m.start();
    send(a, 0x90, 60, 90);
    send(a, 0x91, 60, 80);
    send(a, 0xb1, 123, 0);
    send(a, 0x81, 60, 0);
    expect(log).toEqual(['on 60 90', 'on 60 80', 'off 60']);
    send(a, 0x80, 60, 0);
    expect(log.at(-1)).toBe('off 60');
    expect(log).toHaveLength(4);
  });

  it('押していない鍵の離鍵は渡さず、CC 123 で押している鍵をすべて離す', async () => {
    const a = port('a', 'A');
    fakeMidi([a]);
    const { s, log } = sink(),
      m = new MidiIn(s);
    await m.start();
    send(a, 0x80, 50, 0);
    send(a, 0x90, 60, 90);
    send(a, 0x90, 64, 90);
    send(a, 0xb0, 64, 127);
    send(a, 0xb0, 123, 0);
    expect(log).toEqual(['on 60 90', 'on 64 90', 'cc 64 127', 'off 60', 'off 64']);
  });
});
