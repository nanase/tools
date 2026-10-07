import { describe, expect, it } from 'vitest';
import { parse } from '../src/lib/parse';
import { C } from '../src/tools/guitar/body';
import { coupled, cvec, project } from '../src/tools/piano/eig';
import { boardDesc, Engine, minPhaseFir } from '../src/tools/piano/engine';
import { type StruckString, strike } from '../src/tools/piano/hammer';
import { hammerOf, makePiano, NO_DAMPER, type Piano, strikeKey } from '../src/tools/piano/model';
import { PIECES, pedalPoints, TempoMap, voicing } from '../src/tools/piano/score';
import { admittance, hfPressure, makeBoard, pressure, sigma } from '../src/tools/piano/soundboard';
import {
  etaOf,
  f0Of,
  inharm,
  KEY_HI,
  KEY_LO,
  keyString,
  noteHz,
  noteName,
  PIANO_TYPES,
  partialHz,
  pianoTypeOf,
  tuning,
} from '../src/tools/piano/strings';

const FS = 48000;
const piano = (type = 'concert', unison = 1): Piano =>
  makePiano(
    {
      type: pianoTypeOf(type),
      board: { wood: 'spruce', area: pianoTypeOf(type).area, h: 9e-3, f1: pianoTypeOf(type).f1 },
      a4: 440,
      stretch: true,
      unison,
      hard: 1,
    },
    FS,
  );
const P = piano();
const cents = (a: number, b: number) => 1200 * Math.log2(a / b);
const rms = (y: Float32Array, a: number, b: number) => {
  let s = 0;
  for (let i = Math.round(a * FS); i < Math.round(b * FS); i++) s += y[i] * y[i];
  return Math.sqrt(s / ((b - a) * FS));
};
/** 鍵 key を打って dur 秒ぶん鳴らす（release で鍵を離す時刻、pedal でペダル） */
function play(key: number, v: number, dur: number, release = Infinity, pedal = false): Float32Array {
  const e = new Engine(FS);
  e.setBoard(boardDesc(P.board));
  e.setPedal(pedal);
  e.strike(strikeKey(P, { key, v, soft: false, free: () => pedal }, FS).msg);
  const y = new Float32Array(Math.round(dur * FS));
  for (let i = 0; i < y.length; i += 128) {
    if (i / FS >= release && i / FS < release + 128 / FS) e.release(key);
    e.render(y, i, Math.min(128, y.length - i));
  }
  return y;
}

describe('弦', () => {
  it('張力は、硬い弦の第 1 部分音が調律の周波数になる値', () => {
    const t = pianoTypeOf('concert');
    for (const k of [21, 33, 47, 48, 60, 84, 108]) {
      const f = noteHz(k),
        s = keyString(k, t, f);
      expect(partialHz(s, 1)).toBeCloseTo(f, 9);
      expect(s.T).toBeGreaterThan(400);
      expect(s.T).toBeLessThan(2000);
    }
  });
  it('非調和性係数は中音で 10⁻⁴ 台、最高音で 10⁻² 台。巻弦の低音は小さい', () => {
    const B = (k: number) => inharm(P.keys[k - KEY_LO].s);
    expect(B(60)).toBeGreaterThan(1e-4);
    expect(B(60)).toBeLessThan(1e-3);
    expect(B(108)).toBeGreaterThan(5e-3);
    expect(B(108)).toBeLessThan(5e-2);
    expect(B(36)).toBeLessThan(B(60));
  });
  it('小さいピアノほど低音の弦が短く、非調和性が大きい', () => {
    const t0 = pianoTypeOf('concert'),
      t1 = pianoTypeOf('upright'),
      s0 = keyString(21, t0, 27.5),
      s1 = keyString(21, t1, 27.5);
    expect(s1.L).toBeLessThan(s0.L);
    expect(inharm(s1)).toBeGreaterThan(inharm(s0));
    expect(PIANO_TYPES.length).toBe(3);
  });
  it('ストレッチ調律は高音を高く、低音を低くし、A4 は 440 Hz のまま', () => {
    const f = tuning(pianoTypeOf('concert'), 440, true);
    expect(f[69 - KEY_LO]).toBe(440);
    expect(cents(f[108 - KEY_LO], noteHz(108))).toBeGreaterThan(10);
    expect(cents(f[21 - KEY_LO], noteHz(21))).toBeLessThan(0);
    /* オクターブ上の第 1 部分音は、下の第 2 部分音にそろう */
    const s = keyString(84, pianoTypeOf('concert'), f[84 - KEY_LO]);
    expect(Math.abs(cents(f[96 - KEY_LO], partialHz(s, 2)))).toBeLessThan(0.1);
    const e = tuning(pianoTypeOf('concert'), 442, false);
    expect(e[69 - KEY_LO]).toBe(442);
    expect(e[81 - KEY_LO]).toBeCloseTo(884, 9);
  });
  it('弦の数は低音から 1・2・3 本、ダンパーは最高音の側にない', () => {
    expect(P.keys[0].s.ns).toBe(1);
    expect(P.keys[36 - KEY_LO].s.ns).toBe(2);
    expect(P.keys[60 - KEY_LO].s.ns).toBe(3);
    expect(NO_DAMPER).toBeGreaterThan(84);
    expect(NO_DAMPER).toBeLessThanOrEqual(KEY_HI);
    expect(noteName(21)).toBe('A0');
    expect(f0Of(P.keys[0].s)).toBeLessThan(27.5);
  });
});

