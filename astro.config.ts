import { defineConfig } from 'astro/config';
import { BASE, ORIGIN } from './src/data/redirects';

export default defineConfig({
  site: ORIGIN,
  base: BASE,
  trailingSlash: 'always',
  devToolbar: { enabled: false },
});
