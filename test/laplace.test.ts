import { describe, expect, it } from 'vitest';
import { chaptersHtml } from '../src/tools/laplace/chapters';
import { areaAll, areaCum, C, gain, H, h, reWave, snap } from '../src/tools/laplace/math';

const html = chaptersHtml();
const ids = [...html.matchAll(/<section class="ch" id="(q\d)">/g)].map((m) => m[1]);
/** 章ごとの HTML（次の章の手前まで） */
const chapter = (id: string): string => {
  const i = html.indexOf(`<section class="ch" id="${id}">`);
  return html.slice(i, html.indexOf('</section>', i));
};

describe('章（z 変換のページと同じ形）', () => {
  it('問い 1〜6 が順に並ぶ', () => {
    expect(ids).toEqual(['q1', 'q2', 'q3', 'q4', 'q5', 'q6']);
    ids.forEach((id, i) => {
      expect(chapter(id)).toContain(`問い ${i + 1}</span>`);
    });
  });

  it('どの章にも部の小見出し・今の値の文・式・まとめがある', () => {
    for (const id of ids) {
      const c = chapter(id);
      expect(c, id).toContain('class="eyebrow"');
      expect(c, id).toContain(`id="${id}t"`);
      expect(c, id).toContain('<math');
      expect(c, id).toContain('class="take"');
    }
  });

  it('本文の文は「です・ます」調', () => {
    const prose = [...html.matchAll(/<(?:p class="take"|span class="zn")>([\s\S]*?)<\/(?:p|span)>/g)].map((m) =>
      m[1].replace(/<[^>]+>/g, ''),
    );
    expect(prose).toHaveLength(12);
    for (const s of prose) expect(s, s).toMatch(/(です|ます|ません|ました)。$/);
  });

  it('一覧に 6 問のリンクと表示の切り替えがある', () => {
    const nav = html.slice(html.indexOf('<nav class="qnav"'));
    expect([...nav.matchAll(/data-q="(q\d)"/g)].map((m) => m[1])).toEqual(ids);
    expect(nav).toContain('data-view="all"');
  });
});

describe('伝達関数とインパルス応答', () => {
  const s = [-0.3, 2 * Math.PI] as const;

  it('ω = 0 で |H| = 1', () => {
    expect(C.abs(H(s, [0, 0]))).toBeCloseTo(1, 12);
  });

  it('極の真上で |H| は限りなく大きい', () => {
    expect(C.abs(H(s, [-0.3 + 1e-6, 2 * Math.PI]))).toBeGreaterThan(1e5);
  });

  it('h(t) を数値でラプラス変換すると H(s) になる', () => {
    // 収束域の中の点 x で ∫ h(t) e^{-xt} dt を台形で足す
    const x = [0.2, 1.5] as const,
      T = 80,
      n = 400000;
    let re = 0,
      im = 0;
    for (let i = 0; i <= n; i++) {
      const t = (T * i) / n,
        w = i === 0 || i === n ? 0.5 : 1,
        v = h(s, t) * Math.exp(-x[0] * t) * (T / n) * w;
      re += v * Math.cos(x[1] * t);
      im -= v * Math.sin(x[1] * t);
    }
    const want = H(s, x);
    expect(re).toBeCloseTo(want[0], 4);
    expect(im).toBeCloseTo(want[1], 4);
  });

  it('ω = 0 では重根の g t e^{σt}', () => {
    const r = [-0.5, 0] as const;
    expect(h(r, 2)).toBeCloseTo(gain(r) * 2 * Math.exp(-1), 12);
  });

  it('1 章の波は e^{σt} cos ωt', () => {
    expect(reWave(s, 0.25)).toBeCloseTo(Math.exp(-0.075) * Math.cos(Math.PI / 2), 12);
  });
});

describe('|h(t)| の面積', () => {
  it('極が左半分なら有限で、10 秒までの面積より大きい', () => {
    const s = [-0.3, 2 * Math.PI] as const,
      A = areaAll(s);
    expect(Number.isFinite(A)).toBe(true);
    expect(A).toBeGreaterThan(areaCum(s, 10, 1000)[1000]);
  });

  it('極が虚軸の上か右半分なら無限', () => {
    expect(areaAll([0, 3])).toBe(Infinity);
    expect(areaAll([0.2, 3])).toBe(Infinity);
  });
});

describe('点の吸い付け', () => {
  it('軸の近くは軸の上へ', () => {
    expect(snap(0.04, 0.2)).toEqual([0, 0]);
  });

  it('範囲の外は端で止める', () => {
    const [a, b] = snap(5, -20);
    expect(a).toBeLessThan(2);
    expect(b).toBeGreaterThan(-10);
  });
});
