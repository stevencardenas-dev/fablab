import AsyncStorage from '@react-native-async-storage/async-storage';

import { addItem, findByCodigo, findByDetalle, findByRoom, generateCodigo, getAllItems, removeItem, Rooms, SinUbicacion, type InventoryItem } from './inventory';

function makeItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    codigo: generateCodigo(),
    detalle: 'Arduino Uno',
    serial: 'SN001',
    inventario: 'Sala IOT',
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
      // ponytail: 3 base36 chars/ms = 46656 slots; 200 draws collide with the
      // birthday bound at roughly sqrt(46656*ln(1/(1-p))). Bound is loose on
      // purpose so the test isn't flaky, not a guarantee against collisions —
      // if real usage ever adds elements in a tight loop, widen the random part.
      expect(codes.size).toBeGreaterThan(190);
    } finally {
      jest.restoreAllMocks();
    }
  });
});

describe('addItem + findByCodigo', () => {
  it('stores an item retrievable by its exact code', async () => {
    const item = makeItem();
    await addItem(item);
    await expect(findByCodigo(item.codigo)).resolves.toEqual(item);
  });

  it('returns undefined for an unknown code', async () => {
    await expect(findByCodigo('does-not-exist')).resolves.toBeUndefined();
  });

  it('upserts: adding the same codigo again replaces the old record', async () => {
    const codigo = generateCodigo();
    await addItem(makeItem({ codigo, detalle: 'Old' }));
    await addItem(makeItem({ codigo, detalle: 'New' }));

    const all = await getAllItems();
    expect(all.filter((i) => i.codigo === codigo)).toHaveLength(1);
    await expect(findByCodigo(codigo)).resolves.toMatchObject({ detalle: 'New' });
  });

  it('keeps distinct items separate', async () => {
    const a = makeItem({ detalle: 'Sensor A' });
    const b = makeItem({ detalle: 'Sensor B' });
    await addItem(a);
    await addItem(b);

    const all = await getAllItems();
    expect(all).toHaveLength(2);
  });

  it('persists across calls (survives a fresh read from storage)', async () => {
    const item = makeItem();
    await addItem(item);

    // AsyncStorage.getItem is exercised fresh on every call in inventory.ts,
    // so this confirms the value was actually serialized, not held in memory.
    const raw = await AsyncStorage.getItem('fablab.inventory.items');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toContainEqual(item);
  });

  it('code lookup is case-sensitive and exact (no partial match)', async () => {
    const item = makeItem({ codigo: 'FL-ABC123' });
    await addItem(item);

    await expect(findByCodigo('fl-abc123')).resolves.toBeUndefined();
    await expect(findByCodigo('FL-ABC12')).resolves.toBeUndefined();
    await expect(findByCodigo('FL-ABC1234')).resolves.toBeUndefined();
  });

  it('preserves insertion order for untouched items', async () => {
    const a = makeItem({ detalle: 'First' });
    const b = makeItem({ detalle: 'Second' });
    const c = makeItem({ detalle: 'Third' });
    await addItem(a);
    await addItem(b);
    await addItem(c);

    const all = await getAllItems();
    expect(all.map((i) => i.detalle)).toEqual(['First', 'Second', 'Third']);
  });

  it('moves an upserted item to the end rather than mutating in place', async () => {
    const codigo = generateCodigo();
    await addItem(makeItem({ codigo, detalle: 'A' }));
    await addItem(makeItem({ detalle: 'B' }));
    await addItem(makeItem({ codigo, detalle: 'A-updated' }));

    const all = await getAllItems();
    expect(all.map((i) => i.detalle)).toEqual(['B', 'A-updated']);
  });

  it('KNOWN BUG: concurrent addItem calls silently drop items (read-modify-write race)', async () => {
    // addItem does readAll() -> push -> writeAll() with no locking. When two
    // calls interleave, the second writeAll() overwrites the first: whichever
    // call's readAll() ran first loses its item. This is a real bug reachable
    // from the UI (e.g. a fast double-tap on "Agregar", or two devices/tabs
    // sharing the same storage). This test documents the current (broken)
    // behavior rather than asserting the desired one, so it fails loudly if
    // someone "fixes" addItem — remove the .failing/update the assertion then.
    const items = Array.from({ length: 5 }, () => makeItem({ detalle: 'concurrent' }));

    await Promise.all(items.map((item) => addItem(item)));

    const all = await getAllItems();
    // ponytail: known unsafe — fix is a per-write mutex or an atomic
    // read-modify-write primitive (AsyncStorage has neither built in).
    expect(all.length).toBeLessThan(items.length);
  });
});

