import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/* しくみの枠は共通の部品（components/HowSteps.astro）と CSS（styles/how.css）で組む。design/page.md の「しくみの枠」 */
const SRC = new URL('../../src/', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, SRC), 'utf8');
const pages = readdirSync(new URL('pages/', SRC)).filter((f) => f.endsWith('.astro'));
const toolCss = readdirSync(new URL('tools/', SRC), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) =>
    readdirSync(new URL(`tools/${d.name}/`, SRC))
      .filter((f) => f.endsWith('.css'))
      .map((f) => `tools/${d.name}/${f}`),
  );

describe('しくみの枠', () => {
  it('題名はどのページも「しくみ」', () => {
    const bad = pages.filter((f) => {
      const m = read(`pages/${f}`).match(/hid="hd-how"\s+title="([^"]*)"/);
      return m && m[1] !== 'しくみ';
    });
    expect(bad).toEqual([]);
  });

  it('番号の丸はページごとの CSS に書かない', () => {
    const badge = 'border-radius:50%;background:var(--ink);color:var(--surface)';
    expect(toolCss.filter((f) => read(f).includes(badge))).toEqual([]);
  });

  it('工程の枠のスタイルをページごとの CSS に書かない', () => {
    const own = /\.[a-z0-9]+-(how|st) (h3|li)\b|\.[a-z0-9]+-hw>b|\.(mp3|pcm)-st\b/;
    expect(toolCss.filter((f) => own.test(read(f)))).toEqual([]);
  });
});
