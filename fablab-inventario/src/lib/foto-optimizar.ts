// Puente con la cámara/galería: reduce la foto EN EL DISPOSITIVO antes de
// subirla. Nada de mandar el original: una foto de cámara son 1-2,5 MB y el
// inventario tiene ~917 elementos (≈1-2 GB, más que el disco entero del plan).
//
// Salida por cada foto: una imagen de 800 px y su miniatura de 200 px, en WebP
// (con caída a JPEG donde el dispositivo no sepa codificar WebP). Medido:
// 800 px q0.6 ≈ 26 KB + 200 px ≈ 6 KB → ~31 KB por elemento.
import { ImageManipulator, SaveFormat, type ImageRef } from 'expo-image-manipulator';

import {
  ahorroPorcentaje,
  bytesDeBase64,
  CALIDAD_FOTO,
  dataUri,
  dimensionesReducidas,
  LADO_FOTO,
  LADO_MINIATURA,
  LIMITE_FOTO_BYTES,
  mimeDeBase64,
  pesoLegible,
  revisarPayload,
  siguienteCalidad,
  type DatosFoto,
  type Dimensiones,
} from './foto';

export type FotoOptimizada = DatosFoto & {
  /** URI local del resultado (vista previa antes de subir). */
  uri: string;
  /** El mismo resultado como data URI, para incrustarlo si hace falta. */
  dataUri: string;
  pesoBytes: number;
  pesoMiniaturaBytes: number;
  /** Peso del archivo original, si el selector lo informó. */
  pesoOriginalBytes: number;
  /** % que se recortó respecto al original (0 si no se sabe). */
  ahorro: number;
  /** "2.3 MB → 26 KB (-99%)" o "26 KB" si no se conoce el original. */
  resumen: string;
};

export type EntradaFoto = {
  uri: string;
  ancho?: number | null;
  alto?: number | null;
  pesoOriginalBytes?: number | null;
};

export type OpcionesFoto = {
  /** Lado mayor del resultado (por defecto 800 px). */
  lado?: number;
  /** Calidad inicial (por defecto 0.6); baja sola si no cabe en el límite. */
  calidad?: number;
};

async function medir(entrada: EntradaFoto): Promise<Dimensiones> {
  const ancho = Number(entrada.ancho);
  const alto = Number(entrada.alto);
  if (ancho > 0 && alto > 0) return { ancho, alto };
  // Sin dimensiones (p.ej. un blob de web): se decodifica una vez para saberlas.
  const ref = await ImageManipulator.manipulate(entrada.uri).renderAsync();
  return { ancho: ref.width, alto: ref.height };
}

async function renderizar(uri: string, dims: Dimensiones | null): Promise<ImageRef> {
  const contexto = ImageManipulator.manipulate(uri);
  if (dims) contexto.resize({ width: dims.ancho, height: dims.alto });
  return contexto.renderAsync();
}

type Guardada = { base64: string; uri: string; ancho: number; alto: number; formato: SaveFormat };

async function guardar(ref: ImageRef, calidad: number, formato: SaveFormat): Promise<Guardada> {
  const res = await ref.saveAsync({ base64: true, compress: calidad, format: formato });
  return {
    base64: res.base64 ?? '',
    uri: res.uri,
    ancho: res.width,
    alto: res.height,
    formato,
  };
}

/**
 * Guarda en WebP y, si el dispositivo no sabe codificarlo (p.ej. Safari), cae a
 * JPEG. `saveAsync` lo detecta y lanza error, así que la caída es explícita y
 * no silenciosa.
 */
async function guardarPreferido(ref: ImageRef, calidad: number): Promise<Guardada> {
  try {
    return await guardar(ref, calidad, SaveFormat.WEBP);
  } catch {
    return await guardar(ref, calidad, SaveFormat.JPEG);
  }
}

