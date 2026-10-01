import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Priority, Source, type Order } from '../../types';

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  localStorage.clear();
});
const order = (id: string): Order => ({
  id,
  clientName: 'Test',
  isArchived: false,
  isSold: false,
  brand: 'Toyota',
  model: 'Camry',
  year: '2020',
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

describe('local application data', () => {
  it('waits for persistence and retains the order in the UI when a deletion fails', async () => {
    const store = await import('../../orderStore');
    await store.addOrderItem(order('one'));
    const original = IDBObjectStore.prototype.delete;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (
      this: IDBObjectStore,
      key,
    ) {
      const result = original.call(this, key);
      this.transaction.abort();
      return result;
    });
    expect(await store.deleteOrderItem('one')).toBe(false);
    expect(store.getOrderState().orders.map((item) => item.id)).toContain('one');
    spy.mockRestore();
    expect(await store.deleteOrderItem('one')).toBe(true);
  });
  it('exports and restores settings, media, variants, suppliers and quote documents', async () => {
    const store = await import('../../orderStore'),
      { localDocuments } = await import('../../storage/localDocuments');
    await store.addOrderItem(order('one'));
    // The public quote document can contain large data URLs, unlike localStorage settings.
    const image = 'data:image/webp;base64,' + 'A'.repeat(2000);
    await localDocuments.set('quote:one', { payload: { order: { id: 'one' }, photos: [image] } });
    localStorage.setItem(
      'dubai_spares_standalone_variants',
      JSON.stringify([{ id: 'variant-one', photos: [image] }]),
    );
    localStorage.setItem(
      'dubai_spares_app_settings_v1',
      JSON.stringify({ userName: 'Local Manager' }),
    );
    const backup = await import('../../utils/localBackup');
    const data = await backup.createLocalBackup();
    await localDocuments.set('quote:one', { payload: {} });
    localStorage.setItem('dubai_spares_standalone_variants', '[]');
    await backup.restoreLocalBackup(data);
    expect(await localDocuments.get('quote:one')).toMatchObject({ payload: { photos: [image] } });
    expect(
      JSON.parse(localStorage.getItem('dubai_spares_standalone_variants')!)[0].photos,
    ).toContain(image);
    expect(JSON.parse(localStorage.getItem('dubai_spares_app_settings_v1')!).userName).toBe(
      'Local Manager',
    );
    expect(store.getOrderState().orders[0].id).toBe('one');
  });
  it('opens a self-contained quote on another device without a database or network', async () => {
    const network = vi.fn();
    vi.stubGlobal('fetch', network);
    const { publicQuoteCreateSnapshot, publicQuoteGetSnapshot } =
      await import('../../publicQuoteApi');
    const value = order('quote-order');
    value.parts = [
      {
        id: 'part-one',
        name: 'Bumper',
        quantity: 2,
        isFound: true,
        variants: [
          {
            id: 'v',
            createdAt: 1,
            priceAed: 100,
            shopName: 'Private shop',
            phone: 'private phone',
            location: '',
            photos: [],
          },
        ],
        photos: [],
      },
    ];
    const created = await publicQuoteCreateSnapshot(value);
    window.location.hash = new URL(created.url).hash;
    const { localDocuments } = await import('../../storage/localDocuments');
    await localDocuments.replace([]);
    const opened = await publicQuoteGetSnapshot(created.token);
    expect(opened?.payload.order.id).toBe('quote-order');
    expect(opened?.payload.items?.[0].qty).toBe(2);
    expect(JSON.stringify(opened?.payload)).not.toContain('private phone');
    expect(network).not.toHaveBeenCalled();
  });
  it('keeps large quote media intact and uses file sharing when the URL payload exceeds its limit', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    const { publicQuoteCreateSnapshot } = await import('../../publicQuoteApi');
    const value = order('large-quote');
    value.parts = [
      {
        id: 'part',
        name: 'Bumper',
        quantity: 1,
        isFound: true,
        photos: [],
        variants: [
          {
            id: 'variant',
            priceAed: 100,
            shopName: 'Shop',
            phone: '',
            location: '',
            photos: [],
            createdAt: 1,
          },
        ],
      },
    ];
    value.carPhotoUrl = 'data:image/webp;base64,' + 'A'.repeat(2 * 1024 * 1024);
    const created = await publicQuoteCreateSnapshot(value);
    expect(created.requiresFile).toBe(true);
    expect(created.payload.order.carPhotoUrl).toBe(value.carPhotoUrl);
    expect(new URL(created.url).hash).not.toContain('data=');
    const { localDocuments } = await import('../../storage/localDocuments');
    expect(await localDocuments.get('quote:' + created.token)).toMatchObject({
      payload: { order: { carPhotoUrl: value.carPhotoUrl } },
    });
  });
});
