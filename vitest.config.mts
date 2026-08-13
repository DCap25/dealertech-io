import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    coverage: {
      // The coverage engine is the product. Hold it to a higher bar than the app.
      include: ['src/lib/coverage/**', 'src/lib/opportunities/**'],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
})
