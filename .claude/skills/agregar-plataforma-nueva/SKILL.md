---
name: agregar-plataforma-nueva
description: Procedimiento para agregar una nueva plataforma soportada al sistema. Usar cuando vayas a implementar una plataforma nueva en el generador y sus importadores.
---

1. Agregar la clave en TARGETS (src/types.ts).
2. Escribir la función adaptadora en src/generators/index.ts y registrarla en render().
3. Mapear herramientas genéricas, niveles de modelo, $ARGUMENTS y referencias de secretos.
4. Implementar guardarraíles y agregar importador, detección, tests y documentación.
