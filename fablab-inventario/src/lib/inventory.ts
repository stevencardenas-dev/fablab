import AsyncStorage from '@react-native-async-storage/async-storage';

export type InventoryItem = {
  codigo: string;
  detalle: string;
  serial: string;
  inventario: string;
  estado: string;
  observaciones: string;
  cantidad: string;
  foto?: string;
};

export const Rooms = ['Sala Coworking', 'Sala IOT', 'Sala Drones', 'Impresión 3D', 'Almacén'] as const;
export const SinUbicacion = 'Sin ubicación';

const STORAGE_KEY = 'fablab.inventory.items';

async function readAll(): Promise<InventoryItem[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

async function writeAll(items: InventoryItem[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export async function getAllItems(): Promise<InventoryItem[]> {
  return readAll();
}

export function generateCodigo(): string {
  return `FL-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 36 ** 3)
    .toString(36)
    .toUpperCase()
    .padStart(3, '0')}`;
}

export async function addItem(item: InventoryItem): Promise<void> {
  const items = await readAll();
  const next = items.filter((existing) => existing.codigo !== item.codigo);
  next.push(item);
  await writeAll(next);
}

export async function removeItem(codigo: string): Promise<void> {
  const items = await readAll();
  await writeAll(items.filter((item) => item.codigo !== codigo));
}

export async function findByCodigo(codigo: string): Promise<InventoryItem | undefined> {
  const items = await readAll();
  return items.find((item) => item.codigo === codigo);
}

export async function findByDetalle(query: string): Promise<InventoryItem[]> {
  const items = await readAll();
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return items.filter((item) => item.detalle.toLowerCase().includes(needle));
}

export async function findByRoom(room: string): Promise<InventoryItem[]> {
  const items = await readAll();
  if (room === SinUbicacion) {
    return items.filter((item) => !(Rooms as readonly string[]).includes(item.inventario));
  }
  return items.filter((item) => item.inventario === room);
}
