import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/* LED 付きの切り替えは共通の部品（components/LedToggle.astro）で作り、文字は機能の名前で固定する。design/page.md */
const SRC = new URL('../../src/', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, SRC), 'utf8');
const walk = (dir: string, ext: RegExp): string[] =>
  readdirSync(new URL(dir, SRC), { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(`${dir}${d.name}/`, ext) : ext.test(d.name) ? [`${dir}${d.name}`] : [],
  );
const astro = ['pages/', 'tools/', 'components/'].flatMap((d) => walk(d, /\.astro$/));

/** 図の上に重ねる暗いボタン（配色がページ独自）とオルガンのストップは部品にしない */
const OWN = /\b(mb-tg|pm-tg|chip stop)\b/;

describe('LED 付きの切り替え', () => {
  it('LED 付きのボタンは LedToggle で作る', () => {
    const bad = astro
      .filter((f) => f !== 'components/LedToggle.astro')
      .flatMap((f) =>
        [...read(f).matchAll(/<button\b([^>]*)>\s*<span class="led\b/g)]
          .filter((m) => !OWN.test(m[1]))
          .map((m) => `${f}: ${m[1].match(/id="([^"]*)"/)?.[1] ?? m[1].trim()}`),
      );
    expect(bad).toEqual([]);
  });
});
