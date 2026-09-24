// SVG imprimible a partir de la matriz de módulos de un Data Matrix.
//
// Por qué SVG y no una imagen: el módulo se mide en milímetros y el navegador
// lo vectoriza, así que la etiqueta sale nítida a cualquier tamaño de impresora.
// Un PNG de este tamaño impreso en 300 dpi se vería pixelado en los bordes.
//
// Es una función pura (recibe la matriz ya calculada, no codifica): así se
// puede probar con matrices de mentira sin arrastrar datamatrix-svg-ts, que es
// ESM-only y Jest no transforma node_modules de este proyecto.

export type MatrizDataMatrix = {
  /** matrix[y][x] truthy = módulo negro. Las filas vienen dispersas (huecos). */
  matrix: readonly (readonly number[])[];
  width: number;
  height: number;
};

export type OpcionesSvgDataMatrix = {
  /** Texto bajo el símbolo (normalmente el propio código). Vacío = sin texto. */
  etiqueta?: string;
  /** Lado de un módulo impreso, en mm. 0.5 mm ≈ etiqueta de ~10 mm. */
  moduloMm?: number;
  /** Zona de silencio alrededor del símbolo, en módulos (ISO/IEC 16022: ≥1). */
  margenModulos?: number;
};

const MODULO_MM_DEFECTO = 0.5;
const MARGEN_MODULOS_DEFECTO = 1;
// Alto reservado abajo para el código legible, en módulos.
const ALTO_ETIQUETA_MODULOS = 5;

function escaparXml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Coordenadas cortas y sin ruido de punto flotante (0.5 * 3 = 1.5, no 1.5000000000000002).
function numero(valor: number): string {
  return String(Number(valor.toFixed(3)));
}

// Un rect por cada corrida horizontal de módulos: la fila entera en un solo
// rect es lo normal, así que el SVG queda con ~20 rects en vez de ~300.
// `escala` convierte módulos a la unidad de dibujo (1 en la etiqueta suelta,
// mm en la hoja) y `dx`/`dy` ubican el símbolo dentro de esa unidad.
function rectangulosNegros(
  { matrix, width, height }: MatrizDataMatrix,
  margen: number,
  escala = 1,
  dx = 0,
  dy = 0,
): string[] {
  const rects: string[] = [];
  for (let y = 0; y < height; y++) {
    const fila: readonly number[] = matrix[y] ?? [];
    let x = 0;
    while (x < width) {
      if (!fila[x]) {
        x++;
        continue;
      }
      let fin = x;
      while (fin + 1 < width && fila[fin + 1]) fin++;
      rects.push(
        `<rect x="${numero(dx + (margen + x) * escala)}" y="${numero(dy + (margen + y) * escala)}" width="${numero((fin - x + 1) * escala)}" height="${numero(escala)}"/>`,
      );
      x = fin + 1;
    }
  }
  return rects;
}

export function svgDataMatrix(matriz: MatrizDataMatrix, opciones: OpcionesSvgDataMatrix = {}): string {
  const moduloMm = opciones.moduloMm && opciones.moduloMm > 0 ? opciones.moduloMm : MODULO_MM_DEFECTO;
  const margen = Math.max(0, opciones.margenModulos ?? MARGEN_MODULOS_DEFECTO);
  const etiqueta = (opciones.etiqueta ?? '').trim();

  // El lienzo se mide en módulos (viewBox) y se declara en mm (width/height):
  // el consumidor imprime milímetros exactos y el vector no pierde definición.
  const anchoModulos = matriz.width + margen * 2;
  const altoSimboloModulos = matriz.height + margen * 2;
  const altoModulos = altoSimboloModulos + (etiqueta ? ALTO_ETIQUETA_MODULOS : 0);

  const lineas = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${numero(anchoModulos * moduloMm)}mm" height="${numero(altoModulos * moduloMm)}mm" viewBox="0 0 ${numero(anchoModulos)} ${numero(altoModulos)}" shape-rendering="crispEdges">`,
    // Fondo blanco explícito: sin él, una impresora que rellene los huecos (o un
    // visor en modo oscuro) invierte los módulos y el código deja de leerse.
    `<rect x="0" y="0" width="${numero(anchoModulos)}" height="${numero(altoModulos)}" fill="#ffffff"/>`,
    '<g fill="#000000">',
    ...rectangulosNegros(matriz, margen),
    '</g>',
  ];

  if (etiqueta) {
    lineas.push(
      `<text x="${numero(anchoModulos / 2)}" y="${numero(altoModulos - 1)}" text-anchor="middle" font-family="monospace" font-size="4" font-weight="bold" fill="#000000">${escaparXml(etiqueta)}</text>`,
    );
  }
  lineas.push('</svg>', '');

  return lineas.join('\n');
}

// --- Hoja de etiquetas ---
// Cuando la etiqueta física se perdió hay que reponerla; de a una (descargar,
// imprimir, repetir) no escala para una sala entera. Esta hoja acomoda muchas
// etiquetas en una grilla sobre la página y se imprime de una sola vez (o se
// guarda como PDF desde el diálogo de impresión).

export type EtiquetaDataMatrix = { codigo: string; matriz: MatrizDataMatrix };

export type OpcionesHojaEtiquetas = {
  /** Lado de un módulo, en mm. */
  moduloMm?: number;
  /** Zona de silencio de cada símbolo, en módulos. */
  margenModulos?: number;
  /** Página, en mm. Por defecto A4 vertical (210 × 297). */
  anchoHojaMm?: number;
  altoHojaMm?: number;
  /** Margen imprimible de la página, en mm. */
  margenHojaMm?: number;
  /** Aire entre celdas, en mm (también da el espacio para cortar). */
  separacionMm?: number;
  /** Forzar columnas en vez de calcularlas a partir del ancho de página. */
  columnas?: number;
};

