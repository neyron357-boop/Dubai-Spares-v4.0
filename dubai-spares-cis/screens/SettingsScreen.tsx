import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { offlineDb } from '../storage/offlineDb';
import { backupUpload, clearPublicQuoteSnapshots, clearServerBackups, deletePublicQuoteSnapshot, listPublicQuoteSnapshots } from '../serverApi';
import { cloudBuildGuardMessage, isCloudConfigured, SUPABASE_URL } from '../cloudConfig';
import { AppSettings, useAppSettings } from '../appSettings';
import { testSupabaseConnection } from '../utils/testSupabaseConnection';
import { deleteStorageDuplicateMappings, runStorageImageMaintenance, uploadImageToStorage } from '../storage/photos';
import { Order } from '../types';
import { clearBrokenImageBlacklist, isBrokenImageUrl, markBrokenImageUrl, normalizeBrokenImageKey, shouldBlacklistByStatus } from '../storage/brokenImageBlacklist';

const loadImageFromFile = (file: File): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    URL.revokeObjectURL(url);
    resolve(image);
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error('Не удалось загрузить изображение'));
  };
  image.src = url;
});

const cropSquareFromImage = async (file: File, zoom = 1): Promise<File> => {
  const image = await loadImageFromFile(file);
  const size = Math.max(1, Math.min(image.width, image.height));
  const cropSize = Math.max(1, Math.round(size / Math.max(zoom, 1)));
  const startX = Math.max(0, Math.round((image.width - cropSize) / 2));
  const startY = Math.max(0, Math.round((image.height - cropSize) / 2));
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 640;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas недоступен');
  ctx.drawImage(image, startX, startY, cropSize, cropSize, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((value) => resolve(value), 'image/jpeg', 0.9);
  });
  if (!blob) throw new Error('Не удалось подготовить логотип');
  return new File([blob], `logo-cropped-${Date.now()}.jpg`, { type: 'image/jpeg' });
};

const normalizePhotoKey = (url: string) => {
  const trimmed = String(url || '').trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.pathname.includes('/storage/v1/object/public/')) {
      parsed.searchParams.delete('width');
      parsed.searchParams.delete('quality');
      parsed.searchParams.delete('format');
    }
    return parsed.toString();
  } catch {
    return trimmed;
  }
};

const dedupePhotos = (photos: string[]) => {
  const seen = new Set<string>();
  const next: string[] = [];
  photos.forEach((photo) => {
    const normalized = normalizePhotoKey(photo);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    next.push(photo);
  });
  return next;
};

const remapOrderPhotoUrls = (order: Order, replacements: Map<string, string>): Order => {
  const mapUrl = (url: string | undefined) => replacements.get(normalizePhotoKey(url || '')) || (url || '');
  const carPhotos = dedupePhotos((order.carPhotos || []).map((url) => mapUrl(url)));
  const notes = (order.notes || []).map((note) => ({ ...note, photos: dedupePhotos((note.photos || []).map((url) => mapUrl(url))) }));
  const parts = (order.parts || []).map((part) => {
    const partPhotos = dedupePhotos((part.photos || []).map((url) => mapUrl(url)));
    const variants = (part.variants || []).map((variant) => {
      const photos = dedupePhotos((variant.photos || []).map((url) => mapUrl(url)));
      return { ...variant, photos, photoUrl: photos[0] || '' };
    });
    return { ...part, photos: partPhotos, photoUrl: partPhotos[0] || '', variants };
  });

  return {
    ...order,
    carPhotos,
    carPhotoUrl: carPhotos[0] || '',
    vinPhotoUrl: mapUrl(order.vinPhotoUrl || ''),
    notes,
    parts
  };
};



