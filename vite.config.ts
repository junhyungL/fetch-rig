/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';
import dts from 'vite-plugin-dts';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    target: 'es2022',
    lib: {
      entry: rootDir + 'src/index.ts',
      formats: ['es'],
      fileName: () => 'index.js',
    },
  },
  plugins: [
    dts({
      include: ['src/**/*'],
      bundleTypes: true,
    }),
  ],
  test: {
    environment: 'node',
  },
});