describe('ハンマー', () => {
  const km = P.keys[60 - KEY_LO],
    st: StruckString = { L: km.s.L, mu: km.s.mu, T: km.s.T, ns: 3, x0: km.x0, w: km.w[0], s: km.sg[0] };
  it('衝突は数 ms で終わり、速く打つほど力が大きく、接触が短い', () => {
    const a = strike(st, { ...hammerOf(60), v: 1 }, FS),
      b = strike(st, { ...hammerOf(60), v: 5 }, FS);
    expect(a.tc).toBeGreaterThan(0.5e-3);
    expect(a.tc).toBeLessThan(6e-3);
    expect(b.fmax).toBeGreaterThan(3 * a.fmax);
    expect(b.tc).toBeLessThan(a.tc);
    /* ハンマーは跳ね返る */
    expect(b.vOut).toBeLessThan(0);
  });
  it('高音のハンマーは軽く硬く、接触が短い', () => {
    const hi = P.keys[96 - KEY_LO],
      sh: StruckString = { L: hi.s.L, mu: hi.s.mu, T: hi.s.T, ns: 3, x0: hi.x0, w: hi.w[0], s: hi.sg[0] };
    expect(hammerOf(96).m).toBeLessThan(hammerOf(36).m);
    expect(strike(sh, { ...hammerOf(96), v: 3 }, FS).tc).toBeLessThan(strike(st, { ...hammerOf(60), v: 3 }, FS).tc);
  });
  it('力積はハンマーの運動量の変化に等しい', () => {
    const h = { ...hammerOf(60), v: 3 },
      c = strike(st, h, FS);
    let J = 0;
    for (const f of c.force) J += f * c.dtF;
    expect((J * st.ns) / h.m).toBeCloseTo(h.v - c.vOut, 2);
  });
});

