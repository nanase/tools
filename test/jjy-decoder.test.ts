import { describe, expect, it } from 'vitest';
import { DEFAULTS, encode, type Options, Signal } from '../src/tools/jjy/code';
import { jst } from '../src/tools/jjy/time';
import {
  classify,
  Decoder,
  decodeAll,
  evalFrame,
  type Frame,
  half,
  hm,
  hms,
  type Res,
  type Sym,
  todOf,
} from '../src/tools/jjy-decoder/decoder';
import { analyzeFile, Env, peakF } from '../src/tools/jjy-decoder/dsp';
import { FLAGS, yNote } from '../src/tools/jjy-decoder/flags';
import { EQS, substHtml } from '../src/tools/jjy-decoder/math';
import { type EnvMsg, type ProcOut, procInit, procMsg, procStep } from '../src/tools/jjy-decoder/proc';
import { synth, testWav } from '../src/tools/jjy-decoder/synth';

/** JST の日時を UTC のミリ秒にする（月は 1〜12） */
const at = (y: number, mo: number, d: number, h: number, mi: number, s = 0) => Date.UTC(y, mo - 1, d, h - 9, mi, s);

/** 再現できる乱数（mulberry32）と、正規分布の雑音 */
function gauss(seed: number): () => number {
  let a = seed >>> 0;
  const u = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u());
}

interface Gen {
  fs?: number;
  f?: number;
  /** 雑音の標準偏差（高出力の振幅は 0.5） */
  noise?: number;
  seed?: number;
}
/** シミュレータの規則で、t0 から sec 秒ぶんの信号を作る */
function signal(t0: number, sec: number, opt: Partial<Options> = {}, g: Gen = {}): Float32Array {
  const fs = g.fs ?? 8000,
    x = new Float32Array(Math.round(fs * sec));
  synth(new Signal({ ...DEFAULTS, ...opt }), x, fs, t0, { g: null, i: 0 }, g.f ?? 440);
  if (g.noise) {
    const r = gauss(g.seed ?? 1);
    for (let i = 0; i < x.length; i++) x[i] += g.noise * r();
  }
  return x;
}
/** 信号を解読して、読み終えた分を返す */
function decode(x: Float32Array, fs = 8000, f = 0): { frames: Frame[]; f: number; lag: number } {
  const e = analyzeFile(x, fs, f);
  if (!e) throw new Error('short');
  return { frames: decodeAll(e.env, e.pw).frames, f: e.f, lag: e.lag };
}
const res = (f: Frame): Res => {
  if (!f.res) throw new Error('not finished');
  return f.res;
};
/** 分の始まり（UTC の ms）の一覧 */
const epochs = (L: Frame[]) => L.map((f) => res(f).epoch);

describe('直交検波と周波数の推定', () => {
  it('一定の振幅の正弦波から振幅を取り出す', () => {
    const fs = 48000,
      x = new Float32Array(fs / 10);
    for (let i = 0; i < x.length; i++) x[i] = 0.3 * Math.sin((2 * Math.PI * 1000 * i) / fs + 0.7);
    const e = new Env(fs, 1000),
      out = new Float32Array(200),
      pw = new Float32Array(200);
    const n = e.run(x, out, 0, pw);
    expect(n).toBe(100);
    /* 窓（5 周期 = 5 ms）が埋まった後 */
    for (let k = 6; k < n; k++) expect(out[k]).toBeCloseTo(0.3, 3);
    expect(pw[50]).toBeCloseTo(0.045, 3);
    expect(e.N).toBe(240);
    expect(e.lag).toBeCloseTo(2.5, 6);
  });
  it('窓は搬送波の整数周期で 5 ms 以上', () => {
    const e = new Env(8000, 440);
    /* 440 Hz の 3 周期（6.8 ms）を 8 kHz で */
    expect(e.N).toBe(Math.round((3 * 8000) / 440));
  });
  it('FFT の頂点を放物線で補間して周波数を求める', () => {
    for (const [fs, f] of [
      [48000, 440],
      [44100, 1234.5],
      [8000, 3000],
    ]) {
      const x = new Float32Array(16384);
      for (let i = 0; i < x.length; i++)
        x[i] = Math.sin((2 * Math.PI * f * i) / fs) + 0.2 * Math.sin((2 * Math.PI * 60 * i) / fs);
      const r = peakF(x, fs, 16384);
      expect(r).not.toBeNull();
      expect(Math.abs((r?.f ?? 0) - f)).toBeLessThan(0.5);
    }
  });
  it('短すぎる入力では周波数を求めない', () => {
    expect(peakF(new Float32Array(1000), 8000, 16384)).toBeNull();
    expect(analyzeFile(new Float32Array(1000), 8000, 0)).toBeNull();
  });
});

