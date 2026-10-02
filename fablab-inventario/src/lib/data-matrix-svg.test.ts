import {
  HOLGURA_PAGINA_MM,
  medidasPapel,
  nombreArchivoDataMatrix,
  nombreArchivoHoja,
  paginasHojaEtiquetas,
  PAPELES,
  PAPELES_DISPONIBLES,
  planHojaEtiquetas,
  svgDataMatrix,
  svgHojaEtiquetas,
  type MatrizDataMatrix,
} from '@/lib/data-matrix-svg';

// Matriz de mentira 3x2 (no hace falta codificar de verdad para probar la
// geometría del SVG; datamatrix-svg-ts es ESM-only y Jest no lo transforma).
const MATRIZ: MatrizDataMatrix = {
  matrix: [
    [1, 1, 0],
    [0, 1, 1],
  ],
  width: 3,
  height: 2,
};

function rectsNegros(svg: string): { x: number; y: number; width: number; height: number }[] {
  const grupo = svg.split('<g fill="#000000">')[1]?.split('</g>')[0] ?? '';
  return [...grupo.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"\/>/g)].map(
    (m) => ({ x: Number(m[1]), y: Number(m[2]), width: Number(m[3]), height: Number(m[4]) }),
  );
}

describe('svgDataMatrix', () => {
  it('declara el lienzo en mm y el viewBox en módulos', () => {
    const svg = svgDataMatrix(MATRIZ);
    // 3 módulos + 2 de margen (1 por lado) = 5 módulos → 2.5 mm con módulo de 0.5 mm
    expect(svg).toContain('width="2.5mm"');
    expect(svg).toContain('height="2mm"');
    expect(svg).toContain('viewBox="0 0 5 4"');
  });

  it('respeta el tamaño de módulo y el margen pedidos', () => {
    const svg = svgDataMatrix(MATRIZ, { moduloMm: 1, margenModulos: 2 });
    expect(svg).toContain('width="7mm"'); // 3 + 2*2 módulos
    expect(svg).toContain('height="6mm"');
    expect(svg).toContain('viewBox="0 0 7 6"');
  });

  it('fusiona módulos contiguos en un solo rect', () => {
    const svg = svgDataMatrix(MATRIZ);
    const rects = rectsNegros(svg);
    // fila 0: [1,1,0] → una corrida de 2; fila 1: [0,1,1] → una corrida de 2
    expect(rects).toEqual([
      { x: 1, y: 1, width: 2, height: 1 },
      { x: 2, y: 2, width: 2, height: 1 },
    ]);
  });

  it('deja zona de silencio: ningún módulo negro toca el borde', () => {
    const svg = svgDataMatrix(MATRIZ);
    for (const r of rectsNegros(svg)) {
      expect(r.x).toBeGreaterThanOrEqual(1);
      expect(r.y).toBeGreaterThanOrEqual(1);
      expect(r.x + r.width).toBeLessThanOrEqual(4);
      expect(r.y + r.height).toBeLessThanOrEqual(3);
    }
  });

  it('omite la zona de silencio si se pide margen 0', () => {
    const svg = svgDataMatrix(MATRIZ, { margenModulos: 0 });
    expect(svg).toContain('viewBox="0 0 3 2"');
    expect(rectsNegros(svg)[0]).toEqual({ x: 0, y: 0, width: 2, height: 1 });
  });

  it('lleva fondo blanco explícito (si no, un visor en modo oscuro invierte el código)', () => {
    expect(svgDataMatrix(MATRIZ)).toContain('<rect x="0" y="0" width="5" height="4" fill="#ffffff"/>');
  });

  it('agrega el código impreso debajo cuando se pide etiqueta', () => {
    const svg = svgDataMatrix(MATRIZ, { etiqueta: 'FL-ABC123' });
    expect(svg).toContain('>FL-ABC123</text>');
    expect(svg).toContain('text-anchor="middle"');
    // 9 caracteres a 0,6 em de 4 módulos de cuerpo: 21,6 módulos de texto; el
    // lienzo es el más ancho de los dos (el símbolo son 5)
    expect(svg).toContain('viewBox="0 0 21.6 9"');
    // la etiqueta ocupa alto extra: 4 módulos del símbolo + 5 de texto
    expect(svg).toContain('height="4.5mm"');
  });

  it('ensancha el lienzo si el código no cabe bajo el símbolo', () => {
    const svg = svgDataMatrix(MATRIZ, { etiqueta: 'FL-ABC123' });
    expect(svg).toContain('width="10.8mm"');
    // El ancho del texto queda declarado (`textLength`): la caja no depende de la
    // fuente que tenga el sistema, así que el texto no se sale de la etiqueta ni
    // queda recortado por el borde del lienzo.
    expect(svg).toContain('textLength="21.6" lengthAdjust="spacingAndGlyphs"');
    // El símbolo se centra: 5 módulos en un lienzo de 21,6 → 8,3 a la izquierda
    expect(rectsNegros(svg)[0].x).toBe(9.3);
  });

  it('escapa la etiqueta y la omite si viene vacía', () => {
    expect(svgDataMatrix(MATRIZ, { etiqueta: 'A<&>"B' })).toContain('>A&lt;&amp;&gt;&quot;B</text>');
    const sinEtiqueta = svgDataMatrix(MATRIZ, { etiqueta: '   ' });
    expect(sinEtiqueta).not.toContain('<text');
    expect(sinEtiqueta).toContain('viewBox="0 0 5 4"');
  });
});

