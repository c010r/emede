// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from '../App';
import { useStore } from '../store';

afterEach(cleanup);

beforeAll(() => {
  // React Flow necesita estas APIs del navegador.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  (globalThis as unknown as { DOMMatrixReadOnly: unknown }).DOMMatrixReadOnly ??= class {
    m22 = 1;
  };
});

// El editor se carga en diferido; precargado acá, la primera prueba no depende de cuánto tarda en transformarse.
beforeAll(() => import('../components/Editor'));

beforeEach(() => {
  localStorage.clear();
  // Sin servidor en jsdom: se usa el respaldo en el navegador (mismo formato JSON).
  localStorage.setItem('emede-data', JSON.stringify({ version: 1, settings: { apiKey: 'x', uiLang: 'es', lang: 'es', targets: ['claude', 'codex'] }, projects: {} }));
});

describe('interfaz (prueba de humo)', () => {
  it('arranca en el dashboard, crea un proyecto, edita, vuelve y lo reabre', async () => {
    render(<App />);
    expect(await screen.findByText('Empezar un proyecto')).toBeTruthy();
    expect(await screen.findByText(/Todavía no hay proyectos/)).toBeTruthy();

    await act(async () => fireEvent.click(screen.getByText('Proyecto en blanco')));
    expect(useStore.getState().view).toBe('editor');

    fireEvent.click((await screen.findAllByText('Agente'))[0]); // el editor se carga en diferido
    expect(useStore.getState().nodes).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: /^Problemas/ }));
    expect(screen.getAllByText(/no tiene descripción/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /^Archivos/ }));
    expect(screen.getAllByText('CLAUDE.md').length).toBeGreaterThan(0);
    expect(screen.getAllByText('nuevo-agente.toml').length).toBeGreaterThan(0);

    await act(async () => fireEvent.keyDown(window, { key: 'z', ctrlKey: true }));
    expect(useStore.getState().nodes).toHaveLength(1);
    fireEvent.click(screen.getAllByText('Agente')[0]);

    await act(async () => fireEvent.click(screen.getByText('← Proyectos')));
    expect(await screen.findByText('Proyectos guardados')).toBeTruthy();
    expect(screen.getByText('mi-proyecto')).toBeTruthy();

    // Al recargar la app vuelve a mostrar el dashboard con el proyecto guardado.
    cleanup();
    render(<App />);
    await screen.findByText('mi-proyecto');
    await act(async () => fireEvent.click(screen.getByText('Abrir')));
    expect(useStore.getState().view).toBe('editor');
    expect(useStore.getState().nodes).toHaveLength(2);
  });

  it('empezar desde plantillas abre la galería sobre un proyecto nuevo', async () => {
    render(<App />);
    await screen.findByText('Empezar un proyecto');
    await act(async () => fireEvent.click(screen.getByText('Desde plantillas')));
    fireEvent.click((await screen.findAllByText(/^Agregar \(/))[0]);
    expect(useStore.getState().nodes.length).toBeGreaterThan(3);
  });

  it('guarda piezas como plantilla propia y las inserta en otro proyecto', async () => {
    render(<App />);
    await screen.findByText('Empezar un proyecto');
    await act(async () => fireEvent.click(screen.getByText('Proyecto en blanco')));
    fireEvent.click((await screen.findAllByText('Agente'))[0]);
    await act(async () => fireEvent.click(screen.getByText('💾 Plantilla')));
    fireEvent.change(screen.getByPlaceholderText('p. ej. Revisor del equipo'), { target: { value: 'Mi revisor' } });
    await act(async () => fireEvent.click(screen.getByText('Guardar plantilla (1)')));
    expect(await screen.findByText(/Plantilla “Mi revisor” guardada/)).toBeTruthy();

    // Otro proyecto: la plantilla aparece en ⭐ Mis plantillas y se inserta.
    await act(async () => fireEvent.click(screen.getByText('← Proyectos')));
    await act(async () => fireEvent.click(await screen.findByText('Proyecto en blanco')));
    expect(useStore.getState().nodes).toHaveLength(1);
    await act(async () => fireEvent.click(screen.getAllByTitle('Plantillas')[0]));
    await act(async () => fireEvent.click(screen.getByText('⭐ Mis plantillas')));
    expect(await screen.findByText('Mi revisor')).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByText('Agregar (1)')));
    expect(useStore.getState().nodes).toHaveLength(2);
  });

  it('la prueba de enrutamiento se abre desde Problemas y guarda los casos en el proyecto', async () => {
    render(<App />);
    await screen.findByText('Empezar un proyecto');
    await act(async () => fireEvent.click(screen.getByText('Proyecto en blanco')));
    fireEvent.click((await screen.findAllByText('Agente'))[0]);
    fireEvent.click(screen.getByRole('button', { name: /^Problemas/ }));
    await act(async () => fireEvent.click(screen.getByText('🧭 Probar enrutamiento')));
    expect(screen.getByText('🧭 Prueba de enrutamiento')).toBeTruthy();
    fireEvent.click(screen.getByText('+ Agregar caso'));
    fireEvent.change(screen.getByPlaceholderText('p. ej. revisá los cambios antes del PR'), { target: { value: 'revisá mi PR' } });
    const project = useStore.getState().nodes.find((n) => n.id === 'project')!.data.d as { routing?: { request: string }[] };
    expect(project.routing?.map((c) => c.request)).toEqual(['revisá mi PR']);
  });

  it('arranca en el idioma elegido y cambia de idioma al vuelo', async () => {
    localStorage.setItem('emede-data', JSON.stringify({ version: 1, settings: { apiKey: 'x', uiLang: 'zh', lang: 'es', targets: ['claude'] }, projects: {} }));
    render(<App />);
    expect(await screen.findByText('开始一个项目')).toBeTruthy();
    expect(document.documentElement.lang).toBe('zh-CN');
    await act(async () => useStore.getState().setSettings({ uiLang: 'hi' }));
    expect(await screen.findByText('प्रोजेक्ट शुरू करें')).toBeTruthy();
    await act(async () => useStore.getState().setSettings({ uiLang: 'es' }));
    expect(await screen.findByText('Empezar un proyecto')).toBeTruthy();
  });

  it('sin nada configurado abre la instalación y al terminarla queda el dashboard', async () => {
    localStorage.setItem('emede-data', JSON.stringify({ version: 1, settings: { uiLang: 'es', lang: 'es' }, projects: {} }));
    // El store es global entre pruebas: sin la clave que dejaron las anteriores, como en una instalación nueva.
    useStore.setState((st) => ({ settings: { ...st.settings, keys: {}, setupDone: false } }));
    render(<App />);
    expect(await screen.findByText('Bienvenido a emede')).toBeTruthy();
    fireEvent.click(screen.getByText('Siguiente →'));
    expect(screen.getByText('Elegí tu IA')).toBeTruthy();
    fireEvent.click(screen.getByText('Configurar después'));
    fireEvent.click(screen.getByText('Sí, vincular mi vault'));
    fireEvent.click(screen.getByText('No, por ahora'));
    fireEvent.click(screen.getByText('Saltar'));
    expect(screen.getByText('Todo listo')).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByText('Empezar a usar emede')));
    expect(await screen.findByText('Empezar un proyecto')).toBeTruthy();
    expect(useStore.getState().settings.setupDone).toBe(true);
  });

  it('quien ya tenía la IA configurada no pasa por la instalación', async () => {
    render(<App />);
    expect(await screen.findByText('Empezar un proyecto')).toBeTruthy();
    expect(screen.queryByText('Bienvenido a emede')).toBeNull();
    expect(useStore.getState().settings.setupDone).toBe(true);
  });

  it('la primera vez usa el idioma del navegador', async () => {
    localStorage.setItem('emede-data', JSON.stringify({ version: 1, settings: { apiKey: 'x', targets: ['claude'] }, projects: {} }));
    const langs = vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['pt-BR', 'en']);
    render(<App />);
    expect(await screen.findByText('Começar um projeto')).toBeTruthy();
    expect(useStore.getState().settings).toMatchObject({ uiLang: 'pt', lang: 'pt' });
    langs.mockRestore();
    await act(async () => useStore.getState().setSettings({ uiLang: 'es', lang: 'es' }));
  });
});