const collectOrderPhotoUrls = (order: Order): string[] => {
  const urls = new Set<string>();
  const add = (url?: string | null) => {
    const value = String(url || '').trim();
    if (!/^https?:\/\//i.test(value)) return;
    urls.add(value);
  };

  add(order.carPhotoUrl);
  add(order.vinPhotoUrl);
  (order.carPhotos || []).forEach(add);
  (order.notes || []).forEach((note) => (note.photos || []).forEach(add));
  (order.parts || []).forEach((part) => {
    add(part.photoUrl);
    (part.photos || []).forEach(add);
    (part.variants || []).forEach((variant) => {
      add(variant.photoUrl);
      (variant.photos || []).forEach(add);
    });
  });

  return Array.from(urls);
};

const removeBrokenPhotosFromOrder = (order: Order): { next: Order; removed: number } => {
  let removed = 0;
  const filterPhotos = (photos: string[] = []) => photos.filter((url) => {
    const broken = isBrokenImageUrl(url);
    if (broken) removed += 1;
    return !broken;
  });

  const carPhotos = dedupePhotos(filterPhotos(order.carPhotos || []));
  const notes = (order.notes || []).map((note) => ({ ...note, photos: dedupePhotos(filterPhotos(note.photos || [])) }));
  const parts = (order.parts || []).map((part) => {
    const partPhotos = dedupePhotos(filterPhotos(part.photos || []));
    const variants = (part.variants || []).map((variant) => {
      const photos = dedupePhotos(filterPhotos(variant.photos || []));
      return { ...variant, photos, photoUrl: photos[0] || '' };
    });
    return { ...part, photos: partPhotos, photoUrl: partPhotos[0] || '', variants };
  });

  const carPhotoUrl = isBrokenImageUrl(order.carPhotoUrl || '') ? '' : (order.carPhotoUrl || (carPhotos[0] || ''));
  const vinPhotoUrl = isBrokenImageUrl(order.vinPhotoUrl || '') ? '' : (order.vinPhotoUrl || '');
  if (!carPhotoUrl && order.carPhotoUrl) removed += 1;
  if (!vinPhotoUrl && order.vinPhotoUrl) removed += 1;

  return {
    next: { ...order, carPhotos, carPhotoUrl: carPhotoUrl || carPhotos[0] || '', vinPhotoUrl, notes, parts },
    removed
  };
};

const Section: React.FC<{ title: string; children: React.ReactNode; tone?: 'default' | 'danger' }> = ({ title, children, tone = 'default' }) => (
  <section className={`rounded-2xl border p-4 space-y-3 ${tone === 'danger' ? 'border-rose-200 bg-rose-50' : 'border-gray-200 bg-white'}`}>
    <h2 className={`text-sm font-black ${tone === 'danger' ? 'text-rose-700' : 'text-gray-900'}`}>{title}</h2>
    {children}
  </section>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="space-y-1.5 min-w-0">
    <label className="text-xs font-bold text-gray-700">{label}</label>
    {children}
  </div>
);

const SettingsScreen: React.FC = () => {
  const publicRequestFormUrl = `${window.location.origin}${window.location.pathname}#/request`;
  const navigate = useNavigate();
  const { settings, updateSettings } = useAppSettings();
  const { orders, updateOrder, restoreData, exportData, fetchOrders } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [draftSettings, setDraftSettings] = useState<AppSettings>(settings);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [serverStatus, setServerStatus] = useState<'available' | 'unavailable'>(() => (isCloudConfigured ? 'available' : 'unavailable'));
  const [backupProgress, setBackupProgress] = useState(0);
  const [backupController, setBackupController] = useState<AbortController | null>(null);
  const [lastBackupId, setLastBackupId] = useState('');
  const [snapshotRows, setSnapshotRows] = useState<Array<{ id: string; token: string; snapshot_id?: string | null; expires_at: string; created_at?: string | null; order_id?: string | null; payload_json?: unknown }>>([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [snapshotNotice, setSnapshotNotice] = useState<string | null>(null);
  const [dangerActionProgress, setDangerActionProgress] = useState<{ label: string; processed: number; total: number; details?: string } | null>(null);
  const [logoCrop, setLogoCrop] = useState<{ file: File; previewUrl: string } | null>(null);
  const [logoCropZoom, setLogoCropZoom] = useState(1);

  const timezoneList = useMemo(() => ['Asia/Dubai', 'UTC', 'Europe/Moscow'], []);


  useEffect(() => {
    document.documentElement.lang = settings.appLanguage;
  }, [settings.appLanguage]);

  useEffect(() => {
    setDraftSettings(settings);
  }, [settings]);



  const updateDraft = (patch: Partial<AppSettings>) => {
    setDraftSettings((prev) => ({ ...prev, ...patch }));
    setSaveNotice(null);
  };

  const hasUnsavedChanges = useMemo(() => JSON.stringify(draftSettings) !== JSON.stringify(settings), [draftSettings, settings]);

  const saveChanges = () => {
    updateSettings(draftSettings);
    setSaveNotice('Изменения сохранены и применены во всех разделах.');
  };


  const buildCompactBackupPayload = () => {
    const raw = exportData();
    return {
      ...raw,
      orders: (raw.orders || []).map((order: any) => ({
        ...order,
        carPhotoUrl: '',
        carPhotos: [],
        vinPhotoUrl: '',
        parts: (order.parts || []).map((part: any) => ({
          ...part,
          photoUrl: '',
          photos: [],
          variants: (part.variants || []).map((variant: any) => ({
            ...variant,
            photoUrl: '',
            photos: []
          }))
        }))
      }))
    };
  };

  const withBusy = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setDangerActionProgress(null);
    try {
      await fn();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Cloud action failed';
      alert(`${message}. Use "Copy diagnostics" and retry.`);
    } finally {
      setBusy(null);
    }
  };

  const clearApplicationCache = async () => {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }

    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }

    if ('indexedDB' in window && typeof indexedDB.databases === 'function') {
      const databases = await indexedDB.databases();
      await Promise.all((databases || [])
        .map((database) => database?.name)
        .filter((name): name is string => typeof name === 'string' && name.length > 0)
        .map((name) => new Promise<void>((resolve) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = () => resolve();
          request.onerror = () => resolve();
          request.onblocked = () => resolve();
        })));
    }

    window.sessionStorage.clear();
    window.localStorage.clear();
  };



  const handleExportLocalBackup = () => {
    try {
      const data = exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `dubai_spares_backup_${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Export failed';
      alert(`Не удалось экспортировать бэкап: ${message}`);
    }
  };

  const handleCompressAllServerPhotos = () => void withBusy('storage-compress-all', async () => {
    const first = window.confirm('Сжать ВСЕ фотографии на сервере до минимального размера? Это может занять много времени.');
    if (!first) return;

    const result = await runStorageImageMaintenance({
      recompressAll: true,
      onProgress: (progress) => {
        setDangerActionProgress({
          label: 'Сжатие фото на сервере',
          processed: progress.processed,
          total: progress.total,
          details: progress.currentPath
        });
      }
    });
    const mbSaved = (result.bytesSaved / (1024 * 1024)).toFixed(2);
    const tone = result.failures > 0 ? 'warning' : 'success';
    window.dispatchEvent(new CustomEvent('app-toast', {
      detail: {
        tone,
        message: `Сжато: ${result.compressed}, проверено фото: ${result.imageFiles}, экономия: ${mbSaved} MB${result.failures > 0 ? `, ошибок: ${result.failures}` : ''}`
      }
    }));
  });

  const handleRemovePhotoDuplicates = () => void withBusy('storage-delete-duplicates', async () => {
    const first = window.confirm('Удалить дубликаты фото по идентичному содержимому и автоматически переназначить ссылки во всех заказах?');
    if (!first) return;

    const result = await runStorageImageMaintenance({
      deduplicateByExactSize: true,
      applyDedupDeletes: false,
      onProgress: (progress) => {
        setDangerActionProgress({
          label: 'Поиск дубликатов фото',
          processed: progress.processed,
          total: progress.total,
          details: progress.currentPath
        });
      }
    });

    const replacements = new Map<string, string>();
    result.dedupMappings.forEach((mapping) => {
      const duplicatePublic = `${SUPABASE_URL}/storage/v1/object/public/${mapping.bucket}/${mapping.duplicatePath}`;
      const canonicalPublic = `${SUPABASE_URL}/storage/v1/object/public/${mapping.bucket}/${mapping.canonicalPath}`;
      replacements.set(normalizePhotoKey(duplicatePublic), canonicalPublic);
    });

    let updatedOrders = 0;
    for (let index = 0; index < orders.length; index++) {
      const order = orders[index];
      const remapped = remapOrderPhotoUrls(order, replacements);
      if (JSON.stringify(remapped) === JSON.stringify(order)) continue;
      setDangerActionProgress({ label: 'Обновление ссылок в заказах', processed: index + 1, total: orders.length, details: order.id });
      await updateOrder(remapped);
      updatedOrders += 1;
    }

    const deleteResult = await deleteStorageDuplicateMappings(
      result.dedupMappings.map((mapping) => ({ bucket: mapping.bucket, duplicatePath: mapping.duplicatePath })),
      (progress) => setDangerActionProgress({
        label: 'Удаление дубликатов на сервере',
        processed: progress.processed,
        total: progress.total,
        details: progress.path
      })
    );

    const mbSaved = (result.bytesSaved / (1024 * 1024)).toFixed(2);
    const tone = (result.failures + deleteResult.failures) > 0 ? 'warning' : 'success';
    window.dispatchEvent(new CustomEvent('app-toast', {
      detail: {
        tone,
        message: `Удалено дубликатов: ${deleteResult.deleted}, проверено фото: ${result.imageFiles}, обновлено заказов: ${updatedOrders}, освобождено: ${mbSaved} MB${(result.failures + deleteResult.failures) > 0 ? `, ошибок: ${result.failures + deleteResult.failures}` : ''}`
      }
    }));
  });

  const handleClearBrokenLinks = () => void withBusy('clear-broken-links', async () => {
    let updatedOrders = 0;
    let removedLinks = 0;

    for (let index = 0; index < orders.length; index += 1) {
      const order = orders[index];
      const { next, removed } = removeBrokenPhotosFromOrder(order);
      if (!removed) continue;
      setDangerActionProgress({ label: 'Очистка битых ссылок', processed: index + 1, total: orders.length, details: order.id });
      await updateOrder(next);
      updatedOrders += 1;
      removedLinks += removed;
    }

    window.dispatchEvent(new CustomEvent('app-toast', {
      detail: {
        tone: 'success',
        message: `Очистка завершена: обновлено заказов ${updatedOrders}, удалено ссылок ${removedLinks}`
      }
    }));
  });

  const handleCheckAndCleanBrokenPhotos = () => void withBusy('check-clean-broken-photos', async () => {
    const input = window.prompt('Сколько последних заказов проверить?', '50');
    const limit = Math.max(1, Math.min(300, Number(input) || 50));
    const sorted = [...orders].sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));
    const targetOrders = sorted.slice(0, limit);

    const queue = new Set<string>();
    targetOrders.forEach((order) => collectOrderPhotoUrls(order).forEach((url) => queue.add(url)));
    const urls = Array.from(queue).filter((url) => !isBrokenImageUrl(url));

    let checked = 0;
    const concurrency = 4;
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, async () => {
      while (cursor < urls.length) {
        const current = cursor;
        cursor += 1;
        const url = urls[current];
        setDangerActionProgress({ label: 'Проверка битых фото', processed: checked, total: urls.length, details: normalizeBrokenImageKey(url).slice(0, 90) });
        try {
          const response = await fetch(url, { method: 'GET' });
          if (!response.ok && shouldBlacklistByStatus(response.status)) {
            markBrokenImageUrl(url);
          }
        } catch {
          markBrokenImageUrl(url);
        } finally {
          checked += 1;
        }
      }
    }));

    let updatedOrders = 0;
    let removedLinks = 0;
    for (let index = 0; index < targetOrders.length; index += 1) {
      const order = targetOrders[index];
      const { next, removed } = removeBrokenPhotosFromOrder(order);
      if (!removed) continue;
      setDangerActionProgress({ label: 'Сохранение очищенных заказов', processed: index + 1, total: targetOrders.length, details: order.id });
      await updateOrder(next);
      updatedOrders += 1;
      removedLinks += removed;
    }

    window.dispatchEvent(new CustomEvent('app-toast', {
      detail: {
        tone: 'success',
        message: `Проверено фото: ${urls.length}, обновлено заказов: ${updatedOrders}, удалено ссылок: ${removedLinks}`
      }
    }));
  });





  const uploadBrandingImage = async (file: File, type: 'logo' | 'signature') => {
    const folder = type === 'logo' ? 'branding/logos' : 'branding/signatures';
    const fileName = `${type}-${Date.now()}`;
    const uploadedUrl = await uploadImageToStorage(file, folder, fileName);
    if (!uploadedUrl) throw new Error('Не удалось загрузить изображение');
    if (type === 'logo') {
      updateDraft({ publicCompanyLogoUrl: uploadedUrl });
    } else {
      updateDraft({ publicInvoiceSignatureUrl: uploadedUrl });
    }
  };

  const handleBrandingFileChange = (event: React.ChangeEvent<HTMLInputElement>, type: 'logo' | 'signature') => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (type === 'logo') {
      const previewUrl = URL.createObjectURL(file);
      setLogoCrop((prev) => {
        if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
        return { file, previewUrl };
      });
      setLogoCropZoom(1);
      return;
    }
    void withBusy(`branding-${type}`, async () => {
      await uploadBrandingImage(file, type);
      window.dispatchEvent(new CustomEvent('app-toast', {
        detail: {
          tone: 'success',
          message: type === 'logo' ? 'Логотип загружен' : 'Подпись загружена'
        }
      }));
    });
  };

  const busyLabel = (label: string, idle: string, running: string) => (busy === label ? running : idle);

  const closeLogoCrop = () => {
    setLogoCrop((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
    setLogoCropZoom(1);
  };

  const saveLogoCrop = () => {
    if (!logoCrop) return;
    void withBusy('branding-logo', async () => {
      const cropped = await cropSquareFromImage(logoCrop.file, logoCropZoom);
      await uploadBrandingImage(cropped, 'logo');
      closeLogoCrop();
      window.dispatchEvent(new CustomEvent('app-toast', {
        detail: {
          tone: 'success',
          message: 'Логотип обрезан и загружен'
        }
      }));
    });
  };

  const loadSnapshots = async () => {
    setSnapshotsLoading(true);
    setSnapshotNotice(null);
    try {
      const result = await listPublicQuoteSnapshots();
      if (!result.ok) {
        setSnapshotRows([]);
        setSnapshotNotice(`Ошибка загрузки снапшотов: ${result.error}`);
        return;
      }
      setSnapshotRows(result.data || []);
      if ((result.data || []).length === 0) {
        setSnapshotNotice('Снапшоты на сервере не найдены.');
      }
    } finally {
      setSnapshotsLoading(false);
    }
  };

  const buildSnapshotPublicKey = (row: { id: string; token: string; snapshot_id?: string | null }) => {
    const token = String(row.token || '').trim();
    const snapshotId = String(row.snapshot_id || row.id || '').trim();
    if (!token) return '';
    return snapshotId ? `${token}.${snapshotId}` : token;
  };

  const buildSnapshotSlug = (row: { payload_json?: unknown; order_id?: string | null }) => {
    const payload = row.payload_json && typeof row.payload_json === 'object' && !Array.isArray(row.payload_json)
      ? row.payload_json as Record<string, unknown>
      : {};
    const order = payload.order && typeof payload.order === 'object' && !Array.isArray(payload.order)
      ? payload.order as Record<string, unknown>
      : {};
    const brand = typeof order.brand === 'string' ? order.brand.trim() : '';
    const model = typeof order.model === 'string' ? order.model.trim() : '';
    const year = typeof order.year === 'string' || typeof order.year === 'number' ? String(order.year).trim() : '';
    const slug = [brand, model, year].filter(Boolean).join('-').replace(/\s+/g, '-').toLowerCase();
    return slug || String(row.order_id || 'quote').trim() || 'quote';
  };

  const buildSnapshotUrl = (row: { id: string; token: string; snapshot_id?: string | null; payload_json?: unknown; order_id?: string | null }) => {
    const key = buildSnapshotPublicKey(row);
    const slug = buildSnapshotSlug(row);
    return `${window.location.origin}${window.location.pathname}#/q/${encodeURIComponent(slug)}${key ? `?k=${encodeURIComponent(key)}` : ''}`;
  };

  const copySnapshotUrl = async (row: { id: string; token: string; snapshot_id?: string | null; payload_json?: unknown; order_id?: string | null }) => {
    const token = buildSnapshotPublicKey(row);
    const url = buildSnapshotUrl(row);
    await navigator.clipboard.writeText(url);
    setSnapshotNotice(`Ссылка скопирована: ${token}`);
  };


const resolveSnapshotCarTitle = (row: { order_id?: string | null; payload_json?: unknown }) => {
  const payload = row.payload_json && typeof row.payload_json === 'object' && !Array.isArray(row.payload_json)
    ? row.payload_json as Record<string, unknown>
    : {};
  const order = payload.order && typeof payload.order === 'object' && !Array.isArray(payload.order)
    ? payload.order as Record<string, unknown>
    : {};
  const brand = typeof order.brand === 'string' ? order.brand.trim() : '';
  const model = typeof order.model === 'string' ? order.model.trim() : '';
  const year = typeof order.year === 'string' || typeof order.year === 'number' ? String(order.year).trim() : '';
  const label = [brand, model, year].filter(Boolean).join(' ');
  if (label) return label;
  if (typeof row.order_id === 'string' && row.order_id.trim()) return `Order ${row.order_id.trim()}`;
  return 'Без названия авто';
};

  const handleSnapshotDelete = async (row: { id: string; token: string; snapshot_id?: string | null }) => {
    const key = String(row.snapshot_id || row.id || row.token || '').trim();
    if (!key) return;
    const result = await deletePublicQuoteSnapshot(key);
    if (!result.ok) {
      setSnapshotNotice(`Не удалось удалить снапшот: ${result.error}`);
      return;
    }
    setSnapshotNotice(result.data?.removed ? 'Снапшот удалён.' : 'Снапшот не найден на сервере.');
    await loadSnapshots();
  };

  useEffect(() => {
    void loadSnapshots();
  }, []);

  useEffect(() => () => {
    if (logoCrop?.previewUrl) URL.revokeObjectURL(logoCrop.previewUrl);
  }, [logoCrop?.previewUrl]);

  return (
    <div className="min-h-full max-w-full overflow-x-hidden bg-gray-50 p-4 pb-24 space-y-4">
      <div>
        <h1 className="text-xl font-black text-gray-900">Настройки</h1>
        <p className="text-xs text-gray-500 mt-1">Рабочая панель владельца: только основные и безопасные действия</p>
      </div>


      <Section title="Основные настройки">
        <div className="space-y-3">
          <Field label="Язык приложения">
            <select value={draftSettings.appLanguage} onChange={(e) => {
              const nextLang = e.target.value as 'ru' | 'en';
              updateDraft({ appLanguage: nextLang });
              updateSettings({ appLanguage: nextLang });
            }} className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
              <option value="ru">RU</option>
              <option value="en">EN</option>
            </select>
          </Field>

          <Field label="Язык WA шаблонов">
            <select value={draftSettings.waTemplateLanguage} onChange={(e) => updateDraft({ waTemplateLanguage: e.target.value as 'ru' | 'en' | 'ar' })} className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
              <option value="ru">RU</option>
              <option value="en">EN</option>
              <option value="ar">AR</option>
            </select>
          </Field>

          <Field label="Валюта">
            <select value={draftSettings.currencyFormat} onChange={(e) => updateDraft({ currencyFormat: e.target.value as 'AED' | 'USD' })} className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
              <option value="AED">AED</option>
              <option value="USD">USD</option>
            </select>
          </Field>

          <Field label="Курс по умолчанию">
            <input
              value={draftSettings.defaultExchangeRate}
              onChange={(e) => updateDraft({ defaultExchangeRate: Number(e.target.value) || 0 })}
              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
              type="number"
              step="0.01"
            />
          </Field>

          <Field label="Часовой пояс">
            <div className="space-y-2">
              <select value={draftSettings.timezoneMode} onChange={(e) => updateDraft({ timezoneMode: e.target.value as 'auto' | 'manual' })} className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="auto">Auto</option>
                <option value="manual">Manual</option>
              </select>
              {draftSettings.timezoneMode === 'manual' && (
                <select value={draftSettings.manualTimezone || timezoneList[0]} onChange={(e) => updateDraft({ manualTimezone: e.target.value })} className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
                  {timezoneList.map((tz) => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </select>
              )}
            </div>
          </Field>

          <label className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-3 py-2">
            <span className="text-sm font-bold text-gray-800">Field Focus Mode</span>
            <input
              type="checkbox"
              checked={draftSettings.fieldFocusMode}
              onChange={(e) => updateDraft({ fieldFocusMode: e.target.checked })}
              className="h-4 w-4"
            />
          </label>

          <label className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-3 py-2">
            <div>
              <span className="text-sm font-bold text-gray-800">Звуки интерфейса</span>
              <p className="text-xs text-gray-500">Тапы, переходы, уведомления, сохранение</p>
            </div>
            <input
              type="checkbox"
              checked={draftSettings.soundsEnabled !== false}
              onChange={(e) => updateDraft({ soundsEnabled: e.target.checked })}
              className="h-4 w-4"
            />
          </label>
        </div>
      </Section>

      {logoCrop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-4 space-y-3 shadow-xl">
            <p className="text-sm font-black text-gray-900">Обрезка логотипа (квадрат)</p>
            <div className="mx-auto h-52 w-52 overflow-hidden rounded-2xl border border-gray-200 bg-gray-50">
              <img src={logoCrop.previewUrl} alt="Logo crop preview" className="h-full w-full object-cover" style={{ transform: `scale(${logoCropZoom})` }} />
            </div>
            <label className="text-xs font-semibold text-gray-600">Масштаб: {logoCropZoom.toFixed(2)}x</label>
            <input type="range" min={1} max={2.5} step={0.05} value={logoCropZoom} onChange={(event) => setLogoCropZoom(Number(event.target.value) || 1)} className="w-full" />
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={closeLogoCrop} className="rounded-xl border border-gray-300 px-3 py-2 text-xs font-bold text-gray-700">Отмена</button>
              <button type="button" onClick={saveLogoCrop} className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white">Обрезать и загрузить</button>
            </div>
          </div>
        </div>
      )}

      <Section title="Ссылка для клиента">
        <p className="text-xs text-gray-600">Отправьте эту ссылку клиенту — он заполняет форму, и вы получаете новый лид в разделе «Заказы»:</p>
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={publicRequestFormUrl}
            className="flex-1 min-w-0 rounded-xl border border-gray-300 bg-gray-50 px-3 py-2 text-xs font-mono truncate"
          />
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(publicRequestFormUrl);
              window.dispatchEvent(new CustomEvent('app-toast', { detail: { message: 'Ссылка скопирована', tone: 'success' } }));
            }}
            className="shrink-0 rounded-xl bg-blue-600 text-white px-3 py-2 text-sm font-bold"
          >
            Копировать
          </button>
          <button
            type="button"
            onClick={() => window.open(publicRequestFormUrl, '_blank', 'noopener,noreferrer')}
            className="shrink-0 rounded-xl border border-blue-200 bg-blue-50 text-blue-700 px-3 py-2 text-sm font-bold"
          >
            Открыть
          </button>
        </div>
      </Section>

      <Section title="Публичные контакты">
        <div className="space-y-3">
          <Field label="WhatsApp номер для ссылки в заявке и смете">
            <input
              value={draftSettings.publicWhatsappNumber}
              onChange={(e) => updateDraft({ publicWhatsappNumber: e.target.value.replace(/[^\d]/g, '') })}
              placeholder="971521574546"
              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
            />
          </Field>

          <Field label="Telegram ссылка">
            <input
              value={draftSettings.publicTelegramUrl}
              onChange={(e) => updateDraft({ publicTelegramUrl: e.target.value.trim() })}
              placeholder="https://t.me/your_account"
              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
            />
          </Field>

          <Field label="Instagram ссылка">
            <input
              value={draftSettings.publicInstagramUrl}
              onChange={(e) => updateDraft({ publicInstagramUrl: e.target.value.trim() })}
              placeholder="https://instagram.com/your_account"
              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
            />
          </Field>

          <Field label="Логотип компании (для публичной сметы и формы заявки)">
            <div className="space-y-2">
              <input
                type="file"
                accept="image/*"
                onChange={(event) => handleBrandingFileChange(event, 'logo')}
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
              />
              {draftSettings.publicCompanyLogoUrl && (
                <div className="space-y-2">
                  <img src={draftSettings.publicCompanyLogoUrl} alt="Company logo" className="h-16 w-auto rounded-lg border border-gray-200 bg-gray-50 p-1" />
                  <button type="button" onClick={() => updateDraft({ publicCompanyLogoUrl: '' })} className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-700">Удалить логотип</button>
                </div>
              )}
            </div>
          </Field>

          <Field label="Подпись владельца (для invoice)">
            <div className="space-y-2">
              <input
                type="file"
                accept="image/*"
                onChange={(event) => handleBrandingFileChange(event, 'signature')}
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
              />
              {draftSettings.publicInvoiceSignatureUrl && (
                <div className="space-y-2">
                  <img src={draftSettings.publicInvoiceSignatureUrl} alt="Owner signature" className="h-16 w-auto rounded-lg border border-gray-200 bg-gray-50 p-1" />
                  <button type="button" onClick={() => updateDraft({ publicInvoiceSignatureUrl: '' })} className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-700">Удалить подпись</button>
                </div>
              )}
            </div>
          </Field>

          <Field label="Условия доставки (для сметы клиенту)">
            <textarea
              value={draftSettings.publicDeliveryTerms}
              onChange={(e) => updateDraft({ publicDeliveryTerms: e.target.value })}
              placeholder="Например: Доставка 3-8 рабочих дней после подтверждения и оплаты."
              className="min-h-20 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
              rows={4}
            />
          </Field>

          <Field label="Условия работы (для сметы клиенту)">
            <textarea
              value={draftSettings.publicWorkTerms}
              onChange={(e) => updateDraft({ publicWorkTerms: e.target.value })}
              placeholder="Например: Проверка наличия/цены перед оплатой, фото-отчёт перед отправкой."
              className="min-h-20 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
              rows={4}
            />
          </Field>
        </div>
      </Section>

      <Section title="Локальный режим">
        <div className="text-sm text-gray-700 space-y-1">
          <p>Режим: <b>LOCAL</b></p>
          <p>Server: {serverStatus === 'available' ? 'available' : 'unavailable'}</p>
          {!isCloudConfigured && <p className="text-rose-600">{cloudBuildGuardMessage}</p>}
        </div>

        <div className="flex flex-col gap-2">
          <button
            className="w-full rounded-xl bg-blue-600 text-white px-3 py-2 font-black text-sm disabled:opacity-50"
            type="button"
            disabled={!!backupController || !isCloudConfigured}
            onClick={() => void withBusy('backup-upload', async () => {
              const controller = new AbortController();
              setBackupController(controller);
              setBackupProgress(15);
              try {
                const payload = buildCompactBackupPayload();
                const uploaded = await backupUpload(payload, { signal: controller.signal });
                if (!uploaded.ok) {
                  setServerStatus('unavailable');
                  throw new Error(uploaded.error);
                }
                setLastBackupId(uploaded.data.backupId);
                setServerStatus('available');
                setBackupProgress(100);
              } catch (error) {
                throw new Error(error instanceof Error ? error.message : 'Backup upload failed');
              } finally {
                window.setTimeout(() => setBackupProgress(0), 600);
                setBackupController(null);
              }
            })}
          >
            Backup now
          </button>

          {backupController && (
            <button className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-bold" type="button" onClick={() => backupController.abort('user-cancelled')}>
              Cancel backup
            </button>
          )}

          <div className="h-2 overflow-hidden rounded-full bg-gray-200">
            <div className="h-full bg-blue-600 transition-all" style={{ width: `${backupProgress}%` }} />
          </div>

          <div className="flex gap-2">
            <input
              value={lastBackupId}
              onChange={(e) => setLastBackupId(e.target.value.trim())}
              placeholder="Backup ID"
              className="flex-1 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
            />
            <button
              className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-bold disabled:opacity-50"
              type="button"
              disabled={!lastBackupId || !!backupController}
              onClick={() => void withBusy('backup-restore', async () => {
                const controller = new AbortController();
                setBackupController(controller);
                try {
                  const backup = await backupUpload({}, { mode: 'restore', backupId: lastBackupId, signal: controller.signal, timeoutMs: 45000 });
                  if (!backup.ok || !backup.data.payload) throw new Error(backup.ok ? 'Backup payload missing' : backup.error);
                  await offlineDb.importAllData(backup.data.payload);
                  if ((backup.data.payload as any)?.orders) restoreData({ orders: (backup.data.payload as any).orders, suppliers: [] });
                  setServerStatus('available');
                } finally {
                  setBackupController(null);
                }
              })}
            >
              Restore by ID
            </button>
          </div>

          <button type="button" className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-bold" onClick={handleExportLocalBackup}>Экспорт локального бэкапа</button>

          <label className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-center text-sm font-bold cursor-pointer">Restore from backup
            <input type="file" accept="application/json" className="hidden" onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              void withBusy('import', async () => {
                const raw = await file.text();
                const parsed = JSON.parse(raw);
                await offlineDb.importAllData(parsed);
                if (parsed.orders) restoreData({ orders: parsed.orders, suppliers: [] });
              });
            }} />
          </label>
        </div>

        <button
          type="button"
          onClick={() => void withBusy('cloud-test', async () => {
            const result = await testSupabaseConnection();
            if (!result.success) throw new Error('Supabase test connection failed');
          })}
          disabled={!isCloudConfigured || busy === 'cloud-test'}
          className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-bold disabled:opacity-50"
        >
          Test Connection
        </button>

        <button
          type="button"
          onClick={() => navigate('/debug')}
          className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-bold"
        >
          Логи
        </button>
      </Section>

      <Section title="Snapshots (публичные сметы)">
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-bold disabled:opacity-50"
            onClick={() => void loadSnapshots()}
            disabled={snapshotsLoading}
          >
            {snapshotsLoading ? 'Обновляем…' : 'Обновить список'}
          </button>
          <span className="text-xs text-gray-500 self-center">Всего: {snapshotRows.length}</span>
        </div>
        {snapshotNotice && <p className="text-xs text-gray-600">{snapshotNotice}</p>}
        <div className="max-h-72 overflow-auto rounded-xl border border-gray-200 bg-gray-50">
          {snapshotRows.length === 0 ? (
            <p className="p-3 text-xs text-gray-500">Список пуст.</p>
          ) : (
            <ul className="divide-y divide-gray-200">
              {snapshotRows.map((row) => {
                const identity = row.snapshot_id || row.id;
                return (
                  <li key={`${row.id}:${row.token}`} className="p-3 space-y-2">
                    <div className="text-[11px] text-gray-700 break-all">
                      <p><span className="font-bold text-gray-900">ID:</span> {identity}</p>
                      <p><span className="font-bold text-gray-900">Авто:</span> {resolveSnapshotCarTitle(row)}</p>
                      <p><span className="font-bold text-gray-900">Token:</span> {row.token}</p>
                      <p><span className="font-bold text-gray-900">Expires:</span> {row.expires_at}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <a href={buildSnapshotUrl(row)} target="_blank" rel="noreferrer" className="rounded-lg border border-blue-300 bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700">Открыть</a>
                      <button type="button" className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs font-bold" onClick={() => void copySnapshotUrl(row)}>Копировать ссылку</button>
                      <button type="button" className="rounded-lg border border-rose-300 bg-white px-2 py-1 text-xs font-bold text-rose-700" onClick={() => void handleSnapshotDelete(row)}>Удалить</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Section>

      <Section title="Опасные действия" tone="danger">
        <div className="text-xs text-rose-700">Изменения ниже могут удалить локальные данные и требуют подтверждения.</div>
        <div className="flex flex-col gap-2 text-sm">
          <button className="w-full rounded-xl border border-rose-300 bg-white text-rose-700 px-3 py-2 font-black disabled:opacity-50" type="button" disabled={!!busy} onClick={handleCompressAllServerPhotos}>{busyLabel('storage-compress-all', 'Сжать все фото на сервере до минимума', 'Сжимаем фото…')}</button>
          <button className="w-full rounded-xl border border-rose-300 bg-white text-rose-700 px-3 py-2 font-black disabled:opacity-50" type="button" disabled={!!busy} onClick={handleRemovePhotoDuplicates}>{busyLabel('storage-delete-duplicates', 'Удалить дубликаты фото', 'Обработка дубликатов…')}</button>
          <button className="w-full rounded-xl border border-rose-300 bg-white text-rose-700 px-3 py-2 font-black disabled:opacity-50" type="button" disabled={!!busy} onClick={handleCheckAndCleanBrokenPhotos}>{busyLabel('check-clean-broken-photos', 'Проверить и очистить битые фото', 'Проверяем битые фото…')}</button>
          <button className="w-full rounded-xl border border-rose-300 bg-white text-rose-700 px-3 py-2 font-black disabled:opacity-50" type="button" disabled={!!busy} onClick={handleClearBrokenLinks}>{busyLabel('clear-broken-links', 'Очистить битые ссылки', 'Очищаем битые ссылки…')}</button>
          <button className="w-full rounded-xl border border-rose-300 bg-white text-rose-700 px-3 py-2 font-black disabled:opacity-50" type="button" disabled={!!busy} onClick={() => { clearBrokenImageBlacklist(); window.dispatchEvent(new CustomEvent('app-toast', { detail: { message: 'Локальный blacklist битых фото очищен', tone: 'success' } })); }}>Очистить blacklist битых фото</button>
          <button className="w-full rounded-xl border border-rose-300 bg-white text-rose-700 px-3 py-2 font-black disabled:opacity-50" type="button" disabled={!!busy} onClick={() => void withBusy('cache', async () => {
            await clearApplicationCache();
            window.dispatchEvent(new CustomEvent('app-toast', { detail: { message: 'Кэш приложения очищен. Перезагрузите страницу.', tone: 'success' } }));
          })}>{busyLabel('cache', 'Очистить кэш', 'Очистка кэша…')}</button>
          <button className="w-full rounded-xl border border-rose-300 bg-rose-600 text-white px-3 py-2 font-black disabled:opacity-50" type="button" disabled={!!busy} onClick={() => void withBusy('offline-data', async () => {
            const first = window.confirm('⚠️ Это удалит локальные офлайн данные. Продолжить?');
            if (!first) return;
            const second = window.prompt('Введите DELETE для подтверждения');
            if (second !== 'DELETE') return;
            await offlineDb.clearAllOfflineData();
          })}>{busyLabel('offline-data', 'Очистить офлайн данные', 'Очистка офлайн данных…')}</button>
          <button className="w-full rounded-xl border border-rose-300 bg-white text-rose-700 px-3 py-2 font-black disabled:opacity-50" type="button" disabled={!!busy} onClick={() => void withBusy('public-snapshots', async () => {
            const result = await clearPublicQuoteSnapshots();
            const message = result.ok ? 'Серверные снапшоты смет очищены' : `Ошибка: ${result.error}`;
            const tone = result.ok ? 'success' : 'error';
            window.dispatchEvent(new CustomEvent('app-toast', { detail: { message, tone } }));
          })}>{busyLabel('public-snapshots', 'Очистить снапшоты публичных смет на сервере', 'Очистка снапшотов…')}</button>
          <button className="w-full rounded-xl border border-rose-300 bg-white text-rose-700 px-3 py-2 font-black disabled:opacity-50" type="button" disabled={!!busy} onClick={() => void withBusy('server-backups', async () => {
            const first = window.confirm('⚠️ Это удалит ВСЕ backup записи на сервере. Продолжить?');
            if (!first) return;
            const second = window.prompt('Введите DELETE BACKUPS для подтверждения');
            if (second !== 'DELETE BACKUPS') return;
            const result = await clearServerBackups();
            const message = result.ok ? 'Все серверные backup записи удалены' : `Ошибка: ${result.error}`;
            const tone = result.ok ? 'success' : 'error';
            window.dispatchEvent(new CustomEvent('app-toast', { detail: { message, tone } }));
          })}>{busyLabel('server-backups', 'Очистить все backup записи на сервере', 'Удаление backup…')}</button>
          <button className="w-full rounded-xl border border-rose-300 bg-white text-rose-700 px-3 py-2 font-black disabled:opacity-50" type="button" disabled={!!busy} onClick={() => void withBusy('index', async () => {
            await offlineDb.exportAllData();
          })}>{busyLabel('index', 'Перестроить индекс', 'Перестраиваем индекс…')}</button>
        </div>
        {dangerActionProgress && (
          <div className="rounded-xl border border-rose-200 bg-white p-2">
            <p className="text-[11px] font-bold text-rose-700">{dangerActionProgress.label}</p>
            <p className="text-[11px] text-rose-600">{dangerActionProgress.processed} / {dangerActionProgress.total}{dangerActionProgress.details ? ` · ${dangerActionProgress.details}` : ''}</p>
            <div className="mt-1 h-1.5 w-full rounded bg-rose-100 overflow-hidden">
              <div className="h-full bg-rose-500 transition-all" style={{ width: `${dangerActionProgress.total > 0 ? Math.min(100, Math.round((dangerActionProgress.processed / dangerActionProgress.total) * 100)) : 0}%` }} />
            </div>
          </div>
        )}
      </Section>

      <div className="sticky bottom-2 z-30 rounded-2xl border border-gray-200 bg-white/95 p-3 shadow-sm backdrop-blur">
        <button
          type="button"
          onClick={saveChanges}
          disabled={!hasUnsavedChanges}
          className="w-full rounded-xl bg-blue-600 px-3 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          Сохранить изменения
        </button>
        {saveNotice && <p className="mt-1 text-center text-[11px] font-semibold text-emerald-600">{saveNotice}</p>}
      </div>

      {busy && <div className="text-xs text-gray-500">Выполняется: {busy}…</div>}
    </div>
  );
};

export default SettingsScreen;
