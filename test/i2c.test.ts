import { describe, expect, it } from 'vitest';
import { ABSENT, type Config, devState, electrical, hex, RISE_K, SLAVE0, simulate } from '../src/tools/i2c/bus';
import { say } from '../src/tools/i2c/story';

const base: Config = {
  mode: 'sm',
  rp: 4.7e3,
  cb: 100e-12,
  vdd: 3.3,
  op: 'w',
  addr: 0x48,
  data: [0x2a, 0x07],
  stretch: false,
  multi: false,
  sync: true,
};
const run = (c: Partial<Config> = {}, mem = {}) => simulate({ ...base, ...c }, mem);
/** 解読した区切りを短い文字列に */
const seq = (s: ReturnType<typeof run>) =>
  s.frames.map((f) => (f.v === undefined ? f.k : `${f.k}:${hex(f.v)}`)).join(' ');

describe('電気の値（UM10204 の 7.1 節）', () => {
  it('立ち上がり時間は 0.8473 RC', () => {
    expect(RISE_K).toBeCloseTo(0.8473, 4);
    expect(electrical(base).tr / (4.7e3 * 100e-12)).toBeCloseTo(0.8473, 4);
  });
  it('プルアップ抵抗の範囲', () => {
    const e = electrical(base);
    expect(e.rpMin).toBeCloseTo((3.3 - 0.4) / 3e-3, 6);
    expect(e.rpMax).toBeCloseTo(1e-6 / (0.8473 * 100e-12), 0);
    /* 下限の抵抗では Low がちょうど 0.4 V */
    expect(electrical({ ...base, rp: e.rpMin }).vol).toBeCloseTo(0.4, 6);
    expect(electrical({ ...base, mode: 'fp' }).rpMin).toBeCloseTo(2.9 / 20e-3, 6);
  });
});

describe('通信', () => {
  it('書き込み: アドレス・データ・ACK を解読し、宛先に届く', () => {
    const s = run();
    expect(s.res).toBe('ok');
    expect(s.okData).toBe(true);
    expect(seq(s)).toBe('S addr:0x90 A data:0x2A A data:0x07 A P');
    /* ACK は温度センサ（機器 2）が返す */
    expect(s.frames.filter((f) => f.k === 'A').every((f) => f.by === 1 << SLAVE0)).toBe(true);
    expect(s.mem[0x48]).toEqual([0x2a, 0x07]);
  });
  it('読み出し: スレーブの 2 バイトを読み、最後に NACK', () => {
    const s = run({ op: 'r' });
    expect(s.res).toBe('ok');
    expect(s.got).toEqual([0x19, 0x80]);
    expect(seq(s)).toBe('S addr:0x91 A data:0x19 A data:0x80 N P');
    expect(s.frames.find((f) => f.k === 'data')?.role).toBe('s');
  });
  it('書いた値を読み出せる', () => {
    expect(run({ op: 'r' }, { 72: [1, 2] }).got).toEqual([1, 2]);
  });
  it('宛先の機器がなければ NACK', () => {
    const s = run({ addr: ABSENT });
    expect(s.res).toBe('nack');
    expect(seq(s)).toBe('S addr:0x78 N P');
    expect(say(s, s.frames[2].t0 + 1e-9).t).toContain('NACK');
  });
  it('宛先でないスレーブはアドレスの後に照合をやめる', () => {
    const s = run(),
      t = s.frames.find((f) => f.k === 'A')?.t0 ?? 0;
    expect(devState(s, SLAVE0, t + 1e-9)).toBe('match');
    expect(devState(s, SLAVE0 + 1, t + 1e-9)).toBe('skip');
  });
  it('クロックストレッチの間は SCL が Low で、そのぶん長くなる', () => {
    const a = run({ op: 'r' }),
      b = run({ op: 'r', stretch: true });
    expect(b.res).toBe('ok');
    expect(b.dur - a.dur).toBeGreaterThan(2.5 * a.T);
    expect(b.notes.some((n) => n.kind === 'stretch')).toBe(true);
  });
  it('2 台のマスタ: アドレスで 1 を送った側が負け、終了の後に送り直す', () => {
    const s = run({ multi: true });
    expect(s.res).toBe('ok');
    expect(s.masters[1].res).toBe('ok');
    expect(s.notes.find((n) => n.kind === 'lost')?.i).toBe(1);
    expect(seq(s)).toBe('S addr:0x90 A data:0x2A A data:0x07 A P S addr:0xA0 A data:0x00 A data:0x07 A P');
    /* 宛先が 0x68 なら 1 台目が負ける */
    expect(run({ multi: true, addr: 0x68 }).notes.find((n) => n.kind === 'lost')?.i).toBe(0);
  });
});

describe('電気の失敗', () => {
  it('抵抗が小さすぎると Low が VIL より上で、開始も読めない', () => {
    const s = run({ rp: 220 });
    expect(s.E.vol).toBeGreaterThan(s.E.vil);
    expect(s.frames).toHaveLength(0);
    expect(s.res).toBe('nack');
    expect(say(s, 0).t).toContain('Low にならない');
  });
  it('立ち上がりが遅いとクロックが遅くなる（マスタが SCL を待つ）', () => {
    const s = run({ rp: 47e3, cb: 400e-12 });
    expect(s.res).toBe('ok');
    expect(1 / s.period).toBeLessThan(0.5 * 100e3);
  });
  it('マスタが SCL を待たないと、遅い立ち上がりでビットを読めない', () => {
    const s = run({ rp: 47e3, cb: 400e-12, sync: false });
    expect(s.res).not.toBe('ok');
    expect(s.frames.some((f) => f.k === 'addr')).toBe(false);
  });
  it('速度のモードごとに通信できる', () => {
    for (const mode of ['fm', 'fp'] as const) {
      const s = run({ mode, rp: 1e3 });
      expect(s.res).toBe('ok');
      expect(s.okData).toBe(true);
    }
  });
});
