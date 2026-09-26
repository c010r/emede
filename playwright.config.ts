import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/*
 * Pruebas de extremo a extremo: compilan la app, levantan el servidor de producción
 * con una carpeta de datos temporal (nunca se tocan los proyectos reales) y la usan en un navegador real.
 * Local: Microsoft Edge instalado. CI: Chromium de Playwright (npx playwright install chromium).
 */
const PORT = 5190;
const dataDir = mkdtempSync(join(tmpdir(), 'emede-e2e-'));

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 900 },
    // Las pruebas buscan textos en español: el navegador se presenta en español.
    locale: 'es-AR',
    channel: process.env.CI ? undefined : 'msedge',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && node server/index.ts',
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { PORT: String(PORT), EMEDE_DATA_DIR: dataDir },
  },
});
