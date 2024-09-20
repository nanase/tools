import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

const root = resolve(__dirname);
const srcDir = resolve(root, 'src');

export default defineConfig({
  root: srcDir,
  base: '/tools/',
  publicDir: resolve(root, 'public'),
  envDir: root,
  resolve: {
    alias: [{ find: '@', replacement: srcDir }],
  },
  test: {
    root,
    include: ['test/**/*.test.ts'],
    globals: true,
    coverage: {
      reporter: ['text', 'json'],
      include: ['src/**/*.{ts,vue}'],
      exclude: ['**/index.ts'],
    },
    server: {
      deps: {
        inline: ['vuetify'],
      },
    },
  },
});