describe('パルス幅の判定', () => {
  it('規定の 0.2・0.5・0.8 秒の中間で区切る', () => {
    expect([50, 150, 200, 349, 350, 500, 649, 650, 800, 949, 950].map(classify).join('')).toBe('?PPP111000?');
  });
});

describe('1 分の読み取り（符号から）', () => {
  const codes = (ms: number, o: Partial<Options> = {}): Sym[] => encode(jst(ms), { ...DEFAULTS, ...o });
  it('シミュレータの符号から時刻と曜日を読み戻す', () => {
    const r = evalFrame(codes(at(2026, 9, 27, 22, 34)), null);
    expect([r.h, r.m, r.d, r.y, r.w, r.Y, r.mo, r.day, r.wdC]).toEqual([22, 34, 270, 26, 0, 2026, 9, 27, 0]);
    expect([r.pa1, r.pa2, r.wdOk, r.cs, r.st, r.ok]).toEqual([true, true, true, false, false, true]);
    expect([r.mkN, r.mkOk]).toEqual([7, 7]);
    expect(r.epoch).toBe(at(2026, 9, 27, 22, 34));
    expect(r.tod).toBe((22 * 60 + 34) * 60000);
  });
  it('コールサインの分は年を前の分から引き継ぎ、停波の予告を読む', () => {
    const o = { stopAfter: 4, stopType: true, stopDuration: 2 };
    const p = evalFrame(codes(at(2026, 9, 27, 12, 14), o), null);
    const r = evalFrame(codes(at(2026, 9, 27, 12, 15), o), p);
    expect([r.cs, r.st, r.stA, r.st4, r.st56, r.Y, r.yCarry, r.y, r.ok]).toEqual([
      true,
      true,
      4,
      1,
      2,
      2026,
      true,
      undefined,
      true,
    ]);
    expect(r.epoch).toBe(at(2026, 9, 27, 12, 15));
    expect(yNote(r)).toBe('前の分から引き継ぎ');
  });
  it('年をまたいでコールサインの分が続くと、通算日が戻ったところで翌年にする', () => {
    const o: Partial<Options> = { callSign: 'force' };
    const p = evalFrame(codes(at(2026, 12, 31, 23, 58)), null);
    const a = evalFrame(codes(at(2026, 12, 31, 23, 59), o), p);
    const b = evalFrame(codes(at(2027, 1, 1, 0, 0), o), a);
    expect([a.Y, a.d, b.Y, b.d, b.mo, b.day]).toEqual([2026, 365, 2027, 1, 1, 1]);
    expect(b.epoch).toBe(at(2027, 1, 1, 0, 0));
  });
  it('読めないビット・パリティ違い・範囲外を見分ける', () => {
    const c: (Sym | null)[] = codes(at(2026, 9, 27, 22, 34));
    c[3] = '?';
    let r = evalFrame(c, null);
    expect(Number.isNaN(r.m)).toBe(true);
    expect([r.pa2, r.ok]).toEqual([null, false]);
    const e: (Sym | null)[] = codes(at(2026, 9, 27, 22, 34));
    e[7] = '1';
    r = evalFrame(e, null);
    /* 34 分に 2 の重みを立てて 36 分: 値は読めるがパリティが合わない */
    expect([r.m, r.pa2, r.ok]).toEqual([36, false, false]);
    const d: (Sym | null)[] = codes(at(2026, 9, 27, 22, 34));
    d[5] = '1';
    d[8] = '1';
    /* 分の 1 の位が 4 + 8 + 1 = 13 は BCD の範囲外 */
    expect(Number.isNaN(evalFrame(d, null).m)).toBe(true);
  });
  it('未受信の秒があれば値を undefined にする', () => {
    const c: (Sym | null)[] = codes(at(2026, 9, 27, 22, 34)).map((k, s) => (s < 20 ? k : null));
    const r = evalFrame(c, null);
    expect([r.m, r.h, r.d, r.cs, r.st, r.ok]).toEqual([34, 22, undefined, null, null, false]);
    expect(hm(r)).toBe('22:34');
  });
  it('曜日が年と通算日から求めたものと違えば検査を通さない', () => {
    const c: (Sym | null)[] = codes(at(2026, 9, 27, 22, 34));
    c[52] = '1';
    const r = evalFrame(c, null);
    expect([r.w, r.wdC, r.wdOk, r.ok]).toEqual([1, 0, false, false]);
  });
});

