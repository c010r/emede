import { main } from './main';

/* Punto de entrada del binario `emede` (se empaqueta en dist-cli/emede.js). */

// Idioma de los mensajes: el del sistema (LC_ALL, LANG… o el de Windows vía Intl).
const locales = [process.env.LC_ALL, process.env.LC_MESSAGES, process.env.LANG, Intl.DateTimeFormat().resolvedOptions().locale]
  .filter((l): l is string => !!l && l !== 'C' && l !== 'POSIX')
  .map((l) => l.split('.')[0].replace('_', '-'));

main(process.argv.slice(2), {
  cwd: process.cwd(),
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  locales,
}).then((code) => {
  process.exitCode = code;
});
