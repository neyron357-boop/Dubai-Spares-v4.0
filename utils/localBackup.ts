import { APP_SETTINGS_KEY } from '../appSettings';
import { localDocuments } from '../storage/localDocuments';
import { offlineDb } from '../storage/offlineDb';
import { exportData, restoreDataExternal } from '../store';

const LOCAL_KEYS = [
  APP_SETTINGS_KEY,
  'dubai_spares_suppliers',
  'dubai_spares_standalone_variants',
  'dubai_spares_local_notifications_v2',
  'dubai_spares_read_notification_signatures',
  'dubai_spares_customer_activity_logs_v1',
  'dubai_spares_order_telegram_links_v1',
  'dubai_spares_notification_events_v1',
  'dubai_spares_relevance_state_v1',
  'radar_manual_supplier_parts',
  'shop_order_tags',
];
export const downloadJson = (value: unknown, filename: string) => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
export const createLocalBackup = async () => {
  const dump = await offlineDb.exportAllData();
  const storage: Record<string, string> = {};
  LOCAL_KEYS.forEach((key) => {
    const value = localStorage.getItem(key);
    if (value !== null) storage[key] = value;
  });
  return {
    ...exportData(),
    ...dump,
    format: 'stark-local-backup',
    version: '3.0',
    localStorage: storage,
    documents: await localDocuments.entries(),
  };
};
export type LocalBackup = ReturnType<typeof validateLocalBackup>;
export function validateLocalBackup(value: unknown) {
  if (!value || typeof value !== 'object' || !Array.isArray((value as any).orders))
    throw new Error('Это не резервная копия: отсутствует список заказов.');
  const data = value as Record<string, any>;
  if (
    data.orders.some(
      (order: any) =>
        !order ||
        typeof order.id !== 'string' ||
        !order.id.trim() ||
        !Array.isArray(order.parts) ||
        typeof order.brand !== 'string',
    )
  )
    throw new Error('В файле есть повреждённые заказы. Данные не изменены.');
  if (new Set(data.orders.map((order: any) => order.id)).size !== data.orders.length)
    throw new Error('В файле повторяются идентификаторы заказов.');
  if (
    data.suppliers !== undefined &&
    (!Array.isArray(data.suppliers) ||
      data.suppliers.some(
        (supplier: any) =>
          !supplier || typeof supplier.id !== 'string' || typeof supplier.name !== 'string',
      ))
  )
    throw new Error('В файле есть повреждённые поставщики.');
  if (
    data.localStorage !== undefined &&
    (!data.localStorage ||
      typeof data.localStorage !== 'object' ||
      Array.isArray(data.localStorage))
  )
    throw new Error('Повреждён раздел настроек.');
  if (
    data.documents !== undefined &&
    (!Array.isArray(data.documents) ||
      data.documents.some(
        (entry: any) => !Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string',
      ))
  )
    throw new Error('Повреждён раздел документов.');
  if (data.localStorage)
    for (const key of LOCAL_KEYS) {
      const saved = data.localStorage[key];
      if (
        saved !== undefined &&
        (typeof saved !== 'string' ||
          (() => {
            try {
              JSON.parse(saved);
              return false;
            } catch {
              return true;
            }
          })())
      )
        throw new Error('Повреждены сохранённые настройки.');
    }
  return data;
}
export const restoreLocalBackup = async (value: unknown) => {
  const data = validateLocalBackup(value);
  const before = await createLocalBackup();
  try {
    await offlineDb.importAllData(data);
    if (data.documents) await localDocuments.replace(data.documents);
    if (data.localStorage)
      LOCAL_KEYS.forEach((key) => {
        if (typeof data.localStorage[key] === 'string')
          localStorage.setItem(key, data.localStorage[key]);
      });
    await restoreDataExternal(data);
    window.dispatchEvent(new Event('app-settings-updated'));
    window.dispatchEvent(new Event('local-suppliers-updated'));
  } catch (error) {
    await offlineDb.importAllData(before as unknown as Record<string, unknown[]>);
    await localDocuments.replace(before.documents);
    LOCAL_KEYS.forEach((key) => {
      const original = before.localStorage[key];
      if (original !== undefined) localStorage.setItem(key, original);
      else localStorage.removeItem(key);
    });
    await restoreDataExternal(before);
    throw error;
  }
};
