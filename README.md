# emede

Diseñador visual, asistido por IA (Gemini, Claude, OpenAI o cualquier proveedor compatible con OpenAI), que genera todos los archivos de configuración para agentes de código: **Claude Code, OpenCode, Codex CLI, Gemini CLI, Cursor y GitHub Copilot**.

## Uso

```bash
npm install
npm run dev        # desarrollo: http://127.0.0.1:5178
npm test           # pruebas unitarias e integración (Vitest)
npm run e2e        # pruebas de extremo a extremo en navegador real (Playwright; local usa Edge)

npm run build && npm start   # versión compilada: http://127.0.0.1:5178
```

Al abrir la app siempre aparece el **dashboard**: empezás un proyecto nuevo o abrís uno guardado.

Para empezar uno nuevo:
- **En blanco**
- **✨ Diseñar con IA:** describís el proyecto y la IA arma el sistema completo.
- **📚 Desde plantillas:** paquetes Flujo de PR, Calidad y Seguridad.
- **📥 Importar un repo:** lee la configuración de agentes que ya tiene un proyecto, de cualquiera de las 6 herramientas.
- **⬆ Abrir .emede.json**

Los proyectos guardados se listan con descripción, stack y cantidad de piezas, y se pueden buscar, abrir, duplicar o borrar.

