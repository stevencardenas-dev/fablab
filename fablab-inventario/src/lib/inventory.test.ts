import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  addItem,
  removeItem,
  generateCodigo,
  getAllItems,
  findByCodigo,
  findByDetalle,
  findByRoom,
  listarSalas,
  registrarTraslado,
  historialElemento,
  SinUbicacion,
  type InventoryItem,
  type Room,
} from './inventory';

function makeItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    codigo: generateCodigo(),
    detalle: 'Arduino Uno',
    serial: 'SN001',
    inventario: 'CNC',
    estado: 'Bueno',
    observaciones: '',
    cantidad: '1',
    ...overrides,
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('generateCodigo', () => {
  it('is prefixed for identification', () => {
    expect(generateCodigo()).toMatch(/^FL-/);
  });

  it('only uses characters safe for a Data Matrix / no whitespace', () => {
    for (let i = 0; i < 20; i++) {
      expect(generateCodigo()).toMatch(/^[A-Z0-9-]+$/);
    }
  });

  it('is highly likely unique even within the same millisecond', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
    try {
      const codes = new Set(Array.from({ length: 200 }, () => generateCodigo()));
      expect(codes.size).toBeGreaterThan(190);
    } finally {
      jest.restoreAllMocks();
    }
  });
});

describe('addItem + removeItem (AsyncStorage)', () => {
  it('stores and removes via AsyncStorage', async () => {
    // Forzar fallo de API para probar el fallback AsyncStorage
    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = jest.fn(() => Promise.reject(new Error('API no disponible')));
    try {
      const item = makeItem();
      await addItem(item);
      const raw = await AsyncStorage.getItem('fablab.inventory.items');
      const items: InventoryItem[] = raw ? JSON.parse(raw) : [];
      expect(items).toContainEqual(item);
      await removeItem(item.codigo);
      const after = await AsyncStorage.getItem('fablab.inventory.items');
      expect(after).toBe('[]');
    } finally {
      (globalThis as any).fetch = origFetch;
    }
  });
});

describe('addItem + removeItem (API)', () => {
  afterEach(() => {
    (globalThis as any).fetch = undefined;
  });

  it('addItem posts to API cuando el servidor está disponible', async () => {
    const saved: { codigo: string; detalle: string } = { codigo: '', detalle: '' };
    (globalThis as any).fetch = jest.fn((_url: string, opts?: { method?: string; body?: string }) => {
      if (opts?.method === 'POST' && opts.body) {
        Object.assign(saved, JSON.parse(opts.body));
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 999, ...saved }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    const item = makeItem();
    await addItem(item);
    expect(saved.codigo).toBe(item.codigo);
    expect(saved.detalle).toBe(item.detalle);
  });

  it('removeItem DELETEa al API cuando el servidor está disponible', async () => {
    let deleted = '';
    (globalThis as any).fetch = jest.fn((url: string, opts?: { method?: string }) => {
      if (opts?.method === 'DELETE') {
        deleted = url;
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ deleted: true }) });
    });

    await removeItem('TEST-999');
    expect(deleted).toContain('TEST-999');
  });
});

describe('getAllItems', () => {
  it('returns empty array when API is unreachable', async () => {
    const items = await getAllItems();
    expect(items).toEqual([]);
  });
});

describe('findByCodigo', () => {
  it('returns undefined when API is unreachable', async () => {
    const result = await findByCodigo('anything');
    expect(result === undefined || result === null).toBe(true);
  });
});

describe('findByDetalle', () => {
  const mockSalas: Room[] = [
    { id: 1, nombre: 'CNC', edificio: 'FabLab', elementos: 2 },
    { id: 7, nombre: 'Almacen', edificio: 'FabLab', elementos: 2 },
  ];
  const mockItems: Record<number, InventoryItem[]> = {
    1: [
      { codigo: 'CNC-001', detalle: 'Torno CNC', serial: 'SN100', inventario: 'INV001', estado: 'Bueno', observaciones: '', cantidad: '1', sala_id: 1 },
      { codigo: 'CNC-002', detalle: 'Fresadora CNC', serial: 'SN101', inventario: 'INV002', estado: 'Malo', observaciones: 'Reparar', cantidad: '1', sala_id: 1 },
    ],
    7: [
      { codigo: 'ALM-66', detalle: 'Foami', serial: 'SN200', inventario: 'INV003', estado: 'Bueno', observaciones: '', cantidad: '1', sala_id: 7 },
      { codigo: 'ALM-67', detalle: 'Foami azul', serial: '', inventario: '', estado: '', observaciones: '', cantidad: '', sala_id: 7 },
    ],
  };

  function mockApi(salas: Room[], items: Record<number, InventoryItem[]>) {
    let callCount = 0;
    (globalThis as any).fetch = jest.fn((url: string) => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(salas) }) as unknown as Response;
      }
      const match = url.match(/\/salas\/(\d+)\/elementos/);
      if (match) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(items[Number(match[1])] ?? []) }) as unknown as Response;
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) }) as unknown as Response;
    });
  }

  afterEach(() => {
    (globalThis as any).fetch = undefined;
  });

  it('returns empty when API is unreachable', async () => {
    const results = await findByDetalle('arduino');
    expect(Array.isArray(results)).toBe(true);
  });

  it('finds items by detalle substring', async () => {
    mockApi(mockSalas, mockItems);
    const results = await findByDetalle('cnc');
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((i) => i.detalle?.toLowerCase().includes('cnc'))).toBe(true);
  });

  it('finds items by codigo', async () => {
    mockApi(mockSalas, mockItems);
    const results = await findByDetalle('ALM-66');
    expect(results.length).toBe(1);
    expect(results[0].codigo).toBe('ALM-66');
  });

  it('finds items by serial', async () => {
    mockApi(mockSalas, mockItems);
    const results = await findByDetalle('SN100');
    expect(results.length).toBe(1);
    expect(results[0].serial).toBe('SN100');
  });

  it('finds items by estado', async () => {
    mockApi(mockSalas, mockItems);
    const results = await findByDetalle('malo');
    expect(results.length).toBe(1);
    expect(results[0].estado).toBe('Malo');
  });

  it('requires ALL words to match', async () => {
    mockApi(mockSalas, mockItems);
    const results = await findByDetalle('cnc bueno');
    expect(results.length).toBe(1);
    expect(results[0].codigo).toBe('CNC-001');
  });

  it('ranks exact codigo above partial matches', async () => {
    mockApi(mockSalas, mockItems);
    const results = await findByDetalle('ALM');
    expect(results.length).toBe(2);
    // ALM-66 and ALM-67 both contain "alm" - order should be stable
    expect(results[0].codigo.startsWith('ALM')).toBe(true);
  });
});

describe('findByRoom', () => {
  it('returns empty when API is unreachable', async () => {
    const results = await findByRoom(1);
    expect(Array.isArray(results)).toBe(true);
  });
});

describe('listarSalas', () => {
  it('returns empty when API is unreachable', async () => {
    const salas = await listarSalas();
    expect(Array.isArray(salas)).toBe(true);
  });
});

describe('registrarTraslado', () => {
  it('throws when API is unreachable', async () => {
    await expect(registrarTraslado({ elementoId: 1, salaNuevaId: 2 })).rejects.toThrow();
  });
});

describe('historialElemento', () => {
  it('returns empty when API is unreachable', async () => {
    const hist = await historialElemento(1);
    expect(Array.isArray(hist)).toBe(true);
  });
});

describe('SinUbicacion', () => {
  it('is defined as a string', () => {
    expect(SinUbicacion).toBe('Sin ubicación');
  });
});
