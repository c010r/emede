# Plan del proyecto: emede

_Fecha: 2026-09-26 · Versión actual: 0.1.0 (sin publicar)_

## 1. Objetivo

**emede** es un diseñador visual asistido por IA (Google Gemini) que genera los archivos de configuración para agentes de código: **Claude Code, OpenCode, Codex CLI, Gemini CLI, Cursor y GitHub Copilot**.

El usuario arma un grafo de nodos (proyecto, agentes, skills, comandos, reglas y servidores MCP) en un lienzo. La IA redacta el **contenido** sin atarse a ninguna herramienta, y un adaptador fijo por plataforma lo convierte al **formato** exacto de cada una.

Principio rector: **la IA decide el contenido, el código decide el formato.** Los formatos de salida son deterministas y verificados contra la documentación oficial de cada herramienta (última verificación: 2026-09-25).

## 2. Stack

| Capa | Tecnología | Versión |
|---|---|---|
| Lenguaje | TypeScript (modo `strict`, `noUnusedLocals`) | ^7.0 |
| Interfaz | React | ^19.3 |
| Lienzo de nodos | @xyflow/react (React Flow) | ^12.12 |
| Estado | zustand | ^5.0 |
| Bundler / dev server | Vite (+ @vitejs/plugin-react) | ^8.3 |
| ZIP de salida | jszip | ^3.10 |
| Servidor local | Node.js puro, sin dependencias (ejecuta `.ts` directo) | Node 24 |
| IA | API REST de Google Gemini (`generativelanguage.googleapis.com`) | — |
| Pruebas unitarias / integración | Vitest + Testing Library + jsdom | ^5.0 |
| Pruebas de extremo a extremo | Playwright (local: Edge; CI: Chromium) | ^1.63 |
| CI | GitHub Actions (`.github/workflows/ci.yml`) | — |

No hay base de datos ni otras dependencias de runtime. **No agregar dependencias nuevas sin una razón fuerte.**

## 3. Comandos

| Acción | Comando |
|---|---|
| Instalar | `npm install` (CI: `npm ci`) |
| Desarrollo | `npm run dev` → http://127.0.0.1:5178 |
| Build (tipos de app, servidor y e2e + bundle) | `npm run build` |
| Producción | `npm run build && npm start` → http://127.0.0.1:5178 |
| Tests unitarios e integración | `npm test` |
| Tests en modo watch | `npm run test:watch` |
| Tests de extremo a extremo | `npm run e2e` |

Orden de verificación antes de dar un cambio por terminado (el mismo que corre CI): `npm run build` → `npm test` → `npm run e2e`.

## 4. Estructura

| Carpeta / archivo | Responsabilidad |
|---|---|
| `src/components/Dashboard.tsx`, `Editor.tsx` | Pantalla de inicio (lista de proyectos) y editor con lienzo |
| `src/components/Inspector.tsx`, `NodeCard.tsx` | Edición de cada nodo |
| `src/components/*Modal.tsx` | Modales: plan, plantillas, importar repo, escribir en carpeta, ajustes |
| `src/components/FilesPanel.tsx`, `DiffView.tsx`, `ProblemsPanel.tsx` | Pestañas Archivos (con diff) y Problemas |
| `src/types.ts` | Modelo de datos: `ProjectData`, `AgentData`, `SkillData`, `CommandData`, `RuleData`, `McpData`, `Guards`, `Canary`, `Settings` |
| `src/store.ts` | Estado global (zustand), historial deshacer/rehacer, versión de contenido |
| `src/storage.ts`, `src/projects.ts` | Interfaz `Backend` (servidor local o navegador) y operaciones sobre proyectos |
| `server/api.ts`, `server/store.ts`, `server/index.ts` | API local sobre `~/.emede/emede.json` |
| `src/generators/index.ts` | Adaptadores por plataforma (`claude`, `opencode`, `codex`, `gemini`, `cursor`, `copilot`) y `render()` |
| `src/generators/guards.ts` | Guardarraíles: permisos, hooks y `scripts/agent-guard.mjs` |
| `src/generators/secrets.ts` | Reemplazo de secretos MCP por variables de entorno |
| `src/importers/` | Lectura de configuraciones existentes (frontmatter YAML y TOML) |
| `src/ai.ts`, `src/gemini.ts` | Prompts y cliente de Gemini (reintentos, esperas, cambio de modelo) |
| `src/validate.ts`, `src/quality.ts`, `src/audit.ts` | Validación, chequeos de calidad y auditoría con IA |
| `src/sanitize.ts` | Detección y limpieza de caracteres Unicode invisibles |
| `src/stack.ts`, `src/detect.ts` | Catálogo de tecnologías y detección del stack desde un repo |
| `src/templates.ts` | Biblioteca de plantillas (Flujo de PR, Calidad, Seguridad) |
| `src/fs.ts` | Acceso a carpetas (File System Access API), aislado detrás de una interfaz |
| `src/__tests__/` | Pruebas Vitest; `memfs.ts` imita la File System Access API en memoria |
| `e2e/` | Pruebas Playwright contra el servidor de producción con carpeta de datos temporal |
| `docs/` | Documentación y estudios (`escritorio.md`) |

