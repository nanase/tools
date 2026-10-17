import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readLy } from '../scripts/score-ly';
import { PIECES, pieceOf } from '../src/tools/trumpet/score';
import { loadScore } from '../src/tools/trumpet/scores/load';
import { decodeVoice } from '../src/tools/trumpet/scores/types';

/** ページで使う B♭ 管の音域（実音 E3〜D6） */
const LO = 52,
  HI = 86;

describe('楽譜（LilyPond）', () => {
  it('イタリア語の音名・絶対音高・全休符・アクセントとテヌートを読み、休符のフェルマータは前の音に付けない', () => {
    const src = "m = { \\partial 4 re'8. re'16-. | fad'4-> r8 sol''8-- R2.*2 | la'4 r4\\fermata }";
    const ns = readLy(src, 'm', [], 'chain', { lang: 'it', absolute: true });
    expect(ns.map((x) => x.n[0])).toEqual([62, 62, 66, 79, 69]);
    expect(ns.map((x) => x.t)).toEqual([-1, -0.25, 0, 1.5, 8]);
    expect(ns[1].stacc).toBe(true);
    expect(ns[2].accent).toBe(true);
    expect(ns[3].tenuto).toBe(true);
    expect(ns[4].fermata).toBe(false);
  });
  it('カタルーニャ語の音名と、\\markup の中の強弱を読む', () => {
    const src = "m = \\relative do'' { sib16-.^\\markup {\\dynamic p \\italic grazioso} do mib( re) }";
    const ns = readLy(src, 'm', [], 'chain', { lang: 'it' });
    expect(ns.map((x) => x.n[0])).toEqual([70, 72, 75, 74]);
    expect(ns[0].dyn).toBe('p');
  });
  it('データの文字列を戻せる（アーティキュレーションと強弱を含む）', () => {
    const [a, b] = decodeVoice(`0,480,${1 + 16 + 6 * 64 + 1024 + 2048 + 4096},70 480,960,10,65`);
    expect(a).toMatchObject({ t: 0, d: 0.5, n: 70, slurOn: true, hair: '<', dyn: 'f' });
    expect(a).toMatchObject({ stacc: true, accent: true, tenuto: true });
    expect(b).toMatchObject({ t: 0.5, d: 1, n: 65, slurOff: true, fermata: true, stacc: false });
    expect(b.dyn).toBeUndefined();
  });
  it('元の .ly から作り直すと、データと同じ音になる（ナポリの踊り）', async () => {
    const src = readFileSync(new URL('../src/tools/trumpet/scores/napolitaine.ly', import.meta.url), 'utf8'),
      ns = readLy(src, 'trompette', [], 'chain', { lang: 'it' }).filter((x) => x.d > 0),
      d = await loadScore(pieceOf('napolitaine').file);
    expect(d.voices[0].map((x) => x.n)).toEqual(ns.map((x) => x.n[0]));
    /* 最初の 1 小節（2 拍）の休みを除いている */
    expect(d.voices[0][0].t).toBeCloseTo(ns[0].t - 2);
  });
});

describe('曲', () => {
  it('ラ・レジュイサンスが最初、消灯ラッパが最後', () => {
    expect(PIECES[0].v).toBe('rejouissance');
    expect(PIECES.at(-1)?.v).toBe('taps');
    expect(new Set(PIECES.map((p) => p.v)).size).toBe(PIECES.length);
  });
  it('どの曲も読み込め、音は時刻の順に重ならず、B♭ 管の音域に収まる', async () => {
    for (const p of PIECES) {
      const d = await loadScore(p.file);
      expect(d.voices.length).toBe(1);
      const ns = d.voices[0];
      expect(ns.length).toBeGreaterThan(20);
      for (let i = 0; i < ns.length; i++) {
        expect(ns[i].d).toBeGreaterThan(0);
        expect(ns[i].n).toBeGreaterThanOrEqual(LO);
        expect(ns[i].n).toBeLessThanOrEqual(HI);
        if (i > 0) expect(ns[i].t).toBeGreaterThanOrEqual(ns[i - 1].t + ns[i - 1].d - 1e-9);
      }
      /* 小節線は増えていき、最初の音と最後の音の間にあり、拍子の間隔 */
      const end = ns[ns.length - 1].t + ns[ns.length - 1].d;
      expect(d.bars.length).toBeGreaterThan(5);
      expect(d.bars[0]).toBeGreaterThan(ns[0].t);
      expect(d.bars[d.bars.length - 1]).toBeLessThan(end);
      for (let i = 1; i < d.bars.length; i++) expect(d.bars[i] - d.bars[i - 1]).toBeCloseTo(p.meter);
      /* 強弱は楽譜の記号か予定のどちらか */
      expect(Boolean(p.marks) !== Boolean(p.plan)).toBe(true);
      if (p.marks) expect(ns.some((x) => x.dyn)).toBe(true);
      expect(p.license === 'pd' || p.mutopia !== undefined).toBe(true);
    }
  });
});
