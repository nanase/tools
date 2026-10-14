import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readLy } from '../scripts/score-ly';
import { parse } from '../src/lib/parse';
import { BODY_DEFAULT, makeBody, radiation, yTop } from '../src/tools/violin/body';
import { bowAngle, levelAngle } from '../src/tools/violin/figure';
import { LEVELS, levelOf } from '../src/tools/violin/params';
import { chordStrings, keyAlt, OPEN, planFromMarks, stringOf, upperNeighbor } from '../src/tools/violin/perform';
import { HAIR, ViolinPlayer } from '../src/tools/violin/player';
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
        expect(s.k).toBeGreaterThanOrEqual(0.7 - 1e-9);
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