## 5. Arquitectura y decisiones clave

1. **Contenido vs. formato.** El grafo guarda contenido neutral (herramientas genéricas `read/edit/write/bash/search/web`, niveles de modelo `inherit/fast/balanced/powerful`, `$ARGUMENTS`). Cada adaptador traduce al vocabulario de su plataforma. La IA nunca escribe formato de salida.
2. **Persistencia en un único JSON** fuera de cualquier repo: `~/.emede/emede.json` (configurable con `EMEDE_DATA_DIR`). Escritura atómica + respaldo `emede.json.bak`; si el archivo se daña, se guarda copia y la app arranca igual. Sin servidor, el mismo formato se guarda en el navegador.
3. **Frontend desacoplado del almacenamiento** vía la interfaz `Backend` de `src/storage.ts`, y del sistema de archivos vía `src/fs.ts`. Esto habilita la futura app de escritorio sin tocar la interfaz.
4. **Servidor local** escucha solo en `127.0.0.1` y rechaza pedidos con `Origin` de otros sitios.
5. **Skills compartidas**: se escriben una sola vez en `.agents/skills/` para todas las herramientas que leen esa carpeta.
6. **Guardarraíles técnicos, no solo instrucciones**: lo obligatorio se aplica con permisos y hooks nativos de cada herramienta.
7. **Guardar en carpeta** nunca pisa sin mostrar antes un diff (nuevo / cambia / igual) y respalda lo reemplazado en `.emede-backup/`.

### Matriz de salida (referencia para los adaptadores)

| Nodo | Claude Code | OpenCode | Codex CLI | Gemini CLI | Cursor | Copilot |
|---|---|---|---|---|---|---|
| Proyecto | `CLAUDE.md` | `AGENTS.md` | `AGENTS.md` | `GEMINI.md` | `.cursor/rules/proyecto.mdc` | `.github/copilot-instructions.md` |
| Agente | `.claude/agents/*.md` | `.opencode/agents/*.md` | `.codex/agents/*.toml` | `.gemini/agents/*.md` | `.cursor/agents/*.md` | `.github/agents/*.agent.md` |
| Skill | `.claude/skills/` | `.agents/skills/` | `.agents/skills/` | `.agents/skills/` | `.agents/skills/` | `.agents/skills/` |
| Comando | `.claude/commands/*.md` | `.opencode/commands/*.md` | skill explícita | `.gemini/commands/*.toml` | skill explícita | `.github/prompts/*.prompt.md` |
| Regla | `CLAUDE.md` / `.claude/rules/*.md` | `AGENTS.md` | `AGENTS.md` | `GEMINI.md` | `.cursor/rules/*.mdc` | `.github/instructions/*.instructions.md` |
| MCP | `.mcp.json` | `opencode.json` | `.codex/config.toml` | `.gemini/settings.json` | `.cursor/mcp.json` | `.vscode/mcp.json` |

## 6. Convenciones

- **Idioma:** interfaz, comentarios, documentación, CHANGELOG y mensajes de error en **español rioplatense** (voseo: "pegá", "elegí", "configurá"). Los identificadores de código en inglés.
- **Comentarios:** JSDoc breve (`/** … */`) en tipos y funciones exportadas explicando el *porqué*; no comentar lo obvio.
- **TypeScript estricto**: sin `any` implícito, sin variables sin usar; imports con `type` cuando corresponde.
- **Estilo compacto**: funciones pequeñas con arrow functions de una línea para helpers, igual que el código existente.
- **Mensajes al usuario** accionables: qué pasó y qué hacer ("El PDF pesa X; el máximo es Y. Exportalo como texto o Markdown.").
- **CHANGELOG.md** en formato Keep a Changelog (secciones Agregado / Cambiado / Seguridad), versionado SemVer. Todo cambio visible para el usuario se anota en `[Sin publicar]`.
- **README.md** se actualiza cuando cambia una función, la matriz de salida o la estructura.
- **Tests junto con el cambio**: cada adaptador, importador o regla de validación nueva lleva su prueba en `src/__tests__/`. Para acceso a carpetas usar `memDir()` de `memfs.ts`, nunca el disco real.
- **Commits** en español, descriptivos, uno por cambio lógico.

