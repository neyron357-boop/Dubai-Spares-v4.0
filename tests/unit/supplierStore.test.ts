import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Root } from 'react-dom/client';
import { Priority, Source, type Order, type Supplier } from '../../types';

const supplierKey = 'dubai_spares_suppliers';
const supplier = (id: string): Supplier => ({
  id,
  name: `Parts ${id}`,
  phone: '+971501234567',
  location: 'Sharjah',
  brands: ['BMW'],
  whatsapp: '+971501234568',
  isPinned: true,
  internalNotes: 'Keep this note',
});
const order = (id: string): Order => ({
  id,
  clientName: 'Buyer',
  isArchived: false,
  isSold: false,
  brand: 'BMW',
  model: '3 Series',
  year: '2017',
  vin: '',
  priority: Priority.MEDIUM,
  source: Source.OTHER,
  status: 'active',
  parts: [],
  markupPercent: 10,
  exchangeRate: 3.67,
  createdAt: 1,
  searchDepositStatus: 'paid',
});

let mountedRoot: Root | null = null;
let mountedNode: HTMLDivElement | null = null;
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(async () => {
  if (mountedRoot) {
    const { act } = await import('react');
    await act(async () => mountedRoot?.unmount());
  }
  mountedRoot = null;
  mountedNode?.remove();
  mountedNode = null;
});

async function openStore(suppliers: Supplier[], orders: Order[] = []) {
  localStorage.setItem(supplierKey, JSON.stringify(suppliers));
  const orderStore = await import('../../orderStore');
  await orderStore.restoreOrdersExternal(orders);
  const store = await import('../../store');
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  let latest: ReturnType<typeof store.useStore> | undefined;
  function Probe() {
    latest = store.useStore();
    return null;
  }
  mountedNode = document.createElement('div');
  document.body.append(mountedNode);
  mountedRoot = createRoot(mountedNode);
  await React.act(async () => mountedRoot?.render(React.createElement(Probe)));
  return { store, orderStore, act: React.act, api: () => latest! };
}

function failStorageKey(key: string) {
  const original = Storage.prototype.setItem;
  return vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
    this: Storage,
    storageKey,
    value,
  ) {
    if (storageKey === key) throw new DOMException('Storage is full', 'QuotaExceededError');
    return original.call(this, storageKey, value);
  });
}