describe('nombreArchivoDataMatrix', () => {
  it('nombra el archivo con el código', () => {
    expect(nombreArchivoDataMatrix('FL-MUEVVQQ8QZ3')).toBe('datamatrix-FL-MUEVVQQ8QZ3');
  });

  it('neutraliza caracteres que rompen un nombre de archivo', () => {
    expect(nombreArchivoDataMatrix('FL/../A B\x00')).toBe('datamatrix-FL-..-A-B');
  });

  it('cae a un nombre genérico si el código no deja nada usable', () => {
    expect(nombreArchivoDataMatrix('///')).toBe('datamatrix-elemento');
    expect(nombreArchivoHoja('Sala 3 / IOT')).toBe('etiquetas-Sala-3-IOT');
    expect(nombreArchivoHoja('')).toBe('etiquetas-lote');
  });
});

// --- Hoja de etiquetas (varias por página) ---

// Matriz cuadrada sintética n×n con un patrón cualquiera: alcanza para medir
// la geometría (los módulos negros no se decodifican acá, eso ya lo cubre
// scripts/verify-datamatrix.mjs).
function matrizDe(lado: number): MatrizDataMatrix {
  return {
    matrix: Array.from({ length: lado }, (_, y) =>
      Array.from({ length: lado }, (_, x) => ((x + y) % 3 === 0 ? 1 : 0)),
    ),
    width: lado,
    height: lado,
  };
}

type Caja = { x: number; y: number; width: number; height: number };

function gruposHoja(svg: string): { codigo: string; guia: Caja; negros: Caja[] }[] {
  return [...svg.matchAll(/<g data-codigo="([^"]*)">([\s\S]*?)<\/g>/g)].map(([, codigo, cuerpo]) => {
    const cajas = [...cuerpo.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].map(
      (m) => ({ x: Number(m[1]), y: Number(m[2]), width: Number(m[3]), height: Number(m[4]) }),
    );
    return { codigo, guia: cajas[0], negros: cajas.slice(1) };
  });
}

function tamanioHoja(svg: string): { ancho: number; alto: number } {
  const m = svg.match(/width="([\d.]+)mm" height="([\d.]+)mm"/)!;
  return { ancho: Number(m[1]), alto: Number(m[2]) };
}

const ETIQUETAS = ['FL-ABC1', 'FL-ABC2', 'FL-ABC3', 'FL-ABC4', 'FL-ABC5'].map((codigo) => ({
  codigo,
  matriz: matrizDe(16),
}));

function seSolapan(a: Caja, b: Caja): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