describe('信号の復号（シミュレータの規則で合成）', () => {
  it('雑音入りの信号から、分に同期して時刻を読む', () => {
    const t0 = at(2026, 9, 27, 22, 33, 20);
    const { frames, f } = decode(signal(t0, 170, {}, { noise: 0.1, seed: 7 }));
    expect(f).toBeCloseTo(440, 0);
    expect(epochs(frames)).toEqual([at(2026, 9, 27, 22, 34), at(2026, 9, 27, 22, 35)]);
    for (const fr of frames) {
      expect(res(fr).ok).toBe(true);
      expect(fr.c.every((k) => k === 'P' || k === '0' || k === '1')).toBe(true);
      expect(fr.q?.ok).toBe(60);
    }
    /* 0 秒の立ち上がりは、ファイルの 40 秒（22:34:00）の位置 */
    expect(Math.abs(frames[0].t0 - 40000)).toBeLessThan(10);
    expect(frames[1].t0 - frames[0].t0).toBeCloseTo(60000, -1);
    /* パルス幅は規定の幅 */
    expect(frames[0].w[0]).toBeGreaterThan(180);
    expect(frames[0].w[0]).toBeLessThan(220);
  });
  it('年をまたぐ', () => {
    const { frames } = decode(signal(at(2026, 12, 31, 23, 58, 30), 150, {}, { noise: 0.05 }));
    expect(epochs(frames)).toEqual([at(2026, 12, 31, 23, 59), at(2027, 1, 1, 0, 0)]);
    const [a, b] = frames.map(res);
    expect([a.Y, a.d, a.w, a.ok]).toEqual([2026, 365, 4, true]);
    expect([b.Y, b.d, b.w, b.mo, b.day, b.ok]).toEqual([2027, 1, 5, 1, 1, true]);
  });
  it('コールサインと停波の予告の分', () => {
    const o = { stopAfter: 6, stopType: false, stopDuration: 1 };
    const { frames } = decode(signal(at(2026, 9, 27, 12, 13, 40), 200, o, { noise: 0.05, seed: 3 }));
    expect(frames.map((f) => hm(f.res))).toEqual(['12:14', '12:15', '12:16']);
    const [p, c, n] = frames.map(res);
    expect([p.cs, c.cs, n.cs]).toEqual([false, true, false]);
    expect(frames[1].c.slice(40, 49).join('')).toBe('SSSSSSSSS');
    expect([c.st, c.stA, c.st4, c.st56, c.Y, c.yCarry, c.ok]).toEqual([true, 6, 0, 1, 2026, true, true]);
    expect(c.epoch).toBe(at(2026, 9, 27, 12, 15));
    expect([p.st, n.st]).toEqual([false, false]);
    const fl = Object.fromEntries(FLAGS.map(([b, nm, f]) => [b || nm, f(c)[0]]));
    expect([fl.JJY, fl['ST1–3'], fl.ST4, fl['ST5–6'], fl.LS1, fl.SU2]).toEqual([
      '受信',
      '2 時間以内',
      '終日',
      '7 日間以上・未定',
      '—',
      '—',
    ]);
  });
  it('閏秒と夏時間のフラグ', () => {
    const o = { summerTimeNotice: true, summerTime: true, leapSecondNotice: true, leapSecondType: false };
    const { frames } = decode(signal(at(2026, 6, 30, 23, 57, 50), 75, o, { noise: 0.08, seed: 5 }));
    expect(frames).toHaveLength(1);
    const r = res(frames[0]);
    expect([r.su1, r.su2, r.ls1, r.ls2, r.ok]).toEqual([1, 1, 1, 0, true]);
    const fl = FLAGS.map(([, , f]) => f(r)[0]);
    expect(fl.slice(4, 8)).toEqual(['あり', 'あり', 'あり', '削除']);
    const o2 = { leapSecondNotice: true, leapSecondType: true };
    const r2 = res(decode(signal(at(2026, 6, 30, 23, 57, 50), 75, o2, { noise: 0.08 })).frames[0]);
    expect([r2.su1, r2.su2, r2.ls1, r2.ls2]).toEqual([0, 0, 1, 1]);
  });
  it('搬送波を自動で見つけ、手動でも読める', () => {
    const t0 = at(2026, 9, 27, 8, 0, 50),
      x = signal(t0, 75, {}, { fs: 44100, f: 2000, noise: 0.05 });
    const a = decode(x, 44100);
    expect(Math.abs(a.f - 2000)).toBeLessThan(1);
    expect(epochs(a.frames)).toEqual([at(2026, 9, 27, 8, 1)]);
    const m = decode(x, 44100, 2000);
    expect(m.f).toBe(2000);
    expect(epochs(m.frames)).toEqual([at(2026, 9, 27, 8, 1)]);
  });
  it('雑音だけでは同期しない', () => {
    const r = gauss(9),
      x = new Float32Array(8000 * 70);
    for (let i = 0; i < x.length; i++) x[i] = 0.1 * r();
    expect(decode(x).frames).toEqual([]);
  });
  it('途中で信号が途切れたら同期を外し、戻ったら同期し直す', () => {
    const t0 = at(2026, 9, 27, 9, 0, 50),
      x = signal(t0, 200, {}, { noise: 0.02 });
    /* 9:01:30〜9:02:10 を無音にする */
    x.fill(0, 8000 * 40, 8000 * 80);
    /* 9:01 は P4・P5 が続けて欠けたところで同期を外し、9:02:59 の P0 と 9:03:00 の M で同期し直す */
    const { frames } = decode(x);
    expect(frames.map((f) => hm(f.res))).toEqual(['09:03']);
    expect(res(frames[0]).ok).toBe(true);
  });
});

