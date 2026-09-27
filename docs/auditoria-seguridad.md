# Auditoría de seguridad — septiembre 2026

Revisión del código de emede en busca de vulnerabilidades. Se encontraron 9 hallazgos y los 9 quedaron resueltos:

- los cuatro más graves, en [#1](https://github.com/c010r/emede/pull/1) (commit `1ed013f`, fusionado en `edf0fd7`);
- el resto, en [#2](https://github.com/c010r/emede/pull/2) (commit `3b999d4`, fusionado en `e57ed2e`).

## Resumen

| # | Gravedad | Hallazgo | Estado |
|---|---|---|---|
| 1 | Crítica | La API sin autenticación permitía leer y escribir cualquier archivo del disco a través del vault | Corregido en #1 |
| 2 | Alta | DNS rebinding: una página web podía leer las API keys y el vault | Corregido en #1 |
| 3 | Media | Una URL mal formada tiraba el servidor | Corregido en #1 |
| 4 | Media | Las API keys se guardaban legibles para otros usuarios del equipo | Corregido en #1 |
| 5 | Baja | Otras apps web del equipo podían mandarle pedidos a la API | Corregido en #2 |
| 6 | Baja | El proxy de IA seguía redirecciones y llegaba a direcciones de metadatos de la nube | Corregido en #2 |
| 7 | Baja | Enlaces simbólicos dentro del vault llevaban afuera | Corregido en #1 |
| 8 | Baja | Los errores internos devolvían rutas y detalles del sistema | Corregido en #2 |
| 9 | Informativa | Un diseño o plantilla ajena puede traer comandos que ejecutan los agentes | Mitigado en #2 (aviso) |

## Alcance y método

- **Qué se revisó:** todo el repositorio en `d63ed48`. El servidor local (`server/`), la CLI (`src/cli/`), los generadores de archivos, los importadores, el manejo de secretos y de API keys, el CI (`.github/workflows/ci.yml`) y la configuración de Claude Code (`.claude/`).
- **Cómo se confirmaron los hallazgos:** los principales se reprodujeron levantando `node server/index.ts` y mandando pedidos con `curl`. Cada arreglo se volvió a probar de la misma forma.
- **Dependencias:** `npm audit` no encontró vulnerabilidades conocidas.

## Hallazgos

### 1. La API permitía leer y escribir cualquier archivo del disco — Crítica

**Dónde:** `server/api.ts`, `server/vault.ts`.

**Problema.** La API no tiene autenticación y se protegía solo con la cabecera `Origin`, que las peticiones hechas fuera del navegador no mandan. El ataque tenía dos pasos:

1. `PUT /api/settings` aceptaba cualquier `vaultPath`, incluso `/etc` o la carpeta personal.
2. A partir de ahí, `/api/vault/file` leía, escribía o borraba cualquier archivo bajo esa ruta, con cualquier extensión.

Se confirmó leyendo `/etc/hostname`. Del mismo modo se podía escribir `~/.bashrc` o `~/.ssh/authorized_keys`, lo que equivale a ejecutar código en el equipo. Con `HOST=0.0.0.0`, cualquier equipo de la red local podía hacerlo.

Había además un bug relacionado: `inside()` quitaba la `/` inicial antes de comprobar si la ruta era absoluta. Así, `/tmp/x.md` terminaba escrito *dentro* del vault en vez de rechazarse. Por eso fallaban dos tests en `main`.

**Arreglo.**
- La API solo acepta conexiones que vienen de la propia máquina (ver hallazgo 2).
- Leer, escribir y borrar solo funciona con notas `.md` y lienzos `.canvas` que no estén dentro de carpetas ocultas (`.ssh/`, `.git/`, `.obsidian/`…). Para todo lo demás, la API responde con el error `not-note`.
- Las rutas absolutas (`/etc/x`, `C:/x`) se rechazan.

**Verificación.** Leer `/etc/hostname` y escribir `.bashrc` ahora devuelven `not-note`.

### 2. DNS rebinding y acceso desde la red local — Alta

**Dónde:** `server/api.ts` (`rejectRequest`).

**Problema.** El servidor no comprobaba la cabecera `Host`. El ataque (DNS rebinding) funcionaba así:

1. Una página maliciosa apunta su propio dominio a `127.0.0.1`.
2. Para el navegador, esa página pasa a ser "del mismo origen" que emede.
3. En los GET del mismo origen, el navegador no manda la cabecera `Origin`, así que el chequeo no se aplicaba.
4. La página podía leer `/api/settings` (las API keys de Gemini, Anthropic y OpenAI), `/api/projects` y el vault completo.

Se confirmó con `Host: evil.example`.

**Arreglo.** La API rechaza con 403 cualquier petición que no venga de la propia máquina o cuyo `Host` no sea `localhost`, `127.0.0.1` o `[::1]`. Si se arranca con `HOST=0.0.0.0`, el servidor muestra un aviso y la API sigue atendiendo solo al propio equipo.

**Verificación.** `Host: evil.example` ahora recibe 403.

### 3. Una URL mal formada tiraba el servidor — Media

**Dónde:** `server/index.ts`.

**Problema.** Con `GET /%E0%A4%A`, `decodeURIComponent` lanzaba un error. Nadie capturaba esa promesa rechazada y Node terminaba el proceso. Una sola petición dejaba emede sin servicio.

**Arreglo.**
- La decodificación se hace dentro de un `try/catch` y una URL inválida se trata como inexistente.
- Cualquier error dentro de un pedido se registra en la consola en lugar de terminar el proceso.

**Verificación.** La URL mal formada responde 200 (sirve la app) y el servidor sigue funcionando.

### 4. API keys legibles por otros usuarios del equipo — Media

**Dónde:** `server/store.ts`.

**Problema.** `~/.emede/emede.json`, que guarda las API keys en texto plano, se creaba con permisos `0644`. Lo mismo pasaba con sus copias `.bak` y `.corrupto-*`. Cualquier usuario del mismo equipo podía leerlos.

**Arreglo.**
- La carpeta se crea con permisos `0700`.
- `emede.json`, `.bak` y `.corrupto-*` se crean con `0600`.
- Un archivo que ya existía con permisos abiertos se corrige en la siguiente escritura.

**Verificación.** Los archivos quedan como `drwx------` y `-rw-------`.

### 5. Otras apps web del equipo podían usar la API — Baja

**Dónde:** `server/api.ts` (`rejectRequest`).

**Problema.** Se aceptaba el `Origin` de cualquier puerto de `localhost`. Además, el cuerpo de las peticiones se leía sin mirar su tipo. Por eso otra app web del equipo, en otro puerto, podía hacer un POST con `text/plain`, que el navegador envía sin pedir permiso antes (sin *preflight*).

**Arreglo.**
- Si hay `Origin`, tiene que ser exactamente `http://<Host>`: la propia app, en el mismo puerto. Se sigue aceptando `tauri://`.
- Los POST, PUT y PATCH tienen que ser `application/json`. El navegador no manda ese tipo a otro sitio sin pedir permiso antes, y la API no lo da.

**Verificación.** Un `Origin` de otro puerto recibe 403. Un POST `text/plain` recibe 403.

### 6. El proxy de IA seguía redirecciones — Baja

**Dónde:** `server/api.ts` (`proxy`).

**Problema.** El proxy para proveedores compatibles con OpenAI tenía dos puntos débiles:

- Aceptaba cualquier destino `https`, incluidas direcciones internas.
- Seguía redirecciones, así que un destino podía reenviar el pedido, junto con la cabecera `Authorization`, a otra dirección. Por ejemplo, a `169.254.169.254`, donde los proveedores de nube publican las credenciales de la máquina.

**Arreglo.**
- El proxy ya no sigue redirecciones. Si el destino responde con una, emede contesta 502 y pide la URL final.
- Antes de conectarse, se resuelve el nombre del destino. Se rechazan las direcciones link-local (`169.254.x.x`, `fe80::`) y `0.0.0.0` / `::`.

**Verificación.** El proxy hacia `169.254.169.254` responde 400.

### 7. Enlaces simbólicos que salían del vault — Baja

**Dónde:** `server/vault.ts`.

**Problema.** `inside()` calculaba la ruta con `resolve`, que no sigue enlaces simbólicos. Un enlace dentro del vault que apuntara afuera permitía leer o escribir fuera de él.

**Arreglo.** Las rutas se resuelven con `realpath`. Si el destino real queda fuera del vault, se responde con el error `outside`.

**Pendiente.** `/api/vault/info?path=` sigue diciendo si existe cualquier ruta del disco. La pantalla de Ajustes lo necesita para validar lo que se escribe. Desde #1 y #2 solo responde a la propia app.

### 8. Errores con detalles del sistema — Baja

**Dónde:** `server/api.ts`.

**Problema.** Los errores 5xx devolvían el mensaje interno, que puede incluir rutas del disco o detalles del sistema.

**Arreglo.**
- Los errores 5xx devuelven un mensaje genérico. El detalle va a la consola donde corre emede.
- Los errores 4xx siguen mostrando su mensaje.
- `/api/health` sigue devolviendo la ruta del archivo de datos, porque el dashboard la muestra.

### 9. Diseños y plantillas ajenas pueden traer comandos — Informativa

**Dónde:** `src/risky.ts`, `src/projects.ts`, `src/components/UserTemplates.tsx`, `src/cli/main.ts`.

**Problema.** Un `.emede.json` o un `.emede-pack.json` escrito por otra persona puede incluir comandos que los agentes ejecutarán en el equipo. Es parte del diseño de emede, pero hasta ahora nada lo señalaba.

**Arreglo.** Se muestra un aviso con los comandos que se van a ejecutar:

- servidores MCP locales (`stdio`);
- el formateador que corre después de cada edición;
- los tests que se exigen antes de terminar;
- los comandos que se aprueban sin preguntar (incluidos los de test y lint);
- las ediciones manuales de archivos que definen hooks, permisos o MCP.

El aviso aparece al abrir un `.emede.json`, al importar un `.emede-pack.json` y en `emede generate` sobre un archivo. `emede check` no avisa, porque solo lee. El aviso no bloquea nada. Los mensajes están en los 9 idiomas de la app.

## Riesgos que quedan

- **Programas del mismo usuario:** pueden usar la API o leer `~/.emede/` directamente. Es el límite de cualquier app local sin cifrado. Guardar las claves en el llavero del sistema está previsto en la versión de escritorio (`docs/escritorio.md`).
- **Cambio de dirección en el proxy de IA:** la dirección se comprueba al resolver el nombre y la conexión se hace en un segundo paso. Un servidor DNS malicioso podría cambiar la respuesta entre medio. El proxy solo lo puede usar la propia app.
- **Red local permitida en el proxy de IA:** sirve para servidores de modelos en otra máquina (Ollama, LM Studio).
- **Cambio de enlace en el vault:** el vault comprueba el enlace simbólico y después escribe en un paso aparte. Un programa local podría cambiar el enlace entre los dos pasos, pero ese programa ya tiene acceso al disco por su cuenta.

## Lo que ya estaba bien

- Los nombres de los archivos generados pasan por `slug()`, así que un diseño no puede escribir fuera de la carpeta de destino.
- Todo lo que entra se limpia de caracteres Unicode invisibles (`src/sanitize.ts`), la defensa contra el "Rules File Backdoor".
- Los secretos de MCP nunca se escriben literales: se reemplazan por `${VAR}` y se listan en `.env.example`.
- "Guardar en carpeta" muestra un diff antes de escribir y respalda lo que reemplaza.
- El CI corre con `permissions: contents: read`.
- `.env` está en `.gitignore`.

## Pruebas agregadas

- `src/__tests__/server.test.ts`:
  - `Host` y `Origin` ajenos;
  - peticiones sin JSON;
  - conexiones que no vienen de la propia máquina;
  - permisos del archivo de datos;
  - tipos de archivo del vault y carpetas ocultas;
  - enlaces simbólicos;
  - error 500 sin detalles;
  - proxy hacia direcciones bloqueadas y redirecciones.
- `src/__tests__/risky.test.ts`: cómo se detectan los comandos y cómo se arma el aviso.
- `src/__tests__/cli.test.ts`: el aviso sale en `generate` y no en `check`.

Estado al cierre: 226 tests unitarios, build (con chequeo de tipos) y 4 pruebas e2e, todo en verde local y en CI.
