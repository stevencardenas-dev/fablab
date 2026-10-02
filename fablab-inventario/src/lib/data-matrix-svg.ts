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
// Alto reservado abajo para el código legible, en módulos (2,5 mm con el módulo
// por defecto de 0,5 mm: la fuente y el aire que deja).
const ALTO_ETIQUETA_MODULOS = 5;
// Cuerpo de la fuente del código impreso, en módulos (2 mm con el módulo por
// defecto). Tiene que coincidir con el `font-size` que se escribe en el SVG.
const TAMANO_TEXTO_MODULOS = 4;
// Ancho de avance de una monoespaciada, en em (DejaVu Sans Mono: 0,6023).
// Se usa para saber cuánto ocupa el código impreso **antes** de imprimirlo, sin
// depender de la fuente que tenga el sistema: el texto se dibuja con
// `textLength`, así que la caja es la que dice esta cuenta y no la que resulte.
const AVANCE_TEXTO_EM = 0.6;

/**
 * Ancho del código impreso bajo el símbolo, en módulos del lienzo.
 * Un código largo (`FL-XXXXXXXXXXX`, 15 caracteres) mide ~18 mm y no entra en
 * una etiqueta de 9 mm: por eso la celda de la hoja y el lienzo de la etiqueta
 * suelta se miden con esto y no solo con el símbolo. Sin esto el texto se salía
 * de la etiqueta, pisaba la celda vecina y podía caer fuera del margen de la
 * impresora (lo encontró scripts/verificar-impresion.mjs).
 */
