import { chmod, mkdir, readFile, rename, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/*
 * Almacenamiento en un único archivo JSON (sin motor de base de datos).
 * Ubicación por defecto: ~/.emede/emede.json (fuera de cualquier repo, así la API key no termina en un commit).
 * Se puede cambiar con la variable de entorno EMEDE_DATA_DIR.
 * Guarda las API keys en texto plano, así que la carpeta y los archivos son solo del usuario (0700 / 0600).
 */

export interface ProjectRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  [key: string]: unknown;
}

export interface DataFile {
  version: 1;
  settings: Record<string, unknown>;
  projects: Record<string, ProjectRecord>;
  /** Plantillas propias del usuario (paquetes de piezas reutilizables). */
  templates: Record<string, ProjectRecord>;
}

/** Permisos de los archivos con datos (API keys): solo lectura y escritura del dueño. En Windows no tiene efecto. */
const PRIVATE_FILE = 0o600;
const PRIVATE_DIR = 0o700;

/** Copia un archivo y deja la copia privada (copyFile conserva los permisos del original, que pueden ser abiertos). */
async function privateCopy(from: string, to: string) {
  await copyFile(from, to);
  await chmod(to, PRIVATE_FILE);
}

const empty = (): DataFile => ({ version: 1, settings: {}, projects: {}, templates: {} });

export function defaultDataFile(): string {
  return join(process.env.EMEDE_DATA_DIR || join(homedir(), '.emede'), 'emede.json');
}

export class JsonStore {
  readonly file: string;
  private cache: DataFile | null = null;
  /** Las escrituras se encadenan para que nunca se pisen entre sí. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(file: string = defaultDataFile()) {
    this.file = file;
  }

  async read(): Promise<DataFile> {
    if (this.cache) return this.cache;
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8')) as Partial<DataFile>;
      this.cache = { ...empty(), ...data, settings: data.settings ?? {}, projects: data.projects ?? {}, templates: data.templates ?? {} };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        // Archivo dañado: se conserva una copia y se arranca vacío en vez de perder todo en silencio.
        if (existsSync(this.file)) await privateCopy(this.file, `${this.file}.corrupto-${Date.now()}`);
        console.error(`[emede] No se pudo leer ${this.file}: ${(e as Error).message}. Se guardó una copia.`);
      }
      this.cache = empty();
    }
    return this.cache;
  }

  /** Aplica un cambio y lo persiste: escribe a un temporal y lo renombra (atómico), con respaldo .bak. */
  update<T>(fn: (data: DataFile) => T): Promise<T> {
    const run = async () => {
      const data = await this.read();
      const result = fn(data);
      await mkdir(dirname(this.file), { recursive: true, mode: PRIVATE_DIR });
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: PRIVATE_FILE });
      // mode solo se aplica al crear: un .tmp que quedó de antes conserva sus permisos.
      await chmod(tmp, PRIVATE_FILE);
      if (existsSync(this.file)) await privateCopy(this.file, `${this.file}.bak`);
      await rename(tmp, this.file);
      return result;
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }
}
