import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

/*
 * Genera los íconos PNG/ICO a partir del logo (public/favicon.svg), para navegadores y sistemas que no usan SVG:
 *   public/favicon.ico            16, 32 y 48 px (pestañas y accesos directos de Windows)
 *   public/apple-touch-icon.png   180 px con fondo lleno (iPhone/iPad le redondean las esquinas)
 * Uso: npm run favicons (después de cambiar el logo). Renderiza con el navegador de las pruebas e2e.
 */

const dir = new URL('../public/', import.meta.url);
const svg = await readFile(new URL('favicon.svg', dir), 'utf8');
const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
/** Color del marco del logo: rellena las esquinas del ícono de Apple. */
const FRAME = /<rect[^>]*fill="(#[0-9a-f]{3,8})"/i.exec(svg)?.[1] ?? '#1b1f2a';

const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'msedge' });
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function render(size: number, background = 'transparent'): Promise<Buffer> {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0;background:${background}"><img src="${src}" width="${size}" height="${size}" style="display:block"></body>`);
  await page.locator('img').evaluate((img: HTMLImageElement) => img.decode());
  return page.screenshot({ omitBackground: background === 'transparent', type: 'png' });
}

/** ICO con las imágenes PNG adentro (formato que aceptan Windows Vista+ y todos los navegadores). */
function ico(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reservado
  header.writeUInt16LE(1, 2); // tipo: ícono
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, png }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size % 256, 0); // ancho (0 = 256)
    e.writeUInt8(size % 256, 1); // alto
    e.writeUInt16LE(1, 4); // planos
    e.writeUInt16LE(32, 6); // bits por píxel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

const sizes = [16, 32, 48];
const icoImages = [];
for (const size of sizes) icoImages.push({ size, png: await render(size) });
await writeFile(new URL('favicon.ico', dir), ico(icoImages));
await writeFile(new URL('apple-touch-icon.png', dir), await render(180, FRAME));
await browser.close();
console.log(`favicon.ico (${sizes.join(', ')} px) y apple-touch-icon.png (180 px) generados en public/`);
