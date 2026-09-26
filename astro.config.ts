import { defineConfig } from 'astro/config';
import { BASE, ORIGIN } from './src/data/redirects';

export default defineConfig({
  site: ORIGIN,
  base: BASE,
  // GitHub Pages が main ブランチの docs/ を配信している
  outDir: 'docs',
  trailingSlash: 'always',
  devToolbar: { enabled: false },
});
