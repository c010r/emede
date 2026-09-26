import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

/* Empaqueta la CLI (src/cli/bin.ts) en dist-cli/emede.js para Node. Las dependencias quedan externas. */

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  define: { __EMEDE_VERSION__: JSON.stringify(version) },
  build: {
    ssr: 'src/cli/bin.ts',
    outDir: 'dist-cli',
    emptyOutDir: true,
    target: 'node22',
    rollupOptions: { output: { entryFileNames: 'emede.js', banner: '#!/usr/bin/env node' } },
  },
});
