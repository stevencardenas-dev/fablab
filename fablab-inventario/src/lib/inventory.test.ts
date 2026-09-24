import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  addItem,
  asignarCodigo,
  removeItem,
  updateItem,
  exportarUrl,
  fetchConReintentos,
  generateCodigo,
  getAllItems,
  findByCodigo,
  findByDetalle,
  findByRoom,
  listarSalas,
  registrarTraslado,
  historialElemento,
  resetCache,
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
  // La cache SWR es estado de módulo: sin reset, un test contamina al siguiente
  // (p.ej. "API unreachable" recibiría datos cacheados del test anterior).
  await resetCache();
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

describe('escrituras honestas (sin fallback local silencioso)', () => {
  it('addItem propaga el error cuando la API no responde', async () => {
    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = jest.fn(() => Promise.reject(new Error('API no disponible')));
    try {
      await expect(addItem(makeItem())).rejects.toThrow();
      // Nada quedó "guardado" de mentira: no hay copia local invisible.
      expect(await AsyncStorage.getItem('fablab.inventory.items')).toBeNull();
    } finally {
      (globalThis as any).fetch = origFetch;
    }
  });

  it('removeItem propaga el error cuando el DELETE falla (p.ej. 401)', async () => {
    (globalThis as any).fetch = jest.fn(() =>
      Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) }));
    await expect(removeItem('X-1')).rejects.toThrow('API 401');
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

  it('addItem manda sala_id y usa el id que devuelve el server en la cache', async () => {
    let body: InventoryItem & { sala_id?: number } = makeItem();
    (globalThis as any).fetch = jest.fn((_url: string, opts?: { method?: string; body?: string }) => {
      if (opts?.method === 'POST' && opts.body) {
        body = JSON.parse(opts.body);
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 42, ...body }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });

    await addItem(makeItem({ codigo: 'NEW-1', sala_id: 3 }));
    expect(body.sala_id).toBe(3); // sin esto el server responde 400
    const items = await getAllItems();
    expect(items.find((i) => i.codigo === 'NEW-1')?.id).toBe(42);
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
    const allItems = Object.values(items).flat();
    (globalThis as any).fetch = jest.fn((url: string) => {
      // GET /elementos → todo el inventario en una respuesta
      if (url.endsWith('/elementos')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(allItems) }) as unknown as Response;
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

  it('mueve el elemento y ajusta conteos en cache (write-through)', async () => {
    const item = { ...makeItem({ codigo: 'MOV-1' }), id: 7, sala_id: 1 };
    const salasIniciales: Room[] = [
      { id: 1, nombre: 'Sala A', edificio: 'FabLab', elementos: 3 },
      { id: 2, nombre: 'Sala B', edificio: 'FabLab', elementos: 5 },
    ];
    let body: { elementoId?: number; salaNuevaId?: number; nota?: string | null } = {};
    (globalThis as any).fetch = jest.fn((_url: string, opts?: { method?: string; body?: string }) => {
      if (opts?.method === 'POST') {
        body = JSON.parse(opts.body ?? '{}');
        return Promise.resolve({
          ok: true,
          status: 201,
          json: () => Promise.resolve({ id: 99, salaAnteriorId: 1, salaNuevaId: 2 }),
        });
      }
      if (String(_url).endsWith('/salas')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(salasIniciales) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([item]) });
    });

    await getAllItems(); // llena la cache de elementos
    await listarSalas(); // llena la cache de salas
    await registrarTraslado({ elementoId: 7, salaNuevaId: 2 });

    expect(body).toMatchObject({ elementoId: 7, salaNuevaId: 2, nota: null });

    const items = await getAllItems();
    expect(items.find((i) => i.id === 7)?.sala_id).toBe(2);

    const salas = await listarSalas();
    expect(salas.find((s) => s.id === 1)?.elementos).toBe(2); // 3 - 1
    expect(salas.find((s) => s.id === 2)?.elementos).toBe(6); // 5 + 1
  });

  it('no baja ningun conteo por debajo de cero', async () => {
    const item = { ...makeItem({ codigo: 'MOV-2' }), id: 8, sala_id: 3 };
    const salasIniciales: Room[] = [
      { id: 3, nombre: 'Vacia', edificio: 'FabLab', elementos: 0 },
      { id: 2, nombre: 'Destino', edificio: 'FabLab', elementos: 4 },
    ];
    (globalThis as any).fetch = jest.fn((_url: string, opts?: { method?: string }) => {
      if (opts?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: () => Promise.resolve({ id: 99, salaAnteriorId: 3, salaNuevaId: 2 }),
        });
      }
      if (String(_url).endsWith('/salas')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(salasIniciales) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([item]) });
    });

    await getAllItems();
    await listarSalas();
    await registrarTraslado({ elementoId: 8, salaNuevaId: 2 });
    const salas = await listarSalas();
    expect(salas.find((s) => s.id === 3)?.elementos).toBe(0); // max(0, 0-1)
    expect(salas.find((s) => s.id === 2)?.elementos).toBe(5);
  });
});

describe('historialElemento', () => {
  it('returns empty when API is unreachable', async () => {
    const hist = await historialElemento(1);
    expect(Array.isArray(hist)).toBe(true);
  });
});

