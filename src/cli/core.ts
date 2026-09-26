import { render } from '../generators';
import { computeOutput, toWrite } from '../files';
import type { GenerateOptions } from '../design';
import type { Graph } from '../store';
import type { FileMap } from '../types';

/*
 * Lo que hace la CLI, sin tocar el disco: calcular los archivos esperados y compararlos con una carpeta.
 * La lectura se pasa como función, así lo mismo sirve con el disco (CLI) y con una carpeta en memoria (pruebas).
 */

/** Exactamente lo que escribe "Guardar en carpeta" en la app: generado + ediciones manuales − excluidos. */
export function expectedFiles(graph: Graph, opts: GenerateOptions): FileMap {
  const generated = render(graph, { lang: opts.lang, targets: opts.targets });
  return toWrite(computeOutput(generated, opts.fileOverrides, opts.excluded));
}

export type FileStatus = 'same' | 'changed' | 'missing';

export interface FileCheck {
  path: string;
  status: FileStatus;
  /** Contenido actual en la carpeta (si existe). */
  current?: string;
}

const norm = (s: string) => s.replace(/\r\n/g, '\n');

export async function compareWith(expected: FileMap, read: (path: string) => Promise<string | null>): Promise<FileCheck[]> {
  const out: FileCheck[] = [];
  for (const [path, content] of Object.entries(expected)) {
    const current = await read(path);
    if (current === null) out.push({ path, status: 'missing' });
    else out.push({ path, status: norm(current) === norm(content) ? 'same' : 'changed', current });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
