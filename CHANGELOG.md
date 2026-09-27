# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/); versiones según [SemVer](https://semver.org/lang/es/).

## [Sin publicar]

### Agregado
- **Pieza nueva: Hook.** Un comando que corre solo después de cada edición del agente (formatear, lint…), como nodo propio del lienzo (se puede tener más de uno) en vez de un campo escondido en los guardarraíles. Nativo en Claude Code (`PostToolUse`), Cursor (`afterFileEdit`) y Gemini CLI (`AfterTool`), junto con el hook de formato de los guardarraíles si hay uno. En OpenCode, Codex, Copilot y Roo Code, que no tienen un mecanismo de proyecto para esto, queda como instrucción de texto ("## Hooks") en el archivo de memoria. Con plantillas listas (Prettier, ESLint --fix).
- **Plataforma nueva: Roo Code.** Memoria y reglas en `AGENTS.md` (compartido con OpenCode/Codex), agentes como modos en `.roomodes`, comandos en `.roo/commands/*.md`, skills en `.agents/skills/` y servidores MCP en `.roo/mcp.json`. Verificado contra el código fuente de [RooCodeInc/Roo-Code](https://github.com/RooCodeInc/Roo-Code) (docs.roocode.com no fue alcanzable). Sin guardarraíles (Roo Code no tiene un mecanismo de proyecto para permisos/comandos) y sin sintaxis de referencia a variables de entorno en su MCP: un secreto queda en blanco, con una nota que lo explica, en vez de exponer el valor real o una referencia que Roo Code no resuelve.
- **Verificación en CI (`.github/actions/check`):** Action de GitHub reutilizable (`uses: c010r/emede/.github/actions/check@main`) que falla si un repo versiona un diseño (`.emede.json`) y los archivos generados por separado, y quedaron desincronizados — alguien editó `CLAUDE.md`/`AGENTS.md`/etc. a mano sin actualizar el diseño, o al revés. Usa la CLI (`emede check`), que ya existía; la Action solo la empaqueta para que no haga falta compilar emede a mano en cada repo que la use.
- **Instaladores de un solo comando:** `install.ps1` (Windows, también con doble clic en `install.cmd`) e `install.sh` (Linux y macOS). Instalan lo que falte (Git y Node.js 24: winget en Windows; gestor de paquetes y nvm en Linux), bajan o actualizan emede, instalan las dependencias y lo abren en el navegador. Se ejecutan también directo desde GitHub (`irm … | iex` y `curl … | bash`).
- **Aviso de servidor desactualizado:** si emede se actualiza (por ejemplo, con `git pull`) mientras el servidor sigue corriendo, la app lo detecta y pide reiniciarlo (Ctrl+C y `npm start`) en lugar de mostrar errores como "Método no permitido". El servidor informa una huella de su código en `/api/health` y la app compilada trae la que espera.
- **Pantalla de instalación en el navegador:** la primera vez que se abre emede guía por el idioma, la IA (proveedor, API key y prueba de conexión) y, si se quiere, el vault de Obsidian, y termina con un resumen. Se puede volver a abrir desde **⚙ Ajustes → Asistente de instalación**. Quien ya tenía la IA configurada no la ve.
- **Elegir el vault de Obsidian sin escribir la ruta:** Ajustes y la pantalla de instalación muestran los vaults que Obsidian ya usa en el equipo (un clic para elegir) y un explorador de carpetas que marca cuáles son vaults. Escribir la ruta queda como opción. El servidor solo devuelve nombres de carpetas, nunca archivos.
- **`npm start` listo para quien baja el proyecto de GitHub:** verifica la versión de Node, compila solo si falta el build o el código cambió (por ejemplo, después de un `git pull`), levanta el servidor y abre el navegador. Si emede ya está abierto, solo abre el navegador. El README tiene la instalación paso a paso.
- **Logo de emede:** una "M" armada como grafo de nodos (el lienzo), con la IA en el nodo central y la flecha "↓" de Markdown saliendo hacia los archivos. Se usa en el dashboard, en el editor y como favicon.
  - favicon en SVG, más `favicon.ico` (16/32/48 px) y `apple-touch-icon.png` (180 px) para navegadores y sistemas que no usan SVG; se regeneran desde el logo con `npm run favicons`;
  - al abrir la app, una presentación de 5 segundos arma el grafo pieza por pieza y pasa al dashboard; un clic o una tecla la saltean;
  - al volver del editor al dashboard se anima el logo de la barra;
  - con `prefers-reduced-motion` no hay animación.
- **Guardado automático en Obsidian:** con el vault vinculado en Ajustes, las notas se guardan solas.
  - al vincularlo (y al abrir la app) se crean las notas que falten de todos los proyectos;
  - después, cada pieza nueva se guarda en cuanto tiene nombre propio (las que siguen como `nuevo-agente`, `nueva-skill`… esperan);
  - solo crea: nunca pisa ni borra una nota existente, y no revive las que se borraron en Obsidian. Actualizar sigue siendo **Enviar a Obsidian**, con diff y respaldo.
- **Indicador de Obsidian en la barra del editor:** muestra si el vault está al día o cuántas notas faltan guardar (cambiadas, renombradas o de piezas borradas). Un click abre directo la vista de cambios, con diff y respaldo antes de escribir.
- **Plantillas propias** (📚 Plantillas → ⭐ Mis plantillas):
  - guardar una o varias piezas del proyecto como paquete, con sus conexiones (también desde el Inspector con **💾 Plantilla**);
  - quedan disponibles en todos los proyectos y se insertan como las de la biblioteca; si están escritas en otro idioma que el del contenido, se traducen con IA;
  - se comparten con el equipo como `.emede-pack.json` (exportar/importar). Al importar se valida la forma, se quitan caracteres invisibles y campos desconocidos.
  - Los secretos de MCP nunca se guardan en una plantilla: quedan como referencias `${VAR}`.
- **Prueba de enrutamiento** (Problemas → 🧭 Probar enrutamiento):
  - pedidos de ejemplo y qué agente o skill elige la IA viendo solo nombre y descripción, como la herramienta real;
  - "✨ Sugerir casos" los escribe a partir de lo que hace cada pieza (no de su descripción), más algunos que ninguna debería tomar;
  - "🔧 Mejorar descripciones" reescribe las descripciones de las piezas que se confundieron y vuelve a probar (Ctrl+Z para deshacer);
  - los casos se guardan con el proyecto y no se escriben en ningún archivo generado.
- **Línea de comandos `emede`** para usar en CI y en la terminal:
  - `emede generate` escribe los archivos desde un `.emede.json` o un proyecto guardado (`--project`), muestra qué cambia y respalda lo que reemplaza;
  - `emede check` falla con código 1 si los archivos del repo no coinciden con el diseño, e indica cuáles;
  - `emede list` lista los proyectos guardados.
  - Opciones `--targets`, `--lang`, `--out`, `--dir`, `--dry-run` y `--no-backup`. Los mensajes salen en el idioma del sistema.
- **"⬇ Traer cambios del repo"** (en Archivos): compara la carpeta con lo que genera el diseño y propone los cambios del repo como cambios en las piezas (con diff), así una edición hecha en `.claude/agents/x.md` llega a todas las plataformas. Las piezas nuevas se ofrecen para crear y lo que no corresponde a ningún campo queda como edición manual del archivo.
- **Tamaño en tokens:** cada archivo muestra ≈tokens, y Archivos muestra el contexto fijo que cada herramienta carga en cada sesión (memoria, reglas sin `paths`, reglas `alwaysApply`, etc.). El aviso de memoria larga ahora se basa en ese costo (3000 tokens) en lugar de líneas.
- El `.emede.json` exportado incluye una sección `generate` (plataformas, idioma, ediciones manuales y exclusiones), así la CLI genera exactamente lo mismo que la app.
- **Interfaz y contenido en 12 idiomas:** español, inglés, portugués de Brasil, francés, italiano, chino mandarín (simplificado), cantonés (tradicional), hindi, bengalí, maratí, telugu y tamil.
  - El idioma de la interfaz y el del contenido generado se eligen por separado.
  - La primera vez se usa el idioma del navegador.
  - Las plantillas se traducen con IA al insertarlas.
  - Los chequeos de calidad reconocen "cuándo usar" en todos esos idiomas.
- **Varios proveedores de IA:**
  - Google Gemini;
  - Anthropic Claude, con el SDK oficial;
  - OpenAI;
  - cualquier servicio compatible con OpenAI (OpenRouter, DeepSeek, Groq, Mistral, xAI, Ollama, LM Studio).
  - Cada uno guarda su clave y su modelo. Los ajustes anteriores (clave de Gemini) se migran solos.
- **Ruta del vault de Obsidian en Ajustes**, con verificación en el momento. El servidor local lo lee y escribe por esa ruta.
- **Integración con Obsidian** (📓):
  - espejo del proyecto en el vault, con una nota por pieza, propiedades, `[[enlaces]]` y un `.canvas` igual al lienzo;
  - "Traer cambios", con detección de ediciones y de conflictos por huella de contenido;
  - notas del vault como fuente en "Desde plan".
  - Los secretos de MCP nunca se escriben en el vault.
- **Reparación automática de problemas** ("🔧 Reparar todo"):
  - arreglos fijos sin IA;
  - corrección con IA de todos los campos en un solo pedido, con las mismas reglas que los chequeos;
  - modal de preguntas que se abre solo cuando falta un dato o una decisión del usuario.
  - Corre sola después de generar con IA, desde un plan, importar o completar vacíos. Se deshace con un Ctrl+Z.
- **"Dejarlo así"** en cada problema: queda guardado en el proyecto y no se vuelve a marcar.
- **Ayuda del lienzo** ("? Qué es esto"): qué archivo genera cada tipo de tarjeta y qué significan las flechas.
- **Guardarraíles (permisos y hooks):** lo que se tiene que cumplir se aplica con los mecanismos de cada herramienta, no solo con instrucciones.
  - Claude Code: `.claude/settings.json`, con permisos `allow`, `ask` y `deny` y hooks de formato y de tests antes de terminar.
  - OpenCode: `permission` por patrón.
  - Codex: sandbox y política de aprobación.
  - Gemini CLI: herramientas aprobadas o que piden confirmación, hooks y `.geminiignore`.
  - Cursor: `hooks.json` y `.cursorignore`.
  - Script de guarda multiplataforma: `scripts/agent-guard.mjs`.
- **Protección contra el "Rules File Backdoor":** se detectan y quitan los caracteres Unicode invisibles (ancho cero, controles bidi, caracteres "tag") al importar repos, al recibir respuestas de la IA, al abrir diseños `.json` y al generar archivos. El validador los marca con el botón "Limpiar".
- **Auditoría de instrucciones:**
  - Chequeos automáticos: principios abstractos sin ejemplos, instrucciones vagas, agentes o skills con descripciones casi iguales, skills que no dicen cuándo usarse.
  - "✨ Auditar con IA": puntaje, contradicciones, huecos y reescrituras que se aplican con un click (y se deshacen con Ctrl+Z).
- **Generar desde un plan:** texto, `.md`, `.txt` o `.pdf`. El plan se guarda como `docs/PLAN.md` y la memoria lo referencia.
- **Canario de contexto** en todos los archivos de memoria, con marca o con el nombre del usuario, y en los subagentes.
- **Dashboard de proyectos** y persistencia en un archivo JSON (`~/.emede/emede.json`) con escritura atómica y respaldo.
- **Guardado de emergencia** al cerrar o recargar la pestaña con cambios pendientes.
- **Calidad del proyecto:**
  - pruebas unitarias y de integración (Vitest)
  - pruebas de extremo a extremo con navegador real (Playwright)
  - CI en GitHub Actions

### Cambiado
- **README:** instalación local paso a paso (requisitos por sistema operativo, bajar, abrir, actualizar, dónde quedan los datos, variables según la terminal, problemas frecuentes y desinstalar).
- El aviso de puerto ocupado sugiere la forma de cambiar el puerto que funciona en Windows (`$env:PORT=5180; npm start`).
- **Estilos con Tailwind CSS v4:** los componentes usan utilidades de Tailwind; los colores de la app son tokens del tema (`bg-panel`, `text-muted`, `border-line`…) y las piezas que se repiten (botones, modales, campos, chips) son primitivas en `src/styles.css`. La interfaz se ve igual que antes.
- Sin IA configurada, la app ya no abre **⚙ Ajustes** en cada arranque: lo resuelve la pantalla de instalación la primera vez, y después las funciones de IA indican que falta la clave.
- `npm start` pasa a ser el lanzador (`scripts/start.mjs`); el servidor solo, sobre el build existente, es `npm run server`.
- **Arranque más liviano:** el editor (React Flow) y los modales de plan, plantillas, importar repo y Obsidian se cargan en diferido. El bundle inicial pasa de 713 kB a 361 kB y el editor se precarga en cuanto aparece el dashboard.
- **La auditoría con IA ahora es "Auditar y reparar":**
  - solo detecta y la corrección la hace la reparación, así dos hallazgos sobre el mismo campo ya no se pisan;
  - recuerda lo ya tratado, corre con temperatura 0 y puede devolver cero hallazgos, así deja de aparecer una tanda nueva de problemas en cada corrida.
- El aviso de secretos de MCP ya no cuenta como problema (se sigue mostrando en el Inspector). Se quitó el aviso de "skill suelta", que duplicaba el de descripción vacía.
- Formatos actualizados según la documentación oficial:
  - OpenCode usa `agents/`, `commands/` y `permission`.
  - Codex usa `.codex/agents/*.toml` y skills en `.agents/skills/` (los prompts personalizados quedaron obsoletos).
  - Gemini CLI y Cursor tienen subagentes nativos.
  - En Claude, `skills` pasa a ser una lista YAML.

### Corregido
- "Enviar a Obsidian" fallaba al actualizar o borrar notas existentes: el servidor rechazaba el respaldo en `.emede-backup/` del vault. Ahora se puede escribir ahí (solo notas; leer y borrar siguen bloqueados, igual que el resto de las carpetas ocultas).
- Las notas del espejo de Obsidian pasan por la sanitización también al enviarlas a mano (antes solo las del guardado automático).
- Borrar una pieza y enviar ya no deja su nota registrada como pendiente para siempre.
- El importador reconoce el texto generado en los 12 idiomas (antes solo español e inglés), incluidas las listas separadas con `，` y `、`.
- El sanitizador ya no borra el ZWNJ/ZWJ legítimo dentro de palabras en escrituras índicas (telugu, bengalí, etc.) ni en emojis compuestos; los sigue marcando cuando aparecen sueltos o entre letras latinas.

### Seguridad
- Los secretos de MCP nunca se escriben en los archivos generados: se reemplazan por referencias a variables de entorno y se listan en `.env.example`.
- "Guardar en carpeta" muestra un diff antes de escribir y respalda los archivos reemplazados.
- La API local solo atiende conexiones de loopback con `Host` `localhost`/`127.0.0.1`: una página maliciosa ya no puede leer las API keys ni el vault por DNS rebinding, y con `HOST=0.0.0.0` la red local no tiene acceso.
- El vault por ruta solo lee, escribe y borra notas `.md` y lienzos `.canvas` fuera de carpetas ocultas; rechaza rutas absolutas (antes se escribían dentro del vault) y enlaces simbólicos que salen de él. Aunque la ruta del vault apunte a la carpeta personal, la API ya no toca `.bashrc`, `.ssh/` ni otros archivos.
- Una URL con `%` mal formado ya no tira el servidor de producción.
- `~/.emede/` y `emede.json` (con sus copias `.bak` y `.corrupto-*`) se crean solo para el usuario (0700/0600), porque guardan las API keys.
- La API solo acepta el `Origin` de la propia app (mismo host y puerto) y cuerpos `application/json`: otra app web del equipo, en otro puerto, ya no puede mandarle pedidos (tampoco con `text/plain`, que el navegador envía sin preguntar).
- El intermediario de IA no sigue redirecciones (la clave no viaja a otro destino) y no se conecta a direcciones link-local como `169.254.169.254`, donde los proveedores de nube publican credenciales. La red local sigue permitida para servidores de modelos en otra máquina.
- Los errores internos del servidor ya no devuelven rutas ni detalles del sistema; quedan en la consola donde corre emede.
- Al abrir un `.emede.json`, importar un `.emede-pack.json` o correr `emede generate` sobre un diseño, se avisa qué comandos ejecutarán los agentes: servidores MCP, formateador, tests obligatorios, comandos aprobados sin preguntar y ediciones manuales de archivos de hooks y permisos.
