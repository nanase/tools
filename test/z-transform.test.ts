import { describe, expect, it } from 'vitest';
import { ART } from '../src/lib/card-art';
import { chaptersHtml } from '../src/tools/z-transform/chapters';

const html = chaptersHtml();
const ids = [...html.matchAll(/<section class="ch" id="(q\d)">/g)].map((m) => m[1]);
/** 章ごとの HTML（次の章の手前まで） */
const chapter = (id: string): string => {
  const i = html.indexOf(`<section class="ch" id="${id}">`);
  return html.slice(i, html.indexOf('</section>', i));
};

describe('章', () => {
  it('問い 1〜8 が順に並ぶ', () => {
    expect(ids).toEqual(['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8']);
    ids.forEach((id, i) => {
      expect(chapter(id)).toContain(`問い ${i + 1}</span>`);
    });
  });

  it('どの章にも部の小見出し・式・まとめがある', () => {
    for (const id of ids) {
      const c = chapter(id);
      expect(c, id).toContain('class="eyebrow"');
      expect(c, id).toContain('<math');
      expect(c, id).toContain('class="take"');
      expect(c, id).toContain(`class="live" id="${id}t"`);
    }
  });

  it('本文の文は「です・ます」調', () => {
    const prose = [...html.matchAll(/<(?:p class="take"|span class="zn")>([\s\S]*?)<\/(?:p|span)>/g)].map((m) =>
      m[1].replace(/<a class="rf"[^>]*>\[\d+\]<\/a>/g, '').replace(/<[^>]+>/g, ''),
    );
    expect(prose).toHaveLength(16);
    for (const s of prose) expect(s, s).toMatch(/(です|ます|ません|ました)。$/);
  });

  it('式は括弧を伸ばさず、式の間の空きで分けている', () => {
    expect(html).not.toMatch(/<mo>[()[\]|]<\/mo>/);
    expect(html).not.toMatch(/<mspace width="(1\.2em|1\.4em|1em)"\/>/);
  });
});

describe('問いのナビゲーション', () => {
  it('一覧に 8 問のリンクと表示の切り替えがある', () => {
    const nav = html.slice(html.indexOf('<nav class="qnav"'));
    expect([...nav.matchAll(/data-q="(q\d)"/g)].map((m) => m[1])).toEqual(ids);
    expect(nav).toContain('data-view="one"');
    expect(nav).toContain('data-view="all"');
    expect(nav).toContain('aria-live="polite"');
  });
});

describe('カードの図柄', () => {
  it('止まっているときは点の列を描き終えた絵', () => {
    expect(ART.zt(0).match(/class="fa"/g)).toHaveLength(40);
  });

  it('乗せた直後は 1 点から始まる', () => {
    expect(ART.zt(0.01).match(/class="fa"/g)).toHaveLength(2);
  });
});

describe('出典', () => {
  const cited = [...new Set([...html.matchAll(/class="rf" href="#ref-(\d+)"/g)].map((m) => Number(m[1])))].sort(
    (a, b) => a - b,
  );
  const listed = [...html.matchAll(/<li id="ref-(\d+)">/g)].map((m) => Number(m[1]));

  it('本文の番号はどれも一覧にあり、一覧の項目はどれも本文で使う', () => {
    expect(cited.length).toBeGreaterThan(0);
    expect(cited).toEqual(listed);
  });

  it('一覧は最後の章が閉じたあと、ナビゲーションの前にある（1 問ずつのときも隠れない）', () => {
    const at = html.indexOf('<section class="pnl crefs"');
    expect(html.indexOf('</section>', html.lastIndexOf('<section class="ch"'))).toBeLessThan(at);
    expect(at).toBeLessThan(html.indexOf('<nav class="qnav"'));
  });
});