describe('svgHojaEtiquetas', () => {
  it('usa A4 vertical por defecto y dibuja todas las etiquetas', () => {
    const svg = svgHojaEtiquetas(ETIQUETAS);
    expect(tamanioHoja(svg)).toEqual({ ancho: 210, alto: 297 });
    expect(gruposHoja(svg).map((g) => g.codigo)).toEqual(['FL-ABC1', 'FL-ABC2', 'FL-ABC3', 'FL-ABC4', 'FL-ABC5']);
  });

  it('acomoda tantas etiquetas por fila como caben en el ancho imprimible', () => {
    const treinta = Array.from({ length: 30 }, (_, i) => ({ codigo: `FL-${i}`, matriz: matrizDe(16) }));
    const guias = gruposHoja(svgHojaEtiquetas(treinta)).map((g) => g.guia);
    const columnas = guias.filter((g) => Math.abs(g.y - guias[0].y) < 0.001).length;
    expect(columnas).toBeGreaterThan(1);
    expect(columnas).toBeLessThan(guias.length);
    // Paso horizontal = celda (9 mm: 16 módulos + 2 de margen, a 0.5 mm) + 4 de separación
    expect(guias[1].x - guias[0].x).toBeCloseTo(13, 5);
    // La etiqueta que abre la segunda fila vuelve a la columna 0, una fila más abajo
    expect(guias[columnas].x).toBeCloseTo(guias[0].x, 5);
    expect(guias[columnas].y - guias[0].y).toBeCloseTo(9 + 2.5 + 4, 5); // alto de celda + separación
    // La última columna sigue dentro de la página
    expect(guias[columnas - 1].x + guias[columnas - 1].width).toBeLessThanOrEqual(210 - 9);
  });

  it('respeta las columnas forzadas', () => {
    const svg = svgHojaEtiquetas(ETIQUETAS, { columnas: 2 });
    const guias = gruposHoja(svg).map((g) => g.guia);
    expect(guias[2].x).toBeCloseTo(guias[0].x, 5);
    expect(guias[2].y).toBeGreaterThan(guias[0].y);
    expect(guias[1].x).toBeGreaterThan(guias[0].x);
  });

  it('no solapa etiquetas y las deja dentro del área imprimible', () => {
    const svg = svgHojaEtiquetas(ETIQUETAS);
    const { ancho, alto } = tamanioHoja(svg);
    const grupos = gruposHoja(svg);
    // El símbolo queda dentro del margen de la página (la guía de corte se
    // dibuja 1 mm por fuera de la etiqueta, así que puede entrar al margen).
    for (const { negros } of grupos) {
      for (const negro of negros) {
        expect(negro.x).toBeGreaterThanOrEqual(10);
        expect(negro.y).toBeGreaterThanOrEqual(10);
        expect(negro.x + negro.width).toBeLessThanOrEqual(ancho - 10);
        expect(negro.y + negro.height).toBeLessThanOrEqual(alto - 10);
      }
    }
    const guias = grupos.map((g) => g.guia);
    for (const guia of guias) {
      expect(guia.x).toBeGreaterThanOrEqual(9);
      expect(guia.y).toBeGreaterThanOrEqual(9);
      expect(guia.x + guia.width).toBeLessThanOrEqual(ancho - 9);
      expect(guia.y + guia.height).toBeLessThanOrEqual(alto - 9);
    }
    for (let i = 0; i < guias.length; i++) {
      for (let j = i + 1; j < guias.length; j++) {
        expect(seSolapan(guias[i], guias[j])).toBe(false);
      }
    }
  });

  it('deja todos los módulos negros dentro de la etiqueta que les toca', () => {
    const svg = svgHojaEtiquetas(ETIQUETAS);
    for (const grupo of gruposHoja(svg)) {
      expect(grupo.negros.length).toBeGreaterThan(0);
      for (const negro of grupo.negros) {
        expect(negro.x).toBeGreaterThanOrEqual(grupo.guia.x);
        expect(negro.y).toBeGreaterThanOrEqual(grupo.guia.y);
        expect(negro.x + negro.width).toBeLessThanOrEqual(grupo.guia.x + grupo.guia.width);
        expect(negro.y + negro.height).toBeLessThanOrEqual(grupo.guia.y + grupo.guia.height);
      }
    }
  });

  it('imprime el código bajo cada símbolo (para saber cuál es cuál al cortar)', () => {
    const svg = svgHojaEtiquetas(ETIQUETAS);
    for (const { codigo } of ETIQUETAS) expect(svg).toContain(`>${codigo}</text>`);
  });

  it('crece hacia abajo en vez de recortar cuando hay muchas etiquetas', () => {
    const muchas = Array.from({ length: 120 }, (_, i) => ({ codigo: `FL-${i}`, matriz: matrizDe(16) }));
    const svg = svgHojaEtiquetas(muchas, { columnas: 4 });
    const { alto } = tamanioHoja(svg);
    expect(alto).toBeGreaterThan(297);
    expect(gruposHoja(svg)).toHaveLength(120);
    const guias = gruposHoja(svg).map((g) => g.guia);
    const ultima = guias.reduce((max, g) => (g.y > max.y ? g : max), guias[0]);
    expect(ultima.y + ultima.height).toBeLessThanOrEqual(alto);
  });

  it('deja una guía de corte y una zona de silencio por etiqueta', () => {
    const svg = svgHojaEtiquetas(ETIQUETAS, { columnas: 1 });
    const [grupo] = gruposHoja(svg);
    // La guía rodea la etiqueta con 1 mm de aire
    expect(grupo.negros[0].x - grupo.guia.x).toBeGreaterThanOrEqual(1);
    // El primer módulo negro arranca después de la zona de silencio (0.5 mm)
    expect(grupo.negros[0].x - grupo.guia.x).toBeGreaterThanOrEqual(1.4);
  });

  it('devuelve una hoja vacía si no hay elementos', () => {
    const svg = svgHojaEtiquetas([]);
    expect(tamanioHoja(svg)).toEqual({ ancho: 210, alto: 297 });
    expect(gruposHoja(svg)).toHaveLength(0);
  });

  it('ensancha la celda cuando el código impreso no cabe bajo el símbolo', () => {
    const plan = planHojaEtiquetas([{ codigo: 'FL-M00000000009', matriz: matrizDe(16) }], {
      papel: 'carta',
    });
    // 15 caracteres × 0,6 em × 2 mm de texto = 18 mm, contra 9 mm de símbolo: la
    // celda la fija el texto, o el texto se saldría de la etiqueta (y del margen
    // de la impresora, que es como lo encontró scripts/verificar-impresion.mjs).
    expect(plan.medidas[0].anchoMm).toBe(9);
    expect(plan.medidas[0].anchoTextoMm).toBe(18);
    expect(plan.celdaAnchoMm).toBe(18);
    expect(plan.columnas).toBe(9); // (215,9 − 20 + 4) / (18 + 4)
  });

  it('nunca deja el texto fuera de su celda', () => {
    const mixtas = ['IOT-79', 'M-01', 'IMP3D-121', 'FL-M00000000009', 'VL-303-05'].map((codigo) => ({
      codigo,
      matriz: matrizDe(16),
    }));
    for (const papel of PAPELES_DISPONIBLES) {
      const plan = planHojaEtiquetas(mixtas, { papel });
      for (const medida of plan.medidas) {
        expect(medida.anchoTextoMm).toBeLessThanOrEqual(plan.celdaAnchoMm);
      }
    }
  });

  it('mide la página con el papel elegido', () => {
    expect(tamanioHoja(svgHojaEtiquetas(ETIQUETAS, { papel: 'carta' }))).toEqual({ ancho: 215.9, alto: 279.4 });
    expect(tamanioHoja(svgHojaEtiquetas(ETIQUETAS, { papel: 'oficio' }))).toEqual({ ancho: 215.9, alto: 330.2 });
  });
});

