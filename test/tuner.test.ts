import { describe, expect, it } from 'vitest';
import { BODY_TYPES, makeBody } from '../src/tools/guitar/body';
import { bodyDesc, Engine } from '../src/tools/guitar/engine';
import { type Guitar, modesOf, pluckOf, tuneCoupled } from '../src/tools/guitar/model';
import { noteHz, setOf, stringPhys, tensionFor, tuningOf } from '../src/tools/guitar/strings';
import { mpm, nsdf, partial } from '../src/tools/tuner/mpm';
import {
  centsOf,
  hzOf,
  INSTRUMENTS,
  instrumentOf,
  midiOf,
  nearestNote,
  nearestString,
  noteLabel,
  noteText,
} from '../src/tools/tuner/notes';
import { deviations, JUST_M3, JUST_m3, TEMPERAMENTS } from '../src/tools/tuner/params';
import { type Est, estimate, HighPass, mpmWin, Onset, refWin, Tracker } from '../src/tools/tuner/tracker';
import { bandHz, bandOf, contrast, meterTicks, needlePath, stripes } from '../src/tools/tuner/view';

const FS = 48000;
let seed = 1;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
/**
 * 部分音 amps（k 番目が k 倍音の振幅）の音。B は弦の非調和性（第 k 部分音 = k·f·√(1+Bk²)/√(1+B)。第 1 部分音が f）、
 * snr は全帯域の白色雑音に対する比 [dB]
 */
function tone(f: number, n: number, amps: readonly number[], B = 0, snr = Number.POSITIVE_INFINITY): Float64Array {
  const x = new Float64Array(n);
  amps.forEach((a, i) => {
    const k = i + 1,
      fk = (k * f * Math.sqrt(1 + B * k * k)) / Math.sqrt(1 + B),
      ph = 2 * Math.PI * rnd();
    if (a && fk < FS / 2) for (let j = 0; j < n; j++) x[j] += a * Math.sin((2 * Math.PI * fk * j) / FS + ph);
  });
  if (snr < Number.POSITIVE_INFINITY) {
    let p = 0;
    for (const v of x) p += v * v;
    const s = Math.sqrt(p / n) * 10 ** (-snr / 20);
    for (let j = 0; j < n; j++) x[j] += s * gauss();
  }
  return x;
}
const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);
/** 弦らしい倍音の並び（高い部分音ほど弱い） */
const RICH = [1, 0.8, 0.6, 0.5, 0.4, 0.3, 0.25, 0.2, 0.15, 0.1];
/** 基音がほとんどない（スマホのマイクで低い弦を録ったときを想定） */
const NOFUND = [0.01, ...RICH.slice(1)];

describe('MPM', () => {
  it('正弦波の NSDF は周期で 1 に近く、半周期で −1 に近い', () => {
    const f = 480,
      x = tone(f, 2048, [1]),
      n = new Float64Array(201);
    nsdf(x, 200, n);
    expect(n[0]).toBeCloseTo(1, 9);
    expect(n[100]).toBeGreaterThan(0.99);
    expect(n[50]).toBeLessThan(-0.99);
  });
  it('正弦波は E1〜C7 で 0.05 セント以内', () => {
    for (let m = 28; m <= 96; m += 4) {
      const f = midiHz(m),
        W = mpmWin(FS, f * 0.9),
        r = mpm(tone(f, W, [1]), { fs: FS, fmin: f * 0.9, fmax: 4200 });
      expect(r).not.toBeNull();
      expect(Math.abs(centsOf(r?.f ?? 0, f)), `MIDI ${m}`).toBeLessThan(0.05);
      expect(r?.clarity).toBeGreaterThan(0.99);
    }
  });
  it('基音がなく、第 2 倍音が強くても、オクターブを誤らない', () => {
    for (const m of [28, 40, 45, 55, 69]) {
      const f = midiHz(m);
      for (const amps of [NOFUND, [0.3, 1, 0.5, 0.3, 0.2]]) {
        const r = mpm(tone(f, mpmWin(FS, 27), amps), { fs: FS, fmin: 27, fmax: 4200 });
        expect(Math.abs(centsOf(r?.f ?? 0, f)), `MIDI ${m}`).toBeLessThan(1);
      }
    }
  });
  it('白色雑音は明瞭度が低い', () => {
    const x = Float64Array.from({ length: 4096 }, gauss),
      r = mpm(x, { fs: FS, fmin: 40, fmax: 2000 });
    expect(r === null || r.clarity < 0.7).toBe(true);
  });
});