## 7. Áreas de trabajo

| Área | Alcance | Archivos |
|---|---|---|
| **Adaptadores de plataforma** | Mantener los formatos de salida de las 6 herramientas alineados con su documentación oficial; agregar plataformas nuevas | `src/generators/`, `src/importers/`, tests de generadores e importación |
| **IA y prompts** | Prompts de diseño, redacción por nodo, desde plan, auditoría; cliente Gemini con reintentos y cambio de modelo | `src/ai.ts`, `src/gemini.ts`, `src/audit.ts` |
| **Interfaz (frontend)** | Dashboard, editor, lienzo, inspector, modales, paneles; accesibilidad y UX | `src/components/`, `src/store.ts`, `src/styles.css` |
| **Persistencia y servidor** | API local, JSON atómico, migración desde navegador, interfaz `Backend` | `server/`, `src/storage.ts`, `src/projects.ts` |
| **Seguridad** | Secretos MCP, caracteres invisibles, guardarraíles, protección del servidor local | `src/sanitize.ts`, `src/generators/secrets.ts`, `src/generators/guards.ts`, `server/api.ts` |
| **QA** | Vitest, Playwright, CI; revisar cobertura de cada cambio | `src/__tests__/`, `e2e/`, `.github/workflows/ci.yml` |

## 8. Procedimientos repetibles

### 8.1 Verificar y actualizar el formato de una plataforma
1. Consultar la documentación oficial vigente de la herramienta (rutas, frontmatter/TOML, nombres de campos, herramientas, sintaxis de variables de entorno).
2. Comparar contra el adaptador en `src/generators/index.ts` y el importador en `src/importers/repo.ts`.
3. Ajustar adaptador **e** importador (lo que se genera se tiene que poder volver a importar).
4. Actualizar tests (`generators.test.ts`, `import.test.ts`), la matriz del README, la fecha de verificación y el CHANGELOG.

### 8.2 Agregar una plataforma nueva
1. Agregar la clave en `TARGETS` (`src/types.ts`).
2. Escribir la función adaptadora en `src/generators/index.ts` y registrarla en `render()`; decidir si lee `.agents/skills/` compartidas.
3. Mapear herramientas genéricas, niveles de modelo, `$ARGUMENTS` y referencias de secretos (`secrets.ts`).
4. Implementar guardarraíles con el mecanismo nativo en `guards.ts` (o documentar que no tiene y usar sección en memoria).
5. Agregar importador, detección en `detect.ts`, tests, fila/columna en el README y entrada en CHANGELOG.

### 8.3 Agregar un campo a un tipo de nodo
1. Extender la interfaz en `src/types.ts` (opcional si hay datos guardados previos) y el valor por defecto en `src/defaults.ts`.
2. Normalizar datos viejos en `normalizeGraph` (`src/storage.ts`).
3. Exponerlo en `Inspector.tsx`, usarlo en los adaptadores y, si aplica, en el esquema de respuesta de `src/ai.ts`.
4. Tests de store/storage y generadores.

### 8.4 Cambiar un prompt de IA
1. Editar en `src/ai.ts` (o `audit.ts`) manteniendo el esquema JSON de respuesta.
2. Todo texto que devuelve la IA pasa por `stripHiddenDeep` antes de entrar al grafo.
3. Probar a mano con una API key real y cubrir el parseo con un test (`plan-canary.test.ts` como referencia).

### 8.5 Publicar una versión
1. `npm run build`, `npm test`, `npm run e2e` en verde.
2. Mover `[Sin publicar]` del CHANGELOG a la versión nueva con fecha; subir `version` en `package.json`.
3. Commit y tag `vX.Y.Z`.

## 9. Flujos de trabajo (comandos)

