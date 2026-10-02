import { encodeToMatrix } from 'datamatrix-svg-ts';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import {
  nombreArchivoDataMatrix,
  nombreArchivoHoja,
  svgDataMatrix,
  svgHojaEtiquetas,
  type EtiquetaDataMatrix,
  type OpcionesHojaEtiquetas,
  type OpcionesSvgDataMatrix,
} from '@/lib/data-matrix-svg';
import { hojasImprimibles, htmlHojaImprimible, type HojaImprimible } from '@/lib/hoja-imprimible';

export function DataMatrixCode({ value, size = 160 }: { value: string; size?: number }) {
  const { matrix, width, height } = encodeToMatrix(value);

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${width} ${height}`}>
      <Rect x={0} y={0} width={width} height={height} fill="#FFFFFF" />
      {matrix.flatMap((row, y) =>
        row.map((cell, x) =>
          cell ? <Rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="#000000" /> : null,
        ),
      )}
    </Svg>
  );
}

// --- Descarga / impresión ---
// El código se puede haber perdido o dañado en el elemento físico, así que
// cualquier elemento guardado tiene que poder volver a producir su etiqueta.
// El archivo es un SVG con medidas en milímetros: se abre e imprime nítido
// desde cualquier visor, sin depender de la resolución de una captura.

/** SVG imprimible del código, con el propio código legible bajo el símbolo. */
export function svgDataMatrixDeCodigo(codigo: string, opciones: OpcionesSvgDataMatrix = {}): string {
  return svgDataMatrix(encodeToMatrix(codigo), { etiqueta: codigo, ...opciones });
}

function descargarEnNavegador(svg: string, nombre: string) {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  // Revocar en el siguiente tick: Safari cancela la descarga si el objectURL
  // desaparece antes de que alcance a arrancar.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Entrega el Data Matrix del código como archivo listo para imprimir.
 * Web: lo baja a la carpeta de descargas. Nativo: hoja de compartir (guardar en
 * Archivos, mandarlo por WhatsApp, imprimir…).
 */
async function compartirArchivoNativo(contenido: string, nombre: string, dialogTitle: string): Promise<void> {
  const archivo = new File(Paths.cache, nombre);
  archivo.create({ intermediates: true, overwrite: true });
  archivo.write(contenido);
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Este dispositivo no tiene una app para guardar o compartir el archivo.');
  }
  await Sharing.shareAsync(archivo.uri, {
    mimeType: 'image/svg+xml',
    UTI: 'public.svg-image',
    dialogTitle,
  });
}

export async function descargarDataMatrix(codigo: string, opciones?: OpcionesSvgDataMatrix): Promise<void> {
  const svg = svgDataMatrixDeCodigo(codigo, opciones);
  const nombre = `${nombreArchivoDataMatrix(codigo)}.svg`;

  if (Platform.OS === 'web') {
    descargarEnNavegador(svg, nombre);
    return;
  }
  await compartirArchivoNativo(svg, nombre, `Data Matrix ${codigo}`);
}

// --- Hoja de etiquetas (varios elementos de una vez) ---
// Reponer una etiqueta perdida de a una no sirve cuando hay que reetiquetar una
// sala completa. La hoja se imprime **paginada** (un SVG por página, del tamaño
// exacto del papel elegido) para que ninguna etiqueta quede cortada por el
// borde de la hoja, y además se puede bajar de una pieza para un visor o una
// cortadora.

// Una hoja más grande que esto deja de ser útil (y de a 300 etiquetas el SVG
// ya pesa cientos de KB): mejor imprimir por sala o por búsqueda.
const MAXIMO_ETIQUETAS_POR_HOJA = 300;

/** Etiquetas de una lista de códigos, ya codificadas y con el tope validado. */
export function etiquetasDeCodigos(codigos: readonly string[]): EtiquetaDataMatrix[] {
  const limpios = codigos.filter(Boolean);
  if (!limpios.length) throw new Error('No hay elementos para etiquetar.');
  if (limpios.length > MAXIMO_ETIQUETAS_POR_HOJA) {
    throw new Error(
      `Son ${limpios.length} etiquetas y una hoja admite ${MAXIMO_ETIQUETAS_POR_HOJA}. Imprime por sala o por búsqueda.`,
    );
  }
  return limpios.map((codigo) => ({ codigo, matriz: encodeToMatrix(codigo) }));
}

function abrirHojaEnNavegador(
  hojas: readonly HojaImprimible[],
  cantidad: number,
  nombreArchivo: string,
  svgUnaPieza: string,
): boolean {
  const urlDescarga = URL.createObjectURL(
    new Blob([svgUnaPieza], { type: 'image/svg+xml;charset=utf-8' }),
  );
  const html = htmlHojaImprimible(hojas, cantidad, nombreArchivo, urlDescarga);
  const urlHoja = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const ventana = window.open(urlHoja, '_blank');
  if (!ventana) {
    // Popup bloqueado: al menos que se baje el archivo.
    URL.revokeObjectURL(urlHoja);
    URL.revokeObjectURL(urlDescarga);
    return false;
  }
  // No revocar antes: la pestaña nueva sigue leyendo de estas URLs.
  setTimeout(() => URL.revokeObjectURL(urlHoja), 300_000);
  return true;
}

/**
 * Entrega la hoja con las etiquetas de varios elementos.
 * Web: abre una pestaña lista para imprimir, con el papel elegible ahí mismo
 * (imprime sola, con opción de bajar el SVG de una pieza). Nativo: comparte el
 * archivo SVG de la hoja.
 */
export async function descargarHojaEtiquetas(
  codigos: readonly string[],
  opciones: { nombre?: string } & OpcionesHojaEtiquetas = {},
): Promise<string> {
  const { nombre = 'lote', ...opcionesHoja } = opciones;
  const etiquetas = etiquetasDeCodigos(codigos);
  const cantidad = etiquetas.length;
  const archivo = `${nombreArchivoHoja(nombre)}.svg`;
  const svg = svgHojaEtiquetas(etiquetas, opcionesHoja);

  if (Platform.OS === 'web') {
    if (!abrirHojaEnNavegador(hojasImprimibles(etiquetas, opcionesHoja), cantidad, archivo, svg)) {
      descargarEnNavegador(svg, archivo);
    }
    return archivo;
  }
  await compartirArchivoNativo(svg, archivo, `Etiquetas FabLab (${cantidad})`);
  return archivo;
}

export function DataMatrixDownloadButton({
  codigo,
  label = 'Descargar Data Matrix',
  compacta = false,
}: {
  codigo: string;
  label?: string;
  compacta?: boolean;
}) {
  const [descargando, setDescargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function descargar() {
    if (descargando || !codigo) return;
    setDescargando(true);
    setError(null);
    try {
      await descargarDataMatrix(codigo);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo descargar el Data Matrix.');
    } finally {
      setDescargando(false);
    }
  }

  const color = compacta ? '#C8102E' : '#FFFFFF';

  return (
    <View style={styles.downloadBox}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Descargar el Data Matrix de ${codigo}`}
        disabled={descargando}
        onPress={descargar}
        style={({ pressed }) => [
          compacta ? styles.downloadButtonCompacta : styles.downloadButton,
          descargando && styles.downloadButtonOcupado,
          pressed && styles.pressed,
        ]}>
        <DownloadIcon color={color} />
        <ThemedText style={compacta ? styles.downloadLabelCompacta : styles.downloadLabel}>
          {descargando ? 'Preparando…' : label}
        </ThemedText>
      </Pressable>
      {error && <ThemedText style={styles.downloadError}>{error}</ThemedText>}
    </View>
  );
}