describe('位相で詰める', () => {
  it('倍音の多い音も、窓に 12 周期あれば 0.05 セント以内', () => {
    for (const m of [40, 45, 57, 69, 84, 96]) {
      const f = midiHz(m),
        W = refWin(FS, f),
        x = tone(f, W, RICH),
        r = mpm(x.subarray(W - 2048), { fs: FS, fmin: 60, fmax: 4200 }),
        p = partial(x, r?.f ?? 0, 1, FS);
      expect(Math.abs(centsOf(p.f, f)), `MIDI ${m}`).toBeLessThan(0.05);
      expect(p.a).toBeCloseTo(1, 1);
    }
  });
  it('非調和な弦でも、第 1 部分音の周波数を取り出す（MPM の周期は約 3 セント高い）', () => {
    const f = 220,
      x = tone(f, refWin(FS, f), RICH, 1e-4),
      r = mpm(x.subarray(x.length - 2048), { fs: FS, fmin: 60, fmax: 4200 });
    expect(centsOf(r?.f ?? 0, f)).toBeGreaterThan(2);
    expect(Math.abs(centsOf(partial(x, r?.f ?? 0, 1, FS).f, f))).toBeLessThan(0.05);
  });
});

describe('音名と調弦', () => {
  it('周波数と音番号', () => {
    expect(midiOf(440, 440)).toBe(69);
    expect(midiOf(442, 442)).toBe(69);
    expect(hzOf(60, 440)).toBeCloseTo(261.626, 3);
    expect(hzOf(69, 440, 100)).toBeCloseTo(466.164, 3);
    expect(centsOf(442, 440)).toBeCloseTo(7.85, 2);
  });
  it('音名の書き方', () => {
    const o = { nm: 'en', flat: false, c3: false } as const;
    expect(noteText(69, o)).toBe('A4');
    expect(noteText(61, o)).toBe('C♯4');
    expect(noteText(61, { ...o, flat: true })).toBe('D♭4');
    expect(noteText(60, { ...o, c3: true })).toBe('C3');
    expect(noteText(70, { ...o, nm: 'de', flat: true })).toBe('B4');
    expect(noteText(71, { ...o, nm: 'de' })).toBe('H4');
    expect(noteText(67, { ...o, nm: 'do' })).toBe('ソ4');
    expect(noteLabel(69, { ...o, nm: 'ja' })).toEqual({ pre: '一点', name: 'イ', oct: '' });
    expect(noteText(45, { ...o, nm: 'ja' })).toBe('大字イ');
    expect(noteText(61, { ...o, nm: 'ja' })).toBe('一点嬰ハ');
  });
  it('ギターの標準調弦は E2 A2 D3 G3 B3 E4（82.41〜329.63 Hz）、ベースの 4 弦は E1（41.20 Hz）', () => {
    const g = instrumentOf('guitar')?.tunings[0].notes ?? [];
    expect(g.map((n) => hzOf(n, 440).toFixed(2))).toEqual(['82.41', '110.00', '146.83', '196.00', '246.94', '329.63']);
    expect(hzOf(instrumentOf('bass')?.tunings[0].notes[0] ?? 0, 440).toFixed(2)).toBe('41.20');
    for (const i of INSTRUMENTS) for (const t of i.tunings) expect(t.notes.length).toBeGreaterThanOrEqual(4);
  });
  it('最も近い音は、半音の半分を越えるまで前の音を保つ', () => {
    expect(nearestNote(69.4, null)).toBe(69);
    expect(nearestNote(69.6, null)).toBe(70);
    expect(nearestNote(69.6, 69)).toBe(69);
    expect(nearestNote(69.7, 69)).toBe(70);
  });
  it('最も近い弦', () => {
    const s = [40, 45, 50, 55, 59, 64];
    expect(nearestString(44.2, s, -1)).toBe(1);
    expect(nearestString(42.4, s, -1)).toBe(0);
    expect(nearestString(42.6, s, 0)).toBe(0);
    expect(nearestString(42.9, s, 0)).toBe(1);
  });
});

