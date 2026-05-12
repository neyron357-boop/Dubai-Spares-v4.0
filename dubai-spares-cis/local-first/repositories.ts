import { cleanupOrphanPhotos } from './integrityService';
import { withTransaction } from './db';
import {
  LocalMetaRecord,
  LocalOrder,
  LocalPart,
  LocalPhoto,
  LocalPhotoLink,
  LocalPriceVariant,
  LocalSupplier,
  STORE_NAMES
} from './types';

const nowIso = () => new Date().toISOString();

export const ordersRepository = {
  async list(): Promise<LocalOrder[]> {
    return withTransaction([STORE_NAMES.orders], 'readonly', async ({ store, request }) =>
      request(store(STORE_NAMES.orders).getAll()) as Promise<LocalOrder[]>
    );
  },

  async upsert(order: Omit<LocalOrder, 'updatedAt'> & { updatedAt?: string }): Promise<LocalOrder> {
    const payload: LocalOrder = { ...order, updatedAt: order.updatedAt ?? nowIso() };
    await withTransaction([STORE_NAMES.orders], 'readwrite', async ({ store }) => {
      store(STORE_NAMES.orders).put(payload);
    });
    return payload;
  },

  async removeCascade(orderId: string): Promise<void> {
    await withTransaction(
      [STORE_NAMES.orders, STORE_NAMES.parts, STORE_NAMES.priceVariants, STORE_NAMES.photoLinks],
      'readwrite',
      async ({ store, request }) => {
        const partsStore = store(STORE_NAMES.parts);
        const variantsStore = store(STORE_NAMES.priceVariants);
        const photoLinksStore = store(STORE_NAMES.photoLinks);
        const parts = await request(partsStore.index('by_orderId').getAll(IDBKeyRange.only(orderId))) as LocalPart[];

        for (const part of parts) {
          const variants = await request(variantsStore.index('by_partId').getAll(IDBKeyRange.only(part.id))) as LocalPriceVariant[];
          for (const variant of variants) {
            variantsStore.delete(variant.id);
          }

          const partPhotoLinks = await request(photoLinksStore.index('by_entity').getAll(IDBKeyRange.only(['part', part.id]))) as LocalPhotoLink[];
          for (const link of partPhotoLinks) {
            photoLinksStore.delete(link.id);
          }

          partsStore.delete(part.id);
        }

        const orderPhotoLinks = await request(photoLinksStore.index('by_entity').getAll(IDBKeyRange.only(['order', orderId]))) as LocalPhotoLink[];
        for (const link of orderPhotoLinks) {
          photoLinksStore.delete(link.id);
        }

        store(STORE_NAMES.orders).delete(orderId);
      }
    );

    await cleanupOrphanPhotos();
  }
};

export const partsRepository = {
  async listByOrder(orderId: string): Promise<LocalPart[]> {
    return withTransaction([STORE_NAMES.parts], 'readonly', async ({ store, request }) =>
      request(store(STORE_NAMES.parts).index('by_orderId').getAll(IDBKeyRange.only(orderId))) as Promise<LocalPart[]>
    );
  },

  async upsert(part: Omit<LocalPart, 'updatedAt'> & { updatedAt?: string }): Promise<LocalPart> {
    const payload: LocalPart = { ...part, updatedAt: part.updatedAt ?? nowIso() };
    await withTransaction([STORE_NAMES.parts], 'readwrite', async ({ store }) => {
      store(STORE_NAMES.parts).put(payload);
    });
    return payload;
  },

  async removeCascade(partId: string): Promise<void> {
    await withTransaction(
      [STORE_NAMES.parts, STORE_NAMES.priceVariants, STORE_NAMES.photoLinks],
      'readwrite',
      async ({ store, request }) => {
        const variantsStore = store(STORE_NAMES.priceVariants);
        const photoLinksStore = store(STORE_NAMES.photoLinks);

        const variants = await request(variantsStore.index('by_partId').getAll(IDBKeyRange.only(partId))) as LocalPriceVariant[];
        for (const variant of variants) {
          variantsStore.delete(variant.id);
        }

        const partLinks = await request(photoLinksStore.index('by_entity').getAll(IDBKeyRange.only(['part', partId]))) as LocalPhotoLink[];
        for (const link of partLinks) {
          photoLinksStore.delete(link.id);
        }

        store(STORE_NAMES.parts).delete(partId);
      }
    );

    await cleanupOrphanPhotos();
  }
};

