// Mensajes que ve el usuario. Nada de rutas, códigos HTTP ni texto en inglés:
// el detalle técnico va a la consola (`console.warn`) y a la pantalla llega una
// frase legible. Antes una escritura fallida mostraba "API 502: PATCH /elementos"
// y un corte de red mostraba "TypeError: Failed to fetch".

export const SIN_CONEXION =
  'Sin conexión con el servidor. Revisa tu red e intenta de nuevo.';

const POR_ESTADO: Record<number, string> = {
  400: 'Los datos enviados no son válidos.',
  403: 'No tienes permiso para hacer eso.',
  404: 'No se encontró lo que buscabas.',
  405: 'Esa operación no está permitida.',
  409: 'Ya existe un registro con esos datos.',
  413: 'El archivo pesa más de lo que acepta el servidor.',
  429: 'Demasiadas operaciones seguidas: espera un momento.',
  500: 'El servidor tuvo un problema.',
  502: 'El servidor no está disponible en este momento.',
  503: 'El servidor no está disponible en este momento.',
  504: 'El servidor tardó demasiado en responder.',
};

/** Frase legible para un estado HTTP, sin códigos ni rutas. *//**
 * Cuerpo JSON de una respuesta, si lo hay y es válido. Un 502 de Render llega con
 * HTML (o sin cuerpo) y `res.json()` ahí revienta: sin este guardián el usuario
 * vería "res.json is not a function" en vez de un mensaje.
 */
export async function leerCuerpoJson<T = unknown>(res: Response): Promise<T | null> {
  try {
    return typeof res.json === 'function' ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Frase legible para un estado HTTP, sin códigos ni rutas. */
export function mensajeDeEstado(estado: number): string {
  const conocido = POR_ESTADO[estado];
  if (conocido) return conocido;
  return estado >= 500
    ? 'El servidor no pudo completar la operación. Intenta de nuevo en un momento.'
    : 'No se pudo completar la operación.';
}

// Errores del navegador (en inglés), fallas internas y rastros técnicos: nada de
// esto debe verse. Lo que quede marcado aquí se reemplaza por `porDefecto`.
// Ojo: los pesos ("500 KB", "límite 400 KB") son legibles y deben pasar.
const TECNICO = /failed to fetch|load failed|network request failed|networkerror|aborterror|typeerror|referenceerror|syntaxerror|rangeerror|is not a function|cannot read|undefined|\[object|unhandled|err_|errno|\bAPI\b|\/api\/|https?:\/\/|\bHTTP\b/i;

const ES_RED = /failed to fetch|load failed|network request failed|networkerror|aborterror|network/i;

/**
 * Convierte cualquier error en un mensaje para mostrar. Los mensajes en español
 * de nuestras capas (server y validaciones locales) ya son legibles y pasan
 * tal cual; lo que huela a técnico se sustituye por `porDefecto`.
 */
export function mensajeDeError(
  e: unknown,
  porDefecto = 'No se pudo completar la operación. Intenta de nuevo.',
): string {
  const texto = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  const limpio = texto.trim();
  if (!limpio) return porDefecto;
  if (ES_RED.test(limpio)) return SIN_CONEXION;
  if (TECNICO.test(limpio)) return porDefecto;
  return limpio;
}
