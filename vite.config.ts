/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { createApi } from './server/api.ts';
import { serverCodeId } from './server/codeId.ts';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/** En desarrollo, la misma API de producción corre como middleware de Vite. */
const jsonApi = (): Plugin => ({
  name: 'emede-json-api',
  configureServer(server) {
    server.middlewares.use(createApi());
  },
  configurePreviewServer(server) {
    server.middlewares.use(createApi());
  },
});

export default defineConfig({
  plugins: [tailwindcss(), react(), jsonApi()],
  // __EMEDE_SERVER_CODE__: huella del servidor con el que se compiló la app (si el que corre es otro, se pide reiniciarlo).
  define: { __EMEDE_VERSION__: JSON.stringify(version), __EMEDE_SERVER_CODE__: JSON.stringify(serverCodeId()) },
  // strictPort: si 5178 está ocupado (otra instancia abierta) falla con un aviso en vez de mudarse a otro puerto.
  server: { port: 5178, strictPort: true, host: '127.0.0.1' },
  test: {
    setupFiles: ['src/__tests__/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
