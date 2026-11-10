import { describe, expect, it } from 'vitest';
import { MUSIC_RATE, musicAt, setMusic } from '../src/tools/sampling-theorem/music';
import { fsMarks, PARAMS } from '../src/tools/sampling-theorem/params';
import {
  AMP,
  autoFs,
  CYC,
  comps,
  copyName,
  FS_HI,
  FS_LO,
  fold,
  judge,
  reconAt,
  type Sig,
  source,
  swF,
} from '../src/tools/sampling-theorem/signal';
import { Stream, type StreamSet } from '../src/tools/sampling-theorem/stream';

const R = 48000;
const SINE: Sig = { src: 'sine', f: 1000 };
const set = (o: Partial<StreamSet> = {}): StreamSet => ({
  sig: SINE,
  fs: 8000,
  aa: false,
  hear: 'rec',
  auto: false,
  ...o,
});
function run(st: Stream, sec: number): Float32Array {
  const y = new Float32Array(Math.round(sec * R));
  for (let i = 0; i < y.length; i += 128) st.render(y.subarray(i, Math.min(y.length, i + 128)));
  return y;
}
const maxStep = (y: ArrayLike<number>, from = 0) => {
  let m = 0;
  for (let i = from + 1; i < y.length; i++) m = Math.max(m, Math.abs(y[i] - y[i - 1]));
  return m;
};

describe('折り返し', () => {
  it('fs の 2 倍より低い周波数はそのまま、超えると 0 にいちばん近い複製になる', () => {
    expect(fold(1000, 8000)).toBe(1000);
    expect(fold(1000, 1300)).toBeCloseTo(300, 9);
    expect(fold(1000, 700)).toBeCloseTo(300, 9);
    expect(fold(7000, 8000)).toBe(1000);
  });
  it('復元される複製の名前', () => {
    expect(copyName(1000, 8000)).toBe('f');
    expect(copyName(1000, 1300)).toBe('fs − f');
    expect(copyName(1000, 700)).toBe('f − fs');
    expect(copyName(1000, 450)).toBe('f − 2fs');
  });
  it('判定: 2f を境に折り返す成分が出る', () => {
    expect(judge(SINE, 2100, false).over).toHaveLength(0);
    expect(judge(SINE, 1900, false).over).toHaveLength(1);
    expect(judge(SINE, 1900, true).over).toHaveLength(0);
    expect(judge(SINE, 1900, true).cut).toHaveLength(1);
    const sq = judge({ src: 'square', f: 1000 }, 8000, false);
    expect(sq.over.length).toBeGreaterThan(10);
    expect(sq.over[0].f).toBe(5000);
  });
});

describe('入力', () => {
  it('矩形波はローパスなしで理想の矩形、ありで倍音の和', () => {
    const v = source({ src: 'square', f: 1000 });
    expect(v(0.00025, Number.POSITIVE_INFINITY)).toBe(0.45);
    expect(v(0.00075, Number.POSITIVE_INFINITY)).toBe(-0.45);
    expect(Math.abs(v(0.00025, 2000) - (0.45 * 4) / Math.PI)).toBeLessThan(1e-9);
    expect(Math.abs(v(0.00025, 40000) - 0.45)).toBeLessThan(0.03);
  });
  it('和音は 3 音 × 8 倍音で、先頭が根音', () => {
    const c = comps({ src: 'chord', f: 400 });
    expect(c).toHaveLength(24);
    expect(c[0].f).toBe(400);
  });
  it('スイープは 50 Hz から 16 kHz まで 8 秒', () => {
    expect(swF(0)).toBe(50);
    expect(swF(4)).toBeCloseTo(8025, 6);
    expect(swF(8)).toBe(50);
  });
  it('自動で下げる: 16 kHz から 700 Hz まで下げて戻る', () => {
    expect(autoFs(0)).toBe(FS_HI);
    expect(autoFs(9)).toBe(FS_LO);
    expect(autoFs(CYC)).toBe(FS_HI);
    for (let t = 0.7; t < 8.5; t += 0.5) expect(autoFs(t + 0.1)).toBeLessThan(autoFs(t));
  });
});

describe('止めた図の復元', () => {
  it('fs = 8f の正弦波はほぼそのまま戻る', () => {
    const ts = Array.from({ length: 200 }, (_, i) => 0.002 + i * 1e-5),
      y = reconAt(SINE, 8000, false, ts);
    for (let i = 0; i < ts.length; i++)
      expect(Math.abs(y[i] - AMP * Math.sin(2 * Math.PI * 1000 * ts[i]))).toBeLessThan(0.01);
  });
  it('fs = 1.3f の正弦波は 300 Hz の波になる', () => {
    const ts = Array.from({ length: 200 }, (_, i) => 0.002 + i * 5e-5),
      y = reconAt(SINE, 1300, false, ts);
    for (let i = 0; i < ts.length; i++)
      expect(Math.abs(y[i] + AMP * Math.sin(2 * Math.PI * 300 * ts[i]))).toBeLessThan(0.01);
  });
});

