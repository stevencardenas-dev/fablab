import {
  ahorroPorcentaje,
  bytesDeBase64,
  CALIDAD_FOTO,
  dataUri,
  dimensionesReducidas,
  ESCALONES_CALIDAD,
  LADO_FOTO,
  LADO_MINIATURA,
  LIMITE_FOTO_BYTES,
  LIMITE_MINIATURA_BYTES,
  mimeDeBase64,
  pesoLegible,
  primerosBytes,
  revisarPayload,
  siguienteCalidad,
} from './foto';

// Buffer existe en Node (donde corre jest) pero el proyecto no tipa Node; se
// declara lo mínimo que usan los tests para generar base64 de bytes conocidos.
declare const Buffer: { alloc: (bytes: number, relleno: number) => { toString: (enc: string) => string } };

// Prefijos base64 reales (bytes 0..15), generados con Node:
//   Buffer.from('RIFF\0\0\0\0WEBP...').toString('base64')
const WEBP = 'UklGRiQAAABXRUJQVlA4IA==';
const JPEG = '/9j/4AAQSkZJRg==';

describe('dimensionesReducidas', () => {
  it('proporcional: 4000x3000 a 800 cabe exacto', () => {
    expect(dimensionesReducidas({ ancho: 4000, alto: 3000 }, 800)).toEqual({ ancho: 800, alto: 600 });
  });

  it('usa el lado MAYOR, no el ancho (retrato 3000x4000)', () => {
    expect(dimensionesReducidas({ ancho: 3000, alto: 4000 }, 800)).toEqual({ ancho: 600, alto: 800 });
  });

  it('nunca agranda una foto que ya es pequeña', () => {
    expect(dimensionesReducidas({ ancho: 320, alto: 240 }, 800)).toEqual({ ancho: 320, alto: 240 });
  });

  it('respeta el límite justo en el borde', () => {
    expect(dimensionesReducidas({ ancho: 800, alto: 533 }, 800)).toEqual({ ancho: 800, alto: 533 });
  });

  it('nunca produce un lado 0 (fotos extremadamente panorámicas)', () => {
    const d = dimensionesReducidas({ ancho: 4000, alto: 3 }, LADO_MINIATURA);
    expect(d.ancho).toBe(200);
    expect(d.alto).toBe(1);
  });

  it('no deforma: conserva la relación de aspecto', () => {
    const original = 4032 / 3024;
    const d = dimensionesReducidas({ ancho: 4032, alto: 3024 }, LADO_FOTO);
    expect(Math.abs(d.ancho / d.alto - original)).toBeLessThan(0.01);
  });

  it('la miniatura siempre sale más pequeña que la foto', () => {
    const foto = dimensionesReducidas({ ancho: 4000, alto: 3000 }, LADO_FOTO);
    const mini = dimensionesReducidas({ ancho: 4000, alto: 3000 }, LADO_MINIATURA);
    expect(mini.ancho).toBeLessThan(foto.ancho);
    expect(mini.alto).toBeLessThan(foto.alto);
  });

  it('tolera datos basura sin explotar', () => {
    expect(dimensionesReducidas({ ancho: NaN as number, alto: 0 }, 800)).toEqual({ ancho: 1, alto: 1 });
  });
});

describe('bytesDeBase64 (medir sin decodificar)', () => {
  it('4 caracteres = 3 bytes', () => {
    expect(bytesDeBase64('AAAA')).toBe(3);
  });

  it('descuenta el padding', () => {
    expect(bytesDeBase64('AA==')).toBe(1);
    expect(bytesDeBase64('AAA=')).toBe(2);
  });

  it('ignora espacios y saltos de línea (JSON con pretty-print)', () => {
    expect(bytesDeBase64('AA\nAA\n')).toBe(3);
  });

  it('vacío es 0, no NaN', () => {
    expect(bytesDeBase64('')).toBe(0);
    expect(bytesDeBase64(undefined as unknown as string)).toBe(0);
  });

  it('coincide con el tamaño real de un buffer', () => {
    const buf = Buffer.alloc(22654, 7);
    expect(bytesDeBase64(buf.toString('base64'))).toBe(22654);
  });
});

describe('primerosBytes', () => {
  it('decodifica los primeros bytes a mano', () => {
    expect(primerosBytes(WEBP, 4)).toEqual([0x52, 0x49, 0x46, 0x46]);
  });

  it('no se sale del array cuando el base64 es corto', () => {
    expect(primerosBytes('AA', 12).length).toBeLessThanOrEqual(2);
  });
});

