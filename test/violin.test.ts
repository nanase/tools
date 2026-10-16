import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readLy } from '../scripts/score-ly';
import { parse } from '../src/lib/parse';
import { BODY_DEFAULT, makeBody, radiation, yTop } from '../src/tools/violin/body';
import { bowAngle, levelAngle } from '../src/tools/violin/figure';
import { LEVELS, levelOf } from '../src/tools/violin/params';
import { chordStrings, keyAlt, OPEN, planFromMarks, stringOf, upperNeighbor } from '../src/tools/violin/perform';
import { HAIR, type PNote, touchSpan, untangle, ViolinPlayer } from '../src/tools/violin/player';
import { barOf, PIECES, performPiece, pieceOf } from '../src/tools/violin/score';
import { loadScore } from '../src/tools/violin/scores/load';
import { decodeVoice } from '../src/tools/violin/scores/types';

const FS = 48000;
const rms = (y: Float32Array) => Math.sqrt(y.reduce((s, v) => s + v * v, 0) / y.length);

describe('楽譜（LilyPond）', () => {
  it('相対音高・長さ・付点・タイ・スラー・3 連符を読む', () => {
    const src = "m = \\relative c'' { a4 b8.( c16) d4~ d8 \\times 2/3 { e8 f g } | <a, e' a>2 r2 }";
    const ns = readLy(src, 'm');
    expect(ns.map((x) => x.n[0])).toEqual([69, 71, 72, 74, 76, 77, 79, 69]);
    expect(ns[1].d).toBeCloseTo(0.75);
    expect(ns[1].slurOn).toBe(true);
    expect(ns[2].slurOff).toBe(true);
    /* タイでつながった音は 1 つ（4 分音符 + 8 分音符） */
    expect(ns[3].d).toBeCloseTo(1.5);
    expect(ns[4].d).toBeCloseTo(1 / 3);
    expect(ns[7].n).toEqual([69, 76, 81]);
  });
  it('曲のデータは、どの曲も声部と小節線を持ち、音はヴァイオリンの音域', async () => {
    for (const p of PIECES) {
      const d = await loadScore(p.file);
      expect(d.voices.length).toBeGreaterThan(0);
      expect(d.bars.length).toBeGreaterThan(10);
      const ns = d.voices.flat().flatMap((x) => x.n);
      /* G3 より低い音は、楽譜の誤りと思われる 1 音（アダージョ）だけ */
      expect(ns.filter((n) => n < 55).length).toBeLessThanOrEqual(1);
      expect(Math.max(...ns)).toBeLessThan(100);
      expect(barOf(d, d.bars[0] + 1e-3)).toBe(2);
    }
  });
  it('データの文字列を戻せる（強弱と松葉を含む）', () => {
    const ns = decodeVoice('0,480,65,62 480,960,160,64,69');
    expect(ns[0]).toMatchObject({ t: 0, d: 0.5, n: [62], slurOn: true, dyn: 'ppp' });
    expect(ns[1]).toMatchObject({ t: 0.5, d: 1, n: [64, 69], hair: '>', dyn: 'pp' });
  });
  it('元の .ly から作り直すと、データと同じ音になる（サラバンド）', async () => {
    const src = readFileSync(new URL('../src/tools/violin/scores/bwv1004-3.ly', import.meta.url), 'utf8'),
      ns = readLy(src, 'sarabanda').filter((x) => x.d > 0),
      d = await loadScore(pieceOf('sarabanda').file);
    expect(d.voices[0].length).toBe(ns.length);
    expect(d.voices[0].map((x) => x.n.join())).toEqual(ns.map((x) => x.n.join()));
  });
});