describe('音の流れ', () => {
  it('fs = 8f の正弦波を復元する', () => {
    const st = new Stream(R, set()),
      y = run(st, 0.1);
    let e = 0;
    for (let i = 1000; i < y.length; i++)
      e = Math.max(e, Math.abs(y[i] - AMP * Math.sin((2 * Math.PI * 1000 * i) / R)));
    expect(e).toBeLessThan(0.01);
  });
  it('fs = 1.3f では 300 Hz に折り返す', () => {
    const st = new Stream(R, set({ fs: 1300 })),
      y = run(st, 0.2);
    let e = 0;
    for (let i = 2000; i < y.length; i++) e = Math.max(e, Math.abs(y[i] + AMP * Math.sin((2 * Math.PI * 300 * i) / R)));
    expect(e).toBeLessThan(0.02);
  });
  it('fs を急に変えても音が途切れない', () => {
    const st = new Stream(R, set()),
      a = run(st, 0.05);
    st.update(set({ fs: 1300 }));
    const b = run(st, 0.1);
    st.update(set({ fs: 30000 }));
    const c = run(st, 0.1),
      all = Float32Array.from([...a, ...b, ...c]),
      /* 1 kHz・振幅 0.7 の正弦波の 1 標本の変化は 2π·1000/48000·0.7 ≈ 0.092 */
      lim = 0.12;
    expect(maxStep(all, 500)).toBeLessThan(lim);
  });
  it('自動で下げる 1 周の間、音が途切れない', () => {
    const st = new Stream(R, set({ auto: true })),
      y = run(st, CYC);
    expect(maxStep(y, 500)).toBeLessThan(0.12);
    expect(st.fs).toBeGreaterThan(FS_LO * 0.99);
  });
  it('fs = 2f ちょうどの正弦波は、図と同じく標本が 0 の所に来て無音になる', () => {
    const st = new Stream(R, set({ fs: 2000 })),
      y = run(st, 0.1);
    expect(Math.max(...y.slice(2000).map(Math.abs))).toBeLessThan(1e-3);
  });
  it('途中で fs を 2f に変えても、着いたあとは図と同じ格子で無音になる', () => {
    const st = new Stream(R, set());
    run(st, 0.05);
    st.update(set({ fs: 2000 }));
    const y = run(st, 0.8);
    expect(Math.max(...y.slice(y.length - 4800).map(Math.abs))).toBeLessThan(1e-3);
  });
  it('原音と復元した音の切り替えも途切れない', () => {
    const st = new Stream(R, set({ fs: 1300 })),
      a = run(st, 0.05);
    st.update(set({ fs: 1300, hear: 'orig' }));
    const b = run(st, 0.05);
    expect(maxStep(Float32Array.from([...a, ...b]), 500)).toBeLessThan(0.12);
  });
});

describe('のこぎり波・三角波・音楽', () => {
  it('のこぎり波と三角波の倍音の和は、理想の形に近づく', () => {
    for (const src of ['saw', 'tri'] as const) {
      const v = source({ src, f: 100 });
      for (const t of [0.0013, 0.0031, 0.0057, 0.0082])
        expect(Math.abs(v(t, 400000) - v(t, Number.POSITIVE_INFINITY))).toBeLessThan(0.03);
    }
  });
  it('のこぎり波はすべての倍音、三角波は奇数の倍音', () => {
    expect(
      comps({ src: 'saw', f: 1000 })
        .slice(0, 3)
        .map((c) => c.f),
    ).toEqual([1000, 2000, 3000]);
    expect(
      comps({ src: 'tri', f: 1000 })
        .slice(0, 3)
        .map((c) => c.f),
    ).toEqual([1000, 3000, 5000]);
  });
  it('音楽の値は標本の位置で音源の値に一致し、ローパスで高い成分が減る', () => {
    const x = new Float32Array(MUSIC_RATE * 4);
    for (let i = 0; i < x.length; i++)
      x[i] =
        0.5 * Math.sin((2 * Math.PI * 300 * i) / MUSIC_RATE) + 0.3 * Math.sin((2 * Math.PI * 9000 * i) / MUSIC_RATE);
    setMusic('pad', x);
    for (const i of [1000, 5000, 77777])
      expect(musicAt('pad', i / MUSIC_RATE, Number.POSITIVE_INFINITY)).toBeCloseTo(x[i], 5);
    /* 2 kHz で除くと 9 kHz の成分が消え、300 Hz だけが残る */
    for (const i of [1000, 5000, 77777]) {
      const t = i / MUSIC_RATE;
      expect(Math.abs(musicAt('pad', t, 2000) - 0.5 * Math.sin(2 * Math.PI * 300 * t))).toBeLessThan(0.02);
    }
  });
});

describe('標本化周波数の並び', () => {
  it('2 kHz などのきりのよい値と、入力の 2 倍を選べる', () => {
    const d = PARAMS.find((p) => p.k === 'fs');
    const list = () => (typeof d?.list === 'function' ? d.list() : (d?.list ?? []));
    expect(list()).toContain(2000);
    expect(list()).toContain(1500);
    fsMarks.push(1234, 2468);
    expect(list()).toContain(2468);
    fsMarks.length = 0;
  });
});
