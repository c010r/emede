import { describe, expect, it } from 'vitest';
import { scanContextFromDetection } from '../scanner';

describe('scanContextFromDetection', () => {
  it('arma el contexto con nombre, tecnologías, comandos y estructura', () => {
    const ctx = scanContextFromDetection({
      name: 'tienda',
      description: 'Una tienda online',
      items: [
        { id: 'nextjs', label: 'Next.js', category: 'frontend', version: '15' },
        { id: 'prisma', label: 'Prisma', category: 'orm' },
      ],
      commands: { dev: 'npm run dev', test: 'npm run test' },
      structure: '- `src/`\n- `app/`',
      sources: ['package.json', 'tsconfig.json'],
    });

    expect(ctx).toContain('Proyecto detectado: tienda');
    expect(ctx).toContain('Una tienda online');
    expect(ctx).toContain('**Next.js 15** (frontend)');
    expect(ctx).toContain('**Prisma** (orm)');
    expect(ctx).toContain('`dev` = npm run dev');
    expect(ctx).toContain('`test` = npm run test');
    expect(ctx).toContain('src/');
    expect(ctx).toContain('package.json');
  });

  it('tolera detección vacía', () => {
    const ctx = scanContextFromDetection({
      name: 'x',
      description: '',
      items: [],
      structure: '',
    });

    expect(ctx).toContain('(ninguna)');
    expect(ctx).not.toContain('Comandos detectados');
    expect(ctx).not.toContain('Archivos analizados');
  });
});
