import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';
import { devLifetime } from './scripts/dev-lifetime';
import { BASE, ORIGIN } from './src/data/redirects';

export default defineConfig({
  site: ORIGIN,
  base: BASE,
  trailingSlash: 'always',
  devToolbar: { enabled: false },
  /* サイトマップ（/tools/sitemap-index.xml）。旧 URL の転送ページ（.html）は載せない。
     devLifetime は開発サーバが取り残されないよう、起動した端末が終わるか使われなくなったら止める */
  integrations: [sitemap({ filter: (page) => !page.endsWith('.html') }), devLifetime()],
});
