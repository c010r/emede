# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/); versiones según [SemVer](https://semver.org/lang/es/).

## [Sin publicar]

### Agregado
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
