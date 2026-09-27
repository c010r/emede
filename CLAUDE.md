# Memoria del proyecto: emede

## Canario de contexto

Empezá **cada** respuesta con `🐤 CANARIO-SVZW` en la primera línea. Es una verificación: si la marca falta, significa que perdiste estas instrucciones y hay que volver a cargarlas.

- No inventes archivos, funciones, APIs, comandos, flags ni versiones: verificalos leyendo el código o la documentación antes de usarlos.
- Si no estás seguro de algo, decilo y explicá cómo verificarlo en lugar de suponer.
- Cuando afirmes algo sobre el código, citá la ruta (y la línea si aplica).

## Objetivo
emede es un diseñador visual asistido por IA (Google Gemini) que genera los archivos de configuración para agentes de código. Principio rector: la IA decide el contenido, el código decide el formato.

## Stack
- TypeScript (^7.0, modo strict)
- React (^19.3) + @xyflow/react (^12.12) + zustand (^5.0)
- Tailwind CSS (^4.3) con `@tailwindcss/vite`
- Vite (^8.3) + jszip (^3.10)
- Servidor local en Node.js puro (Node 24)
- Vitest + Testing Library + Playwright

## Guardarraíles

- Nunca leas ni modifiques: `.env`, `.env.*`, `secrets/**`, `**/*.pem`, `**/*.key`.
- Nunca ejecutes: `git push --force`, `git reset --hard`, `sudo`.
- Pedí confirmación antes de ejecutar: `git push`, `rm -rf`, `npm publish`.

## Plan del proyecto

El plan completo está en `docs/PLAN.md`. Leelo antes de empezar una fase o tarea y respetá su orden y sus criterios de aceptación.

## Reglas

### restriccion-secretos-y-api

Nunca escribas valores de tokens, claves o Authorization en archivos generados ni exportaciones. La API key de Gemini solo se guarda en ~/.emede/emede.json y solo se envía a generativelanguage.googleapis.com.

### sanitizacion-caracteres

Todo lo que entra (repos importados, respuestas de IA, JSON abiertos) y todo lo que se genera debe pasar obligatoriamente por src/sanitize.ts.

### seguridad-servidor-y-discos

El servidor local no debe escuchar fuera de 127.0.0.1 ni relajar el chequeo de Origin. Nunca pises archivos en disco sin mostrar un diff previo y respaldar en .emede-backup/.

## Subagentes disponibles

- `adaptadores-ai`: Responsable de los adaptadores de plataforma, importadores, cliente de Gemini y prompts de IA.
- `frontend-qa`: Responsable de la interfaz en React, componentes del editor, estado con Zustand, y la suite de pruebas unitarias y e2e.
- `backend-seguridad`: Responsable del servidor local Node.js, persistencia en JSON, sanitización de caracteres y guardado seguro con diff.