describe('駒での結合', () => {
  it('固有ベクトルは D + i v vᵀ を満たし、初期値を分けて戻すと元に戻る', () => {
    const n = 4,
      d = cvec(n),
      v = cvec(n);
    for (let j = 0; j < n; j++) {
      d.re[j] = 1000 + 0.7 * j - 1;
      d.im[j] = 0.1 + 0.02 * j;
      v.re[j] = 0.9 + 0.1 * j;
      v.im[j] = 0.2;
    }
    const c = coupled(d, v),
      w0 = cvec(n);
    w0.re.fill(1);
    const cc = project(c, w0);
    for (let m = 0; m < n; m++) {
      const u = c.u[m];
      let sr = 0,
        si = 0;
      for (let j = 0; j < n; j++) {
        sr += v.re[j] * u.re[j] - v.im[j] * u.im[j];
        si += v.re[j] * u.im[j] + v.im[j] * u.re[j];
      }
      for (let j = 0; j < n; j++) {
        const mr = d.re[j] * u.re[j] - d.im[j] * u.im[j] - (v.re[j] * si + v.im[j] * sr),
          mi = d.re[j] * u.im[j] + d.im[j] * u.re[j] + (v.re[j] * sr - v.im[j] * si),
          lr = c.lam.re[m] * u.re[j] - c.lam.im[m] * u.im[j],
          li = c.lam.re[m] * u.im[j] + c.lam.im[m] * u.re[j];
        expect(Math.hypot(mr - lr, mi - li)).toBeLessThan(1e-9);
      }
    }
    for (let j = 0; j < n; j++) {
      let r = 0,
        i = 0;
      for (let m = 0; m < n; m++) {
        r += cc.re[m] * c.u[m].re[j] - cc.im[m] * c.u[m].im[j];
        i += cc.re[m] * c.u[m].im[j] + cc.im[m] * c.u[m].re[j];
      }
      expect(r).toBeCloseTo(1, 9);
      expect(i).toBeCloseTo(0, 9);
    }
  });
  it('3 本弦は、速く減衰するモードと遅く減衰するモードに分かれる（二段減衰）', () => {
    const km = P.keys[60 - KEY_LO],
      m = strikeKey(P, { key: 60, v: 3, soft: false, free: () => false }, FS).msg,
      w1 = km.w[0][0],
      near = Array.from(m.s).filter((_, i) => Math.abs(m.w[i] - w1) < 0.01 * w1 && m.own[i] === 60);
    expect(Math.max(...near) / Math.min(...near)).toBeGreaterThan(2);
  });
  it('響板の駆動点アドミタンスの実部は正', () => {
    const b = makeBoard({ wood: 'spruce', area: 2, h: 9e-3, f1: 70 });
    for (const f of [30, 80, 200, 500, 1000, 3000, 8000])
      expect(admittance(b, C.cx(2 * Math.PI * f)).re).toBeGreaterThan(0);
  });
});

describe('響板の放射', () => {
  const b = makeBoard({ wood: 'spruce', area: 1.9, h: 8e-3, f1: 75 });
  it('響棒の間の導波路は約 1.1 kHz で通り始め、数 kHz まで亜音速のまま（Boutillon・Ege 2013 の値の範囲）', () => {
    expect(b.fgs).toBeGreaterThan(1000);
    expect(b.fgs).toBeLessThan(1400);
    expect(b.fsup).toBeGreaterThan(5000);
    expect(b.fsup).toBeLessThan(9000);
    /* 一様な板の一致周波数（約 2 kHz）よりずっと上 */
    expect(b.fsup).toBeGreaterThan(2.5 * b.fc);
  });
  it('放射効率は 1〜2 kHz の境目で強まり、2〜4 kHz の導波路の領域で下がり、f_sup の上で 1 に近づく', () => {
    const g = makeBoard({ wood: 'spruce', area: 1.9, h: 9e-3, f1: 75 }),
      peak = Math.max(...[1200, 1400, 1600, 1800].map((f) => sigma(g, f)));
    expect(peak).toBeGreaterThan(1.5 * sigma(g, 2500));
    expect(sigma(g, 500)).toBeLessThan(peak);
    /* 一様な板なら一致周波数より上で 1 になる 2.5〜4 kHz で、0.25 より小さい */
    for (const f of [2500, 3000, 4000]) expect(sigma(g, f)).toBeLessThan(0.25);
    expect(sigma(g, 1.3 * g.fsup)).toBeGreaterThan(0.9);
  });
  it('モードの和の帯域の平均は、エネルギーの釣り合いから求めた滑らかな特性と同じ大きさ', () => {
    /* 1〜1.4 kHz で、モードの音圧の 2 乗の平均と、滑らかな特性（境目の重みを除いた値）の 2 乗を比べる */
    const c = makeBoard({ wood: 'spruce', area: 2.4, h: 9e-3, f1: 62 });
    let pm = 0,
      ph = 0;
    for (let f = 1000; f <= 1400; f += 0.5) {
      let r = 0,
        i = 0;
      for (const m of c.modes) {
        const wk = 2 * Math.PI * m.f,
          w = 2 * Math.PI * f,
          dr = wk * wk - w * w,
          di = w * wk * m.eta,
          d = dr * dr + di * di;
        /* G iω / (m (dr + i di)) */
        r += (m.G * w * di) / (m.m * d);
        i += (m.G * w * dr) / (m.m * d);
      }
      pm += r * r + i * i;
      const x = (f / 1600) ** 4;
      ph += (hfPressure(c, f) / (x / (1 + x))) ** 2;
    }
    expect(Math.abs(10 * Math.log10(pm / ph))).toBeLessThan(4);
  });
  it('高い周波数の経路の最小位相の FIR は、表の大きさをなぞる', () => {
    const d = boardDesc(b),
      h = minPhaseFir(d.hf, FS, 128);
    for (const f of [2000, 3000, 5000, 8000]) {
      let r = 0,
        i = 0;
      for (let k = 0; k < h.length; k++) {
        r += h[k] * Math.cos((2 * Math.PI * f * k) / FS);
        i -= h[k] * Math.sin((2 * Math.PI * f * k) / FS);
      }
      expect(Math.abs(20 * Math.log10(Math.hypot(r, i) / hfPressure(b, f)))).toBeLessThan(0.5);
    }
  });
  it('音を作る部分の響板の応答は、2 つの経路の境目でも表示の値と大きく違わない（打ち消し合わない）', () => {
    const e = new Engine(FS),
      n = 1 << 15,
      y = new Float32Array(n),
      att = new Float32Array([1]);
    e.setBoard(boardDesc(P.board));
    e.strike({
      key: 60,
      N: 0,
      w: new Float64Array(0),
      s: new Float64Array(0),
      fr: new Float64Array(0),
      fi: new Float64Array(0),
      own: new Int16Array(0),
      sd: new Float64Array(0),
      att,
    });
    for (let i = 0; i < n; i += 128) e.render(y, i, 128);
    for (const f0 of [1800, 2500, 3500]) {
      let pe = 0,
        pd = 0;
      for (let f = f0 / 1.1; f <= f0 * 1.1; f += 4) {
        let r = 0,
          i = 0;
        for (let t = 0; t < n; t++) {
          r += y[t] * Math.cos((2 * Math.PI * f * t) / FS);
          i -= y[t] * Math.sin((2 * Math.PI * f * t) / FS);
        }
        const p = pressure(P.board, f);
        pe += r * r + i * i;
        pd += p.re * p.re + p.im * p.im;
      }
      expect(Math.abs(10 * Math.log10(pe / pd))).toBeLessThan(3);
    }
  });
});