describe('supplier persistence', () => {
  it.each(['contact', 'variant_id', 'variant_name'] as const)(
    'keeps the original supplier identity and historical source when deletion is blocked by %s',
    async (source) => {
      const initial = supplier('one');
      const linked = order('historical-order');
      linked.recommendedShopIds = [initial.id];
      if (source === 'contact') {
        linked.vendorContacts = [
          { id: 'historical-contact', name: '  PARTS ONE  ', phone: initial.phone, createdAt: 1 },
        ];
      } else {
        linked.parts = [
          {
            id: 'historical-part',
            name: 'Bumper',
            quantity: 1,
            isFound: true,
            photos: [],
            variants: [
              {
                id: 'historical-offer',
                shopId: source === 'variant_id' ? initial.id : undefined,
                shopName: source === 'variant_id' ? 'Previous store name' : '  PARTS ONE  ',
                phone: initial.phone,
                location: initial.location,
                priceAed: 500,
                photos: [],
                createdAt: 1,
              },
            ],
          },
        ];
      }
      const { store, orderStore, api, act } = await openStore([initial], [linked]);
      const suppliersBefore = JSON.stringify(store.exportData().suppliers);
      const orderBefore = JSON.stringify(orderStore.getOrderState().orders);
      const { getNotifications } = await import('../../notificationCenter');
      await act(async () => {
        await expect(api().deleteSupplier(initial.id)).rejects.toBeInstanceOf(
          store.SupplierDeletionBlockedError,
        );
        await store.refreshLocalSuppliers(true);
      });
      expect(JSON.stringify(store.exportData().suppliers)).toBe(suppliersBefore);
      expect(localStorage.getItem(supplierKey)).toBe(suppliersBefore);
      expect(JSON.stringify(orderStore.getOrderState().orders)).toBe(orderBefore);
      expect(getNotifications().filter((item) => item.title === 'Удалён поставщик')).toEqual([]);
    },
  );

  it('retains the existing record and does not report an update when supplier storage fails', async () => {
    const original = supplier('one');
    const { store, api, act } = await openStore([original]);
    const { getNotifications } = await import('../../notificationCenter');
    failStorageKey(supplierKey);
    await act(async () => {
      expect(() => api().updateSupplier({ ...original, name: 'Edited supplier' })).toThrow();
    });
    expect(store.exportData().suppliers[0]).toMatchObject(original);
    expect(JSON.parse(localStorage.getItem(supplierKey)!)[0]).toMatchObject(original);
    expect(getNotifications().filter((item) => item.entityType === 'supplier')).toEqual([]);
  });

  it('deduplicates a repeated creation and keeps the saved supplier when activity storage fails', async () => {
    const { store, api, act } = await openStore([]);
    failStorageKey('dubai_spares_local_notifications_v2');
    await act(async () => {
      expect(() => api().addSupplier(supplier('stable-id'))).not.toThrow();
      expect(() => api().addSupplier({ ...supplier('stable-id'), name: 'BMW LLC' })).not.toThrow();
    });
    expect(store.exportData().suppliers).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(supplierKey)!)).toMatchObject([
      { id: 'stable-id', name: 'BMW LLC', internalNotes: 'Keep this note' },
    ]);
  });

  it('keeps automatic reconstruction failures out of the React lifecycle and refresh promise', async () => {
    const initial = supplier('one');
    const input = order('linked-order');
    input.vendorContacts = [
      {
        id: 'vendor-one',
        name: initial.name,
        phone: initial.phone,
        createdAt: 1,
      },
    ];
    localStorage.setItem(supplierKey, JSON.stringify([initial]));
    const orderStore = await import('../../orderStore');
    await orderStore.restoreOrdersExternal([input]);
    failStorageKey(supplierKey);
    const store = await import('../../store');
    const React = await import('react');
    const { createRoot } = await import('react-dom/client');
    function Probe() {
      store.useStore();
      return null;
    }
    mountedNode = document.createElement('div');
    document.body.append(mountedNode);
    mountedRoot = createRoot(mountedNode);
    await expect(
      React.act(async () => mountedRoot?.render(React.createElement(Probe))),
    ).resolves.toBeUndefined();
    await expect(store.refreshLocalSuppliers(true)).resolves.toMatchObject({ fetchedCount: 1 });
    expect(store.exportData().suppliers[0]).toMatchObject(initial);
    expect(store.exportData().suppliers[0].activeOrderIds).toEqual([]);
  });

  it('restores a deletion after failed order cleanup without reverting other suppliers edited during the wait', async () => {
    const linked = order('linked-order');
    linked.recommendedShopIds = ['one', 'two'];
    const { store, api, act } = await openStore([supplier('one'), supplier('two')], [linked]);
    const { offlineDb } = await import('../../storage/offlineDb');
    const { getNotifications } = await import('../../notificationCenter');
    let release!: () => void;
    let started!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.spyOn(offlineDb, 'saveOrder').mockImplementationOnce(async () => {
      started();
      await wait;
      throw new DOMException('Storage is full', 'QuotaExceededError');
    });
    await act(async () => {
      const deletion = api().deleteSupplier('one');
      await entered;
      api().updateSupplier({ ...supplier('two'), name: 'Updated while deleting' });
      api().addSupplier(supplier('three'));
      release();
      await expect(deletion).rejects.toThrow();
    });
    const recovered = store.exportData().suppliers;
    expect(recovered).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'one', internalNotes: 'Keep this note' }),
        expect.objectContaining({ id: 'two', name: 'Updated while deleting' }),
        expect.objectContaining({ id: 'three' }),
      ]),
    );
    expect(JSON.parse(localStorage.getItem(supplierKey)!)).toHaveLength(3);
    expect(getNotifications().filter((item) => item.title === 'Удалён поставщик')).toEqual([]);
  });

  it('uses fresh order records when the same delete callback removes multiple suppliers', async () => {
    const linked = order('linked-order');
    linked.recommendedShopIds = ['one', 'two'];
    linked.dismissedShopIds = ['one', 'two', 'keep'];
    const { store, orderStore, api, act } = await openStore(
      [supplier('one'), supplier('two')],
      [linked],
    );
    const deleteSupplier = api().deleteSupplier;
    await act(async () => {
      await deleteSupplier('one');
      await deleteSupplier('two');
    });
    expect(store.exportData().suppliers).toEqual([]);
    expect(orderStore.getOrderState().orders[0]).toMatchObject({
      recommendedShopIds: [],
      dismissedShopIds: ['keep'],
    });
    const { getNotifications } = await import('../../notificationCenter');
    expect(getNotifications().filter((item) => item.title === 'Удалён поставщик')).toHaveLength(2);
  });
});