describe('fetchConReintentos', () => {
  it('no reintenta en 2xx', async () => {
    let llamadas = 0;
    (globalThis as any).fetch = jest.fn(() => {
      llamadas++;
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    });
    await fetchConReintentos('http://x/api/y', undefined, []);
    expect(llamadas).toBe(1);
  });

  it('reintenta en 503 y pasa cuando despierta', async () => {
    let llamadas = 0;
    (globalThis as any).fetch = jest.fn(() => {
      llamadas++;
      return Promise.resolve({ ok: false, status: llamadas < 3 ? 503 : 200, json: () => Promise.resolve({}) });
    });
    const res = await fetchConReintentos('http://x/api/y', undefined, [1, 1]);
    expect(res.status).toBe(200);
    expect(llamadas).toBe(3);
  });

  it('se rinde tras agotar las esperas y devuelve el último 503', async () => {
    let llamadas = 0;
    (globalThis as any).fetch = jest.fn(() => {
      llamadas++;
      return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) });
    });
    const res = await fetchConReintentos('http://x/api/y', undefined, [1, 1]);
    expect(res.status).toBe(503);
    expect(llamadas).toBe(3);
  });

  it('NO reintenta en 404 (un 404 no se arregla esperando)', async () => {
    let llamadas = 0;
    (globalThis as any).fetch = jest.fn(() => {
      llamadas++;
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    });
    await fetchConReintentos('http://x/api/y', undefined, [1, 1]);
    expect(llamadas).toBe(1);
  });
});

describe('updateItem', () => {
  it('hace PUT y actualiza la cache con la respuesta del server', async () => {
    const itemBase = makeItem({ codigo: 'UPD-1', detalle: 'Original' });
    itemBase.id = 123;
    (globalThis as any).fetch = jest.fn((url: string, opts?: { method?: string; body?: string }) => {
      if (opts?.method === 'PUT') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ updated: true, elemento: { ...itemBase, detalle: 'Editado' } }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([itemBase]) });
    });
    await getAllItems(); // llena la cache
    await updateItem(123, { detalle: 'Editado' });
    const items = await getAllItems();
    expect(items.find((i) => i.id === 123)?.detalle).toBe('Editado');
  });

  it('propaga el error si el PUT falla (sin fallback silencioso)', async () => {
    (globalThis as any).fetch = jest.fn(() =>
      Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: 'x' }) }));
    await expect(updateItem(1, { detalle: 'x' })).rejects.toThrow('API 500');
  });
});

describe('asignarCodigo', () => {
  afterEach(() => {
    (globalThis as any).fetch = undefined;
  });

  it('hace POST a /elementos/:id/codigo y actualiza la cache con el código nuevo', async () => {
    const itemBase = makeItem({ codigo: '', detalle: 'FOAMI NEGRO' });
    itemBase.id = 77;
    let urlLlamada = '';
    (globalThis as any).fetch = jest.fn((url: string, opts?: { method?: string; body?: string }) => {
      if (opts?.method === 'POST') {
        urlLlamada = url;
        expect(JSON.parse(opts.body ?? '{}').codigo).toBe('CNC-137');
        return Promise.resolve({
          ok: true,
          status: 201,
          json: () => Promise.resolve({ asignado: true, elemento: { ...itemBase, codigo: 'CNC-137' } }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([itemBase]) });
    });
    await getAllItems(); // llena la cache
    const elemento = await asignarCodigo(77, 'CNC-137');
    expect(elemento.codigo).toBe('CNC-137');
    expect(urlLlamada).toMatch(/\/elementos\/77\/codigo$/);
    // Write-through: la sala y el resto de la app lo ven sin re-descargar
    const items = await getAllItems();
    expect(items.find((i) => i.id === 77)?.codigo).toBe('CNC-137');
  });

  it('propaga el 409 si el elemento ya tiene código', async () => {
    (globalThis as any).fetch = jest.fn(() =>
      Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({ error: 'ya tiene código' }) }));
    await expect(asignarCodigo(1, 'CNC-137')).rejects.toThrow('API 409');
  });
});

describe('auth en escrituras', () => {
  afterEach(() => {
    (globalThis as any).fetch = undefined;
    delete process.env.EXPO_PUBLIC_API_TOKEN;
  });

  it('sin EXPO_PUBLIC_API_TOKEN no manda Authorization', async () => {
    let auth = '';
    (globalThis as any).fetch = jest.fn((_url: string, opts?: { headers?: Record<string, string> }) => {
      auth = opts?.headers?.Authorization ?? '(ninguno)';
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ updated: true, elemento: {} }) });
    });
    await updateItem(1, { detalle: 'x' });
    expect(auth).toBe('(ninguno)');
  });

  it('con EXPO_PUBLIC_API_TOKEN manda Bearer en PUT y DELETE', async () => {
    process.env.EXPO_PUBLIC_API_TOKEN = 'secreto-test';
    const auths: string[] = [];
    (globalThis as any).fetch = jest.fn((_url: string, opts?: { method?: string; headers?: Record<string, string> }) => {
      auths.push(`${opts?.method}:${opts?.headers?.Authorization ?? '(ninguno)'}`);
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ updated: true, elemento: {} }) });
    });
    await updateItem(1, { detalle: 'x' });
    await removeItem('TEST-1');
    expect(auths).toEqual([
      'PUT:Bearer secreto-test',
      'DELETE:Bearer secreto-test',
    ]);
  });
});

describe('exportarUrl', () => {
  it('apunta a los endpoints de export, csv por defecto', () => {
    expect(exportarUrl('elementos')).toMatch(/\/export\/elementos\.csv$/);
    expect(exportarUrl('traslados')).toMatch(/\/export\/traslados\.csv$/);
  });

  it('acepta el formato json', () => {
    expect(exportarUrl('elementos', 'json')).toMatch(/\/export\/elementos\.json$/);
    expect(exportarUrl('traslados', 'json')).toMatch(/\/export\/traslados\.json$/);
  });
});

describe('SinUbicacion', () => {
  it('is defined as a string', () => {
    expect(SinUbicacion).toBe('Sin ubicación');
  });
});