export function DataMatrixSheetButton({
  codigos,
  label,
  archivo = 'lote',
  ayuda,
  omitidos = 0,
}: {
  codigos: readonly string[];
  label: string;
  archivo?: string;
  ayuda?: string;
  /** Elementos de la lista sin código: no se pueden etiquetar y la hoja los saltea. */
  omitidos?: number;
}) {
  const [trabajando, setTrabajando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [esError, setEsError] = useState(false);

  async function imprimir() {
    if (trabajando) return;
    setTrabajando(true);
    setAviso(null);
    setEsError(false);
    try {
      const cantidad = codigos.filter(Boolean).length;
      await descargarHojaEtiquetas(codigos, { nombre: archivo });
      setAviso(
        Platform.OS === 'web'
          ? `Abriendo la hoja con ${cantidad} etiqueta${cantidad === 1 ? '' : 's'} (elige A4 o Carta al imprimir)…`
          : `Compartiendo ${cantidad} etiqueta${cantidad === 1 ? '' : 's'}…`,
      );
    } catch (e) {
      setEsError(true);
      setAviso(e instanceof Error ? e.message : 'No se pudieron preparar las etiquetas.');
    } finally {
      setTrabajando(false);
    }
  }

  return (
    <View style={styles.sheetBox}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={trabajando}
        onPress={imprimir}
        style={({ pressed }) => [
          styles.downloadButton,
          trabajando && styles.downloadButtonOcupado,
          pressed && styles.pressed,
        ]}>
        <PrinterIcon color="#FFFFFF" />
        <ThemedText style={styles.downloadLabel}>{trabajando ? 'Preparando…' : label}</ThemedText>
      </Pressable>
      {omitidos > 0 ? (
        <ThemedText style={styles.downloadAviso}>
          {omitidos === 1
            ? '1 elemento de la lista no tiene código y queda fuera de la hoja.'
            : `${omitidos} elementos de la lista no tienen código y quedan fuera de la hoja.`}
        </ThemedText>
      ) : null}
      {aviso ? (
        <ThemedText themeColor={esError ? 'text' : 'textSecondary'} style={[styles.downloadHint, esError && styles.downloadError]}>
          {aviso}
        </ThemedText>
      ) : null}
      {ayuda && !aviso ? (
        <ThemedText themeColor="textSecondary" type="small" style={styles.downloadHint}>
          {ayuda}
        </ThemedText>
      ) : null}
    </View>
  );
}

function PrinterIcon({ color }: { color: string }) {
  return (
    <Svg width="16" height="16" viewBox="0 0 24 24" fill="none" accessibilityLabel="Imprimir">
      <Path d="M7 8V4h10v4" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M6 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-1" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M7 14h10v7H7z" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function DownloadIcon({ color }: { color: string }) {
  return (
    <Svg width="16" height="16" viewBox="0 0 24 24" fill="none" accessibilityLabel="Descargar">
      <Path d="M12 4v11M12 15l-4-4M12 15l4-4" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M5 16v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  downloadBox: { alignItems: 'center', gap: Spacing.half },
  downloadButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.one, minHeight: 44, borderRadius: 8, backgroundColor: '#C8102E', paddingHorizontal: Spacing.three },
  downloadButtonCompacta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.half, minHeight: 34, borderRadius: 17, borderWidth: 1, borderColor: '#C8102E', paddingHorizontal: Spacing.two },
  downloadButtonOcupado: { opacity: 0.6 },
  downloadLabel: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  downloadLabelCompacta: { color: '#C8102E', fontWeight: '700', fontSize: 13 },
  downloadError: { color: '#C8102E', fontSize: 13, textAlign: 'center' },
  downloadHint: { fontSize: 13, textAlign: 'center', lineHeight: 18 },
  downloadAviso: { color: '#C8102E', fontSize: 13, textAlign: 'center', lineHeight: 18 },
  sheetBox: { alignItems: 'center', gap: Spacing.half, width: '100%' },
  pressed: { opacity: 0.78 },
});
