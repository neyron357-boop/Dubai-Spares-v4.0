import { withTransaction } from './db';
import { LocalPart, LocalPhotoLink, LocalPriceVariant, STORE_NAMES } from './types';

export interface IntegrityViolation {
  store: keyof typeof STORE_NAMES;
  id: string;
  reason: string;
}

export interface IntegrityCheckResult {
  ok: boolean;
  violations: IntegrityViolation[];
}

const uniqueIds = (rows: Array<{ id: string }>) => new Set(rows.map((row) => row.id));

export const checkReferentialIntegrity = async (): Promise<IntegrityCheckResult> =>
  withTransaction(Object.values(STORE_NAMES), 'readonly', async ({ store, request }) => {
    const orders = await request(store(STORE_NAMES.orders).getAll());
    const parts = await request(store(STORE_NAMES.parts).getAll()) as LocalPart[];
    const variants = await request(store(STORE_NAMES.priceVariants).getAll()) as LocalPriceVariant[];
    const suppliers = await request(store(STORE_NAMES.suppliers).getAll());
    const photos = await request(store(STORE_NAMES.photos).getAll());
    const photoLinks = await request(store(STORE_NAMES.photoLinks).getAll()) as LocalPhotoLink[];

    const orderIds = uniqueIds(orders as Array<{ id: string }>);
    const partIds = uniqueIds(parts);
    const supplierIds = uniqueIds(suppliers as Array<{ id: string }>);
    const photoIds = uniqueIds(photos as Array<{ id: string }>);

    const violations: IntegrityViolation[] = [];

    for (const part of parts) {
      if (!orderIds.has(part.orderId)) {
        violations.push({ store: 'parts', id: part.id, reason: `Missing order ${part.orderId}` });
      }
    }

    for (const variant of variants) {
      if (!partIds.has(variant.partId)) {
        violations.push({ store: 'priceVariants', id: variant.id, reason: `Missing part ${variant.partId}` });
      }
      if (variant.supplierId && !supplierIds.has(variant.supplierId)) {
        violations.push({ store: 'priceVariants', id: variant.id, reason: `Missing supplier ${variant.supplierId}` });
      }
    }

    for (const link of photoLinks) {
      if (!photoIds.has(link.photoId)) {
        violations.push({ store: 'photoLinks', id: link.id, reason: `Missing photo ${link.photoId}` });
      }
      if (link.entityType === 'order' && !orderIds.has(link.entityId)) {
        violations.push({ store: 'photoLinks', id: link.id, reason: `Missing order ${link.entityId}` });
      }
      if (link.entityType === 'part' && !partIds.has(link.entityId)) {
        violations.push({ store: 'photoLinks', id: link.id, reason: `Missing part ${link.entityId}` });
      }
    }

    return {
      ok: violations.length === 0,
      violations
    };
  });

export const cleanupOrphanPhotos = async (): Promise<string[]> =>
  withTransaction([STORE_NAMES.photos, STORE_NAMES.photoLinks], 'readwrite', async ({ store, request }) => {
    const photos = await request(store(STORE_NAMES.photos).getAll()) as Array<{ id: string }>;
    const links = await request(store(STORE_NAMES.photoLinks).getAll()) as LocalPhotoLink[];
    const referencedPhotoIds = new Set(links.map((link) => link.photoId));
    const deletedIds: string[] = [];

    for (const photo of photos) {
      if (!referencedPhotoIds.has(photo.id)) {
        store(STORE_NAMES.photos).delete(photo.id);
        deletedIds.push(photo.id);
      }
    }

    return deletedIds;
  });
