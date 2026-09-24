import AsyncStorage from '@react-native-async-storage/async-storage';
// multiRemove existe en el mock de jest-expo; si no, cae a removeItem secuencial.
if (!AsyncStorage.multiRemove) {
  (AsyncStorage as any).multiRemove = (keys: string[]) =>
    Promise.all(keys.map((k) => AsyncStorage.removeItem(k)));
}

// --- Tipos ---

export type InventoryItem = {
  id?: number; // id en la BD (lo genera la API; los items locales pueden no tenerlo)
  codigo: string;
  detalle: string;
  serial: string;
  inventario: string;
  estado: string;
  observaciones: string;
  cantidad: string;
  foto?: string;
  sala_id?: number;
};

export type Room = {
  id: number;
  nombre: string;
  edificio: string;
  elementos: number;
};

// --- Configuración de conexión ---
// Web (navegador): usa EXPO_PUBLIC_API_URL si está definida (build estático
// desplegado, p.ej. en Render), y si no deriva del host actual
// (192.168.0.2:8083 → 192.168.0.2:3001/api) para el dev server local.
// Native (Expo Go): usa EXPO_PUBLIC_API_URL o localhost/api
const WEB_BASE = typeof window !== 'undefined' && window.location
  ? window.location.origin.replace(/:(\d+)$/, ':3001/api')
  : '';
const API_BASE = process.env.EXPO_PUBLIC_API_URL || WEB_BASE || 'http://localhost:3001/api';

// --- Helpers de API ---

// Reintentos solo para GET: el free tier de Render duerme y al despertar
// devuelve 502/503 mientras arranca. Backoff corto cubre el wake típico;
// lo que no cubra, lo tapa la cache SWR (el usuario ya está viendo stale).
// Solo GET: POST /traslados NO es idempotente y un reintento duplicaría filas.
const RETRY_STATUS = new Set([502, 503, 504]);

export async function fetchConReintentos(
  url: string,
  opts?: RequestInit,
  esperas: number[] = [1000, 2500],
): Promise<Response> {
  let res = await fetch(url, opts);
  for (const ms of esperas) {
    if (!RETRY_STATUS.has(res.status)) return res;
    await new Promise((r) => setTimeout(r, ms));
    res = await fetch(url, opts);
  }
  return res;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetchConReintentos(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

// Token de escritura, horneado en el bundle (EXPO_PUBLIC_*; Expo lo inlined-a
// en cualquier expresión, por eso se lee dentro de la función y no en una
// constante de módulo). Vacío = server en modo abierto y no se manda header.
// Si el server exige token y el bundle no lo trae, la escritura falla 401 explícita.
function authHeaders(): Record<string, string> {
  const token = process.env.EXPO_PUBLIC_API_TOKEN || '';
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

// --- Cache stale-while-revalidate ---
// Primera carga: red (≈1s en WAN). Cargas siguientes: instantáneas de memoria
// mientras la red refresca en background. Persistido en AsyncStorage para
// sobrevivir reinicios de la app.
const CACHE_KEY_ALL = 'fablab.cache.elementos.all';
const CACHE_KEY_SALAS = 'fablab.cache.salas';
const CACHE_FRESH_MS = 60_000;

let memAll: { items: InventoryItem[]; at: number } | null = null;
let memSalas: { salas: Room[]; at: number } | null = null;
let inflightAll: Promise<InventoryItem[]> | null = null;

function readCachedAll(): InventoryItem[] | null {
  if (memAll && Date.now() - memAll.at < CACHE_FRESH_MS) return memAll.items;
  return null;
}

function readCachedSalas(): Room[] | null {
  if (memSalas && Date.now() - memSalas.at < CACHE_FRESH_MS) return memSalas.salas;
  return null;
}

function writeAllCache(items: InventoryItem[]) {
  memAll = { items, at: Date.now() };
  AsyncStorage.setItem(CACHE_KEY_ALL, JSON.stringify(items)).catch(() => {});
}

function writeSalasCache(salas: Room[]) {
  memSalas = { salas, at: Date.now() };
  AsyncStorage.setItem(CACHE_KEY_SALAS, JSON.stringify(salas)).catch(() => {});
}

async function cacheAllFromStorage(): Promise<InventoryItem[]> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY_ALL);
    return raw ? (JSON.parse(raw) as InventoryItem[]) : [];
  } catch {
    return [];
  }
}

async function cacheSalasFromStorage(): Promise<Room[]> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY_SALAS);
    return raw ? (JSON.parse(raw) as Room[]) : [];
  } catch {
    return [];
  }
}

