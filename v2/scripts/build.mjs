import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const root = process.cwd();

async function buildBackground() {
  await build({
    configFile: false,
    plugins: [react()],
    publicDir: 'extension/public',
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: true,
      rollupOptions: {
        input: resolve(root, 'extension/src/background/index.ts'),
        output: {
          format: 'es',
          entryFileNames: 'background.js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]'
        }
      }
    }
  });
}

async function buildContent(name, input) {
  await build({
    configFile: false,
    plugins: [react()],
    publicDir: false,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      sourcemap: true,
      cssCodeSplit: false,
      rollupOptions: {
        input: resolve(root, input),
        output: {
          format: 'iife',
          name: `Courtlens${name}`,
          entryFileNames: `${name}.js`,
          assetFileNames: 'assets/[name]-[hash][extname]'
        }
      }
    }
  });
}

await buildBackground();
await buildContent('courtlist', 'extension/src/content/courtlist.tsx');
await buildContent('caselaw', 'extension/src/content/caselaw.tsx');
