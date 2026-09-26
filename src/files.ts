import type { FileOverride } from './store';
import type { FileMap } from './types';

/* Archivos finales: lo generado más las ediciones manuales y exclusiones. Sin React: lo usa también la CLI. */

export interface OutputFile {
  path: string;
  content: string;
  /** Lo que genera la app, sin la edición manual. */
  generated: string;
  edited: boolean;
  /** La edición manual se hizo sobre una versión generada que ya cambió. */
  stale: boolean;
  excluded: boolean;
}

export function computeOutput(generated: FileMap, overrides: Record<string, FileOverride>, excluded: string[]): OutputFile[] {
  return Object.entries(generated).map(([path, gen]) => {
    const o = overrides[path];
    return {
      path,
      generated: gen,
      content: o ? o.content : gen,
      edited: !!o,
      stale: !!o && o.base !== gen,
      excluded: excluded.includes(path),
    };
  });
}

/** Solo los archivos que se escriben (sin excluidos). */
export const toWrite = (files: OutputFile[]): FileMap =>
  Object.fromEntries(files.filter((f) => !f.excluded).map((f) => [f.path, f.content]));
