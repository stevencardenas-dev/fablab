// Hook de resolución de módulos para los scripts sueltos de Node: traduce el
// alias `@/…` de tsconfig.json a `src/…ts`. Se registra desde cargador-ts.mjs.
//
// Existe porque un script de Node no lee los `paths` de tsconfig, y sin esto no
// se puede importar el código de src/ desde scripts/verificar-impresion.mjs sin
// duplicar la lógica que justamente se quiere verificar.
import { pathToFileURL } from 'node:url';

const RAIZ = pathToFileURL(`${process.cwd()}/`);

export async function resolve(especificador, contexto, siguiente) {
  if (especificador.startsWith('@/')) {
    return siguiente(new URL(`src/${especificador.slice(2)}.ts`, RAIZ).href, contexto);
  }
  return siguiente(especificador, contexto);
}
