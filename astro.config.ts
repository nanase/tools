import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';
import { BASE, ORIGIN } from './src/data/redirects';

export default defineConfig({
  site: ORIGIN,
  base: BASE,
  trailingSlash: 'always',
  devToolbar: { enabled: false },
  /* サイトマップ（/tools/sitemap-index.xml）。旧 URL の転送ページ（.html）は載せない */
  integrations: [sitemap({ filter: (page) => !page.endsWith('.html') })],
});