/** ページと同じ流れ（高域通過 → 出だし → 推定 → 追跡）で、窓の末尾を hop ずつ進める */
function track(y0: Float32Array | Float64Array, tr: Tracker, fmin: number, hop = 960) {
  const y = Float64Array.from(y0),
    hp = new HighPass(FS),
    on = new Onset(FS),
    out: { t: number; cents: number; f: number; tgt: number }[] = [];
  let since = 0;
  for (let end = hop; end <= y.length; end += hop) {
    hp.process(y, end - hop, hop);
    on.push(y, end - hop, hop);
    if (on.since !== since) {
      since = on.since;
      tr.reset(true);
    }
    const r = tr.push(estimate(y, end, { fs: FS, fmin, fmax: 2000, maxW: 16384 }, since, tr.hint()));
    if (r) out.push({ t: end / FS, cents: r.cents, f: r.f, tgt: r.tgt });
  }
  return out;
}
const opts = (strs: readonly number[] | null = null) => ({ a4: 440, strs, fix: -1, dev: null, minClarity: 0.9 });

describe('追跡', () => {
  it('撥弦（出だしで 3 セント高く、時定数 0.3 秒で戻る）を追い、戻ったあとは ±0.5 セント以内', () => {
    const f = 110,
      y = new Float64Array(FS * 2);
    let ph = 0;
    for (let i = FS / 10; i < y.length; i++) {
      const t = (i - FS / 10) / FS,
        fi = f * 2 ** ((3 * Math.exp(-t / 0.3)) / 1200);
      ph += (2 * Math.PI * fi) / FS;
      for (let k = 1; k <= 8; k++) y[i] += (RICH[k - 1] * Math.exp(-t * (0.8 + 0.4 * k)) * Math.sin(k * ph)) / 2;
    }
    const r = track(y, new Tracker(opts([40, 45, 50, 55, 59, 64])), 70);
    expect(r.length).toBeGreaterThan(60);
    expect(r[0].t).toBeLessThan(0.45);
    for (const q of r) {
      expect(q.tgt).toBe(45);
      /* 出だし（0.1 秒）から 0.8 秒で、戻りの残りは 0.2 セント */
      if (q.t > 0.9) expect(Math.abs(q.cents), `${q.t}`).toBeLessThan(0.5);
    }
  });
  it('音が続いている間にオクターブ上へ跳んだ推定は、もとの音へ折り返す', () => {
    const tr = new Tracker(opts()),
      e = (f: number): Est => ({ f, clarity: 0.99, ps: null, ready: true });
    for (let i = 0; i < 5; i++) tr.push(e(110));
    const r = tr.push(e(220.2));
    expect(r?.tgt).toBe(45);
    expect(Math.abs(r?.cents ?? 99)).toBeLessThan(0.1);
    /* 一度途切れても、次の出だしまでは前の音へ折り返す（減衰の終わりに上のオクターブで読み直さない） */
    for (let i = 0; i < 4; i++) tr.push(null);
    for (let i = 0; i < 3; i++) tr.push(e(220));
    expect(tr.push(e(220))?.tgt).toBe(45);
    /* 新しい出だしのあとは、新しい音として受け付ける */
    tr.reset(true);
    for (let i = 0; i < 3; i++) tr.push(e(220));
    expect(tr.push(e(220))?.tgt).toBe(57);
  });
  it('直流と低い揺れが乗っていても読める（高域通過）', () => {
    const f = midiHz(52),
      y = new Float64Array(FS);
    y.set(tone(f, FS - 4800, RICH), 4800);
    for (let i = 0; i < y.length; i++) y[i] = 0.3 * y[i] + 0.5 + 0.3 * Math.sin((2 * Math.PI * 3 * i) / FS);
    const r = track(y, new Tracker(opts()), 60).filter((q) => q.t > 0.5);
    expect(r.length).toBeGreaterThan(10);
    for (const q of r) expect(Math.abs(centsOf(q.f, f))).toBeLessThan(0.5);
  });
  it('基音の弱い音でも、1 オクターブ上で読み始めない（1 オクターブ下の奇数倍の部分音を確かめる）', () => {
    const f = midiHz(40),
      y = new Float64Array(FS);
    y.set(tone(f, FS - 4800, [0.02, 1, 0.3, 0.8, 0.2, 0.5]), 4800);
    const r = track(y, new Tracker(opts()), 60);
    expect(r.length).toBeGreaterThan(10);
    for (const q of r) expect(q.tgt).toBe(40);
  });
  it('出し始めは 3 フレームそろうまで出さない（出だしの外れ値を出さない）', () => {
    const tr = new Tracker(opts()),
      e = (f: number): Est => ({ f, clarity: 0.99, ps: null, ready: true });
    expect(tr.push(e(330))).toBeNull();
    expect(tr.push(e(110))).toBeNull();
    expect(tr.push(e(110))).toBeNull();
    expect(tr.push(e(110))?.tgt).toBe(45);
  });
  it('弦を固定すると、遠い音でもその弦からのずれを出す。音律のずれを目標に足す', () => {
    const tr = new Tracker({ ...opts([40, 45, 50, 55, 59, 64]), fix: 0 }),
      e: Est = { f: 100, clarity: 0.99, ps: null, ready: true };
    let r = null;
    for (let i = 0; i < 3; i++) r = tr.push(e);
    expect(r?.si).toBe(0);
    expect(r?.cents).toBeCloseTo(100 * (midiOf(100, 440) - 40), 6);
    const dev = Array(12).fill(0);
    dev[9] = 5;
    const t2 = new Tracker({ ...opts(), dev });
    for (let i = 0; i < 3; i++) r = t2.push({ ...e, f: 440 });
    expect(r?.cents).toBeCloseTo(-5, 6);
    expect(r?.ft).toBeCloseTo(hzOf(69, 440, 5), 6);
  });
  it('基音のない雑音入りの低い音も、±1 セント以内', () => {
    const f = midiHz(40),
      y = new Float64Array(FS);
    y.set(tone(f, FS - 4800, NOFUND, 0, 20), 4800);
    const r = track(y, new Tracker(opts()), 60).filter((q) => q.t > 0.5);
    expect(r.length).toBeGreaterThan(20);
    for (const q of r) expect(Math.abs(centsOf(q.f, f))).toBeLessThan(1);
  });
});

