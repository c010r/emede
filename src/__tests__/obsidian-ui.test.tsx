// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { memDir } from './memfs';
import { graph } from './helpers';
import { useStore } from '../store';
import type { AgentData, ProjectData } from '../types';

const vault = memDir({ '.obsidian/app.json': '{}', 'Ideas.md': 'nota propia' }, 'MiVault');
vi.mock('../vaultDir', () => ({
  currentVault: () => vault,
  restoreVault: async () => vault,
  pickVault: async () => ({ dir: vault, looksLikeVault: true }),
  ensureAccess: async () => true,
  configuredVault: () => null,
  serverAvailable: () => false,
}));

const { ObsidianModal } = await import('../components/ObsidianModal');

afterEach(cleanup);

const agent = () => useStore.getState().nodes.find((n) => n.id === 'a')!.data.d as AgentData;

async function send() {
  const notify = vi.fn();
  render(<ObsidianModal onClose={() => undefined} notify={notify} onSettings={() => undefined} />);
  await act(async () => fireEvent.click(screen.getByText(/Enviar a Obsidian/)));
  const write = await screen.findByRole('button', { name: /^Escribir \d+ archivo/ });
  await act(async () => fireEvent.click(write));
  cleanup();
  return notify;
}

describe('Obsidian de punta a punta (vault en memoria)', () => {
  it('envía, respeta lo editado en Obsidian y lo trae de vuelta', async () => {
    useStore.getState().setSettings({ vaultFolder: 'emede', keys: {} });
    useStore.getState().loadProject({
      id: 'o',
      graph: graph([
        ['project', 'project', { name: 'tienda', description: 'Tienda', test: 'npm test', memory: '# Tienda' }],
        ['a', 'agent', { name: 'revisor', description: 'Revisa PRs. Usar cuando hay un diff.', prompt: 'Sos revisor.' }],
      ]),
    });

    await send();
    const note = 'emede/tienda/agentes/revisor.md';
    expect(vault.files[note]).toContain('Sos revisor.');
    expect(vault.files['emede/tienda/tienda.canvas']).toBeTruthy();
    expect(vault.files['Ideas.md']).toBe('nota propia');
    expect((useStore.getState().nodes[0].data.d as ProjectData).vault?.path).toBe('emede/tienda');

    // Se edita en Obsidian y, antes de traerlo, se vuelve a enviar: esa nota no se pisa.
    vault.files[note] = vault.files[note].replace('Sos revisor.', 'Sos revisor. Corré npm test.');
    useStore.getState().updateNode('project', { description: 'Tienda online' } as Partial<ProjectData>);
    render(<ObsidianModal onClose={() => undefined} notify={vi.fn()} onSettings={() => undefined} />);
    await act(async () => fireEvent.click(screen.getByText(/Enviar a Obsidian/)));
    expect(await screen.findByText(/la editaste en Obsidian/)).toBeTruthy();
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: /^Escribir 1 archivo/ })));
    cleanup();
    expect(vault.files[note]).toContain('Corré npm test.');

    // Traer cambios.
    render(<ObsidianModal onClose={() => undefined} notify={vi.fn()} onSettings={() => undefined} />);
    await act(async () => fireEvent.click(screen.getByText(/Traer cambios de Obsidian/)));
    expect(await screen.findByText('Agente revisor')).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /Aplicar 1 cambio/ })));
    expect(agent().prompt).toBe('Sos revisor. Corré npm test.');
    cleanup();

    // Ya está todo sincronizado.
    render(<ObsidianModal onClose={() => undefined} notify={vi.fn()} onSettings={() => undefined} />);
    await act(async () => fireEvent.click(screen.getByText(/Traer cambios de Obsidian/)));
    expect(await screen.findByText(/No hay cambios en Obsidian/)).toBeTruthy();
  });
});
