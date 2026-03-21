import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { offlineDb } from '../storage/offlineDb';
import { backupUpload, clearServerBackups, deletePublicQuoteSnapshot, listPublicQuoteSnapshots } from '../serverApi';
import { cloudBuildGuardMessage, isCloudConfigured, SUPABASE_URL } from '../cloudConfig';
import { AppSettings, useAppSettings } from '../appSettings';
import { testSupabaseConnection } from '../utils/testSupabaseConnection';
import { deleteStorageDuplicateMappings, deleteStorageImageByPublicUrl, listAllStorageImages, recompressExistingStorageImage, runStorageImageMaintenance, uploadFileToStorage, uploadImageToStorage } from '../storage/photos';
import { Order } from '../types';
import { clearBrokenImageBlacklist, isBrokenImageUrl, markBrokenImageUrl, normalizeBrokenImageKey, shouldBlacklistByStatus } from '../storage/brokenImageBlacklist';
import { flushOfflineMutations } from '../orderStore';
import { calculateCargo, calculateCargoEstimates, CargoTariff, DEFAULT_CARGO_TARIFFS } from '../utils/cargo';
import { aiCore } from '../utils/aiCore';

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

const Section: React.FC<{ title: string; children: React.ReactNode; tone?: 'default' | 'danger' }> = ({ title, children, tone = 'default' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const sectionRef = useRef<HTMLElement | null>(null);

  return (
    <section ref={sectionRef} className={`rounded-2xl border p-4 ${tone === 'danger' ? 'border-rose-200 bg-rose-50' : 'border-gray-200 bg-white'}`}>
      <button
        type="button"
        onClick={() => {
          setIsOpen((prev) => {
            const next = !prev;
            if (!prev && next) {
              window.setTimeout(() => sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
            }
            return next;
          });
        }}
        className="w-full flex items-center justify-between gap-3"
      >
        <h2 className={`text-left text-sm font-black ${tone === 'danger' ? 'text-rose-700' : 'text-gray-900'}`}>{title}</h2>
        <span className={`text-xs font-bold ${tone === 'danger' ? 'text-rose-600' : 'text-gray-500'}`}>{isOpen ? 'Скрыть' : 'Открыть'}</span>
      </button>
      {isOpen && <div className="mt-3 space-y-3">{children}</div>}
    </section>
  );
};

const CompactBlock: React.FC<{ title: string; subtitle?: string; children: React.ReactNode }> = ({ title, subtitle, children }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5">
      <button type="button" onClick={() => setIsOpen((prev) => !prev)} className="flex w-full items-center justify-between gap-3 text-left">
        <div>
          <p className="text-sm font-bold text-gray-900">{title}</p>
          {subtitle ? <p className="mt-0.5 text-[11px] text-gray-500">{subtitle}</p> : null}
        </div>
        <span className="text-xs font-bold text-gray-500">{isOpen ? 'Свернуть' : 'Открыть'}</span>
      </button>
      {isOpen ? <div className="mt-3 space-y-3">{children}</div> : null}
    </div>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="space-y-1.5 min-w-0">
    <label className="text-xs font-bold text-gray-700">{label}</label>
    {children}
  </div>
);

const TariffNumberInput: React.FC<{
  value: number;
  placeholder?: string;
  onCommit: (nextValue: number) => void;
}> = ({ value, placeholder, onCommit }) => {
  const [raw, setRaw] = useState(String(value));

  useEffect(() => {
    setRaw(String(value));
  }, [value]);

  const commit = () => {
    onCommit(parseDecimalInput(raw));
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      placeholder={placeholder}
      value={raw}
      onChange={(e) => {
        const next = e.target.value.replace(',', '.');
        if (!/^[0-9]*\.?[0-9]*$/.test(next)) return;
        setRaw(next);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
      className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
    />
  );
};

const toTariffNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseDecimalInput = (value: string, fallback = 0) => {
  const normalized = value.replace(',', '.').trim();
  if (!normalized) return fallback;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const openExternalPage = (url: string) => {
  const normalized = String(url || '').trim();
  if (!normalized) return false;
  try {
    const parsed = new URL(normalized);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    const opened = window.open(parsed.toString(), '_blank');
    return !!opened;
  } catch {
    return false;
  }
};

const normalizeTariff = (tariff: Partial<CargoTariff>): CargoTariff => ({
  country: String(tariff.country || '').trim(),
  airRegularUsdPerKg: toTariffNumber((tariff as any).airRegularUsdPerKg, toTariffNumber((tariff as any).regularUsdPerKg, toTariffNumber((tariff as any).airUsdPerKg))),
  airOversizedUsdPerKg: toTariffNumber((tariff as any).airOversizedUsdPerKg, toTariffNumber((tariff as any).oversizedUsdPerKg, toTariffNumber((tariff as any).airUsdPerKg))),
  containerUsdPerKg: toTariffNumber(tariff.containerUsdPerKg),
  airSeatUsd: toTariffNumber(tariff.airSeatUsd),
  minAirKg: toTariffNumber(tariff.minAirKg),
  minContainerKg: toTariffNumber(tariff.minContainerKg),
  airEtaDays: String(tariff.airEtaDays || '').trim(),
  containerEtaDays: String(tariff.containerEtaDays || '').trim()
});



type GalleryRow = {
  bucket: string;
  path: string;
  size: number;
  mimetype: string;
  publicUrl: string;
  createdAt?: string;
  updatedAt?: string;
};

type GallerySort = 'size_desc' | 'size_asc' | 'date_desc' | 'date_asc' | 'folder';
type GalleryTaskType = 'compress' | 'delete';
type GalleryTask = { id: string; label: string; type: GalleryTaskType; urls: string[]; createdAt: number; progress: number; total: number; done?: boolean; failed?: number };
type AiTestTask = 'analyze_text' | 'transform_text' | 'extract_structured_data';

const GALLERY_TASKS_KEY = 'dubai_spares_gallery_tasks_v1';

const loadGalleryTasks = (): GalleryTask[] => {
  try {
    const raw = localStorage.getItem(GALLERY_TASKS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const LOCKED_SNAPSHOTS_KEY = 'dubai_spares_locked_public_snapshots_v1';

const loadLockedSnapshotIds = (): string[] => {
  try {
    const raw = localStorage.getItem(LOCKED_SNAPSHOTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item || '').trim()).filter(Boolean);
  } catch {
    return [];
  }
};

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
  const [isHardResetting, setIsHardResetting] = useState(false);
  const [logoCrop, setLogoCrop] = useState<{ file: File; previewUrl: string } | null>(null);
  const [logoCropZoom, setLogoCropZoom] = useState(1);
  const [newDefaultChecklistTask, setNewDefaultChecklistTask] = useState('');
  const [newZoneName, setNewZoneName] = useState('');
  const [editingZoneIndex, setEditingZoneIndex] = useState<number | null>(null);
  const [editingZoneValue, setEditingZoneValue] = useState('');
  const [lockedSnapshotIds, setLockedSnapshotIds] = useState<string[]>(() => loadLockedSnapshotIds());
  const [serverGalleryRows, setServerGalleryRows] = useState<GalleryRow[]>([]);
  const [serverGalleryLoading, setServerGalleryLoading] = useState(false);
  const [selectedGalleryKeys, setSelectedGalleryKeys] = useState<string[]>([]);
  const [isGallerySelectionMode, setIsGallerySelectionMode] = useState(false);
  const [isGalleryFullscreen, setIsGalleryFullscreen] = useState(false);
  const [gallerySearch, setGallerySearch] = useState('');
  const [gallerySort, setGallerySort] = useState<GallerySort>('size_desc');
  const [heavyOnly, setHeavyOnly] = useState(false);
  const [folderFilter, setFolderFilter] = useState('all');
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [galleryTasks, setGalleryTasks] = useState<GalleryTask[]>(() => loadGalleryTasks());
  const [aiTestTask, setAiTestTask] = useState<AiTestTask>('analyze_text');
  const [aiTestText, setAiTestText] = useState('Toyota Camry 2020 нужна передняя левая фара, состояние б/у, доставка в Дубай.');
  const [aiTestInstructions, setAiTestInstructions] = useState('Определи ключевые параметры запроса клиента и верни краткий структурированный вывод.');
  const [aiTestOperation, setAiTestOperation] = useState('Сделай короткую деловую версию текста для менеджера.');
  const [aiTestTargetLang, setAiTestTargetLang] = useState('ru');
  const [aiTestTone, setAiTestTone] = useState('professional');
  const [aiTestFormat, setAiTestFormat] = useState('plain_text');
  const [aiTestSchema, setAiTestSchema] = useState('{\n  "brand": "string",\n  "model": "string",\n  "year": "string",\n  "part_name": "string",\n  "condition": "string",\n  "delivery_city": "string"\n}');
  const [aiTestResult, setAiTestResult] = useState<string>('');
  const [aiTestError, setAiTestError] = useState<string | null>(null);

  const timezoneList = useMemo(() => ['Asia/Dubai', 'UTC', 'Europe/Moscow'], []);

  const formatDateTime = (value?: string | null) => {
    const normalized = String(value || '').trim();
    if (!normalized) return '—';
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return normalized;
    return date.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };


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
    const nextSettings = updateSettings(draftSettings);
    const tariffsChanged = JSON.stringify(settings.cargoTariffs || []) !== JSON.stringify(nextSettings.cargoTariffs || []);
    if (tariffsChanged) {
      orders.forEach((currentOrder) => {
        const nextCargo = calculateCargo(currentOrder, nextSettings);
        const nextEstimates = calculateCargoEstimates(currentOrder, nextSettings);
        updateOrder({
          ...currentOrder,
          logistics: {
            ...currentOrder.logistics,
            cargoEtaDays: nextCargo.eta,
            cargoTotalWeightKg: nextCargo.realWeight,
            cargoChargeableWeightKg: nextCargo.chargeableWeight,
            cargoTotalPlaces: nextCargo.totalPlaces,
            cargoBaseCostUsd: nextCargo.baseCostUsd,
            cargoTotalCostUsd: nextCargo.totalCostUsd,
            cargoAirEtaDays: nextEstimates.air.eta,
            cargoAirCostUsd: nextEstimates.air.totalCostUsd,
            cargoContainerEtaDays: nextEstimates.container.eta,
            cargoContainerCostUsd: nextEstimates.container.totalCostUsd
          }
        });
      });
    }
    setSaveNotice('Изменения сохранены и применены во всех разделах.');
  };

  const addDefaultChecklistTask = () => {
    const text = newDefaultChecklistTask.trim();
    if (!text) return;
    const exists = (draftSettings.defaultVendorChecklist || []).some((item) => item.trim().toLowerCase() === text.toLowerCase());
    if (exists) {
      setNewDefaultChecklistTask('');
      return;
    }
    updateDraft({ defaultVendorChecklist: [...(draftSettings.defaultVendorChecklist || []), text] });
    setNewDefaultChecklistTask('');
  };

  const removeDefaultChecklistTask = (index: number) => {
    updateDraft({ defaultVendorChecklist: (draftSettings.defaultVendorChecklist || []).filter((_, idx) => idx !== index) });
  };

  const addZone = () => {
    const name = newZoneName.trim();
    if (!name) return;
    const zones = draftSettings.orderZones || [];
    if (zones.some((z) => z.toLowerCase() === name.toLowerCase())) {
      window.dispatchEvent(new CustomEvent('app-toast', { detail: { message: 'Такая зона уже существует', tone: 'info' } }));
      setNewZoneName('');
      return;
    }
    updateDraft({ orderZones: [...zones, name] });
    setNewZoneName('');
  };

  const removeZone = (index: number) => {
    updateDraft({ orderZones: (draftSettings.orderZones || []).filter((_, idx) => idx !== index) });
  };

  const startEditZone = (index: number) => {
    setEditingZoneIndex(index);
    setEditingZoneValue((draftSettings.orderZones || [])[index] || '');
  };

  const saveEditZone = () => {
    if (editingZoneIndex === null) return;
    const name = editingZoneValue.trim();
    if (!name) { setEditingZoneIndex(null); return; }
    const zones = [...(draftSettings.orderZones || [])];
    zones[editingZoneIndex] = name;
    updateDraft({ orderZones: zones });
    setEditingZoneIndex(null);
    setEditingZoneValue('');
  };

  const cargoTariffs = useMemo(
    () => (draftSettings.cargoTariffs?.length ? draftSettings.cargoTariffs : DEFAULT_CARGO_TARIFFS).map((item) => normalizeTariff(item)),
    [draftSettings.cargoTariffs]
  );

  const updateCargoTariff = (index: number, patch: Partial<CargoTariff>) => {
    const next = cargoTariffs.map((item, idx) => (idx === index ? normalizeTariff({ ...item, ...patch }) : item));
    updateDraft({ cargoTariffs: next });
  };

  const addCargoTariff = () => {
    const template = DEFAULT_CARGO_TARIFFS[0];
    updateDraft({
      cargoTariffs: [...cargoTariffs, normalizeTariff({ ...template, country: '' })]
    });
  };

  const removeCargoTariff = (index: number) => {
    updateDraft({ cargoTariffs: cargoTariffs.filter((_, idx) => idx !== index) });
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

  const runAiCoreTest = async () => {
    setAiTestError(null);
    setAiTestResult('');

    if (!aiTestText.trim()) {
      setAiTestError('Добавьте текст для теста AI ядра.');
      return;
    }

    let response;

    if (aiTestTask === 'analyze_text') {
      response = await aiCore.analyzeText({
        text: aiTestText.trim(),
        instructions: aiTestInstructions.trim() || 'Проанализируй текст и верни полезный результат.'
      });
    } else if (aiTestTask === 'transform_text') {
      response = await aiCore.transformText({
        text: aiTestText.trim(),
        operation: aiTestOperation.trim() || 'Переформулируй текст',
        target_lang: aiTestTargetLang.trim() || undefined,
        tone: aiTestTone.trim() || undefined,
        format: aiTestFormat.trim() || undefined,
        instructions: aiTestInstructions.trim() || undefined
      });
    } else {
      let parsedSchema: Record<string, unknown>;
      try {
        parsedSchema = JSON.parse(aiTestSchema);
      } catch {
        setAiTestError('Схема JSON заполнена некорректно.');
        return;
      }

      response = await aiCore.extractStructuredData({
        text: aiTestText.trim(),
        schema: parsedSchema,
        instructions: aiTestInstructions.trim() || 'Извлеки структуру по схеме.'
      });
    }

    setAiTestResult(JSON.stringify(response, null, 2));
    if (!response.ok) {
      setAiTestError(response.error || 'AI ядро вернуло ошибку.');
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
    const localKeys = Object.keys(window.localStorage);
    localKeys.forEach((key) => window.localStorage.removeItem(key));
  };

  const clearAllLocalDataAndRestart = async () => {
    const first = window.confirm('⚠️ Это полностью очистит кэш, историю и все локальные данные. Продолжить?');
    if (!first) return;

    const pendingBeforeSync = await offlineDb.getMutationCount();
    if (pendingBeforeSync > 0) {
      if (!navigator.onLine) {
        alert(`Найдено ${pendingBeforeSync} несинхронизированных изменений. Подключите интернет и повторите, чтобы сначала отправить их на сервер.`);
        return;
      }

      setDangerActionProgress({
        label: 'Подготовка к очистке',
        processed: 0,
        total: 4,
        details: `Отправляем ${pendingBeforeSync} локальных изменений на сервер`
      });

      await flushOfflineMutations({ force: true });

      const pendingAfterSync = await offlineDb.getMutationCount();
      if (pendingAfterSync > 0) {
        alert(`Не удалось синхронизировать все локальные изменения (${pendingAfterSync} осталось в очереди). Очистка отменена.`);
        return;
      }
    }

    setIsHardResetting(true);
    setDangerActionProgress({ label: 'Очистка приложения', processed: 1, total: 4, details: 'Удаление кэша' });
    await clearApplicationCache();
    setDangerActionProgress({ label: 'Очистка приложения', processed: 2, total: 4, details: 'Удаление оффлайн-данных' });
    await offlineDb.clearAllOfflineData();
    setDangerActionProgress({ label: 'Очистка приложения', processed: 3, total: 4, details: 'Перезапуск приложения' });
    window.location.reload();
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
    const first = window.confirm('Сжать ВСЕ фотографии на сервере: заменить оригиналы сжатыми версиями в том же пути (без потери ссылок)? Это может занять много времени.');
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
        message: `Обновлено (заменено сжатыми): ${result.compressed}, проверено фото: ${result.imageFiles}, экономия: ${mbSaved} MB${result.failures > 0 ? `, ошибок: ${result.failures}` : ''}`
      }
    }));
  });

  const handleRemovePhotoDuplicates = () => void withBusy('storage-delete-duplicates', async () => {
    const first = window.confirm('Удалить только более тяжёлые дубликаты фото (оставить самые лёгкие версии) и автоматически переназначить ссылки во всех заказах?');
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

    const deletedBytes = result.dedupMappings.reduce((sum, mapping) => sum + mapping.size, 0);
    const mbSaved = (deletedBytes / (1024 * 1024)).toFixed(2);
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


  const handleRestoreBrokenPhotos = () => void withBusy('restore-broken-photos', async () => {
    clearBrokenImageBlacklist();
    window.dispatchEvent(new CustomEvent('app-toast', {
      detail: {
        tone: 'success',
        message: 'Кэш битых фото очищен. Приложение повторно попробует загрузить фотографии.'
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

  const handlePublicTermsFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    void withBusy('public-terms-file', async () => {
      const safeName = (file.name || `terms-${Date.now()}`)
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '');
      const uploadName = `${Date.now()}-${safeName || 'terms-file'}`;
      const uploadedUrl = await uploadFileToStorage(file, 'public/terms', uploadName, file.type || 'application/octet-stream');
      updateDraft({
        publicTermsFileUrl: uploadedUrl,
        publicTermsFileName: file.name || uploadName
      });
      window.dispatchEvent(new CustomEvent('app-toast', {
        detail: {
          tone: 'success',
          message: 'Файл условий загружен'
        }
      }));
    });
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

  const toggleSnapshotLock = (row: { id: string; token: string; snapshot_id?: string | null }) => {
    const key = String(row.snapshot_id || row.id || '').trim();
    if (!key) return;
    setLockedSnapshotIds((prev) => {
      const next = prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key];
      localStorage.setItem(LOCKED_SNAPSHOTS_KEY, JSON.stringify(next));
      return next;
    });
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
    const url = new URL(`${window.location.origin}/#/q/${encodeURIComponent(slug)}`);
    if (key) {
      url.searchParams.set('k', key);
    }
    return url.toString();
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
    if (lockedSnapshotIds.includes(key)) {
      setSnapshotNotice('Снапшот в замке. Снимите замок перед удалением.');
      return;
    }
    const result = await deletePublicQuoteSnapshot(key);
    if (!result.ok) {
      setSnapshotNotice(`Не удалось удалить снапшот: ${result.error}`);
      return;
    }
    setSnapshotNotice(result.data?.removed ? 'Снапшот удалён.' : 'Снапшот не найден на сервере.');
    await loadSnapshots();
  };

  const handleClearSnapshotsExceptLocked = async () => {
    const unlocked = snapshotRows.filter((row) => {
      const key = String(row.snapshot_id || row.id || '').trim();
      return key && !lockedSnapshotIds.includes(key);
    });
    let removed = 0;
    for (const row of unlocked) {
      const key = String(row.snapshot_id || row.id || row.token || '').trim();
      if (!key) continue;
      const result = await deletePublicQuoteSnapshot(key);
      if (result.ok && result.data?.removed) removed += 1;
    }
    setSnapshotNotice(`Удалено снапшотов: ${removed}. Защищено замком: ${lockedSnapshotIds.length}.`);
    await loadSnapshots();
  };

  const loadServerGallery = async () => {
    setServerGalleryLoading(true);
    try {
      const rows = await listAllStorageImages();
      const sorted = rows.sort((a, b) => b.size - a.size);
      setServerGalleryRows(sorted);
      setSelectedGalleryKeys((prev) => {
        if (!prev.length) return prev;
        const allowed = new Set(sorted.map((row) => `${row.bucket}:${row.path}`));
        return prev.filter((key) => allowed.has(key));
      });
    } finally {
      setServerGalleryLoading(false);
    }
  };

  const handleDeleteServerPhoto = async (url: string) => {
    await deleteStorageImageByPublicUrl(url);
    await loadServerGallery();
  };

  const handleCompressServerPhoto = async (url: string) => {
    await recompressExistingStorageImage(url);
    await loadServerGallery();
  };

  useEffect(() => {
    void loadSnapshots();
  }, []);

  useEffect(() => {
    void loadServerGallery();
  }, []);

  const galleryKey = (row: { bucket: string; path: string }) => `${row.bucket}:${row.path}`;

  const activeGalleryRows = useMemo(() => serverGalleryRows, [serverGalleryRows]);

  const folderOptions = useMemo(() => {
    const folders = new Set<string>();
    activeGalleryRows.forEach((row) => {
      const folder = row.path.includes('/') ? row.path.split('/').slice(0, -1).join('/') : 'root';
      folders.add(folder || 'root');
    });
    return ['all', ...Array.from(folders).sort((a, b) => a.localeCompare(b))];
  }, [activeGalleryRows]);

  const selectedGalleryRows = useMemo(() => {
    if (!selectedGalleryKeys.length) return [];
    const selected = new Set(selectedGalleryKeys);
    return activeGalleryRows.filter((row) => selected.has(galleryKey(row)));
  }, [activeGalleryRows, selectedGalleryKeys]);

  const filteredGalleryRows = useMemo(() => {
    const query = gallerySearch.trim().toLowerCase();
    let rows = activeGalleryRows.filter((row) => !query || row.path.toLowerCase().includes(query));
    if (folderFilter !== 'all') {
      rows = rows.filter((row) => (row.path.includes('/') ? row.path.split('/').slice(0, -1).join('/') : 'root') === folderFilter);
    }
    if (heavyOnly) {
      const sorted = [...rows].sort((a, b) => b.size - a.size);
      rows = sorted.slice(0, Math.max(20, Math.ceil(sorted.length * 0.15)));
    }
    const withDate = (row: GalleryRow) => new Date(row.updatedAt || row.createdAt || 0).getTime() || 0;
    return [...rows].sort((a, b) => {
      if (gallerySort === 'size_desc') return b.size - a.size;
      if (gallerySort === 'size_asc') return a.size - b.size;
      if (gallerySort === 'date_desc') return withDate(b) - withDate(a);
      if (gallerySort === 'date_asc') return withDate(a) - withDate(b);
      const fa = a.path.split('/').slice(0, -1).join('/');
      const fb = b.path.split('/').slice(0, -1).join('/');
      return fa.localeCompare(fb) || b.size - a.size;
    });
  }, [gallerySearch, activeGalleryRows, folderFilter, heavyOnly, gallerySort]);

  const duplicateGroups = useMemo(() => {
    const by = new Map<string, GalleryRow[]>();
    activeGalleryRows.forEach((row) => {
      const name = row.path.split('/').pop() || row.path;
      const key = `${row.size}:${name.toLowerCase()}`;
      by.set(key, [...(by.get(key) || []), row]);
    });
    return Array.from(by.values()).filter((group) => group.length > 1).sort((a, b) => b[0].size - a[0].size);
  }, [activeGalleryRows]);

  const selectedGallerySet = useMemo(() => new Set(selectedGalleryKeys), [selectedGalleryKeys]);

  const toggleGalleryRow = (row: { bucket: string; path: string }) => {
    const key = galleryKey(row);
    setSelectedGalleryKeys((prev) => prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]);
  };

  const clearGallerySelection = () => setSelectedGalleryKeys([]);

  useEffect(() => {
    localStorage.setItem(GALLERY_TASKS_KEY, JSON.stringify(galleryTasks));
  }, [galleryTasks]);

  const enqueueGalleryTask = (type: GalleryTaskType, rows: GalleryRow[], label: string) => {
    if (!rows.length) return;
    const task: GalleryTask = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label,
      type,
      urls: rows.map((row) => row.publicUrl),
      createdAt: Date.now(),
      progress: 0,
      total: rows.length,
      done: false,
      failed: 0
    };
    setGalleryTasks((prev) => [...prev, task]);
    window.dispatchEvent(new CustomEvent('app-toast', { detail: { tone: 'success', message: `Фоновая задача добавлена: ${label}` } }));
  };

  useEffect(() => {
    const task = galleryTasks.find((item) => !item.done);
    if (!task) return;
    let cancelled = false;

    const run = async () => {
      let progress = task.progress;
      let failed = task.failed || 0;
      for (let index = task.progress; index < task.urls.length; index += 1) {
        if (cancelled) return;
        const url = task.urls[index];
        let ok = false;
        try {
          if (task.type === 'compress') ok = await recompressExistingStorageImage(url);
          else if (task.type === 'delete') ok = await deleteStorageImageByPublicUrl(url);
        } catch {
          ok = false;
        }
        progress += 1;
        if (!ok) failed += 1;
        setGalleryTasks((prev) => prev.map((entry) => entry.id === task.id ? { ...entry, progress, failed } : entry));
      }
      setGalleryTasks((prev) => prev.map((entry) => entry.id === task.id ? { ...entry, done: true, progress: entry.total, failed } : entry));
      await loadServerGallery();
    };

    void run();
    return () => { cancelled = true; };
  }, [galleryTasks]);

  const processGalleryRows = async (
    rows: Array<{ path: string; publicUrl: string }>,
    actionLabel: string,
    worker: (publicUrl: string) => Promise<boolean>
  ) => {
    const concurrency = 6;
    let cursor = 0;
    let completed = 0;
    let success = 0;
    let failures = 0;

    const runSingle = async (row: { path: string; publicUrl: string }) => {
      let ok = false;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          ok = await worker(row.publicUrl);
          if (ok) break;
        } catch {
          if (attempt >= 2) ok = false;
        }
      }
      completed += 1;
      if (ok) success += 1;
      else failures += 1;
      setDangerActionProgress({
        label: actionLabel,
        processed: completed,
        total: rows.length,
        details: row.path
      });
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, async () => {
      while (cursor < rows.length) {
        const current = rows[cursor];
        cursor += 1;
        await runSingle(current);
      }
    }));

    return { success, failures };
  };

  const handleBulkCompressGallery = () => {
    if (!selectedGalleryRows.length) return;
    const confirmed = window.confirm(`Сжать выбранные фото (${selectedGalleryRows.length}) в фоне?`);
    if (!confirmed) return;
    enqueueGalleryTask('compress', selectedGalleryRows, `Сжать выбранные (${selectedGalleryRows.length})`);
    clearGallerySelection();
  };

  const handleBulkDeleteGallery = () => {
    if (!selectedGalleryRows.length) return;
    const confirmed = window.confirm(`Удалить выбранные фото (${selectedGalleryRows.length}) с сервера без корзины? Действие необратимо.`);
    if (!confirmed) return;
    enqueueGalleryTask('delete', selectedGalleryRows, `Удалить выбранные (${selectedGalleryRows.length})`);
    clearGallerySelection();
  };

  const openServerGalleryFullscreen = () => {
    if (!serverGalleryRows.length) {
      void loadServerGallery();
    }
    setIsGalleryFullscreen(true);
  };

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
              onChange={(e) => updateDraft({ defaultExchangeRate: parseDecimalInput(e.target.value) })}
              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
              type="text"
              inputMode="decimal"
              placeholder="0.75"
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

      <Section title="Главный экран «Сегодня»">
        <div className="space-y-3">
          <Field label="Ваше имя (приветствие)">
            <input
              value={draftSettings.userName || ''}
              onChange={(e) => updateDraft({ userName: e.target.value })}
              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
              type="text"
              placeholder="Руслан"
            />
          </Field>

          <Field label="Цель по прибыли за неделю (AED)">
            <input
              value={draftSettings.weeklyGoalAed || 2000}
              onChange={(e) => updateDraft({ weeklyGoalAed: Number(e.target.value.replace(/\D/g, '')) || 2000 })}
              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
              type="text"
              inputMode="numeric"
              placeholder="2000"
            />
          </Field>

          <Field label="Время утреннего уведомления">
            <input
              value={draftSettings.morningNotificationTime || '07:30'}
              onChange={(e) => updateDraft({ morningNotificationTime: e.target.value })}
              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
              type="time"
            />
          </Field>

          <Field label="Время вечернего уведомления">
            <input
              value={draftSettings.eveningNotificationTime || '21:00'}
              onChange={(e) => updateDraft({ eveningNotificationTime: e.target.value })}
              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
              type="time"
            />
          </Field>
        </div>
      </Section>

      <Section title="Чек лист поиска поставщиков">
        <p className="text-xs text-gray-500">Эти задачи подставляются по умолчанию во все слайды Vendor. Можно добавлять индивидуальные задачи уже в конкретном заказе.</p>
        <div className="mt-3 space-y-2">
          {(draftSettings.defaultVendorChecklist || []).map((task, idx) => (
            <div key={`${task}-${idx}`} className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2">
              <span className="flex-1 text-sm text-gray-800">{task}</span>
              <button type="button" onClick={() => removeDefaultChecklistTask(idx)} className="rounded-lg border border-rose-200 px-2 py-1 text-[11px] font-bold text-rose-700">Удалить</button>
            </div>
          ))}
          <div className="flex gap-2">
            <input
              value={newDefaultChecklistTask}
              onChange={(e) => setNewDefaultChecklistTask(e.target.value)}
              placeholder="Новая задача по умолчанию"
              className="h-10 flex-1 rounded-xl border border-gray-300 bg-white px-3 text-sm"
            />
            <button type="button" onClick={addDefaultChecklistTask} className="rounded-xl bg-blue-600 px-3 text-xs font-bold text-white">Добавить</button>
          </div>
        </div>
      </Section>

      <Section title="Зоны заказов">
        <p className="text-xs text-gray-500">Список зон, доступных для выбора в деталях заказа и в разделе Vendor Slides.</p>
        <div className="mt-3 space-y-2">
          {(draftSettings.orderZones || []).map((zone, idx) => (
            <div key={`${zone}-${idx}`} className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2">
              {editingZoneIndex === idx ? (
                <>
                  <input
                    value={editingZoneValue}
                    onChange={(e) => setEditingZoneValue(e.target.value)}
                    className="h-8 flex-1 rounded-lg border border-gray-300 bg-white px-2 text-sm"
                    autoFocus
                  />
                  <button type="button" onClick={saveEditZone} className="rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-bold text-blue-700">Сохранить</button>
                  <button type="button" onClick={() => setEditingZoneIndex(null)} className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-bold text-gray-500">Отмена</button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm text-gray-800">{zone}</span>
                  <button type="button" onClick={() => startEditZone(idx)} className="rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-bold text-blue-700">Изменить</button>
                  <button type="button" onClick={() => removeZone(idx)} className="rounded-lg border border-rose-200 px-2 py-1 text-[11px] font-bold text-rose-700">Удалить</button>
                </>
              )}
            </div>
          ))}
          <div className="flex gap-2">
            <input
              value={newZoneName}
              onChange={(e) => setNewZoneName(e.target.value)}
              placeholder="Новая зона (напр. Zone 5)"
              className="h-10 flex-1 rounded-xl border border-gray-300 bg-white px-3 text-sm"
            />
            <button type="button" onClick={addZone} className="rounded-xl bg-blue-600 px-3 text-xs font-bold text-white">Добавить</button>
          </div>
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
            onClick={() => {
              const opened = openExternalPage(publicRequestFormUrl);
              if (!opened) {
                window.dispatchEvent(new CustomEvent('app-toast', { detail: { message: 'Не удалось открыть форму. Проверьте блокировку всплывающих окон.', tone: 'error' } }));
              }
            }}
            className="shrink-0 rounded-xl border border-blue-200 bg-blue-50 text-blue-700 px-3 py-2 text-sm font-bold"
          >
            Открыть
          </button>
        </div>
      </Section>

      <Section title="Публичные контакты">
        <div className="space-y-3">
          <CompactBlock title="Контакты для клиента" subtitle="WhatsApp / Telegram / Instagram">
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

            <Field label="Сайт компании (для invoice)">
              <input
                value={draftSettings.publicWebsiteUrl}
                onChange={(e) => updateDraft({ publicWebsiteUrl: e.target.value.trim() })}
                placeholder="https://www.dubaispares.ae"
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
              />
            </Field>

            <Field label="Публичная почта (для invoice)">
              <input
                type="email"
                value={draftSettings.publicEmail}
                onChange={(e) => updateDraft({ publicEmail: e.target.value.trim() })}
                placeholder="sales@dubaispares.ae"
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
              />
            </Field>

            <Field label="Файл условий (cargo / доставка / и т.д.)">
              <div className="space-y-2">
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.txt,.rtf"
                  onChange={handlePublicTermsFileChange}
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
                />
                {draftSettings.publicTermsFileUrl && (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <a href={draftSettings.publicTermsFileUrl} target="_blank" rel="noreferrer" className="text-blue-600 underline">
                      {draftSettings.publicTermsFileName || 'Открыть файл'}
                    </a>
                    <button type="button" onClick={() => updateDraft({ publicTermsFileUrl: '', publicTermsFileName: '' })} className="rounded-lg border border-rose-200 px-3 py-1.5 font-bold text-rose-700">Удалить файл</button>
                  </div>
                )}
              </div>
            </Field>
          </CompactBlock>

          <CompactBlock title="Брендинг документов" subtitle="Логотип и подпись в публичной смете">
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


            <Field label="Имя и фамилия менеджера / владельца (для публичной сметы и invoice)">
              <input
                value={draftSettings.publicManagerName}
                onChange={(e) => updateDraft({ publicManagerName: e.target.value })}
                placeholder="Например: Ahmed Al Mansoori"
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
              />
            </Field>

            <Field label="Реквизиты оплаты в invoice">
              <div className="grid gap-3 md:grid-cols-3">
                <Field label="Account No">
                  <input
                    value={draftSettings.invoicePaymentAccountNo}
                    onChange={(e) => updateDraft({ invoicePaymentAccountNo: e.target.value })}
                    placeholder="971521574546"
                    className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
                  />
                </Field>
                <Field label="Beneficiary / Name">
                  <input
                    value={draftSettings.invoicePaymentBeneficiary}
                    onChange={(e) => updateDraft({ invoicePaymentBeneficiary: e.target.value })}
                    placeholder="Dubai Spares UAE"
                    className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
                  />
                </Field>
                <Field label="Bank Account">
                  <input
                    value={draftSettings.invoicePaymentBankAccount}
                    onChange={(e) => updateDraft({ invoicePaymentBankAccount: e.target.value })}
                    placeholder="Dubai Spares UAE Trading Account"
                    className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
                  />
                </Field>
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
          </CompactBlock>

          <CompactBlock title="Условия работы" subtitle="Показываются клиенту в публичной смете">
            <Field label="Условия работы (для сметы клиенту)">
              <textarea
                value={draftSettings.publicWorkTerms}
                onChange={(e) => updateDraft({ publicWorkTerms: e.target.value })}
                placeholder="Например: Проверка наличия/цены перед оплатой, фото-отчёт перед отправкой."
                className="min-h-20 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
                rows={4}
              />
            </Field>
          </CompactBlock>

          <CompactBlock title="Калькулятор карго / доставки" subtitle="Тарифы по странам (расчёт только по весу)">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-gray-700">Тарифы по странам (USD)</p>
                <button type="button" onClick={addCargoTariff} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-black text-blue-700">+ Добавить страну</button>
              </div>
              {cargoTariffs.map((tariff, index) => (
                <CompactBlock key={`${tariff.country || 'country'}-${index}`} title={tariff.country || `Страна ${index + 1}`} subtitle="Тарифы и сроки доставки">
                  <div className="grid gap-2 md:grid-cols-2">
                    <Field label="Страна">
                      <input
                        value={tariff.country}
                        onChange={(e) => updateCargoTariff(index, { country: e.target.value })}
                        placeholder="Россия"
                        className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
                      />
                    </Field>
                    <div className="flex items-end justify-end">
                      <button type="button" onClick={() => removeCargoTariff(index)} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-black text-rose-700">Удалить страну</button>
                    </div>
                  </div>

                  <div className="grid gap-2 md:grid-cols-3">
                    <Field label="Авиадоставка: цена за кг (обычный груз)"><TariffNumberInput placeholder="11.5" value={tariff.airRegularUsdPerKg} onCommit={(nextValue) => updateCargoTariff(index, { airRegularUsdPerKg: nextValue })} /></Field>
                    <Field label="Контейнер: цена за кг"><TariffNumberInput placeholder="0.75" value={tariff.containerUsdPerKg} onCommit={(nextValue) => updateCargoTariff(index, { containerUsdPerKg: nextValue })} /></Field>
                    <Field label="Авиадоставка: цена за кг (крупногабарит)"><TariffNumberInput placeholder="13.25" value={tariff.airOversizedUsdPerKg} onCommit={(nextValue) => updateCargoTariff(index, { airOversizedUsdPerKg: nextValue })} /></Field>
                    <Field label="Авиадоставка: доплата за место ($)"><TariffNumberInput placeholder="10" value={tariff.airSeatUsd} onCommit={(nextValue) => updateCargoTariff(index, { airSeatUsd: nextValue })} /></Field>
                  </div>

                  <div className="grid gap-2 md:grid-cols-3">
                    <Field label="Мин. авиа (кг)"><TariffNumberInput placeholder="0.75" value={tariff.minAirKg} onCommit={(nextValue) => updateCargoTariff(index, { minAirKg: nextValue })} /></Field>
                    <Field label="Мин. контейнер (кг)"><TariffNumberInput placeholder="0.75" value={tariff.minContainerKg} onCommit={(nextValue) => updateCargoTariff(index, { minContainerKg: nextValue })} /></Field>
                                        <Field label="Авиа срок (дней)"><input value={tariff.airEtaDays} onChange={(e) => updateCargoTariff(index, { airEtaDays: e.target.value })} placeholder="3-7" className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm" /></Field>
                    <Field label="Контейнер срок (дней)"><input value={tariff.containerEtaDays} onChange={(e) => updateCargoTariff(index, { containerEtaDays: e.target.value })} placeholder="25-45" className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm" /></Field>
                  </div>
                </CompactBlock>
              ))}
            </div>
          </CompactBlock>
        </div>
      </Section>

      <Section title="Локальный режим">
        <CompactBlock title="AI ядро" subtitle="Ключ OpenRouter для внутреннего AI шлюза">
          <div className="space-y-3">
            <Field label="API ключ AI ядра">
              <input
                type="password"
                value={draftSettings.aiCoreApiKey || ''}
                onChange={(e) => updateDraft({ aiCoreApiKey: e.target.value.trim() })}
                placeholder="sk-or-v1-..."
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
              />
            </Field>
            <p className="text-xs text-gray-500">Ключ сохраняется в общих настройках приложения и используется серверным AI шлюзом для запросов к OpenRouter. Если поле пустое, сервер продолжит использовать OPENROUTER_API_KEY из окружения.</p>
          </div>
        </CompactBlock>

        <CompactBlock title="Тест AI ядра" subtitle="Проверка внутреннего шлюза POST /ai/tasks">
          <div className="space-y-3">
            <Field label="Задача">
              <select
                value={aiTestTask}
                onChange={(e) => {
                  setAiTestTask(e.target.value as AiTestTask);
                  setAiTestError(null);
                  setAiTestResult('');
                }}
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
              >
                <option value="analyze_text">analyze_text</option>
                <option value="transform_text">transform_text</option>
                <option value="extract_structured_data">extract_structured_data</option>
              </select>
            </Field>

            <Field label="Текст для теста">
              <textarea
                value={aiTestText}
                onChange={(e) => setAiTestText(e.target.value)}
                rows={4}
                className="min-h-24 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
                placeholder="Введите текст, который нужно отправить в AI ядро"
              />
            </Field>

            <Field label="Инструкции">
              <textarea
                value={aiTestInstructions}
                onChange={(e) => setAiTestInstructions(e.target.value)}
                rows={3}
                className="min-h-20 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
                placeholder="Дополнительные инструкции для AI"
              />
            </Field>

            {aiTestTask === 'transform_text' ? (
              <div className="grid gap-2 md:grid-cols-2">
                <Field label="Операция">
                  <input value={aiTestOperation} onChange={(e) => setAiTestOperation(e.target.value)} className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm" placeholder="Суммаризируй / переведи / переформулируй" />
                </Field>
                <Field label="Язык результата">
                  <input value={aiTestTargetLang} onChange={(e) => setAiTestTargetLang(e.target.value)} className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm" placeholder="ru / en / ar" />
                </Field>
                <Field label="Тон">
                  <input value={aiTestTone} onChange={(e) => setAiTestTone(e.target.value)} className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm" placeholder="professional" />
                </Field>
                <Field label="Формат">
                  <input value={aiTestFormat} onChange={(e) => setAiTestFormat(e.target.value)} className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm" placeholder="plain_text" />
                </Field>
              </div>
            ) : null}

            {aiTestTask === 'extract_structured_data' ? (
              <Field label="JSON-схема">
                <textarea
                  value={aiTestSchema}
                  onChange={(e) => setAiTestSchema(e.target.value)}
                  rows={8}
                  className="min-h-40 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 font-mono text-xs"
                  placeholder='{"field":"string"}'
                />
              </Field>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void withBusy('ai-core-test', runAiCoreTest)}
                disabled={busy === 'ai-core-test'}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-black text-white disabled:opacity-50"
              >
                {busy === 'ai-core-test' ? 'Тестируем…' : 'Запустить AI тест'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAiTestError(null);
                  setAiTestResult('');
                }}
                className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-bold"
              >
                Очистить ответ
              </button>
            </div>

            {aiTestError ? <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{aiTestError}</p> : null}

            <div className="rounded-2xl border border-gray-200 bg-gray-950 p-3 text-xs text-green-300">
              <p className="mb-2 font-black text-white">Ответ AI ядра</p>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words">{aiTestResult || 'После запуска здесь появится JSON-ответ внутреннего AI шлюза.'}</pre>
            </div>
          </div>
        </CompactBlock>

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
                      <p><span className="font-bold text-gray-900">Создан:</span> {formatDateTime(row.created_at)}</p>
                      <p><span className="font-bold text-gray-900">Истекает:</span> {formatDateTime(row.expires_at)}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <a href={buildSnapshotUrl(row)} target="_blank" rel="noreferrer" className="rounded-lg border border-blue-300 bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700">Открыть</a>
                      <button
                        type="button"
                        className="rounded-lg border border-indigo-300 bg-indigo-50 px-2 py-1 text-xs font-bold text-indigo-700 disabled:opacity-50"
                        onClick={() => row.order_id && navigate(`/order/${row.order_id}`)}
                        disabled={!row.order_id}
                      >
                        Открыть заказ этого снапшота
                      </button>
                      <button type="button" className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs font-bold" onClick={() => void copySnapshotUrl(row)}>Копировать ссылку</button>
                      <button
                        type="button"
                        className={`rounded-lg border px-2 py-1 text-xs font-bold ${lockedSnapshotIds.includes(String(row.snapshot_id || row.id || '').trim()) ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-gray-300 bg-white text-gray-700'}`}
                        onClick={() => toggleSnapshotLock(row)}
                      >
                        {lockedSnapshotIds.includes(String(row.snapshot_id || row.id || '').trim()) ? '🔒 В замке' : '🔓 Без замка'}
                      </button>
                      <button type="button" className="rounded-lg border border-rose-300 bg-white px-2 py-1 text-xs font-bold text-rose-700" onClick={() => void handleSnapshotDelete(row)}>Удалить</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Section>

      <Section title="Галерея сервера">
        <div className="rounded-3xl border border-gray-200 bg-gradient-to-b from-slate-50 to-white p-3 shadow-inner">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="rounded-2xl border border-sky-300 bg-sky-50 px-4 py-2 text-sm font-black text-sky-700 disabled:opacity-50" onClick={openServerGalleryFullscreen} disabled={serverGalleryLoading}>{serverGalleryLoading ? 'Открываем…' : 'Открыть галерею сервера'}</button>
            <button type="button" className="rounded-2xl border border-gray-300 bg-white px-3 py-2 text-xs font-bold disabled:opacity-50" onClick={() => void loadServerGallery()} disabled={serverGalleryLoading}>{serverGalleryLoading ? 'Обновляем…' : 'Обновить список фото'}</button>
            <span className="text-xs text-gray-500">Всего: {activeGalleryRows.length}</span>
          </div>
        </div>
      </Section>

      {isGalleryFullscreen && (
        <div className="fixed inset-0 z-[120] bg-slate-950/95 backdrop-blur-sm">
          <div className="flex h-full flex-col">
            <div className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/95 px-3 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="rounded-xl border border-white/20 px-3 py-2 text-xs font-black text-white" onClick={() => setIsGalleryFullscreen(false)}>Закрыть</button>
                <button type="button" className={`rounded-xl border px-3 py-2 text-xs font-black ${isGallerySelectionMode ? 'border-sky-300 bg-sky-500/30 text-sky-100' : 'border-white/20 text-white'}`} onClick={() => {
                  const nextMode = !isGallerySelectionMode;
                  setIsGallerySelectionMode(nextMode);
                  if (!nextMode) clearGallerySelection();
                }}>{isGallerySelectionMode ? 'Готово' : 'Выбрать'}</button>
                <button type="button" className="rounded-xl border border-white/20 px-3 py-2 text-xs font-black text-white disabled:opacity-50" disabled={!isGallerySelectionMode || filteredGalleryRows.length === 0 || !!busy} onClick={() => setSelectedGalleryKeys(filteredGalleryRows.map((row) => galleryKey(row)))}>Выбрать видимые</button>
                <button type="button" className="rounded-xl border border-white/20 px-3 py-2 text-xs font-black text-white disabled:opacity-50" disabled={!isGallerySelectionMode || selectedGalleryKeys.length === 0 || !!busy} onClick={clearGallerySelection}>Снять выбор</button>
                <button type="button" className="rounded-xl border border-amber-300 bg-amber-500/20 px-3 py-2 text-xs font-black text-amber-100 disabled:opacity-50" disabled={!isGallerySelectionMode || selectedGalleryRows.length === 0 || !!busy} onClick={handleBulkCompressGallery}>Сжать выбранные ({selectedGalleryRows.length})</button>
                <button type="button" className="rounded-xl border border-rose-300 bg-rose-500/20 px-3 py-2 text-xs font-black text-rose-100 disabled:opacity-50" disabled={!isGallerySelectionMode || selectedGalleryRows.length === 0 || !!busy} onClick={handleBulkDeleteGallery}>Удалить выбранные ({selectedGalleryRows.length})</button>
                <button className="rounded-xl border border-amber-300 bg-white/10 px-3 py-2 text-xs font-black text-amber-100 disabled:opacity-50" type="button" disabled={!!busy} onClick={handleCompressAllServerPhotos}>{busyLabel('storage-compress-all', 'Сжать все фото', 'Сжимаем фото…')}</button>
                <button className="rounded-xl border border-rose-300 bg-white/10 px-3 py-2 text-xs font-black text-rose-100 disabled:opacity-50" type="button" disabled={!!busy} onClick={handleRemovePhotoDuplicates}>{busyLabel('storage-delete-duplicates', 'Удалить дубликаты фото', 'Обработка дубликатов…')}</button>
                <input value={gallerySearch} onChange={(event) => setGallerySearch(event.target.value)} placeholder="Поиск по имени/папке…" className="min-w-[220px] flex-1 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white placeholder:text-white/60" />
                <select value={gallerySort} onChange={(event) => setGallerySort(event.target.value as GallerySort)} className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white">
                  <option value="size_desc">Размер ↓</option><option value="size_asc">Размер ↑</option><option value="date_desc">Дата ↓</option><option value="date_asc">Дата ↑</option><option value="folder">Папка</option>
                </select>
                <select value={folderFilter} onChange={(event) => setFolderFilter(event.target.value)} className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white">
                  {folderOptions.map((folder) => <option key={folder} value={folder}>{folder === 'all' ? 'Все папки' : folder}</option>)}
                </select>
                <label className="inline-flex items-center gap-1 rounded-xl border border-white/20 px-2 py-2 text-xs text-white"><input type="checkbox" checked={heavyOnly} onChange={(e) => setHeavyOnly(e.target.checked)} />Самые тяжёлые</label>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {!!galleryTasks.length && <div className="mb-3 rounded-2xl border border-white/15 bg-white/10 p-2 text-xs text-white">{galleryTasks.slice(-3).map((task) => <p key={task.id}>{task.label}: {task.progress}/{task.total}{task.done ? ' ✅' : ' ⏳'}{task.failed ? ` · ошибок ${task.failed}` : ''}</p>)}</div>}
              {!!duplicateGroups.length && <div className="mb-3 rounded-2xl border border-amber-300/50 bg-amber-500/10 p-2 text-xs text-amber-100">Группы дубликатов: {duplicateGroups.length}. Рекомендуем "оставить лучший" (первый в группе по размеру/дате).</div>}
              <div className="columns-2 gap-3 sm:columns-3 lg:columns-4">
                {filteredGalleryRows.map((row, idx) => {
                  const key = galleryKey(row);
                  const isSelected = selectedGallerySet.has(key);
                  return (
                    <button key={key} type="button" className={`group relative mb-3 block w-full break-inside-avoid overflow-hidden rounded-2xl border text-left transition ${isSelected ? 'border-sky-400 ring-2 ring-sky-300/40' : 'border-white/10 hover:border-white/30'}`} onClick={() => {
                      if (isGallerySelectionMode) {
                        toggleGalleryRow(row);
                        return;
                      }
                      setLightboxIndex(idx);
                    }}>
                      <img src={row.publicUrl} alt={row.path} className="h-auto w-full object-cover" loading="lazy" />
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2 text-[10px] text-white"><p className="truncate font-bold">{row.path.split('/').pop() || row.path}</p><p className="truncate text-white/80">{(row.size / 1024 / 1024).toFixed(2)} MB · {formatDateTime(row.updatedAt || row.createdAt)}</p></div>
                      {isGallerySelectionMode && <span className={`absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full border text-xs font-black ${isSelected ? 'border-sky-400 bg-sky-500 text-white' : 'border-white bg-white/90 text-slate-700'}`}>{isSelected ? '✓' : ''}</span>}
                    </button>
                  );
                })}
              </div>
              {filteredGalleryRows.length === 0 && <p className="mt-6 text-center text-sm text-white/70">Нет фото по текущему фильтру.</p>}
            </div>
          </div>
        </div>
      )}

      {lightboxIndex !== null && filteredGalleryRows[lightboxIndex] && (
        <div className="fixed inset-0 z-[140] bg-black/95" onClick={() => setLightboxIndex(null)}>
          <button type="button" className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full border border-white/30 bg-black/40 px-3 py-2 text-white" onClick={(e) => { e.stopPropagation(); setLightboxIndex((prev) => prev === null ? null : Math.max(0, prev - 1)); }}>‹</button>
          <img src={filteredGalleryRows[lightboxIndex].publicUrl} alt={filteredGalleryRows[lightboxIndex].path} className="h-full w-full object-contain" />
          <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full border border-white/30 bg-black/40 px-3 py-2 text-white" onClick={(e) => { e.stopPropagation(); setLightboxIndex((prev) => prev === null ? null : Math.min(filteredGalleryRows.length - 1, prev + 1)); }}>›</button>
        </div>
      )}


      <Section title="Опасные действия" tone="danger">
        <div className="text-xs text-rose-700">Изменения ниже могут удалить локальные данные и требуют подтверждения.</div>
        <div className="flex flex-col gap-2 text-sm">
          <button className="w-full rounded-xl border border-rose-300 bg-white text-rose-700 px-3 py-2 font-black disabled:opacity-50" type="button" disabled={!!busy} onClick={handleCheckAndCleanBrokenPhotos}>{busyLabel('check-clean-broken-photos', 'Проверить и очистить битые фото', 'Проверяем битые фото…')}</button>
          <button className="w-full rounded-xl border border-rose-300 bg-white text-rose-700 px-3 py-2 font-black disabled:opacity-50" type="button" disabled={!!busy} onClick={handleRestoreBrokenPhotos}>{busyLabel('restore-broken-photos', 'Восстановить битые фото', 'Восстанавливаем фото…')}</button>
          <button className="w-full rounded-xl border border-rose-300 bg-white text-rose-700 px-3 py-2 font-black disabled:opacity-50" type="button" disabled={!!busy} onClick={handleClearBrokenLinks}>{busyLabel('clear-broken-links', 'Очистить битые ссылки', 'Очищаем битые ссылки…')}</button>
          <button className="w-full rounded-xl border border-rose-300 bg-white text-rose-700 px-3 py-2 font-black disabled:opacity-50" type="button" disabled={!!busy} onClick={() => { clearBrokenImageBlacklist(); window.dispatchEvent(new CustomEvent('app-toast', { detail: { message: 'Локальный blacklist битых фото очищен', tone: 'success' } })); }}>Очистить blacklist битых фото</button>
          <button className="w-full rounded-xl border border-rose-300 bg-rose-600 text-white px-3 py-2 font-black disabled:opacity-50" type="button" disabled={!!busy || isHardResetting} onClick={() => void withBusy('hard-reset', clearAllLocalDataAndRestart)}>{busyLabel('hard-reset', 'Очистить кэш и все локальные данные', 'Очищаем и перезапускаем…')}</button>
          <button className="w-full rounded-xl border border-rose-300 bg-white text-rose-700 px-3 py-2 font-black disabled:opacity-50" type="button" disabled={!!busy} onClick={() => void withBusy('public-snapshots', async () => {
            await handleClearSnapshotsExceptLocked();
            window.dispatchEvent(new CustomEvent('app-toast', { detail: { message: 'Очистка снапшотов завершена (с учетом замков)', tone: 'success' } }));
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
      {isHardResetting && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70">
          <div className="rounded-2xl border border-white/20 bg-slate-900/95 px-5 py-4 text-center text-white shadow-2xl">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            <p className="mt-3 text-sm font-semibold">Очистка и перезапуск приложения…</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsScreen;