describe('mimeDeBase64 (validar lo que salió de verdad)', () => {
  it('reconoce WebP por RIFF…WEBP', () => {
    expect(mimeDeBase64(WEBP)).toBe('image/webp');
  });

  it('reconoce JPEG por FF D8 FF', () => {
    expect(mimeDeBase64(JPEG)).toBe('image/jpeg');
  });

  it('rechaza cualquier otra cosa', () => {
    expect(mimeDeBase64('AAAAAAAAAAAA')).toBeNull(); // PNG no se acepta
    expect(mimeDeBase64('')).toBeNull();
  });
});

describe('siguienteCalidad (bajar calidad solo si hace falta)', () => {
  it('no baja nada si ya cabe', () => {
    expect(siguienteCalidad(26 * 1024, CALIDAD_FOTO)).toBeNull();
  });

  it('baja al siguiente escalón si se pasa', () => {
    expect(siguienteCalidad(LIMITE_FOTO_BYTES + 1, 0.6)).toBe(0.45);
    expect(siguienteCalidad(LIMITE_FOTO_BYTES + 1, 0.45)).toBe(0.32);
  });

  it('se rinde en el último escalón (null = reportar error)', () => {
    expect(siguienteCalidad(LIMITE_FOTO_BYTES + 1, ESCALONES_CALIDAD[ESCALONES_CALIDAD.length - 1])).toBeNull();
  });

  it('el escalón más bajo sigue siendo razonable para identificar un elemento', () => {
    expect(ESCALONES_CALIDAD[ESCALONES_CALIDAD.length - 1]).toBeGreaterThanOrEqual(0.3);
  });
});

describe('pesoLegible', () => {
  it('bytes', () => {
    expect(pesoLegible(512)).toBe('512 B');
  });

  it('KB con un decimal cuando es pequeño', () => {
    expect(pesoLegible(5416)).toBe('5.3 KB');
  });

  it('KB sin decimal cuando es grande', () => {
    expect(pesoLegible(22654)).toBe('22 KB');
  });

  it('MB con un decimal', () => {
    expect(pesoLegible(2.3 * 1024 * 1024)).toBe('2.3 MB');
  });
});

describe('ahorroPorcentaje', () => {
  it('una foto de 2.3 MB reducida a 26 KB se ahorra el 99%', () => {
    expect(ahorroPorcentaje(2.3 * 1024 * 1024, 22654)).toBe(99);
  });

  it('nunca dice 100%: la foto sigue existiendo', () => {
    expect(ahorroPorcentaje(3.6 * 1024 * 1024, 13 * 1024)).toBe(99);
  });

  it('si no se ahorró nada, 0 (nunca negativo)', () => {
    expect(ahorroPorcentaje(1000, 1000)).toBe(0);
    expect(ahorroPorcentaje(0, 1000)).toBe(0);
  });
});

describe('dataUri', () => {
  it('arma el prefijo que entiende <Image>', () => {
    expect(dataUri('image/webp', 'AAAA')).toBe('data:image/webp;base64,AAAA');
  });
});

describe('revisarPayload (los mismos límites que el servidor)', () => {
  const foto = Buffer.alloc(26 * 1024, 1).toString('base64');
  const miniatura = Buffer.alloc(6 * 1024, 1).toString('base64');

  it('acepta el caso medido real (~31 KB por elemento)', () => {
    expect(revisarPayload({ foto, miniatura })).toBeNull();
    expect(LIMITE_FOTO_BYTES).toBe(400 * 1024);
    expect(LIMITE_MINIATURA_BYTES).toBe(80 * 1024);
  });

  it('rechaza una foto que no cabe en el límite del servidor', () => {
    const enorme = Buffer.alloc(LIMITE_FOTO_BYTES + 1024, 1).toString('base64');
    expect(revisarPayload({ foto: enorme, miniatura })).toMatch(/límite es 400 KB/);
  });

  it('rechaza una miniatura más pesada que su foto', () => {
    const chica = Buffer.alloc(1024, 1).toString('base64');
    expect(revisarPayload({ foto: chica, miniatura: chica })).toMatch(/no puede pesar más/);
  });

  it('rechaza una foto vacía', () => {
    expect(revisarPayload({ foto: '', miniatura })).toMatch(/vacía/);
  });
});