describe('演奏の規則', () => {
  it('弦の割り当て: 単音は低いポジション、和音は隣り合う弦', () => {
    expect(stringOf(55)).toBe(3);
    expect(stringOf(76)).toBe(0);
    expect(chordStrings([55, 62, 70])).toEqual([3, 2, 1]);
    /* 同じ弦にしか置けない 2 音は重音にできない */
    expect(chordStrings([55, 56])).toBeNull();
    /* 間の弦をとばして弾けないので、G4 と E5 は D 線の開放でなく D 線と A 線で弾く */
    expect(chordStrings([67, 76])).toEqual([2, 1]);
    /* 隣り合う弦に置けない 2 音は重音にできない */
    expect(chordStrings([66, 80])).toBeNull();
  });
  it('間の弦をとばした 2 本の弦には、同時に弓が触れない（どの曲も）', async () => {
    for (const p of PIECES) {
      const ns: PNote[] = performPiece(p, await loadScore(p.file), 'phrase', 1)
        .notes.map((x) => ({ ...x, c0: x.t, c1: x.t + x.d }))
        .sort((a, b) => a.t - b.t);
      untangle(ns);
      for (let j = 0; j < ns.length; j++)
        for (let i = j - 1; i >= Math.max(0, j - 64); i--) {
          if (Math.abs(ns[i].si - ns[j].si) < 2) continue;
          const [a0, a1] = touchSpan(ns[i]),
            [b0, b1] = touchSpan(ns[j]);
          expect(Math.min(a1, b1) - Math.max(a0, b0)).toBeLessThanOrEqual(1e-9);
        }
    }
  });
  it('トリルの上の音は調号に合わせる', () => {
    expect(upperNeighbor(69, keyAlt(1))).toBe(70);
    expect(upperNeighbor(69, keyAlt(-2))).toBe(71);
  });
  it('強弱の記号から予定の折れ線を作る', () => {
    const plan = planFromMarks(decodeVoice('0,960,192,62 960,960,16,64 960,960,384,65'));
    expect(plan.at(-1)?.[1]).toBe(5);
    expect(plan.some(([, v]) => v === -7)).toBe(true);
  });
  it('どの曲も、弦の範囲に収まる音を作る', async () => {
    for (const p of PIECES) {
      const perf = performPiece(p, await loadScore(p.file), 'phrase', 1);
      expect(perf.notes.length).toBeGreaterThan(50);
      for (const r of perf.notes) {
        expect(r.si).toBeGreaterThanOrEqual(0);
        expect(r.si).toBeLessThanOrEqual(3);
        expect(r.n).toBeGreaterThanOrEqual(OPEN[r.si]);
        expect(r.d).toBeGreaterThan(0);
      }
      expect(perf.end).toBeGreaterThan(30);
    }
  });
  it('楽譜どおりは、テンポの揺れがなく標準のテンポで進む', async () => {
    const p = pieceOf('sarabanda'),
      perf = performPiece(p, await loadScore(p.file), 'plain', 1);
    expect(perf.sec(24) - perf.sec(12)).toBeCloseTo((12 * 60) / p.qpm, 6);
  });
});

describe('胴', () => {
  it('シグネチャモードの近くでアドミタンスが大きく、弱音器で駒の山が下がる', () => {
    const b = makeBody(BODY_DEFAULT),
      m = makeBody({ ...BODY_DEFAULT, mute: 0.005 }),
      y = (bb: typeof b, f: number) => Math.hypot(yTop(bb, f).re, yTop(bb, f).im);
    expect(y(b, 541)).toBeGreaterThan(y(b, 350));
    expect(y(m, 2500)).toBeLessThan(y(b, 2500));
    const r = radiation(b, 1000, 0);
    expect(Number.isFinite(r.re) && Number.isFinite(r.im)).toBe(true);
  });
});

