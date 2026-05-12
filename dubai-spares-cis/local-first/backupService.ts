import { withTransaction } from './db';
import { checkReferentialIntegrity } from './integrityService';
import { base64ToBlob, blobToBase64 } from './photoService';
import {
  LOCAL_DB_VERSION,
  LocalFirstBackupData,
  LocalFirstBackupFile,
  LocalFirstBackupPhoto,
  LocalMetaRecord,
  LocalPhoto,
  LocalStoreStatistics,
  REQUIRED_BACKUP_STORES,
  STORE_NAMES
} from './types';
import { metaRepository } from './repositories';

const APP_NAME = 'dubai-spares-local';
const BACKUP_VERSION = 1;

const assertValidBackupPayload = (payload: unknown): LocalFirstBackupFile => {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Backup file is not a JSON object');
  }

  const backup = payload as Partial<LocalFirstBackupFile>;
  if (backup.backupVersion !== BACKUP_VERSION) {
    throw new Error(`Unsupported backupVersion: ${String(backup.backupVersion)}`);
  }

  if (backup.app !== APP_NAME) {
    throw new Error(`Invalid backup app: ${String(backup.app)}`);
  }

  if (!backup.data || typeof backup.data !== 'object') {
    throw new Error('Backup data section is missing');
  }

  for (const store of REQUIRED_BACKUP_STORES) {
    if (!Array.isArray((backup.data as Record<string, unknown>)[store])) {
      throw new Error(`Backup store is missing or invalid: ${store}`);
    }
  }

  return backup as LocalFirstBackupFile;
};

export const collectStoreStatistics = (data: LocalFirstBackupData): LocalStoreStatistics => ({
  orders: data.orders.length,
  parts: data.parts.length,
  priceVariants: data.priceVariants.length,
  suppliers: data.suppliers.length,
  photos: data.photos.length,
  photoLinks: data.photoLinks.length,
  meta: data.meta.length
});

export const exportBackup = async (): Promise<LocalFirstBackupFile> => {
  const data = await withTransaction(Object.values(STORE_NAMES), 'readonly', async ({ store, request }) => {
    const orders = await request(store(STORE_NAMES.orders).getAll());
    const parts = await request(store(STORE_NAMES.parts).getAll());
    const priceVariants = await request(store(STORE_NAMES.priceVariants).getAll());
    const suppliers = await request(store(STORE_NAMES.suppliers).getAll());
    const photos = await request(store(STORE_NAMES.photos).getAll()) as LocalPhoto[];
    const photoLinks = await request(store(STORE_NAMES.photoLinks).getAll());
    const meta = await request(store(STORE_NAMES.meta).getAll()) as LocalMetaRecord[];

    const encodedPhotos: LocalFirstBackupPhoto[] = await Promise.all(
      photos.map(async (photo) => ({
        id: photo.id,
        mimeType: photo.mimeType,
        width: photo.width,
        height: photo.height,
        sizeBytes: photo.sizeBytes,
        createdAt: photo.createdAt,
        base64: await blobToBase64(photo.blob)
      }))
    );

    return {
      orders,
      parts,
      priceVariants,
      suppliers,
      photos: encodedPhotos,
      photoLinks,
      meta
    };
  });

  await metaRepository.set('lastBackupAt', new Date().toISOString());

  return {
    backupVersion: BACKUP_VERSION,
    app: APP_NAME,
    createdAt: new Date().toISOString(),
    schemaVersion: LOCAL_DB_VERSION,
    data
  };
};

export const downloadBackupJson = (backup: LocalFirstBackupFile): void => {
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const datePart = new Date().toISOString().slice(0, 10);

  anchor.href = url;
  anchor.download = `dubai-spares-backup-${datePart}.json`;
  anchor.click();

  URL.revokeObjectURL(url);
};

export const importBackup = async (file: File): Promise<{ stats: LocalStoreStatistics }> => {
  const raw = await file.text();
  const parsed = JSON.parse(raw) as unknown;
  const backup = assertValidBackupPayload(parsed);

  const stats = collectStoreStatistics(backup.data);

  await withTransaction(Object.values(STORE_NAMES), 'readwrite', async ({ store }) => {
    for (const storeName of Object.values(STORE_NAMES)) {
      store(storeName).clear();
    }

    for (const item of backup.data.orders) store(STORE_NAMES.orders).put(item);
    for (const item of backup.data.parts) store(STORE_NAMES.parts).put(item);
    for (const item of backup.data.priceVariants) store(STORE_NAMES.priceVariants).put(item);
    for (const item of backup.data.suppliers) store(STORE_NAMES.suppliers).put(item);

    for (const item of backup.data.photos) {
      const decoded: LocalPhoto = {
        id: item.id,
        mimeType: item.mimeType,
        width: item.width,
        height: item.height,
        sizeBytes: item.sizeBytes,
        createdAt: item.createdAt,
        blob: base64ToBlob(item.base64, item.mimeType)
      };
      store(STORE_NAMES.photos).put(decoded);
    }

    for (const item of backup.data.photoLinks) store(STORE_NAMES.photoLinks).put(item);
    for (const item of backup.data.meta) store(STORE_NAMES.meta).put(item);
  });

  const integrity = await checkReferentialIntegrity();
  if (!integrity.ok) {
    throw new Error(`Integrity check failed after restore: ${integrity.violations.length} issue(s)`);
  }

  await metaRepository.set('lastRestoreAt', new Date().toISOString());

  return { stats };
};

export const previewBackup = async (file: File): Promise<{ backup: LocalFirstBackupFile; stats: LocalStoreStatistics }> => {
  const raw = await file.text();
  const parsed = JSON.parse(raw) as unknown;
  const backup = assertValidBackupPayload(parsed);
  return { backup, stats: collectStoreStatistics(backup.data) };
};
