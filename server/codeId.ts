import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Huella del código del servidor (sus archivos .ts). La calcula el servidor al arrancar y la app compilada
 * trae la que esperaba: si no coinciden, el servidor que está corriendo es de otra versión (por ejemplo,
 * después de un `git pull` sin reiniciarlo) y la app pide reiniciarlo.
 */
export function serverCodeId(dir = fileURLToPath(new URL('.', import.meta.url))): string {
  const hash = createHash('sha256');
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.ts')).sort()) {
    // Sin \r: la misma huella aunque Git cambie los finales de línea.
    hash.update(name).update('\0').update(readFileSync(join(dir, name), 'utf8').replace(/\r\n/g, '\n')).update('\0');
  }
  return hash.digest('hex').slice(0, 12);
}
