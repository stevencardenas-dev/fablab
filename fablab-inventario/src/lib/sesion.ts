// Sesión de la cuenta del laboratorio en la app. El token de sesión vence a las 12 h
// (lo decide el server) y se guarda en AsyncStorage para no pedir la clave en cada
// visita. Las escrituras lo mandan vía authHeaders() en inventory.ts. Sin sesión, la
// app no puede escribir: el token de script ya no viaja en el bundle.

import AsyncStorage from '@react-native-async-storage/async-storage';

const CLAVE = 'fablab.sesion.v1';

type Sesion = { token: string; expira: number; usuario: string };

let actual: Sesion | null = null;
let listo = false;

function vigente(s: Sesion | null): s is Sesion {
  return !!s && s.expira > Date.now();
}

/** Carga la sesión guardada (una vez al arrancar). Si no hay o venció, queda en null. */
export async function cargarSesion(): Promise<void> {
  if (listo) return;
  listo = true;
  try {
    const crudo = await AsyncStorage.getItem(CLAVE);
    const s = crudo ? (JSON.parse(crudo) as Sesion) : null;
    actual = vigente(s) ? s : null;
  } catch {
    actual = null; // almacenamiento no disponible (navegador privado): se pedirá la clave
  }
}

/** Token de la sesión vigente, o null. Síncrono: lo usa authHeaders(). */
export function tokenDeSesion(): string | null {
  return vigente(actual) ? actual.token : null;
}

/** Usuario con sesión vigente, o null (para mostrarlo en la interfaz). */
export function usuarioDeSesion(): string | null {
  return vigente(actual) ? actual.usuario : null;
}

/** Hora de vencimiento de la sesión vigente (ms), o null. */
export function expiraSesion(): number | null {
  return vigente(actual) ? actual.expira : null;
}

/** Pide la sesión al server. Lanza error con el mensaje del server si la clave no sirve. */
export async function iniciarSesion(base: string, usuario: string, clave: string): Promise<void> {
  const res = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario, clave }),
  });
  const cuerpo = await res.json().catch(() => ({}));
  if (!res.ok || !cuerpo.token) {
    throw new Error(cuerpo.error || `No se pudo iniciar sesión (${res.status})`);
  }
  const sesion: Sesion = {
    token: cuerpo.token,
    usuario: cuerpo.usuario ?? usuario,
    expira: Date.now() + Number(cuerpo.expira_horas ?? 12) * 3_600_000,
  };
  actual = sesion;
  try { await AsyncStorage.setItem(CLAVE, JSON.stringify(sesion)); } catch { /* sin persistencia: vale solo esta visita */ }
}

/** Cierra la sesión en este dispositivo. */
export async function cerrarSesion(): Promise<void> {
  actual = null;
  try { await AsyncStorage.removeItem(CLAVE); } catch { /* nada que limpiar */ }
}