describe('音律と純正律', () => {
  it('平均律はずれなし。A はどの音律・主音でも 0', () => {
    expect(deviations('et', 0)).toBeNull();
    for (const [v] of TEMPERAMENTS.slice(1))
      for (let ton = 0; ton < 12; ton++) expect(deviations(v, ton)?.[9], `${v} ${ton}`).toBeCloseTo(0, 9);
  });
  it('主音を変えると、音どうしの間隔が主音ごと移る（ヴェルクマイスター III の C と G）', () => {
    const c = deviations('wm3', 0) ?? [],
      g = deviations('wm3', 7) ?? [];
    expect(c[0]).toBeCloseTo(11.73, 2);
    /* 主音 G の G–D は、主音 C の C–G と同じ間隔 */
    expect(g[2] - g[7]).toBeCloseTo(c[7] - c[0], 9);
  });
  it('純正の長 3 度は −13.69 セント、短 3 度は +15.64 セント', () => {
    expect(JUST_M3).toBeCloseTo(-13.686, 3);
    expect(JUST_m3).toBeCloseTo(15.641, 3);
  });
});

describe('表示の形', () => {
  it('目盛りは ±50 で 51 本（太い 11 本）、±20 で 41 本（太い 9 本）', () => {
    const n = (s: string) => (s.match(/M/g) ?? []).length;
    expect(n(meterTicks(50).major)).toBe(11);
    expect(n(meterTicks(50).minor)).toBe(40);
    expect(n(meterTicks(20).major)).toBe(9);
    expect(n(meterTicks(20).minor)).toBe(32);
  });
  it('針は 0 で真上、端の外で止まる', () => {
    expect(needlePath(0, 50)).toBe('M300.0 196.0L300.0 47.0');
    expect(needlePath(200, 50)).toBe(needlePath(52, 50));
  });
  it('ストロボの帯の基準は、窓 A・帯 4 オクターブで A4', () => {
    expect(bandHz(9, 2, 440, null)).toBeCloseTo(440, 9);
    expect(bandHz(0, 0, 440, null)).toBeCloseTo(hzOf(36, 440), 9);
    expect(bandHz(0, 0, 440, deviations('wm3', 0))).toBeCloseTo(hzOf(36, 440, 11.73), 6);
  });
  it('帯には最も近い部分音が写る。1 オクターブ下の帯は薄く止まり、部分音のない帯はぼける', () => {
    const parts = [
      { k: 1, f: 441, a: 1 },
      { k: 2, f: 882, a: 0.5 },
      { k: 3, f: 1323, a: 0.3 },
    ];
    const a4 = bandOf(440, 441, parts, 'hz'),
      a3 = bandOf(220, 441, parts, 'hz'),
      e5 = bandOf(659.26, 441, parts, 'hz');
    const dc = (1200 * Math.log2(441 / 440)) / 40;
    expect(a4.vis).toBeCloseTo(Math.exp(-dc * dc), 9);
    expect(a4.rate).toBeCloseTo(1, 9);
    expect(a3.vis).toBeCloseTo(0.3, 1);
    expect(e5.vis).toBeLessThan(0.01);
    /* セントに比例: 3.93 セント × 0.254 本/s */
    expect(bandOf(440, 441, parts, 'cent').rate).toBeCloseTo(1200 * Math.log2(441 / 440) * 0.254, 6);
  });
  it('速く流れる縞は薄くなる', () => {
    expect(contrast(1, 0)).toBe(1);
    expect(contrast(1, 4.5)).toBeCloseTo(0.5, 9);
    expect(contrast(1, 20)).toBeCloseTo(0.1, 9);
  });
  it('縞は窓の内側（x 3〜97）に収まり、1 周で元の位置に戻る', () => {
    for (let o = 0; o < 4; o++) {
      const d = stripes(o, 0.3);
      for (const m of d.matchAll(/M([\d.]+) [\d.]+H([\d.]+)/g)) {
        expect(Number(m[1])).toBeGreaterThanOrEqual(3);
        expect(Number(m[2])).toBeLessThanOrEqual(97);
      }
      expect(stripes(o, 1.3)).toBe(d);
    }
  });
});

