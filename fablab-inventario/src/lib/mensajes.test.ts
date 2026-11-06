import { mensajeDeError, mensajeDeEstado, SIN_CONEXION } from './mensajes';

describe('mensajeDeEstado', () => {
  it('traduce los estados que puede devolver la API', () => {
    expect(mensajeDeEstado(409)).toBe('Ya existe un registro con esos datos.');
    expect(mensajeDeEstado(413)).toBe('El archivo pesa más de lo que acepta el servidor.');
    expect(mensajeDeEstado(502)).toBe('El servidor no está disponible en este momento.');
  });

  it('no deja el número a la vista en estados desconocidos', () => {
    expect(mensajeDeEstado(418)).not.toMatch(/\d{3}/);
    expect(mensajeDeEstado(599)).not.toMatch(/\d{3}/);
  });
});

describe('mensajeDeError', () => {
  it('respeta los mensajes en español de nuestras capas', () => {
    expect(mensajeDeError(new Error('Ya tiene código CNC-137.'))).toBe('Ya tiene código CNC-137.');
    expect(mensajeDeError(new Error('La foto pesa 500 KB y el límite es 400 KB.')))
      .toBe('La foto pesa 500 KB y el límite es 400 KB.');
  });

  it('traduce las fallas de red del navegador (que vienen en inglés)', () => {
    expect(mensajeDeError(new Error('TypeError: Failed to fetch'))).toBe(SIN_CONEXION);
    expect(mensajeDeError(new Error('Network request failed'))).toBe(SIN_CONEXION);
  });

  it('nunca deja ver rutas, códigos ni rastros internos', () => {
    const porDefecto = 'No se pudo hacer eso.';
    expect(mensajeDeError(new Error('API 502: GET /salas'), porDefecto)).toBe(porDefecto);
    expect(mensajeDeError(new Error('Cannot read properties of undefined'), porDefecto)).toBe(porDefecto);
    expect(mensajeDeError('[object Object]', porDefecto)).toBe(porDefecto);
    expect(mensajeDeError(undefined, porDefecto)).toBe(porDefecto);
  });
});
