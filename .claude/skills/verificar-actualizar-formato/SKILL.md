---
name: verificar-actualizar-formato
description: "Procedimiento para verificar y actualizar el formato de una plataforma. Usar cuando necesites actualizar la compatibilidad o el formato de exportación de una plataforma soportada."
---

1. Consultar la documentación oficial vigente de la herramienta (rutas, frontmatter/TOML, campos, herramientas, sintaxis de variables de entorno).
2. Comparar contra el adaptador en src/generators/index.ts y el importador en src/importers/repo.ts.
3. Ajustar adaptador e importador.
4. Actualizar tests, matriz del README, fecha de verificación y CHANGELOG.
