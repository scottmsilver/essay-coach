import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['panel/**/*.test.ts', '../shared/panel/**/*.test.ts'] } });