describe('音', () => {
  it('手で弾くと鳴り、弓を離すと弦は鳴り残ってから小さくなる', () => {
    const pl = new ViolinPlayer(FS, BODY_DEFAULT),
      L = new Float32Array(FS),
      R = new Float32Array(FS);
    pl.setManual({ strings: [1], stop: [0, 2, 0, 0], v: 0.3, F: 0.8, beta: 0.1, dir: 1 });
    let fr = pl.render(L, R, 0, 512);
    for (let i = 512; i < FS; i += 512) fr = pl.render(L, R, i, Math.min(512, FS - i));
    expect(L.every(Number.isFinite)).toBe(true);
    const on = rms(L.subarray(FS / 2));
    expect(on).toBeGreaterThan(0.01);
    expect(fr.c[1]).toBeCloseTo(1, 2);
    expect(fr.n[1]).toBeGreaterThan(70.5);
    expect(fr.pos).toBeGreaterThan(0);
    expect(fr.pos).toBeLessThanOrEqual(HAIR);
    pl.setManual({ strings: [], stop: [0, 2, 0, 0], v: 0.3, F: 0.8, beta: 0.1, dir: 1 });
    for (let i = 0; i < FS; i += 512) pl.render(L, R, i, Math.min(512, FS - i));
    expect(rms(L.subarray(FS / 2))).toBeLessThan(on / 10);
  });
  it('7 秒までのロングトーンは、途中で弓を返さずに 1 回の弓で弾き切る（どの曲も）', async () => {
    for (const p of PIECES) {
      const perf = performPiece(p, await loadScore(p.file), 'phrase', 1),
        pl = new ViolinPlayer(FS, BODY_DEFAULT);
      pl.play(perf);
      for (const x of perf.notes) {
        if (x.d > 7) continue;
        const inside = pl.strokes.filter((s) => s.t0 > x.t + 1e-3 && s.t0 < x.t + x.d - 0.1);
        /* その間に始まる音がなければ、弓を返してはいけない */
        const starts = perf.notes.some((y) => y.t > x.t + 1e-3 && y.t < x.t + x.d - 0.1);
        if (!starts) expect(inside).toEqual([]);
      }
    }
  });
  it('手で弾く弦を D 線から E 線へ変えると、D 線から弓が離れてから E 線に触れる', () => {
    const pl = new ViolinPlayer(FS, BODY_DEFAULT),
      L = new Float32Array(32),
      R = new Float32Array(32),
      m = { strings: [2], stop: [0, 0, 0, 0], v: 0.3, F: 0.8, beta: 0.1, dir: 1 };
    pl.setManual(m);
    for (let i = 0; i < FS / 4; i += 32) pl.render(L, R, 0, 32);
    pl.setManual({ ...m, strings: [0] });
    let both = 0,
      fr = pl.render(L, R, 0, 32);
    for (let i = 0; i < FS / 4; i += 32, fr = pl.render(L, R, 0, 32)) if (fr.c[0] > 0 && fr.c[2] > 0) both++;
    expect(both).toBe(0);
    expect(fr.c[0]).toBeGreaterThan(0.99);
    expect(fr.c[2]).toBe(0);
  });
  it('調弦で開放弦の音の高さが上がる（A 線を +20 セント）', () => {
    const f0 = (cent: number) => {
      const pl = new ViolinPlayer(FS, BODY_DEFAULT),
        N = FS,
        L = new Float32Array(N),
        R = new Float32Array(N);
      pl.setTune([0, cent, 0, 0]);
      pl.setManual({ strings: [1], stop: [0, 0, 0, 0], v: 0.3, F: 0.5, beta: 0.1, dir: 1 });
      for (let i = 0; i < N; i += 512) pl.render(L, R, i, Math.min(512, N - i));
      /* 自己相関の山（440 Hz の前後）を放物線で補間した周期 */
      const y = L.subarray(N / 2),
        r = (l: number) => {
          let s = 0;
          for (let i = 0; i + l < y.length; i++) s += y[i] * y[i + l];
          return s;
        };
      let bl = 90;
      for (let l = 90; l <= 130; l++) if (r(l) > r(bl)) bl = l;
      const a = r(bl - 1),
        b = r(bl),
        c = r(bl + 1);
      return FS / (bl + (0.5 * (a - c)) / (a - 2 * b + c));
    };
    /* 弓で弾いたときの音の下がりがわずかに変わるので、1.5 セントまでのずれは許す */
    expect(Math.abs(1200 * Math.log2(f0(20) / f0(0)) - 20)).toBeLessThan(1.5);
  });
  it('弓の速さの向きは、弓の端で変わる', () => {
    const pl = new ViolinPlayer(FS, BODY_DEFAULT),
      L = new Float32Array(512),
      R = new Float32Array(512),
      vs: number[] = [];
    pl.setManual({ strings: [2], stop: [0, 0, 0, 0], v: 0.5, F: 1, beta: 0.1, dir: 1 });
    for (let k = 0; k < 4 * 94; k++) vs.push(pl.render(L, R, 0, 512).vb);
    expect(vs.some((v) => v > 0.3)).toBe(true);
    expect(vs.some((v) => v < -0.3)).toBe(true);
  });
  it('曲を鳴らせる（サラバンドの初め）', async () => {
    const p = pieceOf('sarabanda'),
      perf = performPiece(p, await loadScore(p.file), 'phrase', 1),
      pl = new ViolinPlayer(FS, BODY_DEFAULT),
      N = 3 * FS,
      L = new Float32Array(N),
      R = new Float32Array(N);
    pl.play(perf);
    let beat = 0;
    for (let i = 0; i < N; i += 512) beat = pl.render(L, R, i, Math.min(512, N - i)).beat ?? 0;
    expect(L.every(Number.isFinite)).toBe(true);
    expect(rms(L.subarray(FS))).toBeGreaterThan(0.01);
    expect(beat).toBeGreaterThan(1);
  });
  it('曲の弓は毛の長さに収まり、弓を離さずに続くひと弾きは位置がつながる。和音の前では弓を離して下げ弓', async () => {
    for (const p of PIECES) {
      const pl = new ViolinPlayer(FS, BODY_DEFAULT);
      pl.play(performPiece(p, await loadScore(p.file), 'phrase', 1));
      const S = pl.strokes;
      expect(S.length).toBeGreaterThan(10);
      for (let j = 0; j < S.length; j++) {
        const s = S[j];
        for (const x of [s.p0, s.p1]) {
          expect(x).toBeGreaterThanOrEqual(0.03 - 1e-9);
          expect(x).toBeLessThanOrEqual(HAIR - 0.03 + 1e-9);
        }
        expect(Math.sign(s.p1 - s.p0)).toBe(s.p1 === s.p0 ? 0 : s.dir);
        /* 弓の長さに収まらないひと弾きは、弓速を落として 1 回の弓に収める（倍率の下限を外す） */
        if (s.vmin >= 0.22) expect(s.k).toBeGreaterThanOrEqual(0.7 - 1e-9);
        expect(s.k).toBeLessThanOrEqual(1.15 + 1e-9);
        if (j > 0 && !s.lift) {
          expect(s.t0).toBeCloseTo(S[j - 1].t1, 9);
          expect(s.p0).toBeCloseTo(S[j - 1].p1, 9);
        }
        if (j > 0 && s.lift) expect(s.t0).toBeGreaterThan(S[j - 1].t1);
        if (s.chord && s.lift) expect(s.dir).toBe(1);
      }
    }
  });
});

describe('図と入力', () => {
  it('弓の傾きは G 線から E 線へ単調に変わる', () => {
    const a = LEVELS.map((_, l) => levelAngle(l));
    for (let l = 1; l < 7; l++) expect(a[l]).toBeGreaterThan(a[l - 1]);
    expect(levelOf(0)).toBe(6);
    expect(bowAngle([0, 0, 0, 0], 0.3)).toBe(0.3);
  });
  it('β の欄は × L を読み飛ばす', () => {
    expect(parse('0.1 × L', '× L')).toBeCloseTo(0.1);
    expect(parse('0.12', '× L')).toBeCloseTo(0.12);
  });
});
