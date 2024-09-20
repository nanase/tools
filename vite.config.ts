import { resolve } from 'path';
import { defineConfig } from 'vite';
import VueMacros from 'unplugin-vue-macros/vite';
import Vue from '@vitejs/plugin-vue';
import webfontDownload from 'vite-plugin-webfont-dl';
import injectHTML from 'vite-plugin-html-inject';

const root = resolve(__dirname);
const srcDir = resolve(root, 'src');

// https://vitejs.dev/config/
export default defineConfig({
  root: srcDir,
  base: '/tools/',
  publicDir: resolve(root, 'public'),
  envDir: root,
  plugins: [
    VueMacros({
      plugins: {
        vue: Vue({
          script: {
            defineModel: true,
          },
          features: {
            propsDestructure: true,
          },
        }),
      },
    }),
    webfontDownload(),
    injectHTML(),
  ],
  resolve: {
    alias: [{ find: '@', replacement: srcDir }],
  },
  css: {
    devSourcemap: true,
  },
  build: {
    outDir: resolve(root, 'docs'),
    rollupOptions: {
      input: {
        '': resolve(srcDir, 'index.html'),
        'control/pid': resolve(srcDir, 'control', 'pid.html'),
        'electric/timer555': resolve(srcDir, 'electric', 'timer555.html'),
        'electric/combination': resolve(srcDir, 'electric', 'combination.html'),
        'filter/biquad': resolve(srcDir, 'filter', 'biquad.html'),
        'jjy/simulator': resolve(srcDir, 'jjy', 'simulator.html'),
        'svg/theme-checker': resolve(srcDir, 'svg', 'theme-checker.html'),
      },
      output: {
        chunkFileNames: 'assets/tools-[name]-[hash].js',
      },
    },
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    fs: {
      cachedChecks: false,
    },
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
});
