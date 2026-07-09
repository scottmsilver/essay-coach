import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // lib/ is tsc build output; without this vitest also collects the
    // compiled *.test.js copies there and fails to require() them.
    // shared/panel tests run under eval's vitest (their SDK deps live
    // there) — the src/shared symlink would otherwise pull them in here.
    exclude: ['**/node_modules/**', 'lib/**', '**/shared/panel/**'],
  },
});