// Llama a esto al abrir la app (layout) para calentar la cache en background.
export function prewarmCache(): void {
  getAllItems().catch(() => {});
  listarSalas().catch(() => {});
}

// Reserva para tests y para "pull to refresh" futuro: olvida todo el estado
// cacheado (memoria y AsyncStorage).
export async function resetCache(): Promise<void> {
  memAll = null;
  memSalas = null;
  inflightAll = null;
  await AsyncStorage.multiRemove([CACHE_KEY_ALL, CACHE_KEY_SALAS]).catch(() => {});
}

// --- Lectura desde la base de datos (reemplaza AsyncStorage) ---
// GET /elementos devuelve todo el inventario en UNA petición (antes eran 1 +
// N salas en serie, cada una pagando latencia WAN — el inventario tardaba ~30s).
export async function getAllItems(): Promise<InventoryItem[]> {
  const cached = readCachedAll();
  if (cached) return cached;
  if (inflightAll) return inflightAll;

  // Stale: muestra lo persistido al instante y refresca por detrás.
  cacheAllFromStorage().then((stale) => {
    if (stale.length && !memAll) {
      memAll = { items: stale, at: Date.now() };
    }
  });

  inflightAll = get<InventoryItem[]>('/elementos')
    .then((items) => {
      writeAllCache(items);
      return items;
    })
    .catch(() => {
      const stale = memAll?.items ?? [];
      return stale; // sin red: lo último conocido
    })
    .finally(() => {
      inflightAll = null;
    });
  return inflightAll;
}

export function generateCodigo(): string {
  return `FL-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 36 ** 3)
    .toString(36)
    .toUpperCase()
    .padStart(3, '0')}`;
}

// --- Escritura vía API ---

// POST /elementos. Requiere sala_id: sin él el server responde 400 y no guarda.
// No hay fallback local: un elemento que solo existiera en AsyncStorage sería
// invisible para la app (todo se lee de la API/cache) — una ilusión de guardado.
// Devuelve el elemento con el id que asignó la base.
export async function addItem(item: InventoryItem): Promise<InventoryItem> {
  const saved = await post<InventoryItem>('/elementos', item);
  const cached = memAll?.items ?? (await cacheAllFromStorage());
  const next = cached.filter((existing) => existing.codigo !== saved.codigo);
  writeAllCache([...next, saved]);
  return saved;
}

// Campos que el server permite editar (CAMPOS_EDITABLES). El codigo NO se
// toca (es el identificador del DataMatrix); mover de sala es registrarTraslado.
export type CamposEditables = Partial<
  Pick<InventoryItem, 'detalle' | 'serial' | 'inventario' | 'estado' | 'observaciones' | 'cantidad'>
>;

// PUT /elementos/:id y merge optimista en cache (sin re-descargar todo).
// A diferencia de addItem/removeItem, aquí NO hay fallback local: una edición
// que solo existiera en AsyncStorage sería una ilusión de guardado.
export async function updateItem(id: number, campos: CamposEditables): Promise<void> {
  const res = await put<{ updated: boolean; elemento: InventoryItem }>(`/elementos/${id}`, campos);
  const cached = memAll?.items ?? (await cacheAllFromStorage());
  writeAllCache(cached.map((it) => (it.id === id ? { ...it, ...res.elemento } : it)));
}