En el editor:
1. **⚙ Ajustes:** elegí el proveedor de IA y pegá su API key. La app lista los modelos y verifica que el elegido responda. Los proveedores son:
   - **Google Gemini:** clave de [AI Studio](https://aistudio.google.com/apikey).
   - **Anthropic Claude:** clave de la [Console](https://console.anthropic.com/settings/keys). Se usa con el SDK oficial y el modelo por defecto es `claude-opus-5`.
   - **OpenAI:** clave de la [plataforma](https://platform.openai.com/api-keys).
   - **Compatible con OpenAI:** OpenRouter, DeepSeek, Groq, Mistral, xAI, u Ollama o LM Studio en tu equipo (estos dos no necesitan clave). Los pedidos pasan por el servidor local de emede para evitar bloqueos de CORS, y no lee PDF.

   Cada proveedor guarda su propia clave y su propio modelo: cambiar de proveedor no borra nada.
2. Editá en el **Inspector**. Cada nodo tiene ✨ para redactar o mejorar su contenido con IA. El stack se elige visualmente o se detecta desde el repo.
3. Conectá nodos arrastrando desde el punto derecho. Doble click en una conexión la borra.
4. **Problemas** revisa descripciones vacías, nombres duplicados, contenido faltante y memoria demasiado larga. **🔧 Reparar todo** los corrige y te pregunta lo que no puede decidir (ver [Reparación de problemas](#reparación-de-problemas)).

El lienzo del medio es el mapa de la configuración: cada tarjeta se convierte en uno o más archivos y las flechas indican quién usa a quién. El botón **? Qué es esto** lo explica dentro de la app.
5. En **Archivos** podés ver, editar a mano o excluir cada archivo. Después: **ZIP** o **Guardar en carpeta**. Guardar muestra antes qué es nuevo, qué cambia (con diff) y qué queda igual, y respalda en `.emede-backup/` lo que reemplaza.

### Línea de comandos (CI)

`npm run build` genera también la CLI `emede` (`dist-cli/emede.js`). Exportá el diseño con **⬇ .json** y dejalo en el repo; el archivo incluye plataformas, idioma, ediciones manuales y exclusiones.

```bash
npx emede generate                 # escribe los archivos del único *.emede.json de la carpeta
npx emede check                    # código 1 si los archivos del repo no coinciden con el diseño
npx emede generate --project tienda --out ../tienda   # usa un proyecto guardado en la app
npx emede generate --dry-run --targets claude,codex --lang en
npx emede list                     # proyectos guardados
```

En CI, `emede check` avisa cuando alguien edita a mano un archivo generado sin actualizar el diseño. Códigos de salida: 0 bien, 1 diferencias, 2 error de uso.

### Traer cambios del repo

Si un archivo generado se edita en el repo (a mano, por un agente, en otra rama), **Archivos → ⬇ Traer cambios del repo** compara la carpeta con el diseño y propone:
- **Cambió en el repo:** el campo de la pieza correspondiente (por ejemplo, el prompt de un agente editado en `.claude/agents/revisor.md`). Al aplicarlo, el cambio llega a todas las plataformas.
- **Nueva en el repo:** piezas que están en el repo y no en el diseño.
- **Edición manual del archivo:** lo que no corresponde a ningún campo (por ejemplo, un comentario en un `.toml`); se guarda como edición manual para que el próximo guardado no la pise.

Cada cambio se ve con diff y se elige con una casilla. Se deshace con Ctrl+Z.

### Plantillas propias

En **📚 Plantillas → ⭐ Mis plantillas** podés guardar piezas del proyecto (una o varias, con sus conexiones) para reusarlas en todos tus proyectos. También se guarda una pieza sola desde el Inspector con **💾 Plantilla**. Cada paquete se exporta como `.emede-pack.json` para compartirlo con el equipo, y se importa desde la misma pestaña.
- Los secretos de MCP nunca entran en una plantilla: quedan como `${VARIABLE}`.
- Al importar, se validan los campos y se quitan caracteres invisibles.
- Si la plantilla está en otro idioma que el contenido del proyecto, se traduce con IA al insertarla.

Las plantillas se guardan en el mismo `emede.json` que los proyectos (sección `templates`).

### Prueba de enrutamiento

Las herramientas deciden a qué agente delegar o qué skill cargar mirando solo el nombre y la descripción. **Problemas → 🧭 Probar enrutamiento** reproduce eso: por cada pedido de ejemplo, la IA ve únicamente las descripciones y elige, y se marca si acertó.
- **✨ Sugerir casos:** la IA escribe pedidos a partir de lo que hace cada pieza (su prompt o instrucciones, no su descripción), así una descripción que no refleja el propósito real falla. Suma pedidos que ninguna pieza debería tomar.
- **🔧 Mejorar descripciones:** con los casos que fallaron, reescribe las descripciones de las piezas involucradas y vuelve a probar. Se deshace con Ctrl+Z.

Los casos se guardan con el proyecto (y en el `.emede.json`), pero no se escriben en ningún archivo generado. Los comandos no se prueban porque se invocan a mano con `/nombre`.

### Tokens

Cada archivo muestra su tamaño estimado en tokens (≈4 caracteres por token en alfabeto latino, 1 por carácter en chino). Arriba, **Contexto fijo por sesión** suma lo que cada herramienta carga siempre: memoria (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`…), reglas sin `paths`/`globs` y reglas `alwaysApply`. Agentes, skills y comandos no cuentan porque se cargan solo al usarlos. Por encima de 3000 tokens se marca en naranja y aparece un aviso en Problemas.

Otras funciones:
- **Guardado automático:** "✔ guardado" arriba a la izquierda.
- **← Proyectos:** vuelve al dashboard.
- **Deshacer y rehacer:** Ctrl+Z / Ctrl+Shift+Z.

## Datos

No hay base de datos: todo se guarda en **un archivo JSON**, `~/.emede/emede.json` (en Windows, `C:\Users\<usuario>\.emede\emede.json`).
- **Ubicación:** fuera de cualquier repo, así la API key nunca termina en un commit. Se cambia con la variable de entorno `EMEDE_DATA_DIR`.
- **Escritura segura:** cada escritura es atómica y deja un respaldo `emede.json.bak`. Si el archivo se daña, se guarda una copia y la app arranca igual.
- **Quién escribe:** el servidor local (`server/`), que corre dentro de `npm run dev` y en `npm start`. Si la app se sirve sin servidor, el mismo formato se guarda en el navegador y el dashboard lo avisa.
- **Migración:** los datos de versiones anteriores (guardados en el navegador) se pasan solos al JSON la primera vez.

La posibilidad de instalarla como aplicación de escritorio está analizada en [docs/escritorio.md](docs/escritorio.md).

La auditoría de seguridad de septiembre de 2026 y lo que se corrigió están en [docs/auditoria-seguridad.md](docs/auditoria-seguridad.md).

## Qué genera

La IA redacta el **contenido** sin atarse a ninguna herramienta. Después, un adaptador fijo por plataforma (`src/generators`) lo convierte al **formato** exacto de cada una. Los formatos se verificaron contra la documentación oficial el 2026-09-25.

| Nodo | Claude Code | OpenCode | Codex CLI | Gemini CLI | Cursor | Copilot |
|---|---|---|---|---|---|---|
| Proyecto | `CLAUDE.md` | `AGENTS.md` | `AGENTS.md` | `GEMINI.md` | `.cursor/rules/proyecto.mdc` | `.github/copilot-instructions.md` |
| Agente | `.claude/agents/*.md` | `.opencode/agents/*.md` | `.codex/agents/*.toml` | `.gemini/agents/*.md` | `.cursor/agents/*.md` | `.github/agents/*.agent.md` |
| Skill | `.claude/skills/` | lee `.claude/` o `.agents/skills/` | `.agents/skills/` | `.agents/skills/` | `.agents/skills/` | lee `.claude/` o `.agents/skills/` |
| Comando | `.claude/commands/*.md` | `.opencode/commands/*.md` | skill de invocación explícita | `.gemini/commands/*.toml` | skill de invocación explícita | `.github/prompts/*.prompt.md` |
| Regla | `CLAUDE.md` / `.claude/rules/*.md` | `AGENTS.md` | `AGENTS.md` | `GEMINI.md` | `.cursor/rules/*.mdc` | `.github/instructions/*.instructions.md` |
| MCP | `.mcp.json` | `opencode.json` | `.codex/config.toml`¹ | `.gemini/settings.json` | `.cursor/mcp.json` | `.vscode/mcp.json` |

¹ Codex solo toma `.codex/config.toml` en proyectos marcados como confiables.

Otros detalles de la salida:
- **Skills compartidas:** van a `.agents/skills/` una sola vez para todas las herramientas que leen esa carpeta, así no se duplican.
- **Argumentos:** `$ARGUMENTS` se traduce a `{{args}}` (Gemini) o `${input:args}` (Copilot).

## Guardarraíles

Lo que se tiene que cumplir no puede depender de que el agente "se acuerde" de una instrucción. En el Inspector del proyecto (🛡) se definen:
- archivos protegidos
- comandos prohibidos, que piden confirmación o que se aprueban solos
- formateador después de editar
- tests obligatorios antes de terminar

Se aplican con el mecanismo de cada herramienta:

| Herramienta | Cómo se aplica |
|---|---|
| Claude Code | `.claude/settings.json`: permisos `allow`/`ask`/`deny` y hooks `PostToolUse` y `Stop` |
| OpenCode | `permission` en `opencode.json` |
| Codex CLI | `sandbox_mode` y `approval_policy` en `.codex/config.toml` |
| Gemini CLI | `tools.allowed`/`confirmationRequired` y hooks en `.gemini/settings.json`, más `.geminiignore` |
| Cursor | `.cursor/hooks.json` y `.cursorignore` |
| Copilot | Sección en la memoria (no tiene mecanismo técnico) |

Los hooks que bloquean comandos usan `scripts/agent-guard.mjs`, que se genera y requiere Node.js.

## Calidad de las instrucciones

- **Chequeos automáticos** (pestaña Problemas): principios abstractos sin ejemplos, instrucciones vagas, descripciones que se pisan, skills que no dicen cuándo usarse, caracteres invisibles y tamaño de la memoria.
- **✨ Auditar y reparar:** la IA busca contradicciones, huecos y permisos de más, da un puntaje y los corrige con el mismo mecanismo que "Reparar todo".
- **🐤 Canario:** si el agente deja de repetir la marca (o tu nombre), perdió las instrucciones.

## Idiomas

La interfaz y el contenido generado están disponibles en 12 idiomas:

| Idioma | Código |
|---|---|
| Español | `es` |
| English | `en` |
| Português (Brasil) | `pt` |
| Français | `fr` |
| Italiano | `it` |
| 简体中文 (mandarín) | `zh` |
| 粵語 (cantonés, caracteres tradicionales) | `yue` |
| हिन्दी | `hi` |
| বাংলা | `bn` |
| मराठी | `mr` |
| తెలుగు | `te` |
| தமிழ் | `ta` |

- **Dónde se elige:** en **⚙ Ajustes** hay dos idiomas independientes:
  - **de la interfaz**, que la primera vez toma el del navegador;
  - **del contenido generado**, en el que se escriben `CLAUDE.md`, los agentes, las skills, los guardarraíles y el canario.
- **Qué hace la IA:** escribe el contenido en el idioma del contenido, y las preguntas y los hallazgos de la auditoría en el idioma de la interfaz.
- **Plantillas:** están escritas en español. Si el contenido va en otro idioma y hay IA configurada, se traducen al insertarlas.
- **Para desarrollar:**
  - los textos están en `src/i18n/`: `es.ts` es la fuente y cada idioma se descarga solo cuando se elige;
  - TypeScript marca las claves que le faltan a un idioma, y `i18n.test.ts` verifica que cada traducción conserve las variables (`{n}`, `{name}`…);
  - los textos que van dentro de los archivos generados están en `src/generators/content.ts`.
- **Límites:**
  - Las propiedades de las notas de Obsidian (`descripcion`, `herramientas`, `usa`…) quedan fijas en español, porque son el formato de sincronización.
  - Las instrucciones internas que emede le da a la IA están en español.
  - Las traducciones a lenguas de la India y al cantonés conviene que las revise un hablante nativo.

## Obsidian

El botón **📓 Obsidian** del editor crea en tu vault un espejo navegable del proyecto. Los archivos para los agentes (`CLAUDE.md`, `.claude/`…) siguen yendo al repo con "Guardar en carpeta": Obsidian no muestra las carpetas que empiezan con punto.

- **⬆ Enviar a Obsidian:** escribe en `emede/<proyecto>/` una nota por pieza, organizadas en `agentes/`, `skills/`, `comandos/`, `reglas/` y `mcp/`, más la nota del proyecto, `plan.md` y un `.canvas` igual al lienzo.
  - Cada nota tiene propiedades (descripción, herramientas, globs…) y en `usa` los `[[enlaces]]` a las piezas que usa, así se recorre con el grafo de Obsidian.
  - Antes de escribir muestra el diff y respalda en `.emede-backup/`. Borra las notas que sobran (piezas borradas o renombradas).
  - No pisa notas que editaste en Obsidian y todavía no trajiste.
- **⬇ Traer cambios de Obsidian:** propone solo lo que editaste en las notas desde la última sincronización (textos, propiedades, enlaces en `usa`, notas nuevas en esas carpetas y notas borradas), con diff.
  - Si una pieza cambió en los dos lados, la marca como conflicto y no la aplica sola.
  - Las posiciones del `.canvas` también vuelven. Las flechas se editan con la propiedad `usa`, no dibujándolas en el canvas.
- **Vault como fuente:** en **📄 Desde plan → 📓 Notas de Obsidian** elegís notas del vault, y si querés también las enlazadas con `[[…]]`. Se usan como plan para generar la configuración.

La ruta del vault se configura en **⚙ Ajustes → Obsidian** (por ejemplo `C:\Users\vos\Documentos\MiVault` o `~/Obsidian/MiVault`). La app avisa si la carpeta no existe o no tiene `.obsidian/`. El servidor local lee y escribe el vault por esa ruta, así que funciona en cualquier navegador. Sin servidor local, el vault se elige desde la ventana de Obsidian (Chrome o Edge) y se recuerda entre sesiones. Los secretos de MCP nunca se escriben en el vault (puede sincronizarse a la nube): quedan como referencias y se editan en emede.

## Reparación de problemas

**🔧 Reparar todo** trabaja en rondas (como máximo 3) hasta que no queda nada que pueda arreglar solo:

1. **Arreglos fijos, sin IA:** caracteres invisibles, nombres duplicados o vacíos, marca del canario, argumentos de los comandos.
2. **Corrección con IA:** todos los campos con problemas se corrigen en un solo pedido. Si hay varios problemas en un mismo campo, se combinan en una sola reescritura. La IA recibe las mismas reglas que verifican los chequeos automáticos, así no mete problemas nuevos.
3. **Preguntas:** lo que depende de un dato o una decisión tuya se pregunta en un modal que se abre solo. Por ejemplo: comandos, a qué archivos aplica una regla, para qué sirve una tarjeta vacía o qué versión conservar de un archivo editado a mano. También se pregunta lo que la IA no resolvió en dos intentos, en vez de insistir.

Otros detalles:
- **Cuándo corre sola:** después de diseñar con IA, generar desde un plan, importar un repo o un `.json` y "Completar vacíos". Se deshace con un solo Ctrl+Z.
- **Sin API key:** hace solo los arreglos fijos y las preguntas.
- **"Dejarlo así":** el problema no se vuelve a marcar. Esa decisión, y los hallazgos de auditoría ya tratados, se guardan en el proyecto. La auditoría no los repite, corre sin variación (misma configuración, mismo resultado) y puede devolver cero hallazgos.

## Seguridad

- **Instrucciones ocultas ("Rules File Backdoor"):** los caracteres Unicode invisibles se quitan de todo lo que entra (repos importados, respuestas de la IA, diseños `.json`) y de todo lo que se genera.

- **Secretos de MCP:** nunca se escriben en los archivos generados. Los valores sensibles (tokens, claves, `Authorization`) se reemplazan por referencias a variables de entorno, cada plataforma con su sintaxis:
  - Claude: `${VAR}`
  - OpenCode: `{env:VAR}`
  - Codex: `env_vars` / `bearer_token_env_var`
  - Gemini: `${VAR}`
  - Cursor: `${env:VAR}`
  - VS Code: `inputs` con contraseña

  Los nombres de esas variables quedan listados en `.env.example`.
- **Exportar `.emede.json`:** también reemplaza los secretos por referencias.
- **Guardar en carpeta:** nunca pisa archivos sin mostrarlos antes, y respalda los que reemplaza.
- **API keys de IA:** se guardan en `~/.emede/emede.json`, fuera de los repos. Cada una se envía solo a su proveedor (`generativelanguage.googleapis.com`, `api.anthropic.com`, `api.openai.com` o la URL base que configures).
- **Intermediario de IA** (`/api/ai/proxy`, solo para los proveedores compatibles): reenvía únicamente a rutas `/chat/completions` y `/models`, por `https` o a servidores del propio equipo.
- **Vault por ruta:** el servidor solo lee y escribe dentro de la carpeta del vault configurada. Rechaza rutas absolutas y las que intentan salir con `..`.
- **Servidor local:** escucha solo en `127.0.0.1` y rechaza pedidos que vengan de otros sitios.

## Estructura

| Carpeta / archivo | Qué hace |
|---|---|
| `src/components/Dashboard.tsx`, `Editor.tsx` | Pantalla de inicio y editor |
| `src/storage.ts`, `src/projects.ts` | Persistencia en JSON y operaciones sobre proyectos |
| `server/` | API local sobre el archivo JSON (dev y producción) |
| `src/generators/` | Adaptadores por plataforma y manejo de secretos |
| `src/importers/` | Lectura de configuraciones existentes (frontmatter y TOML) |
| `src/ai.ts` | Prompts |
| `src/llm.ts`, `src/providers/` | Capa común de IA (reintentos, esperas, cambio de modelo, JSON) y un adaptador por proveedor |
| `src/store.ts` | Estado, historial para deshacer, versión de contenido |
| `src/validate.ts`, `src/quality.ts`, `src/audit.ts` | Pestaña Problemas: validación, calidad y auditoría con IA |
| `src/repair.ts`, `src/components/QuestionsModal.tsx` | Reparación automática en rondas y preguntas al usuario |
| `src/i18n/`, `src/generators/content.ts` | Traducciones de la interfaz (12 idiomas) y del contenido generado |
| `src/obsidian.ts`, `src/vaultDir.ts`, `src/components/ObsidianModal.tsx` | Espejo en Obsidian: notas, canvas, sincronización de ida y vuelta, vault como fuente |
| `src/generators/guards.ts` | Guardarraíles: permisos, hooks y script de guarda |
| `src/cli/`, `vite.cli.config.ts` | CLI `emede` (generate, check, list) |
| `src/repoSync.ts`, `src/components/RepoPullModal.tsx` | Traer cambios del repo al diseño |
| `src/userTemplates.ts`, `src/components/UserTemplates.tsx` | Plantillas propias: guardar, compartir e importar paquetes |
| `src/routing.ts`, `src/components/RoutingModal.tsx` | Prueba de enrutamiento y mejora de descripciones |
| `src/tokens.ts`, `src/files.ts` | Estimación de tokens y cálculo de la salida (compartido entre la app y la CLI) |
| `src/design.ts` | Formato `.emede.json` (lectura validada y escritura) |
| `src/sanitize.ts` | Detección y limpieza de caracteres invisibles |
| `e2e/` | Pruebas de extremo a extremo (Playwright) |
| `src/templates.ts` | Biblioteca de plantillas |
| `src/stack.ts`, `src/detect.ts` | Catálogo de tecnologías y detección desde un repo |
| `src/__tests__/` | Pruebas (Vitest) |
