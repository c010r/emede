import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serverCodeId } from '../../server/codeId.ts';
import { serverOutdated } from '../storage';

afterEach(() => vi.unstubAllGlobals());

describe('huella del código del servidor', () => {
  it('cambia cuando cambia el código, no con los finales de línea ni otros archivos', () => {
    const dir = mkdtempSync(join(tmpdir(), 'emede-code-'));
    try {
      writeFileSync(join(dir, 'api.ts'), 'export const a = 1;\n');
      writeFileSync(join(dir, 'store.ts'), 'export const b = 2;\n');
      const id = serverCodeId(dir);
      expect(id).toMatch(/^[0-9a-f]{12}$/);
      writeFileSync(join(dir, 'api.ts'), 'export const a = 1;\r\n');
      writeFileSync(join(dir, 'notas.md'), 'no es código');
      expect(serverCodeId(dir)).toBe(id);
      writeFileSync(join(dir, 'api.ts'), 'export const a = 3;\n');
      expect(serverCodeId(dir)).not.toBe(id);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('la app se compila con la huella del servidor actual', () => {
    expect(__EMEDE_SERVER_CODE__).toBe(serverCodeId());
  });

  it('avisa si el servidor que corre es de otra versión (o tan viejo que no informa su huella)', async () => {
    const health = (body: object) => vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => body })));
    health({ ok: true, code: __EMEDE_SERVER_CODE__ });
    expect(await serverOutdated()).toBe(false);
    health({ ok: true, code: 'otra-version' });
    expect(await serverOutdated()).toBe(true);
    health({ ok: true });
    expect(await serverOutdated()).toBe(true);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('sin servidor'); }));
    expect(await serverOutdated()).toBe(false);
  });
});
