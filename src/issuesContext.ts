import { createContext } from 'react';
import type { Level } from './validate';

/** Nivel del peor problema de cada nodo, para marcar las tarjetas del lienzo. */
export const IssuesContext = createContext<Map<string, Level>>(new Map());