describe('ピアノ線の損失', () => {
  it('Ege・Chaigne の測ったピアノ線（f₁ = 810 Hz）の 3〜4 kHz の減衰率と、2 倍以内で合う', () => {
    /* 外径 0.95 mm、L = 28.1 cm の鋼線を、f₁ = 810 Hz に張る */
    const d = 0.95e-3,
      L = 0.281,
      mu = (7850 * Math.PI * d * d) / 4,
      B = (2e11 * Math.PI * d ** 4) / 64,
      T = 4 * L * L * mu * 810 ** 2 - (Math.PI ** 2 * B) / (L * L),
      s = { key: 78, ns: 1, L, d, dc: d, wound: false, mu, B, T },
      rate = (n: number) => {
        const f =
          n *
          810 *
          Math.sqrt((1 + ((Math.PI ** 2 * B) / (T * L * L)) * n * n) / (1 + (Math.PI ** 2 * B) / (T * L * L)));
        return etaOf(s, n, f) * Math.PI * f;
      };
    for (const [n, a] of [
      [1, 0.43],
      [4, 1.12],
      [5, 1.97],
    ] as const) {
      expect(rate(n)).toBeLessThan(2 * a);
      expect(rate(n)).toBeGreaterThan(a / 2);
    }
  });
});

describe('音', () => {
  it('打つと音が出て減衰し、鍵を離すとダンパーで速く消える', () => {
    const held = play(60, 3, 3),
      rel = play(60, 3, 3, 0.5);
    expect(held.every(Number.isFinite)).toBe(true);
    expect(rms(held, 0, 0.1)).toBeGreaterThan(1e-3);
    expect(rms(held, 2.5, 3)).toBeLessThan(rms(held, 0, 0.5));
    expect(rms(rel, 2.5, 3)).toBeLessThan(rms(held, 2.5, 3) / 30);
  });
  it('ペダルを踏んでいれば、鍵を離しても鳴り続ける', () => {
    const rel = play(48, 3, 2.5, 0.3, false),
      ped = play(48, 3, 2.5, 0.3, true);
    expect(rms(ped, 2, 2.5)).toBeGreaterThan(10 * rms(rel, 2, 2.5));
  });
  it('ダンパーのない高音は、鍵を離しても鳴り続ける', () => {
    const k = NO_DAMPER + 2,
      held = play(k, 3, 1.5),
      rel = play(k, 3, 1.5, 0.2);
    expect(rms(rel, 1, 1.5)).toBeCloseTo(rms(held, 1, 1.5), 6);
  });
  it('何も打たなければ無音、すべて止めると消える', () => {
    const e = new Engine(FS),
      y = new Float32Array(FS);
    e.setBoard(boardDesc(P.board));
    for (let i = 0; i < 1024; i += 128) e.render(y, i, 128);
    expect(y.subarray(0, 1024).every((v) => v === 0)).toBe(true);
    e.strike(strikeKey(P, { key: 50, v: 4, soft: false, free: () => false }, FS).msg);
    for (let i = 0; i < 4800; i += 128) e.render(y, i, 128);
    e.stopAll(0.005);
    for (let i = 0; i < y.length; i += 128) e.render(y, i, Math.min(128, y.length - i));
    expect(rms(y, 0.5, 1)).toBeLessThan(1e-6);
  });
  it('ステレオの定位は再生だけに効き、モノラルの音は変わらない', () => {
    const msg = strikeKey(P, { key: 30, v: 3, soft: false, free: () => false }, FS).msg,
      run = (stereo: boolean, pan: number) => {
        const e = new Engine(FS, stereo),
          l = new Float32Array(FS / 2),
          r = new Float32Array(FS / 2);
        e.setBoard(boardDesc(P.board));
        e.strike({ ...msg, att: msg.att.slice() }, pan);
        for (let i = 0; i < l.length; i += 128) e.render(l, i, 128, r);
        return [l, r];
      };
    expect(run(false, -0.8)[0]).toEqual(run(false, 0.5)[0]);
    const [l, r] = run(true, -0.6);
    expect(rms(l, 0, 0.5)).toBeGreaterThan(1.3 * rms(r, 0, 0.5));
  });
});

