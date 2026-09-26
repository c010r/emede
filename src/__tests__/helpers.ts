import type { Edge } from '@xyflow/react';
import { emptyData } from '../defaults';
import type { FlowNode, Graph } from '../store';
import type { NodeData, NodeKind } from '../types';

/** Construye un grafo de prueba de forma compacta. */
export function graph(
  nodes: Array<[id: string, kind: NodeKind, data?: Partial<NodeData>]>,
  links: Array<[from: string, to: string]> = [],
): Graph {
  const all: Array<[string, NodeKind, Partial<NodeData>?]> = nodes.some(([, k]) => k === 'project') ? nodes : [['project', 'project'], ...nodes];
  return {
    nodes: all.map(([id, kind, data]): FlowNode => ({
      id, type: 'card', position: { x: 0, y: 0 }, data: { d: { ...emptyData(kind), ...data } as NodeData },
    })),
    edges: links.map(([source, target]): Edge => ({ id: `${source}-${target}`, source, target })),
  };
}

export const ALL_TARGETS = ['claude', 'opencode', 'codex', 'gemini', 'cursor', 'copilot'] as const;
