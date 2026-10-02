// Página HTML que la app abre en una pestaña para imprimir la hoja de
// etiquetas (o guardarla como PDF desde el diálogo de impresión).
//
// Vive aparte del componente porque es una función pura de cadenas: el
// componente arrastra react-native, expo-file-system y expo-sharing, y así esta
// parte se puede probar en Jest sin montar la app. Y sobre todo: lo que se
// imprime es esto, así que tenerlo aislado permite imprimirlo de verdad
// (Chrome headless a PDF) y medir el resultado en vez de suponerlo.

import {
  medidasPapel,
  paginasHojaEtiquetas,
  PAPELES_DISPONIBLES,
  type EtiquetaDataMatrix,
  type OpcionesHojaEtiquetas,
  type PapelImpresion,
} from '@/lib/data-matrix-svg';

// Papel con el que arranca la pestaña de impresión. Carta por defecto porque es
// el que más se carga acá, y porque es el default que menos rompe si la
// impresora tiene otro papel: una hoja de Carta sobre A4 solo pierde 4 mm del
// margen derecho (etiquetas intactas), mientras que al revés se pierde la
// última fila entera, que A4 es 17,6 mm más alto que Carta.
export const PAPEL_IMPRESION_DEFECTO: PapelImpresion = 'carta';

export type HojaImprimible = {
  papel: PapelImpresion;
  nombre: string;
  anchoMm: number;
  altoMm: number;
  /** Un SVG por página, del tamaño exacto del papel. */
  paginas: string[];
};

/** Las páginas de cada papel ofrecido, listas para embeber en la pestaña. */
export function hojasImprimibles(
  etiquetas: readonly EtiquetaDataMatrix[],
  opciones: OpcionesHojaEtiquetas = {},
): HojaImprimible[] {
  return PAPELES_DISPONIBLES.map((papel) => {
    const conPapel = { ...opciones, papel };
    const { nombre, anchoMm, altoMm } = medidasPapel(conPapel);
    return { papel, nombre, anchoMm, altoMm, paginas: paginasHojaEtiquetas(etiquetas, conPapel) };
  });
}

// La declaración XML es del archivo, no del fragmento: embebida en HTML el
// navegador la lee como un comentario raro.
function sinDeclaracionXml(svg: string): string {
  return svg.replace(/^<\?xml[^>]*\?>\s*/, '').trim();
}

// La barra de arriba ofrece imprimir/guardar PDF, elegir el papel (la app no
// puede saber qué tiene cargado la impresora), bajar el SVG de una pieza y
// recuerda imprimir al 100 %. Se oculta al imprimir. Se intenta abrir el
// diálogo solo: si el navegador lo bloquea, el botón queda a la vista.
//
// Cada página es un bloque de exactamente el alto del papel menos 1 mm, con
// salto de página forzado después: el navegador no tiene dónde partir una
// etiqueta, así que pagina entre etiquetas y no por el borde del papel.
export function htmlHojaImprimible(
  hojas: readonly HojaImprimible[],
  cantidad: number,
  nombreArchivo: string,
  urlDescarga: string,
): string {
  const inicial = hojas.find((h) => h.papel === PAPEL_IMPRESION_DEFECTO) ?? hojas[0];
  const datos = Object.fromEntries(
    hojas.map((h) => [
      h.papel,
      { nombre: h.nombre, anchoMm: h.anchoMm, altoMm: h.altoMm, paginas: h.paginas.length },
    ]),
  );
  const opciones = hojas
    .map(
      (h) =>
        `<option value="${h.papel}"${h.papel === inicial.papel ? ' selected' : ''}>${h.nombre}</option>`,
    )
    .join('');

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Etiquetas FabLab (${cantidad})</title>
<style>
  html, body { margin: 0; padding: 0; background: #ffffff; }
  .barra { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; padding: 10px 14px; font: 600 14px system-ui, sans-serif; background: #f0f0f3; }
  .barra button { font: inherit; color: #ffffff; background: #C8102E; border: 0; border-radius: 8px; padding: 8px 14px; cursor: pointer; }
  .barra select { font: inherit; padding: 4px 6px; border-radius: 6px; border: 1px solid #b9bcc4; }
  .barra a { color: #C8102E; }
  .barra span { color: #60646C; font-weight: 500; }
  @media print { .barra { display: none; } }
</style>
<style id="css-hoja"></style>
</head>
<body>
<div class="barra">
  <button type="button" onclick="window.print()">Imprimir / Guardar PDF</button>
  <label>Papel: <select id="select-papel" onchange="pintarPapel(this.value)">${opciones}</select></label>
  <span id="resumen"></span>
  <a href="${urlDescarga}" download="${nombreArchivo}">Descargar SVG (una pieza)</a>
  <span>Imprime al 100 % (tamaño real), sin «ajustar a la página».</span>
</div>
<main>
${hojas
  .map(
    (h) =>
      `<section class="papel" data-papel="${h.papel}">\n${h.paginas
        .map((svg) => `<div class="pagina">\n${sinDeclaracionXml(svg)}\n</div>`)
        .join('\n')}\n</section>`,
  )
  .join('\n')}
</main>
<script>
var HOJAS = ${JSON.stringify(datos)};
function pintarPapel(papel) {
  var hoja = HOJAS[papel] || HOJAS[${JSON.stringify(inicial.papel)}];
  document.getElementById('css-hoja').textContent = [
    '@page { size: ' + hoja.anchoMm + 'mm ' + hoja.altoMm + 'mm; margin: 0; }',
    '.papel { display: none; }',
    '.papel[data-papel="' + papel + '"] { display: block; }',
    '.pagina { break-after: page; page-break-after: always; }',
    '.pagina:last-child { break-after: auto; page-break-after: auto; }',
    '.pagina > svg { display: block; width: ' + hoja.anchoMm + 'mm; height: auto; }'
  ].join('\\n');
  document.getElementById('resumen').textContent =
    ${cantidad} + ' etiqueta' + (${cantidad} === 1 ? '' : 's') + ' · ' +
    hoja.paginas + (hoja.paginas === 1 ? ' página' : ' páginas') + ' en ' + hoja.nombre;
}
window.addEventListener('load', function () {
  pintarPapel(document.getElementById('select-papel').value);
  setTimeout(function () { window.print(); }, 400);
});
</script>
</body>
</html>`;
}