export function anchoTextoModulos(codigo: string): number {
  return codigo.trim().length * AVANCE_TEXTO_EM * TAMANO_TEXTO_MODULOS;
}

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
  const anchoSimboloModulos = matriz.width + margen * 2;
  const altoSimboloModulos = matriz.height + margen * 2;
  const altoModulos = altoSimboloModulos + (etiqueta ? ALTO_ETIQUETA_MODULOS : 0);

  // Si el código impreso es más ancho que el símbolo, manda él: así el texto no
  // queda recortado por el borde del lienzo.
  const anchoTexto = etiqueta ? anchoTextoModulos(etiqueta) : 0;
  const anchoLienzo = Math.max(anchoSimboloModulos, anchoTexto);

  const lineas = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${numero(anchoLienzo * moduloMm)}mm" height="${numero(altoModulos * moduloMm)}mm" viewBox="0 0 ${numero(anchoLienzo)} ${numero(altoModulos)}" shape-rendering="crispEdges">`,
    // Fondo blanco explícito: sin él, una impresora que rellene los huecos (o un
    // visor en modo oscuro) invierte los módulos y el código deja de leerse.
    `<rect x="0" y="0" width="${numero(anchoLienzo)}" height="${numero(altoModulos)}" fill="#ffffff"/>`,
    '<g fill="#000000">',
    // El símbolo se centra en el lienzo si el texto lo ensanchó.
    ...rectangulosNegros(matriz, margen, 1, (anchoLienzo - anchoSimboloModulos) / 2),
    '</g>',
  ];

  if (etiqueta) {
    lineas.push(
      `<text x="${numero(anchoLienzo / 2)}" y="${numero(altoModulos - 1)}" text-anchor="middle" font-family="monospace" font-size="${TAMANO_TEXTO_MODULOS}" font-weight="bold" fill="#000000" textLength="${numero(anchoTexto)}" lengthAdjust="spacingAndGlyphs">${escaparXml(etiqueta)}</text>`,
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

/**
 * Papeles en los que se imprime de verdad. No entran las mismas etiquetas en
 * cada uno (Carta es 6 mm más ancha y 18 mm más baja que A4), así que la
 * maqueta se calcula contra el papel elegido y no contra un tamaño fijo.
 */
export type PapelImpresion = 'a4' | 'carta' | 'oficio';

// Medidas exactas de norma, no redondeadas: con 216 × 279 el diálogo de
// impresión no reconoce la hoja y cae en "personalizado". Carta y Oficio son
// 8.5 in de ancho; Oficio es el folio de 8.5 × 13 in.
export const PAPELES: Record<PapelImpresion, { nombre: string; anchoMm: number; altoMm: number }> = {
  a4: { nombre: 'A4', anchoMm: 210, altoMm: 297 },
  carta: { nombre: 'Carta', anchoMm: 215.9, altoMm: 279.4 },
  oficio: { nombre: 'Oficio', anchoMm: 215.9, altoMm: 330.2 },
};

/** Orden en que se ofrecen al imprimir. */
export const PAPELES_DISPONIBLES: readonly PapelImpresion[] = ['carta', 'a4', 'oficio'];

export type OpcionesHojaEtiquetas = {
  /** Lado de un módulo, en mm. */
  moduloMm?: number;
  /** Zona de silencio de cada símbolo, en módulos. */
  margenModulos?: number;
  /** Papel de impresión. Por defecto A4 vertical (210 × 297). */
  papel?: PapelImpresion;
  /** Página, en mm. Si se pasan, ganan sobre `papel`. */
  anchoHojaMm?: number;
  altoHojaMm?: number;
  /** Margen imprimible de la página, en mm. */
  margenHojaMm?: number;
  /** Aire entre celdas, en mm (también da el espacio para cortar). */
  separacionMm?: number;
  /** Forzar columnas en vez de calcularlas a partir del ancho de página. */
  columnas?: number;
};

const PAPEL_HOJA_DEFECTO: PapelImpresion = 'a4';
const MARGEN_HOJA_MM_DEFECTO = 10;
const SEPARACION_MM_DEFECTO = 4;
// Aire entre el borde de la etiqueta y su guía de corte.
const GUIA_MM = 1;
// Milímetro que se le quita al alto de cada página impresa. Un bloque que mide
// exactamente el alto del papel depende del redondeo del navegador y puede
// empujar una página en blanco entre medio. Ese milímetro sale del margen
// inferior (10 mm), así que no recorta ninguna etiqueta.
export const HOLGURA_PAGINA_MM = 1;

/** Medida de la página en mm: el `papel` elegido, o los overrides explícitos. */
export function medidasPapel(opciones: OpcionesHojaEtiquetas = {}): {
  nombre: string;
  anchoMm: number;
  altoMm: number;
} {
  const base = PAPELES[opciones.papel ?? PAPEL_HOJA_DEFECTO];
  return {
    nombre: base.nombre,
    anchoMm: opciones.anchoHojaMm ?? base.anchoMm,
    altoMm: opciones.altoHojaMm ?? base.altoMm,
  };
}

/** Etiqueta ya medida: su matriz y la caja que ocupa en la grilla, en mm. */
export type MedidaEtiqueta = {
  codigo: string;
  matriz: MatrizDataMatrix;
  /** Caja del símbolo (módulos + zona de silencio). */
  anchoMm: number;
  altoMm: number;
  /** Caja del código impreso debajo, que puede ser más ancha que el símbolo. */
  anchoTextoMm: number;
};

/** Etiqueta ubicada en la grilla de una página (fila 0 = arriba). */
export type UbicadaEtiqueta = { medida: MedidaEtiqueta; columna: number; fila: number };

export type PlanHoja = {
  papel: { nombre: string; anchoMm: number; altoMm: number };
  margenHojaMm: number;
  separacionMm: number;
  moduloMm: number;
  margenModulos: number;
  /** Celda de la grilla: la etiqueta más grande, para poder cortar en recto. */
  celdaAnchoMm: number;
  celdaAltoMm: number;
  columnas: number;
  filasPorPagina: number;
  porPagina: number;
  /** Todas las etiquetas, en orden, medidas (sin ubicar). */
  medidas: MedidaEtiqueta[];
  /** Una entrada por página, con las etiquetas que le tocan. */
  paginas: UbicadaEtiqueta[][];
};

/**
 * Reparte las etiquetas en páginas del papel elegido. Es puro, y es lo único
 * que decide cuántas entran por página: la hoja de una pieza (archivo) y la
 * hoja paginada (impresión) dibujan desde el mismo plan, así que no pueden
 * discrepar en la grilla.
 */
export function planHojaEtiquetas(
  etiquetas: readonly EtiquetaDataMatrix[],
  opciones: OpcionesHojaEtiquetas = {},
): PlanHoja {
  const moduloMm = opciones.moduloMm && opciones.moduloMm > 0 ? opciones.moduloMm : MODULO_MM_DEFECTO;
  const margenModulos = Math.max(0, opciones.margenModulos ?? MARGEN_MODULOS_DEFECTO);
  const margenHojaMm = opciones.margenHojaMm ?? MARGEN_HOJA_MM_DEFECTO;
  const separacionMm = opciones.separacionMm ?? SEPARACION_MM_DEFECTO;
  const papel = medidasPapel(opciones);
  const altoTextoMm = ALTO_ETIQUETA_MODULOS * moduloMm;

  // Cada etiqueta tiene su propia medida (matrices de distinto tamaño), pero la
  // celda de la grilla es la más grande de todas: así las columnas quedan
  // alineadas y se puede cortar en línea recta sin pisar el código del vecino.
  const medidas: MedidaEtiqueta[] = etiquetas.map(({ codigo, matriz }) => ({
    codigo,
    matriz,
    anchoMm: (matriz.width + margenModulos * 2) * moduloMm,
    altoMm: (matriz.height + margenModulos * 2) * moduloMm + altoTextoMm,
    anchoTextoMm: anchoTextoModulos(codigo) * moduloMm,
  }));

  // La celda tiene que caber el símbolo **y** el código impreso: si no, el texto
  // se sale de la etiqueta, pisa la celda vecina y puede quedar fuera del margen
  // de la impresora. Un código de 15 caracteres pide ~18 mm, el doble que su
  // símbolo de 9 mm, así que en esa hoja entran menos etiquetas por fila.
  const celdaAnchoMm = medidas.length
    ? Math.max(...medidas.map((m) => Math.max(m.anchoMm, m.anchoTextoMm)))
    : 0;
  const celdaAltoMm = medidas.length ? Math.max(...medidas.map((m) => m.altoMm)) : 0;
  const anchoUtil = Math.max(celdaAnchoMm, papel.anchoMm - margenHojaMm * 2);
  const columnas = Math.max(
    1,
    opciones.columnas ?? Math.floor((anchoUtil + separacionMm) / (celdaAnchoMm + separacionMm)),
  );
  // Filas que entran **completas** en el alto imprimible. Acá es donde la hoja
  // deja de cortar etiquetas: lo que no entra arranca la página siguiente en
  // vez de quedar partido por el borde del papel.
  const altoUtil = Math.max(celdaAltoMm, papel.altoMm - margenHojaMm * 2);
  const filasPorPagina = Math.max(
    1,
    Math.floor((altoUtil + separacionMm) / (celdaAltoMm + separacionMm)),
  );
  const porPagina = columnas * filasPorPagina;
  const totalPaginas = Math.max(1, Math.ceil(medidas.length / porPagina));

  const paginas = Array.from({ length: totalPaginas }, (_, pagina) =>
    medidas.slice(pagina * porPagina, (pagina + 1) * porPagina).map((medida, i) => ({
      medida,
      columna: i % columnas,
      fila: Math.floor(i / columnas),
    })),
  );

  return {
    papel,
    margenHojaMm,
    separacionMm,
    moduloMm,
    margenModulos,
    celdaAnchoMm,
    celdaAltoMm,
    columnas,
    filasPorPagina,
    porPagina,
    medidas,
    paginas,
  };
}

/** Centro horizontal de la celda de una columna (ahí va el código impreso). */
function centroDeColumna(columna: number, plan: PlanHoja): number {
  return plan.margenHojaMm + columna * (plan.celdaAnchoMm + plan.separacionMm) + plan.celdaAnchoMm / 2;
}

/** Esquina superior izquierda de la etiqueta dentro de la página. */
function ubicarEnLaGrilla({ medida, columna, fila }: UbicadaEtiqueta, plan: PlanHoja): { x: number; y: number } {
  const celdaX = plan.margenHojaMm + columna * (plan.celdaAnchoMm + plan.separacionMm);
  const celdaY = plan.margenHojaMm + fila * (plan.celdaAltoMm + plan.separacionMm);
  // Centrada en su celda: el corte queda parejo aunque la matriz no lo sea.
  return {
    x: celdaX + (plan.celdaAnchoMm - medida.anchoMm) / 2,
    y: celdaY + (plan.celdaAltoMm - medida.altoMm) / 2,
  };
}

/** Grupo SVG de una etiqueta: guía de corte, símbolo y código legible debajo. */
function grupoEtiqueta(ubicada: UbicadaEtiqueta, plan: PlanHoja): string[] {
  const { medida } = ubicada;
  const { x, y } = ubicarEnLaGrilla(ubicada, plan);
  return [
    `<g data-codigo="${escaparXml(medida.codigo)}">`,
    `<rect x="${numero(x - GUIA_MM)}" y="${numero(y - GUIA_MM)}" width="${numero(medida.anchoMm + GUIA_MM * 2)}" height="${numero(medida.altoMm + GUIA_MM * 2)}" fill="none" stroke="#bbbbbb" stroke-width="0.15" stroke-dasharray="1 1"/>`,
    ...rectangulosNegros(medida.matriz, plan.margenModulos, plan.moduloMm, x, y),
    // Centrado en la celda (no en el símbolo) y con el ancho declarado: la caja
    // del texto es la que midió el plan, así que la celda la contiene siempre.
    `<text x="${numero(centroDeColumna(ubicada.columna, plan))}" y="${numero(y + medida.altoMm - plan.moduloMm)}" text-anchor="middle" font-family="monospace" font-size="${numero(TAMANO_TEXTO_MODULOS * plan.moduloMm)}" font-weight="bold" fill="#000000" textLength="${numero(medida.anchoTextoMm)}" lengthAdjust="spacingAndGlyphs">${escaparXml(medida.codigo)}</text>`,
    '</g>',
  ];
}

function envolverSvg(anchoMm: number, altoMm: number, contenido: readonly string[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${numero(anchoMm)}mm" height="${numero(altoMm)}mm" viewBox="0 0 ${numero(anchoMm)} ${numero(altoMm)}" shape-rendering="crispEdges">`,
    // Fondo blanco explícito: sin él, una impresora que rellene los huecos (o un
    // visor en modo oscuro) invierte los módulos y el código deja de leerse.
    `<rect x="0" y="0" width="${numero(anchoMm)}" height="${numero(altoMm)}" fill="#ffffff"/>`,
    ...contenido,
    '</svg>',
    '',
  ].join('\n');
}

/**
 * Hoja de una sola pieza: crece hacia abajo todo lo que haga falta.
 * Es el archivo que se descarga o se comparte (un visor lo escala, una
 * cortadora lo corta de una pasada) y conserva las columnas de la página. Para
 * imprimir de verdad está `paginasHojaEtiquetas()`, que no deja nada al corte
 * del navegador.
 */
export function svgHojaEtiquetas(
  etiquetas: readonly EtiquetaDataMatrix[],
  opciones: OpcionesHojaEtiquetas = {},
): string {
  const plan = planHojaEtiquetas(etiquetas, opciones);
  const filas = Math.max(1, Math.ceil(plan.medidas.length / plan.columnas));
  const altoNecesario =
    plan.margenHojaMm * 2 + filas * plan.celdaAltoMm + (filas - 1) * plan.separacionMm;
  const contenido = plan.medidas.flatMap((medida, i) =>
    grupoEtiqueta({ medida, columna: i % plan.columnas, fila: Math.floor(i / plan.columnas) }, plan),
  );
  return envolverSvg(plan.papel.anchoMm, Math.max(plan.papel.altoMm, altoNecesario), contenido);
}

/**
 * Una página por SVG, cada una del tamaño exacto del papel elegido.
 * Esto es lo que evita que se corte una etiqueta al imprimir: el navegador no
 * parte un bloque que cabe en la página, así que lo que sobra pasa a la
 * siguiente en vez de quedar rebanado por el borde del papel.
 */
export function paginasHojaEtiquetas(
  etiquetas: readonly EtiquetaDataMatrix[],
  opciones: OpcionesHojaEtiquetas = {},
): string[] {
  const plan = planHojaEtiquetas(etiquetas, opciones);
  const altoPagina = plan.papel.altoMm - HOLGURA_PAGINA_MM;
  return plan.paginas.map((pagina) =>
    envolverSvg(plan.papel.anchoMm, altoPagina, pagina.flatMap((u) => grupoEtiqueta(u, plan))),
  );
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
