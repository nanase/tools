import { describe, expect, it } from 'vitest';
import { ART, LOOP } from '../src/lib/card-art';
import { gearRatio, Model, RPM, record, SPEC } from '../src/tools/transmission/model';
import { makeSfx } from '../src/tools/transmission/sfx';

describe('歯数と減速比', () => {
  it('歯数から求めた比が公表の値と一致する', () => {
    expect([1, 2, 3, 4].map((g) => gearRatio(g).toFixed(3))).toEqual(['2.500', '1.550', '1.150', '0.923']);
    expect((SPEC.zp[1] / SPEC.zp[0]).toFixed(3)).toBe('3.421');
    expect(SPEC.p.toFixed(3)).toBe('3.421');
    expect((SPEC.zs[1] / SPEC.zs[0]).toFixed(3)).toBe('2.714');
    expect(SPEC.fin.toFixed(3)).toBe('2.714');
  });
});

describe('シフトドラム', () => {
  it('溝の位置 0〜4 で N・1〜4 速を選ぶ', () => {
    for (let th = 0; th <= 4; th++) expect(new Model({ base: th }).gear, `th=${th}`).toBe(th);
  });
  /** ペダルを 0.3 s 踏んで離し、戻りきるまで進める */
  const kick = (m: Model, dir: 1 | -1) => {
    m.press(dir);
    m.run(0.3);
    m.release();
    m.run(0.3);
  };
  it('停車中は N からシフトダウンで 4 速へ回る', () => {
    const m = new Model({ base: 0 });
    kick(m, -1);
    expect(m.base).toBe(4);
    expect(m.gear).toBe(4);
  });
  it('走行中は N から 4 速へ回らない', () => {
    const m = new Model({ base: 0, v: 5 });
    m.press(-1);
    m.run(0.2);
    expect(m.blocked).toBe('lock');
    m.release();
    m.run(0.3);
    expect(m.base).toBe(0);
  });
});

describe('場面', () => {
  it('発進: 滑走の回転数は録音の 2,750〜2,990 rpm で、約 2 秒でつながる', () => {
    const r = record('start');
    const mid = r.frames.filter((f) => f.t >= 1.0 && f.t <= 1.8);
    expect(mid.length).toBeGreaterThan(0);
    for (const f of mid) {
      expect(f.rpm, `t=${f.t.toFixed(3)}`).toBeGreaterThanOrEqual(2750);
      expect(f.rpm, `t=${f.t.toFixed(3)}`).toBeLessThanOrEqual(2990);
    }
    /* スロットルは 0.5 s で開く */
    const lock = r.bounds[3];
    expect(lock).not.toBeNull();
    expect((lock ?? 0) - 0.5).toBeGreaterThanOrEqual(2.0);
    expect((lock ?? 0) - 0.5).toBeLessThanOrEqual(2.4);
  });

  it('シフトアップ: 1 速から 2 速へ入る', () => {
    const r = record('up');
    expect(r.frames[0].gear).toBe(1);
    expect(r.frames[r.frames.length - 1].gear).toBe(2);
  });

  it('停車中の 4→N: 停車中は N へ回り、走行中はドラムロックで止まる', () => {
    const r = record('rotary');
    /* 1.0 s では N に止まっている（ドラムも N の位置） */
    const n = r.frames.find((f) => f.t >= 1.0);
    expect(n?.gear).toBe(0);
    expect(n?.base).toBe(0);
    expect(r.frames[r.frames.length - 1].gear).toBe(4);
    expect(r.frames.some((f) => f.blocked === 'lock')).toBe(true);
  });

  it('エンジンブレーキ: 2,000 rpm より下でもワンウェイクラッチで後輪の力がクランクへ伝わる', () => {
    const r = record('brake');
    expect(r.frames.some((f) => f.rpm < 2000 && (f.Tow < -0.05 || f.drpm >= f.rpm - 20))).toBe(true);
  });
});

describe('カードの図柄', () => {
  it('変速機の図柄は 1 周で止まっている絵に戻る', () => {
    expect(LOOP.gb).toBe(2);
    expect(ART.gb(LOOP.gb)).toBe(ART.gb(0));
    expect(ART.gb(LOOP.gb / 2)).not.toBe(ART.gb(0));
  });
});

describe('ペダルとギアの音', () => {
  /** 最大から −20 dB に下がるまでの時間 [ms]（1 ms ごとの RMS） */
  const t20 = (y: Float32Array, fs: number) => {
    const w = fs / 1000,
      env: number[] = [];
    for (let i = 0; i + w <= y.length; i += w) {
      let s = 0;
      for (let j = 0; j < w; j++) s += y[i + j] ** 2;
      env.push(Math.sqrt(s / w));
    }
    let pk = 0;
    for (let i = 0; i < env.length; i++) if (env[i] > env[pk]) pk = i;
    return env.slice(pk).findIndex((v) => v < env[pk] / 10);
  };
  it('録音の減衰に合う（踏み込み 35 ms・踏み終わり 28 ms 前後で −20 dB）', () => {
    expect(t20(makeSfx('press', 48000), 48000)).toBeGreaterThan(25);
    expect(t20(makeSfx('press', 48000), 48000)).toBeLessThan(50);
    expect(t20(makeSfx('release', 48000), 48000)).toBeGreaterThan(20);
    expect(t20(makeSfx('release', 48000), 48000)).toBeLessThan(40);
  });
  it('毎回同じ形で、最大の振幅は 1', () => {
    for (const k of ['press', 'release', 'gear'] as const) {
      const a = makeSfx(k, 44100),
        b = makeSfx(k, 44100);
      expect(a).toEqual(b);
      expect(Math.max(...a.map(Math.abs))).toBeCloseTo(1, 5);
    }
  });
});

describe('ドグの噛み合いの遅れ', () => {
  /** ペダルを 0.25 s 踏んで離し、次のギアに入るまでの時間（離してから）[s] */
  const lag = (from: number, kmh: number, off: number) => {
    const m = new Model({ base: from, v: kmh / 3.6, we: 1400 / RPM, wd: 1400 / RPM });
    m.ang.c = (off * Math.PI) / 2;
    m.press(-1);
    let t = 0;
    while (t < 8 && m.gear !== from - 1) {
      if (t > 0.25) m.release();
      m.step(0.0005);
      t += 0.0005;
    }
    return t - 0.25;
  };
  it('止まる直前の 2→1 は、ドグが面に当たったまま 0.5 s より長く待つことがある', () => {
    expect(Math.max(...[0, 0.25, 0.5, 0.75].map((o) => lag(2, 3, o)))).toBeGreaterThan(0.5);
  });
  it('待つ時間は長くても 1.5 s ほど', () => {
    for (const kmh of [1, 3, 5, 6.5, 8]) for (let o = 0; o < 1; o += 0.125) expect(lag(2, kmh, o)).toBeLessThan(1.6);
  });
  it('速いときの 4→3 はすぐ噛み合う', () => {
    for (const o of [0, 0.25, 0.5, 0.75]) expect(lag(4, 30, o)).toBeLessThan(0.1);
  });
  it('場面「2→1 の遅れ」ではドグの滑走の段階がある', () => {
    const r = record('down21');
    expect(r.frames.some((f) => f.wait === 1)).toBe(true);
    expect(r.frames.at(-1)?.gear).toBe(1);
  });
});