describe('ギターの物理モデルの音', () => {
  /** サイトのギター音響モデルで、標準調弦に合わせたスチール弦のギター（test/guitar.test.ts と同じ組み立て） */
  function steel(): Guitar {
    const set = setOf('steel'),
      notes = tuningOf('std').notes,
      t = BODY_TYPES.find((b) => b.v === 'dread'),
      g: Guitar = {
        L: set.L,
        frets: set.frets,
        str: set.strings.map((s, i) => {
          const p = stringPhys(s);
          return { ...p, T: tensionFor(p, set.L, noteHz(notes[i])) };
        }),
        body: makeBody({ type: 'dread', wood: 'spruce', h: t?.h ?? 0, V: t?.V ?? 0, dh: t?.dh ?? 0 }),
      };
    g.str = g.str.map((p, i) => ({ ...p, T: tuneCoupled(g, i, noteHz(notes[i])) }));
    return g;
  }
  it('開放弦の 6 本とも、弾いて 0.3〜1 秒の値は基音から ±1 セント以内（中央値）、外れ値なし', () => {
    const g = steel(),
      notes = tuningOf('std').notes;
    for (let si = 0; si < 6; si++) {
      const e = new Engine(FS);
      e.setBody(bodyDesc(g.body));
      const m = modesOf(g, si, 0, FS),
        pl = pluckOf(g, si, m, { pos: 0.13, amp: 1.2e-3, width: 12e-3, rel: 8e-5, angle: Math.PI / 4 }),
        y = new Float32Array(FS * 1.1);
      e.pluck({ si, N: m.N, w: m.w, s: m.s, f: pl.f });
      for (let i = FS / 10; i < y.length; i += 128) e.render(y, i, 128);
      const f1 = m.w[0] / (2 * Math.PI),
        r = track(y, new Tracker(opts(notes)), 70).filter((q) => q.t > 0.4),
        c = r.map((q) => centsOf(q.f, f1)).sort((a, b) => a - b);
      expect(r.length, `${si}`).toBeGreaterThan(30);
      for (const q of r) expect(q.tgt, `${si}`).toBe(notes[si]);
      expect(Math.abs(c[c.length >> 1]), `${si}`).toBeLessThan(1);
      expect(Math.max(-c[0], c[c.length - 1]), `${si}`).toBeLessThan(3);
    }
  });
});