describe('ライブ入力（ブロックごとの処理）', () => {
  it('128 点ずつ流しても、ファイルと同じ時刻を読む', () => {
    const fs = 8000,
      t0 = at(2026, 9, 27, 22, 33, 45),
      x = signal(t0, 80, {}, { noise: 0.05 });
    const st = procInit(),
      d = new Decoder(17),
      raws: ProcOut[] = [];
    const post = (m: ProcOut) => {
      if ('raw' in m) raws.push(m);
      else for (let i = 0; i < m.a.length; i++) d.push(m.a[i], m.p[i]);
    };
    let k0 = 0;
    const seen: EnvMsg[] = [];
    for (let i = 0; i < x.length; i += 128) {
      if (i === 16384) {
        /* 推定用の音が 16384 点そろったら、その周波数で検波を始める */
        const r = raws[0];
        const pk = 'raw' in r ? peakF(r.raw, fs, 16384) : null;
        expect(Math.abs((pk?.f ?? 0) - 440)).toBeLessThan(1);
        procMsg(st, fs, { f: pk?.f });
      }
      procStep(st, x.subarray(i, i + 128), fs, i / fs, (m) => {
        if (!('raw' in m)) {
          expect(m.k0).toBe(k0);
          k0 += m.a.length;
          seen.push(m);
        }
        post(m);
      });
    }
    expect(raws.length).toBeGreaterThanOrEqual(2);
    expect(seen[0].c0).toBeCloseTo(16384 / fs, 6);
    expect(d.frames.map((f) => res(f).epoch)).toEqual([at(2026, 9, 27, 22, 34)]);
    expect(res(d.frames[0]).ok).toBe(true);
  });
});

describe('テスト信号の WAV', () => {
  it('8 kHz・16 bit の WAV を読み戻して解読できる', () => {
    const t0 = at(2026, 9, 27, 22, 33, 50),
      buf = testWav(new Signal({ ...DEFAULTS }), t0, 80),
      dv = new DataView(buf);
    const str = (o: number) => String.fromCharCode(...new Uint8Array(buf, o, 4));
    expect([str(0), str(8), str(12), str(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect([dv.getUint16(22, true), dv.getUint32(24, true), dv.getUint16(34, true), dv.getUint32(40, true)]).toEqual([
      1,
      8000,
      16,
      8000 * 80 * 2,
    ]);
    const x = new Float32Array(8000 * 80);
    for (let i = 0; i < x.length; i++) x[i] = dv.getInt16(44 + i * 2, true) / 32768;
    const { frames } = decode(x);
    expect(epochs(frames)).toEqual([at(2026, 9, 27, 22, 34)]);
  });
});

describe('時刻の表記と式', () => {
  it('0 時からの時刻と、1 日の差', () => {
    expect(hms((13 * 3600 + 5 * 60 + 9) * 1000 + 999)).toBe('13:05:09');
    expect(hms(-1000)).toBe('23:59:59');
    expect(todOf(at(2026, 9, 27, 0, 0, 1))).toBe(1000);
    expect(half(864e5 - 1000)).toBe(-1000);
    expect(half(5000)).toBe(5000);
  });
  it('代入した式で、読めないビットを「?」にする', () => {
    const c: (Sym | null)[] = encode(jst(at(2026, 9, 27, 22, 34)), { ...DEFAULTS });
    c[1] = '?';
    const h = substHtml(c, evalFrame(c, null));
    expect(h).toContain('<mn>40</mn><mo>&#x22C5;</mo><mi mathvariant="normal">?</mi>');
    expect(h.match(/<math/g)).toHaveLength(4);
    expect(EQS.match(/<math/g)).toHaveLength(13);
  });
});