export const priceVariantsRepository = {
  async listByPart(partId: string): Promise<LocalPriceVariant[]> {
    return withTransaction([STORE_NAMES.priceVariants], 'readonly', async ({ store, request }) =>
      request(store(STORE_NAMES.priceVariants).index('by_partId').getAll(IDBKeyRange.only(partId))) as Promise<LocalPriceVariant[]>
    );
  },

  async upsert(variant: Omit<LocalPriceVariant, 'updatedAt'> & { updatedAt?: string }): Promise<LocalPriceVariant> {
    const payload: LocalPriceVariant = { ...variant, updatedAt: variant.updatedAt ?? nowIso() };
    await withTransaction([STORE_NAMES.priceVariants], 'readwrite', async ({ store }) => {
      store(STORE_NAMES.priceVariants).put(payload);
    });
    return payload;
  },

  async remove(id: string): Promise<void> {
    await withTransaction([STORE_NAMES.priceVariants], 'readwrite', async ({ store }) => {
      store(STORE_NAMES.priceVariants).delete(id);
    });
  }
};

export const suppliersRepository = {
  async list(): Promise<LocalSupplier[]> {
    return withTransaction([STORE_NAMES.suppliers], 'readonly', async ({ store, request }) =>
      request(store(STORE_NAMES.suppliers).getAll()) as Promise<LocalSupplier[]>
    );
  },

  async upsert(supplier: Omit<LocalSupplier, 'updatedAt'> & { updatedAt?: string }): Promise<LocalSupplier> {
    const payload: LocalSupplier = { ...supplier, updatedAt: supplier.updatedAt ?? nowIso() };
    await withTransaction([STORE_NAMES.suppliers], 'readwrite', async ({ store }) => {
      store(STORE_NAMES.suppliers).put(payload);
    });
    return payload;
  }
};

export const photosRepository = {
  async savePhoto(photo: LocalPhoto): Promise<void> {
    await withTransaction([STORE_NAMES.photos], 'readwrite', async ({ store }) => {
      store(STORE_NAMES.photos).put(photo);
    });
  },

  async getPhoto(photoId: string): Promise<LocalPhoto | undefined> {
    return withTransaction([STORE_NAMES.photos], 'readonly', async ({ store, request }) =>
      request(store(STORE_NAMES.photos).get(photoId)) as Promise<LocalPhoto | undefined>
    );
  },

  async linkPhoto(link: LocalPhotoLink): Promise<void> {
    await withTransaction([STORE_NAMES.photoLinks], 'readwrite', async ({ store }) => {
      store(STORE_NAMES.photoLinks).put(link);
    });
  },

  async listLinksForEntity(entityType: LocalPhotoLink['entityType'], entityId: string): Promise<LocalPhotoLink[]> {
    return withTransaction([STORE_NAMES.photoLinks], 'readonly', async ({ store, request }) =>
      request(store(STORE_NAMES.photoLinks).index('by_entity').getAll(IDBKeyRange.only([entityType, entityId]))) as Promise<LocalPhotoLink[]>
    );
  }
};

export const metaRepository = {
  async set(key: string, value: unknown): Promise<void> {
    const record: LocalMetaRecord = { key, value };
    await withTransaction([STORE_NAMES.meta], 'readwrite', async ({ store }) => {
      store(STORE_NAMES.meta).put(record);
    });
  },

  async get<T>(key: string): Promise<T | undefined> {
    const record = await withTransaction([STORE_NAMES.meta], 'readonly', async ({ store, request }) =>
      request(store(STORE_NAMES.meta).get(key)) as Promise<LocalMetaRecord | undefined>
    );
    return record?.value as T | undefined;
  }
};