describe('getAllItems', () => {
  it('returns an empty array when nothing is stored', async () => {
    await expect(getAllItems()).resolves.toEqual([]);
  });

  it('returns a fresh array each call, not a shared mutable reference', async () => {
    await addItem(makeItem());
    const first = await getAllItems();
    first.push(makeItem());

    const second = await getAllItems();
    expect(second).toHaveLength(1);
  });
});

describe('removeItem', () => {
  it('deletes the item with the matching codigo', async () => {
    const item = makeItem();
    await addItem(item);

    await removeItem(item.codigo);

    await expect(findByCodigo(item.codigo)).resolves.toBeUndefined();
    await expect(getAllItems()).resolves.toEqual([]);
  });

  it('leaves other items untouched', async () => {
    const a = makeItem({ detalle: 'Keep' });
    const b = makeItem({ detalle: 'Remove' });
    await addItem(a);
    await addItem(b);

    await removeItem(b.codigo);

    const all = await getAllItems();
    expect(all).toEqual([a]);
  });

  it('is a no-op for an unknown codigo', async () => {
    await addItem(makeItem());
    const before = await getAllItems();

    await removeItem('does-not-exist');

    await expect(getAllItems()).resolves.toEqual(before);
  });
});

describe('findByRoom', () => {
  beforeEach(async () => {
    await addItem(makeItem({ detalle: 'Arduino', inventario: 'Sala IOT' }));
    await addItem(makeItem({ detalle: 'Drone', inventario: 'Sala Drones' }));
    await addItem(makeItem({ detalle: 'Huérfano', inventario: 'not-a-real-room' }));
    await addItem(makeItem({ detalle: 'Sin sala', inventario: '' }));
  });

  it('matches only items in the given room', async () => {
    const results = await findByRoom('Sala IOT');
    expect(results.map((i) => i.detalle)).toEqual(['Arduino']);
  });

  it('returns an empty array for a room with nothing', async () => {
    await expect(findByRoom('Almacén')).resolves.toEqual([]);
  });

  it('is exact, not a substring match', async () => {
    await expect(findByRoom('Sala')).resolves.toEqual([]);
  });

  it('SinUbicacion bucket collects items outside the fixed Rooms list', async () => {
    const results = await findByRoom(SinUbicacion);
    expect(results.map((i) => i.detalle).sort()).toEqual(['Huérfano', 'Sin sala']);
  });
});

describe('findByDetalle', () => {
  beforeEach(async () => {
    await addItem(makeItem({ detalle: 'Arduino Uno' }));
    await addItem(makeItem({ detalle: 'Arduino Mega' }));
    await addItem(makeItem({ detalle: 'Raspberry Pi 4' }));
  });

  it('matches by case-insensitive substring', async () => {
    const results = await findByDetalle('arduino');
    expect(results.map((i) => i.detalle).sort()).toEqual(['Arduino Mega', 'Arduino Uno']);
  });

  it('returns an empty array for no matches', async () => {
    await expect(findByDetalle('nonexistent')).resolves.toEqual([]);
  });

  it('returns an empty array for a blank query instead of everything', async () => {
    await expect(findByDetalle('   ')).resolves.toEqual([]);
  });

  it('matches substrings anywhere in the word, not just prefixes', async () => {
    const results = await findByDetalle('berry');
    expect(results.map((i) => i.detalle)).toEqual(['Raspberry Pi 4']);
  });

  it('trims surrounding whitespace from the query', async () => {
    const results = await findByDetalle('  mega  ');
    expect(results.map((i) => i.detalle)).toEqual(['Arduino Mega']);
  });

  it('does not match an item with an empty detalle against a blank-ish query', async () => {
    await addItem(makeItem({ detalle: '' }));
    await expect(findByDetalle('')).resolves.toEqual([]);
  });
});

describe('Rooms', () => {
  it('lists the fixed FabLab rooms', () => {
    expect(Rooms).toEqual(['Sala Coworking', 'Sala IOT', 'Sala Drones', 'Impresión 3D', 'Almacén']);
  });
});
