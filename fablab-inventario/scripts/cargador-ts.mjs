// Punto de entrada para que un script suelto pueda importar el código de src/,
// que está en TypeScript y usa el alias `@/`:
//
//   node --import ./scripts/cargador-ts.mjs scripts/verificar-impresion.mjs
//
// (verificar-impresion.mjs se relanza solo con este flag, así que en la práctica
// se puede llamar sin más). Node ejecuta TypeScript sin compilarlo: de fábrica
// desde la 22.18 y con `--experimental-strip-types` desde la 22.6.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./resolutor-alias.mjs', pathToFileURL(`${import.meta.dirname}/`));
