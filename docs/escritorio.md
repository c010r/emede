# emede como aplicación de escritorio: estudio de viabilidad

_Fecha: 2026-09-25_

## Punto de partida

La arquitectura actual ya está preparada para empaquetarse:

- **Frontend** (React + Vite): no sabe dónde se guardan los datos. Habla con una interfaz `Backend` (`src/storage.ts`) que tiene dos implementaciones: servidor local o navegador.
- **Persistencia**: `server/api.ts` + `server/store.ts`, Node puro, sin dependencias. Guarda en un JSON en `~/.emede/emede.json`, con escritura atómica y respaldo `.bak`.
- **Acceso a carpetas** (importar repo, detectar stack, guardar archivos): usa la File System Access API (`showDirectoryPicker`), aislada en `src/fs.ts`.
- **IA**: llamadas directas desde la interfaz a `generativelanguage.googleapis.com`.

Cualquier opción de escritorio solo tiene que resolver dos cosas: **dónde corre la API del JSON** y **cómo se accede a las carpetas**.

## Opciones

| | PWA instalable | **Electron** | Tauri 2 |
|---|---|---|---|
| Ventana propia, ícono, menú de inicio | ✔ | ✔ | ✔ |
| Independiente del navegador | ✘ (usa Chrome/Edge) | ✔ | ✔ |
| Funciona sin `npm start` aparte | ✘ | ✔ (Node incluido) | ✔ si se porta la API a Rust |
| Reutiliza `server/api.ts` sin cambios | — | ✔ | ✘ (portar a Rust o incluir Node aparte) |
| Carpetas (`showDirectoryPicker`) | ✔ | ✔ Chromium¹ | Windows ✔ (WebView2) / macOS-Linux ✘ (WebKit) |
| Tamaño del instalador | 0 | ~90–120 MB | ~5–10 MB |
| Memoria en uso | la del navegador | ~150–250 MB | ~60–100 MB |
| Herramientas extra | ninguna | electron-builder | toolchain de Rust |
| Esfuerzo estimado | 2–4 h | **1–2 días** | 3–5 días |

¹ Electron soporta la API desde 2024, pero hubo regresiones al recorrer directorios en algunas versiones ([electron#45225](https://github.com/electron/electron/issues/45225)). Conviene implementar el acceso a carpetas por IPC con `fs` de Node, detrás de la misma interfaz de `src/fs.ts`.

### Descartadas
- **Ejecutable único con Node (SEA/pkg) que abre el navegador:** sigue dependiendo del navegador, que es justo lo que se quiere evitar.

## Recomendación: Electron

Es la opción de menor riesgo y la más rápida: **el 100 % del código actual se reutiliza**.

1. El proceso principal levanta la misma API (`createApi`) y sirve `dist/` en `127.0.0.1` con un puerto libre.
2. Abre una `BrowserWindow` apuntando ahí. El frontend detecta el servidor igual que hoy (`/api/health`).
3. Los datos siguen en `~/.emede/emede.json`, así que **la app de escritorio y la versión web comparten proyectos**.

Si más adelante importa mucho el tamaño del instalador, se puede migrar a Tauri: solo cambian el backend (`storage.ts`) y el acceso a carpetas (`fs.ts`), no la interfaz.

## Plan de implementación (Electron)

| Paso | Detalle |
|---|---|
| `electron/main.ts` | Servidor HTTP con `createApi` + estáticos en un puerto libre; ventana; una sola instancia (`requestSingleInstanceLock`); menú mínimo. |
| Seguridad | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; abrir enlaces externos en el navegador del sistema. |
| Carpetas | `preload.ts` expone `pickDir`, `readText`, `writeText` y `list` por IPC. `src/fs.ts` los usa si existen; si no, usa la API web. |
| API key | Guardarla cifrada con `safeStorage` (llavero del sistema) en lugar de texto plano en el JSON. Es una mejora que la web no puede tener. |
| Empaquetado | `electron-builder`: instalador `.exe` (NSIS) para Windows, `.dmg` para macOS y `AppImage`/`.deb` para Linux. |
| Actualizaciones | `electron-updater` con GitHub Releases (opcional). |
| Firma | Sin certificado de firma, Windows muestra el aviso de SmartScreen la primera vez. Un certificado de firma de código cuesta ~USD 100–400 por año. |

## Riesgos

- **Aviso de SmartScreen** sin firma: se acepta en uso interno; para distribución pública conviene firmar.
- **Tamaño**: ~100 MB es habitual en apps Electron (VS Code, Slack), pero es 10 veces más que Tauri.
- **Regresiones de la File System Access API en Electron**: se evitan con el acceso por IPC propuesto.

## Paso intermedio opcional

Hacer la app instalable como **PWA** (manifest + service worker) toma 2–4 h. Da ícono y ventana propia desde Chrome/Edge, pero sigue necesitando `npm start` corriendo. Sirve como mejora rápida, no reemplaza a Electron.