// DELETE /elementos/:codigo. Igual que updateItem: sin fallback local, y se
// revisa el estatus para no sacar de la cache un elemento que el server no borró
// (p.ej. 401 por token faltante, o 404 si ya no existía).
export async function removeItem(codigo: string): Promise<void> {
  const res = await fetch(`${API_BASE}/elementos/${encodeURIComponent(codigo)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`API ${res.status}: DELETE /elementos/${codigo}`);
  const cached = memAll?.items ?? (await cacheAllFromStorage());
  writeAllCache(cached.filter((item) => item.codigo !== codigo));
}

export async function findByCodigo(codigo: string): Promise<InventoryItem | undefined> {
  const items = await getAllItems();
  return items.find((i) => i.codigo === codigo);
}

// POST /elementos/:id/codigo. Para elementos importados que quedaron sin
// código: sin código no hay Data Matrix que imprimir ni forma de escanear el
// elemento. El server solo rellena vacíos (responde 409 si ya tiene uno),
// porque el código es el identificador impreso en la etiqueta.
export async function asignarCodigo(id: number, codigo: string): Promise<InventoryItem> {
  const res = await post<{ asignado: boolean; elemento: InventoryItem }>(`/elementos/${id}/codigo`, {
    codigo,
  });
  const cached = memAll?.items ?? (await cacheAllFromStorage());
  writeAllCache(cached.map((it) => (it.id === id ? { ...it, ...res.elemento } : it)));
  return res.elemento;
}

// --- Búsqueda inteligente ---
// Busca en TODOS los campos del elemento (codigo, detalle, serial, inventario,
// estado, observaciones, cantidad). Soporta múltiples palabras: todas deben
// coincidir. Los resultados se ordenan por relevancia (codigo exacto > inicio
// de campo > subcadena). Normaliza acentos y espacios.

function normalize(text: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quitar tildes
    .replace(/\s+/g, ' ')
    .trim();
}

type MatchResult = { item: InventoryItem; score: number };

function matchItem(item: InventoryItem, words: string[]): MatchResult | null {
  const fields: (keyof InventoryItem)[] = [
    'codigo', 'detalle', 'serial', 'inventario', 'estado', 'observaciones', 'cantidad',
  ];
  const normalized = Object.fromEntries(
    fields.map((f) => [f, normalize(item[f] as string)]),
  );

  let score = 0;
  let allMatched = true;

  for (const word of words) {
    let wordBest = 0;
    for (const field of fields) {
      const value = normalized[field];
      if (!value) continue;
      if (value === word) wordBest = Math.max(wordBest, 100); // exact match
      else if (value.startsWith(word)) wordBest = Math.max(wordBest, 50); // starts with
      else if (value.includes(word)) wordBest = Math.max(wordBest, 10); // contains
    }
    if (wordBest === 0) { allMatched = false; break; }
    score += wordBest;
  }

  if (!allMatched) return null;
  return { item, score };
}

export async function buscarElementos(query: string): Promise<InventoryItem[]> {
  const items = await getAllItems();
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const results: MatchResult[] = [];
  for (const item of items) {
    const match = matchItem(item, words);
    if (match) results.push(match);
  }
  results.sort((a, b) => b.score - a.score);
  return results.map((r) => r.item);
}

export async function findByDetalle(query: string): Promise<InventoryItem[]> {
  return buscarElementos(query);
}

export async function findByRoom(roomId: number): Promise<InventoryItem[]> {
  const items = await getAllItems();
  return items.filter((i) => i.sala_id === roomId);
}

export async function listarSalas(): Promise<Room[]> {
  const cached = readCachedSalas();
  if (cached) return cached;
  try {
    const salas = await get<Room[]>('/salas');
    writeSalasCache(salas);
    return salas;
  } catch {
    return (await cacheSalasFromStorage()) ?? [];
  }
}

export async function registrarTraslado({
  elementoId,
  salaNuevaId,
  nota,
}: {
  elementoId: number;
  salaNuevaId: number;
  nota?: string | null;
}) {
  const res = await post<{ id: number; salaAnteriorId: number; salaNuevaId: number }>('/traslados', {
    elementoId,
    salaNuevaId,
    nota: nota ?? null,
  });
  // Write-through: el elemento cambia de sala en cache (y se ajustan los
  // conteos) sin re-descargar todo. Sin esto, la sala vieja seguiría
  // mostrando el elemento hasta que expirara la cache (60 s).
  const cached = memAll?.items ?? (await cacheAllFromStorage());
  writeAllCache(
    cached.map((it) => (it.id === elementoId ? { ...it, sala_id: salaNuevaId } : it)),
  );
  const salas = memSalas?.salas ?? (await cacheSalasFromStorage());
  if (salas.length) {
    writeSalasCache(
      salas.map((s) =>
        s.id === salaNuevaId
          ? { ...s, elementos: s.elementos + 1 }
          : s.id === res.salaAnteriorId
            ? { ...s, elementos: Math.max(0, s.elementos - 1) }
            : s,
      ),
    );
  }
  return res;
}

export type TrasladoHistorial = {
  id: number;
  fecha: string;
  nota: string | null;
  salaAnterior: string | null;
  salaNueva: string;
};

export async function historialElemento(elementoId: number): Promise<TrasladoHistorial[]> {
  try {
    return await get(`/elementos/${elementoId}/historial`);
  } catch {
    return [];
  }
}

// --- Sin ubicación (fallback UI) ---

// URL de descarga del inventario/traslados. El CSV sale con BOM y
// Content-Disposition desde el server (abre directo en Excel con acentos OK);
// el JSON es para otros programas. La UI la abre con Linking.openURL.
export function exportarUrl(
  tipo: 'elementos' | 'traslados',
  formato: 'csv' | 'json' = 'csv',
): string {
  return `${API_BASE}/export/${tipo}.${formato}`;
}

export const SinUbicacion = 'Sin ubicación';