const ANCHO_HOJA_MM_DEFECTO = 210; // A4 vertical
const ALTO_HOJA_MM_DEFECTO = 297;
const MARGEN_HOJA_MM_DEFECTO = 10;
const SEPARACION_MM_DEFECTO = 4;
// Aire entre el borde de la etiqueta y su guía de corte.
const GUIA_MM = 1;

export function svgHojaEtiquetas(
  etiquetas: readonly EtiquetaDataMatrix[],
  opciones: OpcionesHojaEtiquetas = {},
): string {
  const moduloMm = opciones.moduloMm && opciones.moduloMm > 0 ? opciones.moduloMm : MODULO_MM_DEFECTO;
  const margen = Math.max(0, opciones.margenModulos ?? MARGEN_MODULOS_DEFECTO);
  const margenHoja = opciones.margenHojaMm ?? MARGEN_HOJA_MM_DEFECTO;
  const separacion = opciones.separacionMm ?? SEPARACION_MM_DEFECTO;
  const altoTexto = ALTO_ETIQUETA_MODULOS * moduloMm;

  // Cada etiqueta tiene su propia medida (matrices de distinto tamaño), pero la
  // celda de la grilla es la más grande de todas: así las columnas quedan
  // alineadas y se puede cortar en línea recta sin pisar el código del vecino.
  const medidas = etiquetas.map(({ codigo, matriz }) => ({
    codigo,
    matriz,
    ancho: (matriz.width + margen * 2) * moduloMm,
    alto: (matriz.height + margen * 2) * moduloMm + altoTexto,
  }));

  const celdaAncho = medidas.length ? Math.max(...medidas.map((m) => m.ancho)) : 0;
  const celdaAlto = medidas.length ? Math.max(...medidas.map((m) => m.alto)) : 0;
  const anchoUtil = Math.max(celdaAncho, (opciones.anchoHojaMm ?? ANCHO_HOJA_MM_DEFECTO) - margenHoja * 2);
  const columnas = Math.max(
    1,
    opciones.columnas ?? Math.floor((anchoUtil + separacion) / (celdaAncho + separacion)),
  );
  const filas = Math.max(1, Math.ceil(medidas.length / columnas));

  // Si hay más etiquetas que las que entran en la página, la hoja crece hacia
  // abajo en vez de recortarlas: el navegador paginará al imprimir.
  const altoNecesario = margenHoja * 2 + filas * celdaAlto + (filas - 1) * separacion;
  const anchoHoja = opciones.anchoHojaMm ?? ANCHO_HOJA_MM_DEFECTO;
  const altoHoja = Math.max(opciones.altoHojaMm ?? ALTO_HOJA_MM_DEFECTO, altoNecesario);

  const partes: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${numero(anchoHoja)}mm" height="${numero(altoHoja)}mm" viewBox="0 0 ${numero(anchoHoja)} ${numero(altoHoja)}" shape-rendering="crispEdges">`,
    `<rect x="0" y="0" width="${numero(anchoHoja)}" height="${numero(altoHoja)}" fill="#ffffff"/>`,
  ];

  medidas.forEach((medida, i) => {
    const columna = i % columnas;
    const fila = Math.floor(i / columnas);
    const celdaX = margenHoja + columna * (celdaAncho + separacion);
    const celdaY = margenHoja + fila * (celdaAlto + separacion);
    // Centrada en su celda: el corte queda parejo aunque la matriz no lo sea.
    const x = celdaX + (celdaAncho - medida.ancho) / 2;
    const y = celdaY + (celdaAlto - medida.alto) / 2;

    partes.push(`<g data-codigo="${escaparXml(medida.codigo)}">`);
    partes.push(
      `<rect x="${numero(x - GUIA_MM)}" y="${numero(y - GUIA_MM)}" width="${numero(medida.ancho + GUIA_MM * 2)}" height="${numero(medida.alto + GUIA_MM * 2)}" fill="none" stroke="#bbbbbb" stroke-width="0.15" stroke-dasharray="1 1"/>`,
    );
    partes.push(...rectangulosNegros(medida.matriz, margen, moduloMm, x, y));
    partes.push(
      `<text x="${numero(x + medida.ancho / 2)}" y="${numero(y + medida.alto - moduloMm)}" text-anchor="middle" font-family="monospace" font-size="${numero(4 * moduloMm)}" font-weight="bold" fill="#000000">${escaparXml(medida.codigo)}</text>`,
    );
    partes.push('</g>');
  });

  partes.push('</svg>', '');
  return partes.join('\n');
}

// Nombre de archivo seguro para cualquier sistema: el código solo trae
// [A-Z0-9-], pero esto evita que un texto raro (pegado a mano en la BD o el
// nombre de una sala) genere una ruta o un nombre inválido en Windows.
function nombreArchivoSeguro(texto: string, alternativa: string): string {
  const limpio = texto.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return limpio || alternativa;
}

/** `datamatrix-FL-XXXX.svg`: un archivo por elemento. */
export function nombreArchivoDataMatrix(codigo: string): string {
  return `datamatrix-${nombreArchivoSeguro(codigo, 'elemento')}`;
}

/** `etiquetas-<sala o búsqueda>.svg`: una hoja con varios elementos. */
export function nombreArchivoHoja(nombre: string): string {
  return `etiquetas-${nombreArchivoSeguro(nombre, 'lote')}`;
}
