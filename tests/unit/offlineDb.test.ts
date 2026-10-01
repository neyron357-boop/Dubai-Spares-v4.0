import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Order } from '../../types';

vi.mock('../../logging', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const order = (id: string, patch: Partial<Order> = {}): Order =>
  ({
    id,
    brand: 'Toyota',
    model: 'Camry',
    year: '2020',
    vin: '',
    priority: 'MEDIUM',
    clientName: 'Test',
    source: 'Other',
    status: 'lead',
    parts: [],
    markupPercent: 10,
    exchangeRate: 3.67,
    createdAt: 1,
    ...patch,
  }) as Order;

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
});

describe('durable offline storage', () => {
  it('preserves separate patches and persists the latest concurrent edit', async () => {
    const { offlineDb } = await import('../../storage/offlineDb');
    await offlineDb.saveOrder(order('one'));
    await offlineDb.saveOrderPatch('one', { clientName: 'Edited' });
    await offlineDb.saveOrderPatch('one', { model: 'Corolla' });
    expect((await offlineDb.getOrders())[0]).toMatchObject({
      clientName: 'Edited',
      model: 'Corolla',
    });
    await Promise.all([
      offlineDb.saveOrder(order('one', { clientName: 'First' })),
      offlineDb.saveOrder(order('one', { clientName: 'Latest' })),
    ]);
    expect((await offlineDb.getOrders())[0].clientName).toBe('Latest');
  });

  it('rejects an aborted commit and retains the edit for retry', async () => {
    const { offlineDb } = await import('../../storage/offlineDb');
    const original = IDBObjectStore.prototype.delete;
    vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementationOnce(function (
      this: IDBObjectStore,
      ...args
    ) {
      const request = original.apply(this, args);
      request.addEventListener('success', () => this.transaction.abort());
      return request;
    });
    await expect(offlineDb.saveOrder(order('retry'))).rejects.toThrow(/abort/i);
    expect(await offlineDb.getOrders()).toEqual([order('retry')]);
  });

  it('retains a failed sync mutation instead of silently losing it', async () => {
    const { offlineDb } = await import('../../storage/offlineDb');
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('Storage full', 'QuotaExceededError');
    });
    const mutation = {
      id: 'mutation',
      type: 'upsert' as const,
      orderId: 'one',
      payload: order('one'),
      createdAt: 1,
    };
    await expect(offlineDb.enqueueMutation(mutation)).rejects.toThrow('Storage full');
    expect(await offlineDb.getMutations()).toContainEqual(expect.objectContaining(mutation));
  });

  it('preserves orders and pending mutations during connection recovery', async () => {
    const { offlineDb } = await import('../../storage/offlineDb');
    await offlineDb.saveOrder(order('preserved'));
    await offlineDb.enqueueMutation({
      id: 'pending',
      type: 'upsert',
      orderId: 'preserved',
      payload: order('preserved'),
      createdAt: 1,
    });
    await offlineDb.rebuildLocalCacheSafely();
    expect(await offlineDb.getOrders()).toEqual([order('preserved')]);
    expect(await offlineDb.getMutationCount()).toBe(1);
  });

  it('never deletes the database when recovery cannot read it', async () => {
    const { offlineDb } = await import('../../storage/offlineDb');
    await offlineDb.saveOrder(order('preserved'));
    const deletion = vi.spyOn(indexedDB, 'deleteDatabase');
    vi.spyOn(IDBObjectStore.prototype, 'count').mockImplementationOnce(() => {
      throw new Error('Read failed');
    });
    await expect(offlineDb.rebuildLocalCacheSafely()).rejects.toThrow('Read failed');
    expect(deletion).not.toHaveBeenCalled();
    expect(await offlineDb.getOrders()).toEqual([order('preserved')]);
  });

  it('commits replacement snapshots before resolving and removes obsolete patches', async () => {
    const { offlineDb } = await import('../../storage/offlineDb');
    await offlineDb.saveOrder(order('old'));
    await offlineDb.saveOrderPatch('old', { clientName: 'Old patch' });
    await offlineDb.saveOrders([order('new')]);
    expect(await offlineDb.getOrders()).toEqual([order('new')]);
    await offlineDb.saveOrderPatch('new', { model: 'Corolla' });
    await offlineDb.deleteOrder('new');
    expect(await offlineDb.getOrders()).toEqual([]);
  });
});

