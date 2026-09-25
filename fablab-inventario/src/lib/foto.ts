// Optimización de fotos: todo lo que se puede calcular sin tocar la cámara ni
// el sistema de archivos vive aquí (puro y con tests). El puente con
// expo-image-manipulator está en `foto-optimizar.ts`.
//
// Por qué optimizar en el teléfono y no en el servidor: la foto cruda de una
// cámara moderna es 1-2,5 MB y el inventario tiene ~917 elementos. Subirlas
// todas serían 1-2 GB — no cabe en el disco de 1 GB del plan de Aiven, ni se
// termina de subir en una jornada de trabajo. Medido: 800 px WebP q0.6 ≈ 26 KB
// y 200 px ≈ 6 KB → ~31 KB por elemento (~29 MB para los 917).

export type TamanoFoto = 'foto' | 'miniatura';

export type Dimensiones = { ancho: number; alto: number };

export type DatosFoto = {
  mime: string;
  foto: string; // base64 sin el prefijo `data:...;base64,`
  miniatura: string;
  ancho: number;
  alto: number;
};

// Lado mayor de la foto guardada. 800 px es de sobra para identificar un
// elemento en pantalla y es el punto donde la curva peso/calidad se aplana.
export const LADO_FOTO = 800;
// La miniatura es la que se pinta en las listas: 200 px basta para una tarjeta
// y pesa ~4× menos que la foto.
export const LADO_MINIATURA = 200;
export const CALIDAD_FOTO = 0.6;

// Los mismos límites que valida el servidor (importer/api.mjs). Se repiten aquí
// para poder avisar antes de gastar la subida (el teléfono en datos móviles no
// debería mandar 500 KB para recibir un 413).
export const LIMITE_FOTO_BYTES = 400 * 1024;
export const LIMITE_MINIATURA_BYTES = 80 * 1024;

// Calidades por las que baja la foto si aún no cabe en el límite. Se recorre en
// orden y se corta en la primera que cumpla; el escalón final sigue siendo
// legible para identificar un elemento (que es el uso real de la foto).
export const ESCALONES_CALIDAD = [0.6, 0.45, 0.32];

/**
 * Dimensiones de salida sin deformar y sin agrandar: si la imagen ya cabe, se
 * devuelve igual (una foto de 300 px no se convierte en una borrosa de 800).
 */
export function dimensionesReducidas(origen: Dimensiones, ladoMaximo: number): Dimensiones {
  const ancho = Math.max(1, Math.round(Number(origen.ancho) || 0));
  const alto = Math.max(1, Math.round(Number(origen.alto) || 0));
  const mayor = Math.max(ancho, alto);
  if (mayor <= ladoMaximo) return { ancho, alto };
  const factor = ladoMaximo / mayor;
  return {
    ancho: Math.max(1, Math.round(ancho * factor)),
    alto: Math.max(1, Math.round(alto * factor)),
  };
}

/** Peso real que ocupan los bytes de un base64 (sin decodificarlo en memoria). */
export function bytesDeBase64(base64: string): number {
  const limpio = String(base64 || '').replace(/\s+/g, '').replace(/=+$/, '');
  if (!limpio) return 0;
  return Math.floor((limpio.length * 3) / 4);
}

const ALFABETO_BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Primeros bytes de un base64, decodificados a mano (sin atob/Buffer: el
 * teléfono no siempre los tiene). Alcanza para leer las firmas.
 */
export function primerosBytes(base64: string, cuantos = 12): number[] {
  const limpio = String(base64 || '').replace(/\s+/g, '');
  const bytes: number[] = [];
  for (let i = 0; i + 3 < limpio.length && bytes.length < cuantos; i += 4) {
    const [a, b, c, d] = [
      ALFABETO_BASE64.indexOf(limpio[i]),
      ALFABETO_BASE64.indexOf(limpio[i + 1]),
      ALFABETO_BASE64.indexOf(limpio[i + 2]),
      ALFABETO_BASE64.indexOf(limpio[i + 3]),
    ];
    if (a < 0 || b < 0) break;
    bytes.push(((a << 2) | (b >> 4)) & 0xff);
    if (c >= 0 && bytes.length < cuantos) bytes.push(((b << 4) | (c >> 2)) & 0xff);
    if (d >= 0 && bytes.length < cuantos) bytes.push(((c << 6) | d) & 0xff);
  }
  return bytes.slice(0, cuantos);
}

/**
 * Qué formato salió de verdad. El servidor rechaza lo que no sea WebP/JPEG
 * mirando los bytes, así que aquí se decide lo mismo mirando los bytes (y no lo
 * que se pidió): iOS puede devolver JPEG aunque se pidiera WebP.
 */
export function mimeDeBase64(base64: string): string | null {
  const b = primerosBytes(base64, 12);
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return 'image/webp'; // "RIFF"…"WEBP"
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  return null;
}

/**
 * Siguiente calidad a probar cuando la foto no cabe en el límite. `null` = ya
 * no queda nada más que bajar (el que llama decide qué hacer con el error).
 */
export function siguienteCalidad(
  pesoBytes: number,
  calidad: number,
  limite: number = LIMITE_FOTO_BYTES,
): number | null {
  if (pesoBytes <= limite) return null;
  const idx = ESCALONES_CALIDAD.indexOf(calidad);
  const siguiente = ESCALONES_CALIDAD[idx + 1];
  return siguiente ?? null;
}

/** "26 KB" / "1,4 MB": para que el usuario vea cuánto pesa lo que va a subir. */
export function pesoLegible(bytes: number): string {
  const n = Math.max(0, Number(bytes) || 0);
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Porcentaje que se ahorró. Se topa en 99 a propósito: mostrar "-100%" parece
 * que la foto se perdió, y en realidad sigue habiendo una imagen guardada.
 */
export function ahorroPorcentaje(pesoOriginal: number, pesoFinal: number): number {
  if (!pesoOriginal || pesoOriginal <= pesoFinal) return 0;
  return Math.min(99, Math.round((1 - pesoFinal / pesoOriginal) * 100));
}

/** Data URI para previsualizar en pantalla lo que se va a subir. */
export function dataUri(mime: string, base64: string): string {
  return `data:${mime};base64,${base64}`;
}

/**
 * Comprueba que el resultado local cumple lo que exige el servidor, antes de
 * mandarlo. Devuelve el motivo si no cumple (mensaje en español, listo para UI).
 */
export function revisarPayload(datos: { foto: string; miniatura: string }): string | null {
  const peso = bytesDeBase64(datos.foto);
  const mini = bytesDeBase64(datos.miniatura);
  if (!peso) return 'La foto llegó vacía.';
  if (peso > LIMITE_FOTO_BYTES) {
    return `La foto pesa ${pesoLegible(peso)} y el límite es ${pesoLegible(LIMITE_FOTO_BYTES)}.`;
  }
  if (mini > LIMITE_MINIATURA_BYTES) {
    return `La miniatura pesa ${pesoLegible(mini)} y el límite es ${pesoLegible(LIMITE_MINIATURA_BYTES)}.`;
  }
  if (mini >= peso) return 'La miniatura no puede pesar más que la foto.';
  return null;
}
