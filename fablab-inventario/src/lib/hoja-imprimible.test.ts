import { planHojaEtiquetas, type EtiquetaDataMatrix } from '@/lib/data-matrix-svg';
import { hojasImprimibles, htmlHojaImprimible, PAPEL_IMPRESION_DEFECTO } from '@/lib/hoja-imprimible';

// Matriz cuadrada sintética: acá se prueba la página que se imprime, no el
// contenido decodificado (eso lo cubre scripts/verify-datamatrix.mjs).
function matriz(lado: number): EtiquetaDataMatrix['matriz'] {
  return {
    matrix: Array.from({ length: lado }, (_, y) =>
      Array.from({ length: lado }, (_, x) => ((x + y) % 3 === 0 ? 1 : 0)),
    ),
    width: lado,
    height: lado,
  };
}

// 260 etiquetas: no da el mismo número de páginas en cada papel (Carta y A4
// necesitan dos, Oficio una), que es justo lo que hay que poder elegir.
const ETIQUETAS: EtiquetaDataMatrix[] = Array.from({ length: 260 }, (_, i) => ({
  codigo: `FL-${i}`,
  matriz: matriz(16),
}));

const HOJAS = hojasImprimibles(ETIQUETAS);
const HTML = htmlHojaImprimible(HOJAS, ETIQUETAS.length, 'etiquetas-lote.svg', 'blob:descarga');

function seccion(html: string, papel: string): string {
  const desde = html.indexOf(`data-papel="${papel}"`);
  expect(desde).toBeGreaterThan(-1);
  return html.slice(desde, html.indexOf('</section>', desde));
}

function paginasDe(html: string, papel: string): number {
  return (seccion(html, papel).match(/<div class="pagina">/g) ?? []).length;
}

describe('hojasImprimibles', () => {
  it('arma una hoja por papel ofrecido, con su medida y sus páginas', () => {
    expect(HOJAS.map((h) => h.papel)).toEqual(['carta', 'a4', 'oficio']);
    expect(HOJAS.map((h) => [h.nombre, h.anchoMm, h.altoMm, h.paginas.length])).toEqual([
      ['Carta', 215.9, 279.4, 2],
      ['A4', 210, 297, 2],
      ['Oficio', 215.9, 330.2, 1],
    ]);
  });

  it('el papel por defecto se puede imprimir en A4 sin perder etiquetas', () => {
    // Razón del default: las etiquetas de una hoja de Carta entran en el ancho
    // de A4 (4 mm de margen de sobra). Al revés no: A4 es 17,6 mm más alto, así
    // que su última fila se saldría de una hoja de Carta.
    const carta = planHojaEtiquetas(ETIQUETAS, { papel: PAPEL_IMPRESION_DEFECTO });
    const ultimaColumna = carta.margenHojaMm + carta.columnas * carta.celdaAnchoMm + (carta.columnas - 1) * carta.separacionMm;
    expect(PAPEL_IMPRESION_DEFECTO).toBe('carta');
    expect(ultimaColumna).toBeLessThanOrEqual(210);
  });
});

describe('htmlHojaImprimible', () => {
  it('embebe una sección por papel y una caja por página', () => {
    for (const hoja of HOJAS) {
      expect(HTML).toContain(`<section class="papel" data-papel="${hoja.papel}">`);
      expect(paginasDe(HTML, hoja.papel)).toBe(hoja.paginas.length);
    }
    expect((HTML.match(/<div class="pagina">/g) ?? []).length).toBe(
      HOJAS.reduce((total, h) => total + h.paginas.length, 0),
    );
  });

  it('cada página lleva un solo SVG, con la medida del papel', () => {
    for (const hoja of HOJAS) {
      const cajas = seccion(HTML, hoja.papel).split('<div class="pagina">').slice(1);
      expect(cajas.length).toBe(hoja.paginas.length);
      for (const caja of cajas) {
        expect((caja.match(/<svg /g) ?? []).length).toBe(1);
        expect(caja).toContain(`width="${hoja.anchoMm}mm"`);
      }
    }
  });

  it('no embebe la declaración XML (es del archivo, no del fragmento)', () => {
    expect(HTML).not.toContain('<?xml');
  });

  it('arranca en el papel por defecto y ofrece los tres en el selector', () => {
    expect(HTML).toContain('<option value="carta" selected>Carta</option>');
    expect(HTML).toContain('<option value="a4">A4</option>');
    expect(HTML).toContain('<option value="oficio">Oficio</option>');
  });

  it('lleva las medidas de cada papel para que el selector cambie el @page', () => {
    expect(HTML).toContain('"carta":{"nombre":"Carta","anchoMm":215.9,"altoMm":279.4,"paginas":2}');
    expect(HTML).toContain('"a4":{"nombre":"A4","anchoMm":210,"altoMm":297,"paginas":2}');
    expect(HTML).toContain('"oficio":{"nombre":"Oficio","anchoMm":215.9,"altoMm":330.2,"paginas":1}');
    // El @page sale del JSON, no de un literal A4 en el CSS
    expect(HTML).toContain("'@page { size: ' + hoja.anchoMm + 'mm ' + hoja.altoMm + 'mm; margin: 0; }'");
  });

  it('ocupa cada caja una página y recuerda imprimir al 100 %', () => {
    expect(HTML).toContain('.pagina { break-after: page; page-break-after: always; }');
    expect(HTML).toContain('.pagina:last-child { break-after: auto; page-break-after: auto; }');
    expect(HTML).toContain('@media print { .barra { display: none; } }');
    expect(HTML).toContain('Imprime al 100 %');
    // El resumen que se ve en la barra: cuántas etiquetas y en cuántas páginas
    expect(HTML).toContain('<title>Etiquetas FabLab (260)</title>');
    expect(HTML).toContain("260 + ' etiqueta' + (260 === 1 ? '' : 's')");
  });
});