describe('曲の強さとペダル', () => {
  it('和音の最も高い右手の音を強く、間の音を弱くする', () => {
    const k = voicing([
      { t: 0, d: 1, n: 48, h: 1 },
      { t: 0, d: 1, n: 60, h: 0 },
      { t: 0, d: 1, n: 64, h: 0 },
      { t: 0, d: 1, n: 67, h: 0 },
    ]);
    expect(k[3]).toBeGreaterThan(k[1]);
    expect(k[0]).toBeGreaterThan(k[2]);
  });
  it('低音の音名が変わる拍で踏みかえる', () => {
    const pts = pedalPoints([
      { t: 0, d: 4, n: 36, h: 1 },
      { t: 0, d: 1, n: 60, h: 0 },
      { t: 1, d: 1, n: 64, h: 0 },
      { t: 4, d: 4, n: 43, h: 1 },
      { t: 8, d: 4, n: 43, h: 1 },
      { t: 12, d: 4, n: 41, h: 1 },
    ]);
    expect(pts).toEqual([0, 4, 12]);
  });
  it('単位: 速さ m/s・セント', () => {
    expect(parse('2.5m/s', 'm/s')).toBe(2.5);
    expect(parse('1.5セント', 'セント')).toBe(1.5);
    expect(parse('2cents', 'セント')).toBe(2);
  });
  it('テンポの比の表: 比 0.5 の区間は 2 倍の時間がかかり、拍に戻せる', () => {
    const tm = new TempoMap([
      [4, 0.5],
      [6, 1],
    ]);
    expect(tm.tau(4)).toBe(4);
    expect(tm.tau(6)).toBe(8);
    expect(tm.tau(10)).toBe(12);
    for (const b of [0, 3.5, 5, 7.25]) expect(tm.beat(tm.tau(b))).toBeCloseTo(b, 12);
  });
  it('どの曲も、鍵盤の音域に収まり、小節の長さがそろう', async () => {
    const bars: Record<string, number> = { bwv846: 35, gymno1: 78, moon1: 69, moon3: 264 };
    for (const p of PIECES) {
      const notes = await p.load(),
        end = Math.max(...notes.map((x) => x.t + x.d));
      expect(notes.length).toBeGreaterThan(400);
      for (const x of notes) {
        expect(x.n).toBeGreaterThanOrEqual(KEY_LO);
        expect(x.n).toBeLessThanOrEqual(KEY_HI);
        expect(x.d).toBeGreaterThan(0);
        expect([0, 1]).toContain(x.h);
      }
      if (bars[p.v]) expect(Math.ceil((end - p.pickup) / p.bar - 1e-9)).toBe(bars[p.v]);
    }
  });
});