describe('backup restoration safety', () => {
  it('rejects unrelated JSON without clearing orders', async () => {
    const { offlineDb } = await import('../../storage/offlineDb');
    await offlineDb.saveOrder(order('preserved'));
    await expect(offlineDb.importAllData({})).rejects.toThrow('Некорректная');
    await expect(offlineDb.importAllData({ orders: [{}], mutations: [] })).rejects.toThrow(
      'Некорректные',
    );
    expect(await offlineDb.getOrders()).toEqual([order('preserved')]);
  });
  it('restores a valid backup in an atomic transaction', async () => {
    const { offlineDb } = await import('../../storage/offlineDb');
    await offlineDb.saveOrder(order('old'));
    await offlineDb.importAllData({ orders: [order('restored')], mutations: [] });
    expect(await offlineDb.getOrders()).toEqual([order('restored')]);
  });
});

it('keeps a newer mutation when an older server request is acknowledged', async () => {
  const { offlineDb } = await import('../../storage/offlineDb');
  await offlineDb.enqueueMutation({
    id: 'same',
    type: 'upsert',
    orderId: 'one',
    payload: order('one', { clientName: 'Old' }),
    createdAt: 1,
  });
  const [sent] = await offlineDb.getMutations();
  await offlineDb.enqueueMutation({ ...sent, payload: order('one', { clientName: 'New' }) });
  await offlineDb.removeMutation(sent.id, sent);
  const [latest] = await offlineDb.getMutations();
  expect(latest.payload).toMatchObject({ clientName: 'New' });
  await offlineDb.removeMutation(latest.id, latest);
  expect(await offlineDb.getMutationCount()).toBe(0);
});

it('restores the legacy order/supplier export without requiring database-specific stores', async () => {
  const { offlineDb } = await import('../../storage/offlineDb');
  await offlineDb.saveOrder(order('legacy'));
  await offlineDb.saveOrderPatch('legacy', { clientName: 'Obsolete patch' });
  await offlineDb.importAllData({ orders: [order('legacy')], suppliers: [] });
  expect(await offlineDb.getOrders()).toEqual([order('legacy')]);
});

it('exports chunks even when callbacks yield and reads diagnostics between batches', async () => {
  const { offlineDb } = await import('../../storage/offlineDb');
  await offlineDb.saveOrders([order('one'), order('two')]);
  const rows: unknown[] = [];
  await offlineDb.exportAllDataChunked({
    batchSize: 1,
    onStoreChunk: async (chunk) => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (chunk.store === 'orders') rows.push(...chunk.rows);
    },
  });
  expect(rows).toEqual([order('one'), order('two')]);
  expect(await offlineDb.getDiagnosticsSummary()).toMatchObject({ entityCounts: { orders: 2 } });
});

it('persists changes beyond the advisory queue threshold so syncing can still drain them', async () => {
  const { offlineDb } = await import('../../storage/offlineDb');
  const mutations = Array.from({ length: 2000 }, (_, index) => ({
    id: `queued-${index}`,
    type: 'delete',
    orderId: `order-${index}`,
    createdAt: index,
  }));
  await offlineDb.importAllData({ orders: [], mutations });
  await offlineDb.enqueueMutation({
    id: 'latest',
    type: 'delete',
    orderId: 'latest',
    createdAt: 2001,
  });
  expect(await offlineDb.getMutationCount()).toBe(2001);
  expect((await offlineDb.exportAllData()).mutations).toHaveLength(2001);
});
