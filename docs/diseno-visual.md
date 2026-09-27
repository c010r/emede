# Diseño visual de emede

_Fecha: 2026-09-27_

Qué es la identidad visual de la app (no confundir con `src/design.ts`, el formato `.emede.json` del diseño/grafo de cada proyecto). Sirve de referencia para tocar el logo, los colores o la interfaz sin romper la coherencia del conjunto.

## 1. El logo

Una **"M" armada como un grafo de nodos** — el mismo lenguaje visual que el lienzo del editor — de la que cuelga la flecha "↓" de Markdown: **M↓ = emede**, del diseño visual salen los archivos `.md`.

- 5 nodos dibujan la M (`src/components/Logo.tsx:11`); el del medio (índice `AI`, línea 12) es el nodo de la IA y va en `--color-ai` (violeta), los otros cuatro en `--color-accent` (ámbar).
- `LogoMark` es el ícono solo (SVG, `viewBox 0 0 48 48`); `Logo` le suma la palabra "emede" y es lo que se usa en las barras superiores del dashboard y el editor.
- Con `animate`, el grafo se arma en capas (`src/styles.css:160-172`): el marco entra girando, las aristas se dibujan (`stroke-dasharray`/`pathLength=1`), los nodos aparecen uno por uno con retardo creciente (`--i` por nodo), el nodo de la IA late al final y cae la flecha.
- `Splash` (`Logo.tsx:52`) es la presentación de 5 segundos al abrir la app: tapa la interfaz (`fixed inset-0`, `z-100`) pero un clic o una tecla la saltea sin que ese clic le llegue a lo de abajo.
- Con `prefers-reduced-motion: reduce` no hay animación ni presentación (`src/styles.css:182-185`).
- El favicon (`public/favicon.svg`, más `.ico`/`apple-touch-icon.png` generados con `npm run favicons` desde `scripts/favicons.ts`) es una copia estática del mismo dibujo.

## 2. Paleta

Tokens de color en `@theme` (`src/styles.css:12-35`), tema oscuro único (`color-scheme: dark`):

| Token Tailwind | Valor | Uso |
|---|---|---|
| `bg` | `#0e1015` | fondo de la app |
| `panel` / `panel2` | `#151821` / `#1b1f2a` | barras, tarjetas, modales |
| `line` / `line-hover` | `#262b38` / `#3a4152` | bordes |
| `fg` | `#e6e8ee` | texto |
| `muted` | `#8b92a5` | texto secundario |
| `accent` | `#f5b841` | color de marca — CTAs, foco, nodos del logo |
| `ai` | `#a78bfa` | todo lo relacionado con la IA (botón "Diseñar con IA", nodo central del logo) |
| `danger` / `ok` / `warn` / `info` | `#ff6b6b` / `#4fd1a5` / `#ffb447` / `#62c6e8` | estados |
| `add` / `del` | `#7ee2a8` / `#ff9b9b` | líneas agregadas/quitadas en el diff |

Un segundo bloque de variables cortas (`:root`, `styles.css:38-50`) repite los mismos valores sin el prefijo `color-`: los usan el SVG del logo y React Flow, que necesitan `var(--accent)` en vez de clases de Tailwind.

## 3. Tipografía y forma

- Fuente del sistema con más cobertura no latina (chino, devanagari, bengalí, telugu, tamil) — `--font-sans` en `src/styles.css:31-33` — porque el contenido generado (y la interfaz, con `uiLang`) puede estar en cualquiera de esos idiomas.
- Monoespaciada (`--font-mono`) para el código: vista previa de archivos, rutas, `pre`.
- Radios entre 7 y 14 px (campos, botones, modales, chips); nada cuadrado ni completamente redondo salvo los chips (`rounded-[14px]`) y los pasos de la instalación (círculos).

## 4. Sistema de componentes (Tailwind)

Desde la migración a Tailwind CSS v4 (`src/styles.css:1`), casi toda la interfaz usa utilidades directamente en el JSX de cada componente. Lo que queda como clases propias son las **primitivas que se repiten** entre componentes, en `@layer components` (`src/styles.css:72-144`): `.btn` (con variantes `primary`, `ai`, `ghost`, `danger`, `small`), `.modal`/`.modal-head`/`.modal-foot`, `.field`, `.chip`/`.chip-c` (esta última se tiñe con el color de categoría de cada pieza vía `--c`), `.provider`, `.tabs`, `.badge`, `.note`, `.tag`.

Fuera de esas clases, en CSS plano quedan solo tres cosas que Tailwind no cubre bien: React Flow (`.react-flow__*`), el SVG del logo (§1) y la presentación de inicio.

## 5. Pantallas principales

- **Dashboard** (`src/components/Dashboard.tsx`) — punto de entrada: `Logo` en la barra, tarjetas para empezar un proyecto (`.start`), buscador y lista de proyectos guardados.
- **Editor** (`src/components/Editor.tsx`) — lienzo de nodos (React Flow) con paleta a la izquierda, inspector a la derecha y pestañas de Archivos/Problemas abajo; `Logo` chico (`small`) en la barra, que debajo de 1500 px de ancho se queda sin la palabra "emede" para dejarle lugar al nombre del proyecto (`Logo.tsx:40`).
- **Instalación** (`src/components/Setup.tsx`) — la primera vez que se abre emede: idioma → IA → Obsidian (opcional) → resumen, con `Logo` arriba y un indicador de pasos con círculos numerados.
- Los nodos del lienzo (`NodeCard.tsx`) se distinguen por color de categoría (`--c`, la misma paleta que `.chip-c`), no por el logo.

## 6. Accesibilidad y movimiento

- Todo lo animado respeta `prefers-reduced-motion` (§1, §4).
- El logo y el ícono del favicon son puramente decorativos (`aria-hidden="true"` en el SVG); el nombre "emede" en texto es lo que leen los lectores de pantalla.
- Contraste: la paleta se pensó para AA sobre `--bg`/`--panel` (texto `--fg` y `--muted` legibles; los estados usan versiones "soft" — `danger-soft`, `warn-soft` — sobre fondos oscuros en vez de texto saturado).

## 7. Si cambia el logo

1. Editar `src/components/Logo.tsx` (geometría) y `src/styles.css:153-172` (color/animación).
2. `npm run favicons` regenera `public/favicon.ico` y `public/apple-touch-icon.png` desde `public/favicon.svg` — pero ese SVG es una copia estática: si cambia la geometría en `Logo.tsx`, hay que llevar el mismo cambio a `public/favicon.svg` a mano antes de regenerar.
3. Revisar capturas del dashboard, el editor (chico, con y sin la palabra "emede") y la presentación completa — no hay prueba automática que compare píxeles.