- **Verificar todo:** correr build, tests y e2e en ese orden y reportar fallas con la salida.
- **Revisar un cambio:** leer el diff contra las restricciones de la sección 10 (secretos, caracteres invisibles, escritura sin diff, dependencias nuevas, idioma) y confirmar que trae tests y CHANGELOG.
- **Auditar formatos:** ejecutar el procedimiento 8.1 para una plataforma dada como argumento (o todas).
- **Siguiente tarea:** tomar el primer ítem sin marcar de la sección 11, implementarlo, verificarlo y marcarlo `[x]`.
- **Estado:** resumir qué fases y tareas de la sección 11 están hechas, en curso y pendientes.

## 10. Restricciones (lo que no se debe hacer)

- **Secretos:** nunca escribir valores de tokens, claves o `Authorization` en archivos generados ni en exportaciones `.emede.json`. Siempre referencias a variables de entorno con la sintaxis de cada plataforma (Claude `${VAR}`, OpenCode `{env:VAR}`, Codex `env_vars`/`bearer_token_env_var`, Gemini `${VAR}`, Cursor `${env:VAR}`, VS Code `inputs` con contraseña) y listarlas en `.env.example`.
- **API key de Gemini:** solo se guarda en `~/.emede/emede.json` y solo se envía a `generativelanguage.googleapis.com`. Nunca loguearla ni incluirla en tests, fixtures o commits.
- **Caracteres invisibles ("Rules File Backdoor"):** todo lo que entra (repos importados, respuestas de IA, `.json` abiertos) y todo lo que se genera pasa por `src/sanitize.ts`. No agregar un camino de entrada o salida que lo saltee.
- **Escritura en disco del usuario:** nunca pisar archivos sin mostrar el diff antes y sin respaldar en `.emede-backup/`.
- **Datos reales:** los tests y e2e nunca tocan `~/.emede/`; usan `EMEDE_DATA_DIR` temporal o `memDir()`.
- **Servidor:** no escuchar fuera de `127.0.0.1` ni relajar el chequeo de `Origin`.
- **Formato por IA:** la IA no genera rutas ni frontmatter; eso es trabajo exclusivo de los adaptadores.
- **Dependencias:** el servidor se mantiene sin dependencias; en el frontend, no agregar librerías sin justificación.
- **Formatos inventados:** no cambiar un formato de salida sin fuente en la documentación oficial de la herramienta.

## 11. Fases y tareas

Marcar avance con `[x]`.

### Fase 1 — Núcleo (hecho)
- [x] Lienzo de nodos, inspector, deshacer/rehacer
- [x] Adaptadores para las 6 plataformas y ZIP / guardar en carpeta con diff y respaldo
- [x] Diseño con IA, desde plantillas, desde plan (texto, .md, .txt, .pdf) e importación de repos
- [x] Persistencia en `~/.emede/emede.json` con dashboard de proyectos y migración desde el navegador
- [x] Guardarraíles, canario de contexto, secretos MCP, limpieza de caracteres invisibles
- [x] Pestaña Problemas: validación, calidad y auditoría con IA
- [x] Vitest, Playwright y CI

### Fase 2 — Primera versión publicada
- [ ] Primer commit y publicación de `v0.1.0` (procedimiento 8.5)
- [ ] Re-verificar la matriz de formatos contra la documentación oficial antes de publicar

### Fase 3 — App de escritorio (ver `docs/escritorio.md`)
- [ ] Opcional: PWA instalable (manifest + service worker), 2–4 h
- [ ] `electron/main.ts`: servidor con `createApi` + estáticos en puerto libre, una sola instancia, menú mínimo
- [ ] Seguridad de Electron: `contextIsolation`, `sandbox`, sin `nodeIntegration`, enlaces externos al navegador del sistema
- [ ] `preload.ts` con `pickDir`, `readText`, `writeText`, `list` por IPC; `src/fs.ts` los usa si existen
- [ ] API key cifrada con `safeStorage`
- [ ] Empaquetado con electron-builder (NSIS, dmg, AppImage/deb)
- [ ] Opcional: `electron-updater` con GitHub Releases

## 12. Pendientes y decisiones abiertas

- Firma de código para Windows (evitar el aviso de SmartScreen): sin decidir; depende de si la distribución es interna o pública.
- Migración futura a Tauri si el tamaño del instalador importa: sin decidir.
- Soporte de proveedores de IA además de Gemini: no planificado.