/**
 * Optimiza una foto para guardarla en la base: la reduce, la comprime y genera
 * su miniatura. Devuelve también el peso final y el ahorro, para que la app lo
 * muestre (quien toma la foto merece ver que 2,3 MB viajaron como 26 KB).
 */
export async function prepararFotoParaSubir(
  entrada: EntradaFoto,
  opciones: OpcionesFoto = {},
): Promise<FotoOptimizada> {
  if (!entrada?.uri) throw new Error('No hay ninguna foto que optimizar.');

  const lado = opciones.lado ?? LADO_FOTO;
  const origen = await medir(entrada);
  const dimsFoto = dimensionesReducidas(origen, lado);
  const dimsMini = dimensionesReducidas(origen, Math.min(LADO_MINIATURA, lado));

  // Si ya cabe, no se toca (un remuestreo de más solo pierde nitidez).
  const sinCambio = (d: Dimensiones) => (d.ancho === origen.ancho && d.alto === origen.alto ? null : d);
  const refFoto = await renderizar(entrada.uri, sinCambio(dimsFoto));
  const refMini = await renderizar(entrada.uri, sinCambio(dimsMini));

  // Baja calidad por escalones hasta que la foto quepa en el límite del server.
  let calidad = opciones.calidad ?? CALIDAD_FOTO;
  let foto = await guardarPreferido(refFoto, calidad);
  for (;;) {
    const siguiente = siguienteCalidad(bytesDeBase64(foto.base64), calidad, LIMITE_FOTO_BYTES);
    if (siguiente == null) break;
    calidad = siguiente;
    foto = await guardar(refFoto, calidad, foto.formato);
  }
  if (bytesDeBase64(foto.base64) > LIMITE_FOTO_BYTES) {
    throw new Error(
      `No se pudo reducir la foto por debajo de ${pesoLegible(LIMITE_FOTO_BYTES)}; intenta con otra foto.`,
    );
  }

  // La miniatura nunca puede pesar más que la foto (el server lo rechaza). Si la
  // imagen original ya era diminuta, la foto y la miniatura salen del mismo
  // tamaño: ahí la miniatura se guarda con más compresión.
  const mismaMedida = dimsMini.ancho === dimsFoto.ancho && dimsMini.alto === dimsFoto.alto;
  let miniatura = await guardar(refMini, mismaMedida ? Math.min(calidad, 0.3) : calidad, foto.formato);
  if (bytesDeBase64(miniatura.base64) >= bytesDeBase64(foto.base64)) {
    miniatura = await guardar(refMini, Math.min(calidad, 0.25), foto.formato);
  }

  // El formato lo dicen los bytes, no lo que se pidió: iOS puede devolver JPEG
  // aunque se pidiera WebP y el server valida la firma.
  const mime = mimeDeBase64(foto.base64) ?? (foto.formato === SaveFormat.WEBP ? 'image/webp' : 'image/jpeg');

  const motivo = revisarPayload({ foto: foto.base64, miniatura: miniatura.base64 });
  if (motivo) throw new Error(motivo);

  const pesoBytes = bytesDeBase64(foto.base64);
  const pesoMiniaturaBytes = bytesDeBase64(miniatura.base64);
  const pesoOriginalBytes = Math.max(0, Number(entrada.pesoOriginalBytes) || 0);
  const ahorro = ahorroPorcentaje(pesoOriginalBytes, pesoBytes);

  return {
    mime,
    foto: foto.base64,
    miniatura: miniatura.base64,
    ancho: foto.ancho,
    alto: foto.alto,
    uri: foto.uri,
    dataUri: dataUri(mime, foto.base64),
    pesoBytes,
    pesoMiniaturaBytes,
    pesoOriginalBytes,
    ahorro,
    resumen: pesoOriginalBytes
      ? `${pesoLegible(pesoOriginalBytes)} → ${pesoLegible(pesoBytes)} (-${ahorro}%)`
      : `${pesoLegible(pesoBytes)} (foto y miniatura)`,
  };
}
