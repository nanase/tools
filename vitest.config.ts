import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    /* 計算の重い試験は、全体を並列に動かすと既定の 5 秒を超えることがある */
    testTimeout: 30000,
  },
});
