import vue from '@astrojs/vue';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://nanase.cc',
  base: '/tools/',
  outDir: 'docs',

  integrations: [vue()],

  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@': '/src',
      },
    },
    optimizeDeps: {
      entries: ['src/pages/**/*.astro', 'src/layouts/**/*.astro'],
    },
  },
});
