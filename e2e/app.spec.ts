import { expect, test, type Page } from '@playwright/test';

/* Recorridos reales de usuario contra el servidor de producción (datos en una carpeta temporal). */

const errors: string[] = [];
test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
});
test.afterEach(() => expect(errors, 'errores en la consola').toEqual([]));

/** Sin API key la app abre Ajustes al arrancar: se cierra para seguir. */
async function dismissSettings(page: Page) {
  await expect(page.getByText('Empezar un proyecto')).toBeVisible();
  const settings = page.getByRole('heading', { name: 'Ajustes' });
  if (await settings.isVisible()) await page.getByRole('button', { name: 'Listo' }).click();
}

async function newBlankProject(page: Page) {
  await page.goto('/');
  await dismissSettings(page);
  await page.getByRole('button', { name: /Proyecto en blanco/ }).click();
  await expect(page.getByText('← Proyectos')).toBeVisible();
}

test('dashboard → proyecto nuevo → nodos → archivos → vuelta al dashboard', async ({ page }) => {
  await newBlankProject(page);
  await page.locator('.palette', { hasText: 'Agente' }).click();
  await page.getByLabel('Nombre').fill('code-reviewer');

  await page.getByRole('button', { name: /^Archivos/ }).click();
  await expect(page.getByRole('button', { name: /^CLAUDE\.md ≈/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'code-reviewer.md' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'settings.json' }).first()).toBeVisible(); // guardarraíles activos por defecto

  await expect(page.getByText('✔ guardado')).toBeVisible({ timeout: 5000 });
  await page.getByText('← Proyectos').click();
  await expect(page.getByText('Proyectos guardados')).toBeVisible();
  await expect(page.locator('.proj-name', { hasText: 'mi-proyecto' }).first()).toBeVisible();
});

test('recargar justo después de editar no pierde el cambio', async ({ page }) => {
  await newBlankProject(page);
  await page.getByLabel('Nombre').fill('persistente');
  // Sin esperar al guardado automático: el cambio pendiente se guarda al cerrar la página.
  await page.reload();
  // El guardado de emergencia (keepalive) tiene que haber llegado al servidor.
  await expect
    .poll(async () => (await (await page.request.get('/api/projects')).json()).map((p: { name: string }) => p.name), { timeout: 5000 })
    .toContain('persistente');
  await page.reload();
  await dismissSettings(page);
  const card = page.locator('.proj', { hasText: 'persistente' });
  await card.getByRole('button', { name: 'Abrir', exact: true }).click();
  await expect(page.locator('.project-title')).toHaveText('persistente');
});

test('problemas: "Reparar todo" limpia solo y pregunta lo que no sabe', async ({ page }) => {
  await newBlankProject(page);
  await page.locator('.palette', { hasText: 'Regla' }).click();
  await page.getByLabel('Contenido').fill('No uses any.​‮');
  await page.getByRole('button', { name: /^Problemas/ }).click();
  await expect(page.getByText(/carácter\(es\) invisible\(s\)/)).toBeVisible();
  await page.getByRole('button', { name: /Reparar todo/ }).click();
  await expect(page.getByText(/carácter\(es\) invisible\(s\)/)).toHaveCount(0);
  // Sin descripción ni comandos no hay de dónde sacarlos: se abre el modal de preguntas.
  await expect(page.getByText('¿Qué hace el proyecto? (una o dos frases)')).toBeVisible();
  await page.getByLabel('Descripción').fill('Tienda online');
  await page.getByRole('button', { name: /Aplicar 1 respuesta/ }).click();
  await expect(page.getByText(/El proyecto no tiene descripción/)).toHaveCount(0);
});

test('en pantallas angostas no hay scroll horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 });
  await newBlankProject(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
