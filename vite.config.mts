import { fileURLToPath, URL } from 'node:url';
import { resolve } from 'path';
import { defineConfig } from 'vite';
import VueMacros from 'unplugin-vue-macros/vite';
import Vue from '@vitejs/plugin-vue';
import webfontDownload from 'vite-plugin-webfont-dl';
import injectHTML from 'vite-plugin-html-inject';

const root = resolve(__dirname, 'src');
const outDir = resolve(__dirname, 'docs');

// https://vitejs.dev/config/
export default defineConfig({
  root,
  base: '/tools/',
  publicDir: '../public',
  envDir: '../',
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
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  css: {
    devSourcemap: true,
  },
  build: {
    outDir,
    rollupOptions: {
      input: {
        '': resolve(root, 'index.html'),
        'control/pid': resolve(root, 'control', 'pid.html'),
        'electric/timer555': resolve(root, 'electric', 'timer555.html'),
        'electric/combination': resolve(root, 'electric', 'combination.html'),
        'filter/biquad': resolve(root, 'filter', 'biquad.html'),
        'jjy/simulator': resolve(root, 'jjy', 'simulator.html'),
        'svg/theme-checker': resolve(root, 'svg', 'theme-checker.html'),
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
