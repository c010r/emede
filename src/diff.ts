export interface DiffLine {
  type: 'same' | 'add' | 'del';
  text: string;
}

/** Diff por líneas (LCS). Suficiente para archivos de configuración de algunos cientos de líneas. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.replace(/\r\n/g, '\n').split('\n');
  const b = after.replace(/\r\n/g, '\n').split('\n');
  const n = a.length, m = b.length;
  // Tabla LCS desde el final para reconstruir el recorrido hacia adelante.
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) out.push({ type: 'same', text: a[i++] }), j++;
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ type: 'del', text: a[i++] });
    else out.push({ type: 'add', text: b[j++] });
  }
  while (i < n) out.push({ type: 'del', text: a[i++] });
  while (j < m) out.push({ type: 'add', text: b[j++] });
  return out;
}

export function diffStats(d: DiffLine[]) {
  return { added: d.filter((l) => l.type === 'add').length, removed: d.filter((l) => l.type === 'del').length };
}

/** Recorta las zonas sin cambios, dejando `context` líneas alrededor de cada cambio. */
export function collapse(d: DiffLine[], context = 3): (DiffLine | { type: 'gap'; count: number })[] {
  const keep = d.map(() => false);
  d.forEach((l, i) => {
    if (l.type !== 'same') for (let k = Math.max(0, i - context); k <= Math.min(d.length - 1, i + context); k++) keep[k] = true;
  });
  const out: (DiffLine | { type: 'gap'; count: number })[] = [];
  let gap = 0;
  d.forEach((l, i) => {
    if (keep[i]) {
      if (gap) out.push({ type: 'gap', count: gap });
      gap = 0;
      out.push(l);
    } else gap++;
  });
  if (gap) out.push({ type: 'gap', count: gap });
  return out;
}
