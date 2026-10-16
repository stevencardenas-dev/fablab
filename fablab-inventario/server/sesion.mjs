// Cuenta del laboratorio e inicio de sesión. Funciones puras (sin red ni base),
// para que el server, scripts/crear-cuenta.mjs y el self-check usen las mismas.
//
// Una sola cuenta compartida (decisión con los usuarios, 2026-10-16). La clave
// se guarda como hash scrypt en CUENTA_CLAVE_HASH; nunca en claro. La sesión es
// un token firmado con HMAC (SESION_SECRETO) que vence: no hay tabla de sesiones,
// así que sobrevive a reinicios y no toca la base.

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const iguales = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

/** 'scrypt:<sal hex>:<hash hex>' a partir de la clave. */
export function crearHashClave(clave) {
  const sal = randomBytes(16);
  return `scrypt:${sal.toString('hex')}:${scryptSync(String(clave), sal, 64).toString('hex')}`;
}

/** ¿La clave corresponde al hash? Tiempo constante; false ante un hash mal formado. */
export function verificarClave(clave, hash) {
  const [tipo, sal, esperado] = String(hash).split(':');
  if (tipo !== 'scrypt' || !sal || !esperado) return false;
  const calculado = scryptSync(String(clave), Buffer.from(sal, 'hex'), 64).toString('hex');
  return iguales(calculado, esperado);
}

const firma = (datos, secreto) => createHmac('sha256', secreto).update(datos).digest('base64url');

/** Token de sesión: base64url({u, exp}) + '.' + firma. `exp` en milisegundos. */
export function firmarSesion(usuario, secreto, { ahora = Date.now(), horas = 12 } = {}) {
  const datos = Buffer.from(JSON.stringify({ u: usuario, exp: ahora + horas * 3_600_000 })).toString('base64url');
  return `${datos}.${firma(datos, secreto)}`;
}

/** Usuario de una sesión válida y vigente, o null (firma alterada, vencida o basura). */
export function leerSesion(token, secreto, { ahora = Date.now() } = {}) {
  const [datos, f] = String(token ?? '').split('.');
  if (!datos || !f || !secreto || !iguales(f, firma(datos, secreto))) return null;
  try {
    const { u, exp } = JSON.parse(Buffer.from(datos, 'base64url').toString());
    return typeof u === 'string' && Number(exp) > ahora ? u : null;
  } catch {
    return null;
  }
}
