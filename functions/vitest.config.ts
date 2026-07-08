import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // lib/ is tsc build output; without this vitest also collects the
    // compiled *.test.js copies there and fails to require() them.
    exclude: ['**/node_modules/**', 'lib/**'],
  },
});