describe('medidasPapel', () => {
  it('usa A4 si no se pide papel y respeta el que se pida', () => {
    expect(medidasPapel()).toEqual({ nombre: 'A4', anchoMm: 210, altoMm: 297 });
    expect(medidasPapel({ papel: 'carta' })).toEqual({ nombre: 'Carta', anchoMm: 215.9, altoMm: 279.4 });
  });

  it('deja forzar una medida propia, que gana sobre el papel', () => {
    expect(medidasPapel({ papel: 'carta', anchoHojaMm: 100, altoHojaMm: 50 })).toEqual({
      nombre: 'Carta',
      anchoMm: 100,
      altoMm: 50,
    });
  });
});

// --- Paginado ---
// El bug que esto cubre: la hoja era un solo SVG alto y el navegador la cortaba
// donde terminaba el papel, rebanando la etiqueta que cayera justo ahí. Ahora
// cada página es un SVG que mide el papel, así que el corte es entre etiquetas.

describe('paginasHojaEtiquetas', () => {
  function etiquetasDe(cantidad: number, lado = 16) {
    return Array.from({ length: cantidad }, (_, i) => ({ codigo: `FL-${i}`, matriz: matrizDe(lado) }));
  }

  it('calcula la grilla contra el papel, no contra un tamaño fijo', () => {
    const a4 = planHojaEtiquetas(etiquetasDe(300), { papel: 'a4' });
    const carta = planHojaEtiquetas(etiquetasDe(300), { papel: 'carta' });
    const oficio = planHojaEtiquetas(etiquetasDe(300), { papel: 'oficio' });
    // Celda de 9 × 11,5 mm con 4 mm de aire (paso 13 × 15,5) y 10 mm de margen:
    // Carta es 5,9 mm más ancha que A4 (una columna más) y 17,6 mm más baja
    // (dos filas menos), así que la misma cantidad de etiquetas no da el mismo
    // número de páginas.
    expect([a4.columnas, a4.filasPorPagina, a4.porPagina]).toEqual([14, 18, 252]);
    expect([carta.columnas, carta.filasPorPagina, carta.porPagina]).toEqual([15, 16, 240]);
    expect([oficio.columnas, oficio.filasPorPagina, oficio.porPagina]).toEqual([15, 20, 300]);
    expect(a4.paginas).toHaveLength(2);
    expect(carta.paginas).toHaveLength(2);
    expect(oficio.paginas).toHaveLength(1); // 300 justo
  });

  it('reparte en páginas sin perder ni repetir etiquetas', () => {
    const etiquetas = etiquetasDe(300);
    for (const papel of PAPELES_DISPONIBLES) {
      const paginas = paginasHojaEtiquetas(etiquetas, { papel, columnas: 4 });
      expect(paginas.length).toBeGreaterThan(1);
      const codigos = paginas.flatMap((pagina) => gruposHoja(pagina).map((g) => g.codigo));
      expect(codigos).toEqual(etiquetas.map((e) => e.codigo));
    }
  });

  it('cada página mide el papel y deja toda la etiqueta dentro del área imprimible', () => {
    const etiquetas = etiquetasDe(300);
    for (const papel of PAPELES_DISPONIBLES) {
      const { anchoMm, altoMm } = PAPELES[papel];
      for (const pagina of paginasHojaEtiquetas(etiquetas, { papel, columnas: 4 })) {
        // Alto del papel menos la holgura de paginado: entra en una hoja sola
        expect(tamanioHoja(pagina)).toEqual({ ancho: anchoMm, alto: altoMm - HOLGURA_PAGINA_MM });
        const grupos = gruposHoja(pagina);
        expect(grupos.length).toBeGreaterThan(0);
        for (const { guia, negros } of grupos) {
          // La guía de corte rodea la etiqueta por fuera (1 mm): si entra ella,
          // entra el código impreso completo.
          expect(guia.x).toBeGreaterThanOrEqual(9);
          expect(guia.y).toBeGreaterThanOrEqual(9);
          expect(guia.x + guia.width).toBeLessThanOrEqual(anchoMm - 9);
          expect(guia.y + guia.height).toBeLessThanOrEqual(altoMm - 9);
          for (const negro of negros) {
            expect(negro.y + negro.height).toBeLessThanOrEqual(altoMm - 10);
          }
        }
      }
    }
  });

  it('no mete más etiquetas por página de las que anuncia el plan', () => {
    const etiquetas = etiquetasDe(300, 12);
    const plan = planHojaEtiquetas(etiquetas, { papel: 'carta' });
    for (const pagina of paginasHojaEtiquetas(etiquetas, { papel: 'carta' })) {
      expect(gruposHoja(pagina).length).toBeLessThanOrEqual(plan.porPagina);
    }
  });

  it('usa la misma grilla que la hoja de una pieza en su primera página', () => {
    const etiquetas = etiquetasDe(60);
    const hoja = svgHojaEtiquetas(etiquetas, { papel: 'carta' });
    const [primera] = paginasHojaEtiquetas(etiquetas, { papel: 'carta' });
    const guiasPagina = gruposHoja(primera).map((g) => g.guia);
    expect(gruposHoja(hoja).slice(0, guiasPagina.length).map((g) => g.guia)).toEqual(guiasPagina);
  });

  it('no solapa etiquetas de distinto tamaño dentro de una página', () => {
    const mixtas = [12, 16, 18, 14].flatMap((lado) =>
      Array.from({ length: 65 }, (_, i) => ({ codigo: `FL-${lado}-${i}`, matriz: matrizDe(lado) })),
    );
    const paginas = paginasHojaEtiquetas(mixtas, { papel: 'a4' });
    expect(paginas.length).toBeGreaterThan(1);
    for (const pagina of paginas) {
      const guias = gruposHoja(pagina).map((g) => g.guia);
      for (let i = 0; i < guias.length; i++) {
        for (let j = i + 1; j < guias.length; j++) {
          expect(seSolapan(guias[i], guias[j])).toBe(false);
        }
      }
    }
  });

  it('una hoja vacía también ocupa una página', () => {
    const paginas = paginasHojaEtiquetas([], { papel: 'carta' });
    expect(paginas).toHaveLength(1);
    expect(tamanioHoja(paginas[0])).toEqual({ ancho: 215.9, alto: 279.4 - 1 });
    expect(gruposHoja(paginas[0])).toHaveLength(0);
  });
});
