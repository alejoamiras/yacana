import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.vitest.tsx', 'src/**/*.test.ts'],
    // *.bun.test.ts needs Bun; bun runs it, Vitest skips it.
    exclude: ['**/*.bun.test.ts', '**/node_modules/**'],
  },
});
