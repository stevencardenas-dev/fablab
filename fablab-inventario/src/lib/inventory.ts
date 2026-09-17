import AsyncStorage from '@react-native-async-storage/async-storage';

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

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

// --- Lectura desde la base de datos (reemplaza AsyncStorage) ---

export async function getAllItems(): Promise<InventoryItem[]> {
  try {
    const salas = await get<Room[]>('/salas');
    const all: InventoryItem[] = [];
    for (const sala of salas) {
      const items = await get<InventoryItem[]>(`/salas/${sala.id}/elementos`);
      all.push(...items);
    }
    return all;
  } catch {
    return []; // servidor no disponible → sin datos
  }
}

export function generateCodigo(): string {
  return `FL-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 36 ** 3)
    .toString(36)
    .toUpperCase()
    .padStart(3, '0')}`;
}

// --- Escritura vía API ---

export async function addItem(item: InventoryItem): Promise<void> {
  try {
    await post('/elementos', item);
  } catch {
    // Fallback local si el servidor no está disponible
    const items = await readAll();
    const next = items.filter((existing) => existing.codigo !== item.codigo);
    next.push(item);
    await writeAll(next);
  }
}

export async function removeItem(codigo: string): Promise<void> {
  try {
    await fetch(`${API_BASE}/elementos/${encodeURIComponent(codigo)}`, { method: 'DELETE' });
  } catch {
    // Fallback local si el servidor no está disponible
    const items = await readAll();
    await writeAll(items.filter((item) => item.codigo !== codigo));
  }
}

// Modifica un elemento existente (por id). El codigo no se edita — es lo que
// está impreso en el Data Matrix; cambiar de sala se hace con registrarTraslado.
export async function updateItem(id: number, campos: Partial<Omit<InventoryItem, 'id' | 'codigo' | 'sala_id' | 'foto'>>): Promise<InventoryItem> {
  const res = await fetch(`${API_BASE}/elementos/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(campos),
  });
  if (!res.ok) throw new Error(`API ${res.status}: elementos/${id}`);
  const data = await res.json();
  return data.elemento as InventoryItem;
}

export async function findByCodigo(codigo: string): Promise<InventoryItem | undefined> {
  try {
    const salas = await get<Room[]>('/salas');
    for (const sala of salas) {
      const items = await get<InventoryItem[]>(`/salas/${sala.id}/elementos`);
      const found = items.find((i) => i.codigo === codigo);
      if (found) return found;
    }
    return undefined;
  } catch {
    return undefined;
  }
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
  try {
    const salas = await get<Room[]>('/salas');
    const words = normalize(query).split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    const results: MatchResult[] = [];
    for (const sala of salas) {
      const items = await get<InventoryItem[]>(`/salas/${sala.id}/elementos`);
      for (const item of items) {
        const match = matchItem(item, words);
        if (match) results.push(match);
      }
    }
    results.sort((a, b) => b.score - a.score);
    return results.map((r) => r.item);
  } catch {
    return [];
  }
}

export async function findByDetalle(query: string): Promise<InventoryItem[]> {
  return buscarElementos(query);
}

export async function findByRoom(roomId: number): Promise<InventoryItem[]> {
  try {
    return await get<InventoryItem[]>(`/salas/${roomId}/elementos`);
  } catch {
    return [];
  }
}

export async function listarSalas(): Promise<Room[]> {
  try {
    return await get<Room[]>('/salas');
  } catch {
    return [];
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
  return post('/traslados', { elementoId, salaNuevaId, nota: nota ?? null });
}

export async function historialElemento(elementoId: number): Promise<Array<{ id: number; fecha: string; nota: string | null; salaAnterior: string; salaNueva: string }>> {
  try {
    return await get(`/elementos/${elementoId}/historial`);
  } catch {
    return [];
  }
}

// --- Export de inventario y traslados ---
// Devuelve la URL pública del API (CSV abre descarga directa; JSON también).
export function exportarUrl(qué: 'elementos' | 'traslados', formato: 'csv' | 'json' = 'csv'): string {
  return `${API_BASE}/export/${qué}.${formato}`;
}

// --- Sin ubicación (fallback UI) ---

export const SinUbicacion = 'Sin ubicación';

// --- Almacenamiento temporal (AsyncStorage) ---
// TODO: eliminar cuando los endpoints de escritura estén listos.

const STORAGE_KEY = 'fablab.inventory.items';

async function readAll(): Promise<InventoryItem[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

async function writeAll(items: InventoryItem[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}
