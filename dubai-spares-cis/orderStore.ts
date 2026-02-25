import { useCallback, useEffect, useState } from 'react';
import { DbOrderGraphRow, Order, OrderStatus, Part, PriceVariant, SalesStatus } from './types';
import { supabase, isCloudSyncConfigured } from './supabase';
import { deleteOrderFolderFromStorage, ensurePublicImageUrls, optimizeImageForUpload, recompressExistingStorageImage } from './storage/photos';
import { OfflineMutation, isIdbAutoSyncPaused, offlineDb } from './storage/offlineDb';
import { logger } from './logging';
import { logDatabaseIntegrity } from './dbIntegrity';
import { NotificationType, pushNotification, sendBrowserNotification } from './notificationCenter';
import { addMissingColumns, normalizeSyncError, setLastIndexedDbError, setLastSupabaseError, setSyncStatus } from './syncDiagnostics';
import { getSelectableColumns, markMissingColumn } from './syncSchema';
import { logSyncCategory, syncPerf } from './syncPerf';
import { LOCAL_ONLY } from './localMode';
import { mergeCloudLeadsWithOrders } from './leadSync';
import { CloudLeadRow, leadsSync, purgePublicLeadArtifacts } from './serverApi';
import { refreshSupabaseSchemaCache } from './schemaCache';

type OrderState = {
  orders: Order[];
  isLoading: boolean;
  isSyncing: boolean;
  isHydrated: boolean;
  error: string | null;
};

const listeners = new Set<() => void>();

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const createUuid = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const ensureUuid = (value?: string) => (value && isUuid(value) ? value : createUuid());

const getStatus = (order: Pick<Order, 'isSold' | 'isArchived' | 'isVip' | 'isLead'>): OrderStatus => {
  if (order.isSold) return 'sold';
  if (order.isArchived) return 'archive';
  if (order.isVip) return 'vip';
  if (order.isLead) return 'lead';
  return 'active';
};

const SALES_STATUS_ALIASES: Record<string, SalesStatus> = {
  inquiry: 'Inquiry',
  price_sent: 'Price Sent',
  pending_approval: 'Pending Approval',
  paid: 'Paid',
  completed: 'Completed'
};

const normalizeSalesStatus = (value: unknown): SalesStatus => {
  const raw = typeof value === 'string' ? value.trim() : '';
  const normalizedKey = raw.toLowerCase().replace(/[\s-]+/g, '_');
  return SALES_STATUS_ALIASES[normalizedKey] || 'Inquiry';
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

const normalizePhotoList = (photos: string[] = []): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];
  photos.forEach((photo) => {
    const value = String(photo || '').trim();
    if (!value) return;
    const key = normalizePhotoKey(value);
    if (!key || seen.has(key)) return;
    seen.add(key);
    normalized.push(value);
  });
  return normalized;
};

const estimateOrderProfitUsd = (order: Pick<Order, 'parts' | 'markupPercent' | 'markupType' | 'markupFixedAed' | 'exchangeRate'>): number => {
  const totalCostAed = (order.parts || []).reduce((sum, part) => {
    if (!part.isFound || (part.variants || []).length === 0) return sum;
    return sum + Number(part.variants[0].priceAed || 0);
  }, 0);
  if (totalCostAed <= 0) return 0;
  const markupAed = (order.markupType || 'percent') === 'fixed'
    ? Number(order.markupFixedAed || 0)
    : totalCostAed * (Number(order.markupPercent || 0) / 100);
  return markupAed / (Number(order.exchangeRate || 0) || 3.67);
};

const normalizeLogistics = (raw: unknown): Order['logistics'] | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
  const src = raw as Record<string, unknown>;
  const toAmount = (...values: unknown[]) => {
    for (const value of values) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
  };

  return {
    deliveryType: src.deliveryType === 'export' || src.delivery_type === 'export' ? 'export' : 'uae',
    deliveryAed: toAmount(src.deliveryAed, src.delivery_aed),
    packingAed: toAmount(src.packingAed, src.packing_aed),
    serviceFeeAed: toAmount(src.serviceFeeAed, src.service_fee_aed, src.commissionAed, src.commission_aed)
  };
};

const normalizeOrder = (order: Order): Order => {
  const salesStatus = normalizeSalesStatus(order.salesStatus);
  const isCompleted = salesStatus === 'Completed';
  const isSold = order.isSold || isCompleted;

  const carPhotos = normalizePhotoList(order.carPhotos || [order.carPhotoUrl || '']);
  const notes = Array.isArray(order.notes)
    ? order.notes.map((note) => ({ ...note, photos: normalizePhotoList(note.photos || []) }))
    : [];
  const parts = Array.isArray(order.parts)
    ? order.parts.map((part) => {
      const partPhotos = normalizePhotoList(part.photos || [part.photoUrl || '']);
      const variants = Array.isArray(part.variants)
        ? part.variants.map((variant) => {
          const variantPhotos = normalizePhotoList(variant.photos || [variant.photoUrl || '']);
          return { ...variant, photos: variantPhotos, photoUrl: variantPhotos[0] || '' };
        })
        : [];
      return { ...part, photos: partPhotos, photoUrl: partPhotos[0] || '', variants };
    })
    : [];

  return {
    ...order,
    status: order.status ?? getStatus(order),
    salesStatus,
    isSold,
    isArchived: order.isArchived || isCompleted,
    soldProfitUsd: isSold
      ? order.soldProfitUsd ?? estimateOrderProfitUsd(order)
      : order.soldProfitUsd,
    isVip: !!order.isVip,
    isPinned: !!order.isPinned,
    isLead: !!order.isLead,
    notes,
    carPhotos,
    carPhotoUrl: carPhotos[0] || '',
    vinPhotoUrl: order.vinPhotoUrl || '',
    bodyType: order.bodyType || '',
    parts,
    updatedAt: order.updatedAt ?? order.createdAt ?? Date.now(),
    recommendedShopIds: Array.isArray(order.recommendedShopIds) ? order.recommendedShopIds : [],
    dismissedShopIds: Array.isArray(order.dismissedShopIds) ? order.dismissedShopIds : [],
    leadUnread: order.leadUnread === true,
    leadSource: order.leadSource === 'public_form' ? 'public_form' : 'manual',
    leadReadAt: Number.isFinite(Number(order.leadReadAt)) ? Number(order.leadReadAt) : undefined,
    pricingEvents: Array.isArray(order.pricingEvents) ? order.pricingEvents : []
  };
};




const EXISTING_IMAGE_RECOMPRESS_KEY = 'existing_image_recompress_v1';
const existingImageCompressionQueue = new Set<string>();
let existingImageCompressionRunning = false;

const readRecompressedImageSet = (): Set<string> => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(EXISTING_IMAGE_RECOMPRESS_KEY) || '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((item: unknown): item is string => typeof item === 'string') : []);
  } catch {
    return new Set();
  }
};

const writeRecompressedImageSet = (entries: Set<string>) => {
  try {
    const capped = Array.from(entries).slice(-4000);
    window.localStorage.setItem(EXISTING_IMAGE_RECOMPRESS_KEY, JSON.stringify(capped));
  } catch {
    // noop
  }
};

const collectOrderImageUrls = (order: Order): string[] => {
  const bag = new Set<string>();
  const append = (value: string) => {
    const normalized = String(value || '').trim();
    if (!normalized.startsWith('http')) return;
    bag.add(normalized);
  };

  append(order.carPhotoUrl || '');
  append(order.vinPhotoUrl || '');
  (order.carPhotos || []).forEach(append);
  (order.notes || []).forEach((note) => (note.photos || []).forEach(append));

  (order.parts || []).forEach((part) => {
    append(part.photoUrl || '');
    (part.photos || []).forEach(append);
    (part.variants || []).forEach((variant) => {
      append(variant.photoUrl || '');
      (variant.photos || []).forEach(append);
    });
  });

  return Array.from(bag);
};

const enqueueExistingImagesForCompression = (orders: Order[]) => {
  if (LOCAL_ONLY || !isCloudSyncConfigured || !navigator.onLine) return;

  const known = readRecompressedImageSet();
  orders.forEach((order) => {
    collectOrderImageUrls(order).forEach((url) => {
      if (!known.has(url)) existingImageCompressionQueue.add(url);
    });
  });

  if (existingImageCompressionRunning || existingImageCompressionQueue.size === 0) return;
  existingImageCompressionRunning = true;

  void (async () => {
    const updated = new Set(known);
    try {
      while (existingImageCompressionQueue.size > 0) {
        const next = existingImageCompressionQueue.values().next().value as string | undefined;
        if (!next) break;
        existingImageCompressionQueue.delete(next);

        try {
          await recompressExistingStorageImage(next);
          updated.add(next);
          if (updated.size % 20 === 0) writeRecompressedImageSet(updated);
        } catch (error) {
          await logger.warn('storage:recompress-existing', 'Failed to recompress existing image', {
            url: next,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    } finally {
      writeRecompressedImageSet(updated);
      existingImageCompressionRunning = false;
    }
  })();
};

const LEAD_SYNC_STATE_KEY = 'lead_sync_state_v1';

type LeadSyncState = { ignoredIds: string[]; convertedIds: string[] };

const readLeadSyncState = (): LeadSyncState => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LEAD_SYNC_STATE_KEY) || '{}');
    return {
      ignoredIds: Array.isArray(parsed.ignoredIds) ? parsed.ignoredIds.filter((item: unknown): item is string => typeof item === 'string') : [],
      convertedIds: Array.isArray(parsed.convertedIds) ? parsed.convertedIds.filter((item: unknown): item is string => typeof item === 'string') : []
    };
  } catch {
    return { ignoredIds: [], convertedIds: [] };
  }
};

const writeLeadSyncState = (state: LeadSyncState) => {
  window.localStorage.setItem(LEAD_SYNC_STATE_KEY, JSON.stringify({
    ignoredIds: Array.from(new Set(state.ignoredIds)),
    convertedIds: Array.from(new Set(state.convertedIds))
  }));
};

const rememberLeadDeleted = (orderId: string) => {
  const state = readLeadSyncState();
  state.ignoredIds.push(orderId);
  writeLeadSyncState(state);
};

const rememberLeadConverted = (orderId: string) => {
  const state = readLeadSyncState();
  state.convertedIds.push(orderId);
  writeLeadSyncState(state);
};

const forgetLeadSyncOverrides = (orderId: string) => {
  const state = readLeadSyncState();
  writeLeadSyncState({
    ignoredIds: state.ignoredIds.filter((id) => id !== orderId),
    convertedIds: state.convertedIds.filter((id) => id !== orderId)
  });
};

const parseTimestamp = (value: string | number | null | undefined): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) return asNumber;
    const asDate = Date.parse(value);
    if (!Number.isNaN(asDate)) return asDate;
  }
  return Date.now();
};

const toIsoTimestamp = (value: string | number | null | undefined): string => {
  const timestamp = parseTimestamp(value);
  return new Date(timestamp).toISOString();
};


let state: OrderState = {
  orders: [],
  isLoading: false,
  isSyncing: false,
  isHydrated: false,
  error: null
};

let syncInProgress = false;
let wasCloudHydratedAtLeastOnce = false;
let ordersTableUnavailable = false;
const schemaMissingColumns = new Set<string>();
const MAX_MUTATION_RETRY = 1;
const ORDER_PAGE_SIZE = 50;
const mutationTimers = new Map<string, number>();
const localCommitTimers = new Map<string, number>();
const networkFlushTimerMs = 3000;
const hotFieldKeys: Array<keyof Order> = ['markupPercent', 'markupType', 'markupFixedAed', 'exchangeRate', 'clientCurrency', 'fxUpdatedAt', 'logistics', 'pricingEvents', 'isVip', 'isPinned', 'customerStatus', 'updatedAt'];
let cachedQueueLength = 0;
let syncPausedUntil = 0;
let syncMutex: Promise<void> = Promise.resolve();
let lifecycleHydrationStarted = false;
let lifecycleEventsBound = false;
let lastFullFetchAt = 0;
let lastLeadRefreshAt = 0;

const MIN_FULL_FETCH_INTERVAL_MS = 45_000;
const MIN_LEAD_REFRESH_INTERVAL_MS = 30_000;

const runWithSyncMutex = async <T>(task: () => Promise<T>): Promise<T> => {
  const previous = syncMutex;
  let release!: () => void;
  syncMutex = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await task();
  } finally {
    release();
  }
};


const notify = () => listeners.forEach((l) => l());

const setState = (patch: Partial<OrderState>) => {
  state = { ...state, ...patch };
  notify();
};


const serializeError = (error: unknown) => {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  if (typeof error === 'object' && error) {
    return error;
  }
  return { value: String(error) };
};

const isUnreadPublicLead = (order: Order) =>
  order.leadSource === 'public_form' && order.leadUnread === true && !order.isArchived;


const playLeadAlertFeedback = () => {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate([200, 100, 200, 100, 200]);
  }

  const AudioContextCtor = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextCtor) return;
  try {
    const ctx = new AudioContextCtor();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.value = 0.0001;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;
    gain.gain.exponentialRampToValueAtTime(0.4, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
    osc.start(now);
    osc.stop(now + 0.45);
    // Second beep
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.value = 1100;
    gain2.gain.value = 0.0001;
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    gain2.gain.setValueAtTime(0.0001, now + 0.5);
    gain2.gain.exponentialRampToValueAtTime(0.4, now + 0.55);
    gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.85);
    osc2.start(now + 0.5);
    osc2.stop(now + 0.9);
    window.setTimeout(() => { void ctx.close(); }, 1200);
  } catch {
    // no-op
  }
};

const notifyAboutIncomingLeads = (previousOrders: Order[], nextOrders: Order[]) => {
  const previousIds = new Set(previousOrders.map((order) => order.id));
  const newUnreadLeads = nextOrders.filter((order) => isUnreadPublicLead(order) && !previousIds.has(order.id));

  if (newUnreadLeads.length === 0) return;
  playLeadAlertFeedback();

  newUnreadLeads.forEach((lead) => {
    const title = '🔔 Новый лид!';
    const message = `${lead.brand || '-'} ${lead.model || ''} - ${lead.clientName || 'без имени'}`.trim();

    pushNotification({
      type: NotificationType.ORDER_NEW,
      title,
      message,
      orderId: lead.id,
      phone: lead.customerContact,
      brand: lead.brand,
      carModel: lead.model,
      carYear: Number(lead.year) || undefined,
      source: 'web_form',
      route: `/order/${lead.id}`,
      severity: 'success',
      signature: `incoming-lead:${lead.id}:${lead.updatedAt || lead.createdAt || ''}`
    });

    void sendBrowserNotification(title, {
      body: message,
      icon: '/icon-192.png',
      tag: `lead-${lead.id}`,
      renotify: true,
      requireInteraction: true,
      silent: false,
      vibrate: [250, 120, 250, 120, 250],
      route: `/order/${lead.id}`
    });
  });
};
const getMissingColumnName = (error: unknown): string | null => {
  if (typeof error !== 'object' || !error) return null;
  const anyErr = error as { code?: unknown; message?: unknown };
  if (typeof anyErr.message !== 'string') return null;

  const message = anyErr.message;
  if (anyErr.code === 'PGRST204') {
    const match = message.match(/Could not find the '([^']+)' column of 'orders'/);
    return match?.[1] || null;
  }

  if (anyErr.code === '42703') {
    const postgresMatch = message.match(/column\s+orders\.([a-zA-Z0-9_]+)\s+does not exist/i);
    const quotedMatch = message.match(/column\s+["']?orders["']?\.["']?([a-zA-Z0-9_]+)["']?\s+does not exist/i);
    return postgresMatch?.[1] || quotedMatch?.[1] || null;
  }

  return null;
};

const fetchOrdersPage = async (orderColumns: string[], from: number, to: number) => {
  if (!supabase) return { data: null, error: null };

  const partColumns = getSelectableColumns('parts');
  const variantColumns = getSelectableColumns('price_variants');
  const partsJoin = `parts(${partColumns.join(',')}, price_variants(${variantColumns.join(',')}))`;
  const selectQuery = `${orderColumns.join(',')}, ${partsJoin}`;

  const ordersResponse = await supabase
    .from('orders')
    .select(selectQuery)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (ordersResponse.error || !ordersResponse.data) {
    return { data: null, error: ordersResponse.error };
  }

  return { data: ordersResponse.data as DbOrderGraphRow[], error: null };
};


const fetchOrdersGraphWithSchemaFallbacks = async () => {
  if (!supabase) return { data: null, error: null };

  let orderColumns = getSelectableColumns('orders');
  const collectedOrders: DbOrderGraphRow[] = [];
  let offset = 0;

  while (true) {
    const response = await fetchOrdersPage(orderColumns, offset, offset + ORDER_PAGE_SIZE - 1);

    if (!response.error) {
      const page = Array.isArray(response.data) ? response.data : [];
      collectedOrders.push(...page);
      if (page.length < ORDER_PAGE_SIZE) {
        return { data: collectedOrders, error: null };
      }
      offset += ORDER_PAGE_SIZE;
      continue;
    }

    const missingColumn = getMissingColumnName(response.error);
    if (!missingColumn || !orderColumns.includes(missingColumn)) {
      return response;
    }

    const isNewlyMissing = markMissingColumn('orders', missingColumn);
    if (isNewlyMissing && !schemaMissingColumns.has(missingColumn)) {
      schemaMissingColumns.add(missingColumn);
      addMissingColumns([missingColumn]);
      syncPerf.addSchemaWarning(`orders.${missingColumn}`);
      logSyncCategory('SCHEMA_MISMATCH', 'column_missing', { table: 'orders', column: missingColumn });
      await logger.warn('sync:fetch', `schema_missing_columns: ["${missingColumn}"]`);
      await logDatabaseIntegrity('sync:fetch', response.error, { column: missingColumn });
    }
    orderColumns = orderColumns.filter((column) => column !== missingColumn);
  }
};

const isTimestamptzTimestampInputError = (error: unknown) => {
  if (typeof error !== 'object' || !error) return false;
  const anyErr = error as { code?: unknown; message?: unknown };
  return (
    (anyErr.code === '22007' || anyErr.code === '22008' || anyErr.code === '22P02') &&
    typeof anyErr.message === 'string' &&
    (anyErr.message.includes('timestamp with time zone') || anyErr.message.includes('date/time field value'))
  );
};

const isOrderTimestampInputError = (error: unknown) => {
  if (typeof error !== 'object' || !error) return false;
  const anyErr = error as { code?: unknown; message?: unknown };
  return (
    (anyErr.code === '22007' || anyErr.code === '22008' || anyErr.code === '22P02')
    && typeof anyErr.message === 'string'
    && (anyErr.message.includes('timestamp') || anyErr.message.includes('date/time') || anyErr.message.includes('bigint'))
  );
};

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'object' && error) {
    const anyErr = error as { message?: unknown; code?: unknown; status?: unknown };
    const baseMessage = typeof anyErr.message === 'string' && anyErr.message ? anyErr.message : fallback;
    const code = typeof anyErr.code === 'string' ? anyErr.code : null;
    const status = typeof anyErr.status === 'number' || typeof anyErr.status === 'string' ? String(anyErr.status) : null;

    if (code || status) {
      return `${baseMessage}${status ? ` (status: ${status})` : ''}${code ? ` [code: ${code}]` : ''}`;
    }

    return baseMessage;
  }
  return fallback;
};

const isOrdersTableMissingFromSchemaCache = (error: unknown) => {
  if (!error) return false;

  const stack: unknown[] = [error];
  const visited = new Set<unknown>();

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);

    if (typeof current === 'string') {
      const probe = current.toLowerCase();
      if (probe.includes('public.orders') && probe.includes('schema cache')) return true;
      continue;
    }

    if (typeof current !== 'object') continue;

    const anyErr = current as { code?: unknown; message?: unknown; details?: unknown; error?: unknown; raw?: unknown; status?: unknown };
    const code = typeof anyErr.code === 'string' ? anyErr.code.toUpperCase() : '';
    const status = Number(anyErr.status);
    const message = typeof anyErr.message === 'string' ? anyErr.message : '';
    const details = typeof anyErr.details === 'string' ? anyErr.details : '';
    const probe = `${message} ${details}`.toLowerCase();

    if ((code === 'PGRST205' || code === 'SCHEMA_MISMATCH') && probe.includes('public.orders') && probe.includes('schema cache')) {
      return true;
    }
    // Also treat a plain 404 on the orders table as a schema cache miss so we retry
    if (status === 404 && (probe.includes('orders') || probe.includes('not found'))) {
      return true;
    }

    if (anyErr.error) stack.push(anyErr.error);
    if (anyErr.raw) stack.push(anyErr.raw);
    if (message) stack.push(message);
    if (details) stack.push(details);
  }

  return false;
};

const broadcastSyncError = (error: unknown, fallback: string) => {
  const normalized = normalizeSyncError(error, fallback);
  syncPerf.setLastError(normalized.message);
  const message = `${normalized.humanMessage} [${normalized.code}]`;
  void logger.error('sync:error', message, { fallback, code: normalized.code, actions: normalized.actions, error: serializeError(error) });
  void logDatabaseIntegrity('sync:error', error, { fallback });
  setState({ error: message });
  setSyncStatus(navigator.onLine ? 'error' : 'offline');
  if (
    normalized.code.startsWith('PGRST')
    || normalized.code.startsWith('42')
    || normalized.code.startsWith('SUPABASE_')
  ) {
    setLastSupabaseError(normalized);
  }
  if (normalized.code.includes('IDB') || normalized.code.includes('QUEUE')) {
    setLastIndexedDbError(normalized);
  }
  window.dispatchEvent(new CustomEvent('cloud-sync-error', { detail: { message, code: normalized.code, actions: normalized.actions } }));
};

const isNetworkError = (error: unknown) => {
  const message = getErrorMessage(error, '').toLowerCase();
  if (message.includes('load failed') || message.includes('failed to fetch') || message.includes('network')) return true;
  if (typeof error === 'object' && error) {
    const anyErr = error as { status?: unknown; code?: unknown };
    const status = Number(anyErr.status);
    if (status >= 500 || status === 0 || Number.isNaN(status)) return true;
    if (typeof anyErr.code === 'string' && ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'].includes(anyErr.code.toUpperCase())) return true;
  }
  return false;
};

const isSchemaError = (error: unknown) => {
  if (getMissingColumnName(error)) return true;
  if (typeof error !== 'object' || !error) return false;
  const anyErr = error as { status?: unknown; message?: unknown; code?: unknown };
  const status = Number(anyErr.status);
  const message = typeof anyErr.message === 'string' ? anyErr.message.toLowerCase() : '';
  const code = typeof anyErr.code === 'string' ? anyErr.code.toUpperCase() : '';
  return status === 400 || status === 404
    || code === 'PGRST204'
    || code === '42703'
    || message.includes('column does not exist')
    || message.includes('schema cache');
};

const classifySyncError = (error: unknown): 'network' | 'schema' | 'unknown' => {
  if (isSchemaError(error)) return 'schema';
  if (isNetworkError(error)) return 'network';
  return 'unknown';
};

const deleteRemoteOrderWithStorageCleanup = async (orderId: string) => {
  if (!supabase || !isUuid(orderId)) return;

  const { error } = await supabase.from('orders').delete().eq('id', orderId);
  if (error) throw error;

  try {
    await deleteOrderFolderFromStorage(orderId);
  } catch (storageError) {
    await logger.warn('storage:cleanup', `Storage cleanup warning for order ${orderId}`, {
      error: serializeError(storageError)
    });
  }
};

const mapDbOrder = (row: DbOrderGraphRow): Order => ({
  ...normalizeOrder({
    id: String(row.id),
    brand: row.brand,
    model: row.model,
    year: row.year || '',
    bodyType: row.body_type || '',
    vin: row.vin || '',
    vinPhotoUrl: row.vin_photo_url || '',
    priority: row.priority,
    clientName: row.client_name || '',
    source: row.source || 'Другое',
    carPhotos: row.car_photos || [],
    carPhotoUrl: row.car_photo_url || row.car_photos?.[0],
    parts: (row.parts || []).map((part) => ({
      id: String(part.id),
      orderId: String(part.order_id),
      name: part.name,
      photos: part.photos || [],
      photoUrl: part.photo_url || part.photos?.[0],
      isFound: !!part.is_found,
      variants: (part.price_variants || []).map((v): PriceVariant => ({
        id: String(v.id),
        partId: String(v.part_id),
        priceAed: Number(v.price_aed || 0),
        shopName: v.shop_name || '',
        phone: v.phone || '',
        location: v.location || '',
        photos: v.photos || [],
        photoUrl: v.photo_url || v.photos?.[0],
        createdAt: parseTimestamp(v.created_at)
      }))
    })),
    markupPercent: Number(row.markup_percent || 0),
    markupType: row.markup_type || 'percent',
    markupFixedAed: Number(row.markup_fixed_aed || 0),
    useMarkupAsDefaultForNewParts: !!row.use_markup_as_default_for_new_parts,
    clientCurrency: row.client_currency || 'USD',
    fxUpdatedAt: Number.isFinite(Number(row.fx_updated_at)) ? Number(row.fx_updated_at) : undefined,
    logistics: normalizeLogistics(row.logistics),
    exchangeRate: Number(row.exchange_rate || 0),
    createdAt: parseTimestamp(row.created_at),
    isArchived: !!row.is_archived,
    isSold: !!row.is_sold,
    soldProfitUsd: row.sold_profit_usd ?? undefined,
    isVip: !!row.is_vip,
    isPinned: !!row.is_pinned,
    isLead: !!row.is_lead,
    notes: row.notes || [],
    status: row.status || 'active',
    salesStatus: row.sales_status || 'Inquiry',
    customerStatus: (row as any).customer_status || undefined,
    customerContact: row.customer_contact || '',
    socialNickname: row.social_nickname || '',
    updatedAt: parseTimestamp(row.updated_at ?? row.created_at),
    recommendedShopIds: Array.isArray(row.recommended_shop_ids) ? row.recommended_shop_ids : [],
    dismissedShopIds: Array.isArray(row.dismissed_shop_ids) ? row.dismissed_shop_ids : [],
    leadUnread: !!(row as any).lead_unread,
    leadSource: (row as any).lead_source === 'public_form' ? 'public_form' : 'manual',
    leadReadAt: Number.isFinite(Number((row as any).lead_read_at)) ? Number((row as any).lead_read_at) : undefined,
    pricingEvents: Array.isArray((row as any).pricing_events) ? (row as any).pricing_events : []
  })
});

const withUploadedPhotos = async (order: Order): Promise<Order> => {
  const orderId = ensureUuid(order.id);
  const skipUpload = !!order.localOnlyPhotos;
  const carPhotos = await ensurePublicImageUrls(order.carPhotos || [], `orders/${orderId}/car`, { skipUpload });

  const notes = await Promise.all(
    (order.notes || []).map(async (note, noteIndex) => {
      const notePhotos = await ensurePublicImageUrls(note.photos || [], `orders/${orderId}/notes/${note.id || noteIndex}`, { skipUpload });
      return { ...note, photos: notePhotos };
    })
  );

  const parts: Part[] = await Promise.all(
    (order.parts || []).map(async (part) => {
      const partId = ensureUuid(part.id);
      const partPhotos = await ensurePublicImageUrls(part.photos || [], `orders/${orderId}/parts/${partId}`, { skipUpload });

      const variants = await Promise.all(
        (part.variants || []).map(async (variant) => {
          const variantId = ensureUuid(variant.id);
          const variantPhotos = await ensurePublicImageUrls(
            variant.photos || [],
            `orders/${orderId}/parts/${partId}/variants/${variantId}`,
            { skipUpload }
          );

          return { ...variant, id: variantId, partId, photos: variantPhotos, photoUrl: variantPhotos[0] };
        })
      );

      return { ...part, id: partId, orderId, photos: partPhotos, photoUrl: partPhotos[0], variants };
    })
  );

  return { ...order, id: orderId, carPhotos, carPhotoUrl: carPhotos[0], notes, parts };
};

const persistOrderGraph = async (order: Order) => {
  if (!supabase) return normalizeOrder(order);
  const uploadedOrder = await withUploadedPhotos(order);
  const cloudOrder = uploadedOrder.localOnlyPhotos
    ? {
        ...uploadedOrder,
        carPhotoUrl: undefined,
        carPhotos: [],
        parts: (uploadedOrder.parts || []).map((part) => ({
          ...part,
          photoUrl: undefined,
          photos: [],
          variants: (part.variants || []).map((variant) => ({ ...variant, photoUrl: undefined, photos: [] }))
        }))
      }
    : uploadedOrder;

  await logger.info('sync:persist', `Step 1/3 upsert order ${uploadedOrder.id}`);

  const buildOrderPayload = () => ({
    id: uploadedOrder.id,
    brand: uploadedOrder.brand,
    model: uploadedOrder.model,
    year: uploadedOrder.year,
    body_type: uploadedOrder.bodyType || null,
    vin: uploadedOrder.vin,
    vin_photo_url: uploadedOrder.vinPhotoUrl || null,
    status: getStatus(uploadedOrder),
    priority: uploadedOrder.priority,
    client_name: uploadedOrder.clientName,
    source: uploadedOrder.source,
    car_photo_url: cloudOrder.carPhotoUrl,
    car_photos: cloudOrder.carPhotos || [],
    markup_percent: uploadedOrder.markupPercent,
    markup_type: uploadedOrder.markupType || 'percent',
    markup_fixed_aed: Number(uploadedOrder.markupFixedAed || 0),
    use_markup_as_default_for_new_parts: !!uploadedOrder.useMarkupAsDefaultForNewParts,
    client_currency: uploadedOrder.clientCurrency || 'USD',
    fx_updated_at: uploadedOrder.fxUpdatedAt ? toIsoTimestamp(uploadedOrder.fxUpdatedAt) : null,
    logistics: uploadedOrder.logistics || null,
    exchange_rate: uploadedOrder.exchangeRate,
    created_at: toIsoTimestamp(uploadedOrder.createdAt),
    is_archived: uploadedOrder.isArchived,
    is_sold: uploadedOrder.isSold,
    sold_profit_usd: uploadedOrder.soldProfitUsd,
    is_vip: !!uploadedOrder.isVip,
    is_pinned: !!uploadedOrder.isPinned,
    is_lead: !!uploadedOrder.isLead,
    customer_status: uploadedOrder.customerStatus || null,
    notes: uploadedOrder.notes || [],
    customer_contact: uploadedOrder.customerContact || '',
    social_nickname: uploadedOrder.socialNickname || '',
    recommended_shop_ids: uploadedOrder.recommendedShopIds || [],
    dismissed_shop_ids: uploadedOrder.dismissedShopIds || [],
    lead_unread: !!uploadedOrder.leadUnread,
    lead_source: uploadedOrder.leadSource || 'manual',
    lead_read_at: uploadedOrder.leadReadAt ? toIsoTimestamp(uploadedOrder.leadReadAt) : null,
    pricing_events: uploadedOrder.pricingEvents || []
  });

  const upsertOrderWithSchemaFallbacks = async () => {
    const fallbackOrderPayload: Record<string, unknown> = {
      ...buildOrderPayload(),
      sales_status: uploadedOrder.salesStatus || 'Inquiry',
      updated_at: toIsoTimestamp(uploadedOrder.updatedAt || Date.now())
    };

    const fallbackColumns = new Set([
      'sales_status',
      'vin_photo_url',
      'customer_contact',
      'social_nickname',
      'recommended_shop_ids',
      'dismissed_shop_ids',
      'body_type',
      'customer_status',
      'lead_unread',
      'lead_source',
      'lead_read_at',
      'markup_type',
      'markup_fixed_aed',
      'use_markup_as_default_for_new_parts',
      'client_currency',
      'fx_updated_at',
      'logistics',
      'pricing_events'
    ]);

    let payload: Record<string, unknown> = { ...fallbackOrderPayload };
    let { error: orderError } = await supabase.from('orders').upsert(payload, { onConflict: 'id' });

    if (orderError && isOrderTimestampInputError(orderError)) {
      await logger.warn('sync:persist', 'Order timestamp normalization detected invalid input; retrying with ISO datetime values');
      ({ error: orderError } = await supabase.from('orders').upsert(payload, { onConflict: 'id' }));
    }

    while (orderError) {
      const missingColumn = getMissingColumnName(orderError);
      if (!missingColumn || !fallbackColumns.has(missingColumn) || !(missingColumn in payload)) {
        break;
      }

      await logger.warn('sync:persist', `orders.${missingColumn} is missing in remote schema; retrying upsert without that column`);
      await logDatabaseIntegrity('sync:persist', orderError, { column: missingColumn });
      const { [missingColumn]: _ignored, ...reducedPayload } = payload;
      payload = reducedPayload;
      ({ error: orderError } = await supabase.from('orders').upsert(payload, { onConflict: 'id' }));
    }

    return orderError;
  };

  const orderError = await upsertOrderWithSchemaFallbacks();

  if (orderError) {
    await logger.error('sync:persist', `Step 1/3 failed for order ${uploadedOrder.id}`, { error: serializeError(orderError) });
    throw orderError;
  }

  await logger.info('sync:persist', `Step 1/3 success for order ${uploadedOrder.id}`);

  const existingPartIdsResponse = await supabase
    .from('parts')
    .select('id')
    .eq('order_id', uploadedOrder.id);

  if (existingPartIdsResponse.error) {
    await logger.error('sync:persist', `Step 1.5/3 failed to read existing parts for order ${uploadedOrder.id}`, {
      error: serializeError(existingPartIdsResponse.error)
    });
    throw existingPartIdsResponse.error;
  }

  const existingPartIds = (existingPartIdsResponse.data || [])
    .map((row) => String((row as { id?: unknown }).id || ''))
    .filter(Boolean);

  if (existingPartIds.length > 0) {
    await logger.info('sync:persist', `Step 1.6/3 cleanup existing graph for order ${uploadedOrder.id}`, {
      existingPartCount: existingPartIds.length
    });
    const { error: deleteVariantsError } = await supabase
      .from('price_variants')
      .delete()
      .in('part_id', existingPartIds);
    if (deleteVariantsError) {
      await logger.error('sync:persist', `Step 1.6/3 failed to cleanup variants for order ${uploadedOrder.id}`, {
        error: serializeError(deleteVariantsError)
      });
      throw deleteVariantsError;
    }

    const { error: deletePartsError } = await supabase
      .from('parts')
      .delete()
      .eq('order_id', uploadedOrder.id);
    if (deletePartsError) {
      await logger.error('sync:persist', `Step 1.6/3 failed to cleanup parts for order ${uploadedOrder.id}`, {
        error: serializeError(deletePartsError)
      });
      throw deletePartsError;
    }
  }

  const partRows = (cloudOrder.parts || []).map((part) => ({
    id: part.id,
    order_id: uploadedOrder.id,
    name: part.name,
    photo_url: part.photoUrl,
    photos: part.photos || [],
    is_found: !!part.isFound
  }));

  for (let i = 0; i < partRows.length; i += 50) {
    const batch = partRows.slice(i, i + 50);
    await logger.info('sync:persist', `Step 2/3 upsert parts batch for order ${uploadedOrder.id}`, {
      batchSize: batch.length,
      payloadBytes: JSON.stringify(batch).length
    });
    let { error: partError } = await supabase.from('parts').upsert(batch, { onConflict: 'id' });
    let currentPartBatch: Record<string, unknown>[] = batch as Record<string, unknown>[];
    while (partError) {
      const missingPartCol = getMissingColumnName(partError);
      if (!missingPartCol) break;
      await logger.warn('sync:persist', `parts.${missingPartCol} missing; retrying without it`);
      currentPartBatch = currentPartBatch.map(({ [missingPartCol]: _ignored, ...rest }) => rest);
      ({ error: partError } = await supabase.from('parts').upsert(currentPartBatch, { onConflict: 'id' }));
    }
    if (partError) {
      await logger.error('sync:persist', `Step 2/3 failed for order ${uploadedOrder.id}`, { error: serializeError(partError) });
      throw partError;
    }
  }

  const variantRows = (cloudOrder.parts || []).flatMap((part) =>
    (part.variants || []).map((variant) => ({
      id: variant.id,
      part_id: part.id,
      price_aed: variant.priceAed,
      shop_name: variant.shopName,
      phone: variant.phone,
      location: variant.location,
      photo_url: variant.photoUrl,
      photos: variant.photos || [],
      created_at: parseTimestamp(variant.createdAt)
    }))
  );

  for (let i = 0; i < variantRows.length; i += 50) {
    const batch = variantRows.slice(i, i + 50);
    await logger.info('sync:persist', `Step 3/3 upsert variants batch for order ${uploadedOrder.id}`, {
      batchSize: batch.length,
      payloadBytes: JSON.stringify(batch).length
    });
    let { error: variantError } = await supabase.from('price_variants').upsert(batch, { onConflict: 'id' });

    if (variantError && isTimestamptzTimestampInputError(variantError)) {
      await logger.warn('sync:persist', 'price_variants.created_at expects timestamptz; retrying with ISO timestamps');
      ({ error: variantError } = await supabase.from('price_variants').upsert(
        batch.map((row) => ({ ...row, created_at: toIsoTimestamp(row.created_at) })),
        { onConflict: 'id' }
      ));
    }

    let currentVariantBatch: Record<string, unknown>[] = batch as Record<string, unknown>[];
    while (variantError) {
      const missingVariantCol = getMissingColumnName(variantError);
      if (!missingVariantCol) break;
      await logger.warn('sync:persist', `price_variants.${missingVariantCol} missing; retrying without it`);
      currentVariantBatch = currentVariantBatch.map(({ [missingVariantCol]: _ignored, ...rest }) => rest);
      ({ error: variantError } = await supabase.from('price_variants').upsert(currentVariantBatch, { onConflict: 'id' }));
    }

    if (variantError) {
      await logger.error('sync:persist', `Step 3/3 failed for order ${uploadedOrder.id}`, { error: serializeError(variantError) });
      throw variantError;
    }
  }

  await logger.info('sync:persist', `Order graph persisted ${uploadedOrder.id}`);
  return normalizeOrder(uploadedOrder);
};


const hasStructuralDiff = (previous: Order | undefined, next: Order) => {
  if (!previous) return true;
  return JSON.stringify(previous.parts || []) !== JSON.stringify(next.parts || [])
    || JSON.stringify(previous.notes || []) !== JSON.stringify(next.notes || [])
    || JSON.stringify(previous.pricingEvents || []) !== JSON.stringify(next.pricingEvents || [])
    || JSON.stringify(previous.carPhotos || []) !== JSON.stringify(next.carPhotos || []);
};

const pickHotFieldPatch = (previous: Order | undefined, next: Order): Partial<Order> => {
  const patch: Partial<Order> = {};
  for (const key of hotFieldKeys) {
    if (!previous || previous[key] !== next[key]) patch[key] = next[key] as never;
  }
  return patch;
};

const scheduleBackgroundFlush = () => {
  const timerKey = '__network_flush__';
  const existing = mutationTimers.get(timerKey);
  if (existing) window.clearTimeout(existing);
  if (LOCAL_ONLY) return;
  mutationTimers.set(timerKey, window.setTimeout(() => {
    mutationTimers.delete(timerKey);
    if (navigator.onLine && document.visibilityState === 'visible') void flushOfflineMutations();
  }, networkFlushTimerMs));
};

const scheduleLocalCommit = (order: Order, patchOnly?: Partial<Order>) => {
  const existing = localCommitTimers.get(order.id);
  if (existing) {
    window.clearTimeout(existing);
    localCommitTimers.delete(order.id);
  }
  if (patchOnly && Object.keys(patchOnly).length > 0) {
    void offlineDb.saveOrderPatch(order.id, patchOnly);
    return;
  }
  void offlineDb.saveOrder(order);
};


const toOrderPatchPayload = (patch: Partial<Order>) => ({
  markup_percent: patch.markupPercent,
  markup_type: patch.markupType,
  markup_fixed_aed: patch.markupFixedAed,
  exchange_rate: patch.exchangeRate,
  client_currency: patch.clientCurrency,
  fx_updated_at: patch.fxUpdatedAt ? toIsoTimestamp(patch.fxUpdatedAt) : undefined,
  logistics: patch.logistics,
  pricing_events: patch.pricingEvents,
  is_vip: typeof patch.isVip === 'boolean' ? patch.isVip : undefined,
  is_pinned: typeof patch.isPinned === 'boolean' ? patch.isPinned : undefined,
  customer_status: patch.customerStatus,
  updated_at: toIsoTimestamp(patch.updatedAt || Date.now())
});

const persistOrderPatch = async (orderId: string, patch: Partial<Order>) => {
  if (!supabase || !Object.keys(patch).length) return;
  const payload = toOrderPatchPayload(patch);
  let cleanPayload = Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
  const payloadBytes = JSON.stringify(cleanPayload).length;
  const startedAt = Date.now();
  syncPerf.recordNetworkRequest();
  syncPerf.setLastNetworkRequest({ operation: 'orders.patch', orderId, bytes: payloadBytes });
  await logger.info('sync:persist', `PATCH orders ${orderId}`, { payloadBytes });
  let { error } = await supabase.from('orders').update(cleanPayload).eq('id', orderId);

  while (error) {
    const missingColumn = getMissingColumnName(error);
    if (!missingColumn || !(missingColumn in cleanPayload)) break;
    markMissingColumn('orders', missingColumn);
    addMissingColumns([missingColumn]);
    syncPerf.addSchemaWarning(`orders.${missingColumn}`);
    await logger.warn('sync:persist', `orders.${missingColumn} missing during patch; retrying without it`, { orderId });
    cleanPayload = Object.fromEntries(Object.entries(cleanPayload).filter(([key]) => key !== missingColumn));
    ({ error } = await supabase.from('orders').update(cleanPayload).eq('id', orderId));
  }

  if (error) throw error;
  await logger.info('sync:persist', `PATCH orders success ${orderId}`, { durationMs: Date.now() - startedAt, payloadBytes });
};

const queueMutation = async (type: 'upsert' | 'delete', order: Order | undefined, orderId: string, patch?: Partial<Order>) => {
  if (LOCAL_ONLY) return;
  await logger.warn('sync:queue', `Queueing ${type} for order ${orderId}`);
  const mutationId = createUuid();
  await offlineDb.enqueueMutation({
    id: mutationId,
    mutationId,
    type: patch && !order ? 'patch' : type,
    table: 'orders',
    primaryKey: orderId,
    orderId,
    entity: 'orders',
    entityId: orderId,
    operation: patch && !order ? 'patch' : type,
    payload: order,
    patch,
    createdAt: Date.now(),
    attemptCount: 0,
    retryCount: 0,
    lastError: null
  });
  cachedQueueLength = await offlineDb.getMutationCount();
  syncPerf.setQueueLength(cachedQueueLength);

  if (navigator.onLine && document.visibilityState === 'visible') scheduleBackgroundFlush();

  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.ready;
      if ('sync' in registration) {
        await (registration as ServiceWorkerRegistration & { sync: { register: (tag: string) => Promise<void> } }).sync.register('orders-background-sync');
      }
    } catch (error) {
      await logger.warn('sync:queue', 'Background sync registration failed', { error: serializeError(error) });
    }
  }
};

export const flushOfflineMutations = async (options?: { force?: boolean }) => runWithSyncMutex(async () => {
  const force = options?.force === true;
  if (LOCAL_ONLY) {
    setSyncStatus('online');
    setState({ isSyncing: false });
    return;
  }
  if (syncInProgress || !navigator.onLine || !isCloudSyncConfigured || !supabase || isIdbAutoSyncPaused()) return;
  if (!force && document.visibilityState !== 'visible') return;
  if (!force && syncPausedUntil > Date.now()) {
    syncPerf.setNextRetryAt(syncPausedUntil);
    return;
  }

  syncInProgress = true;
  logSyncCategory('SYNC_STATE', 'flush_started');
  setSyncStatus('online');
  setState({ isSyncing: false });

  try {
    const pending = await offlineDb.getMutations();
    if (!pending.length) {
      syncPerf.setQueueLength(0);
      syncPerf.setNextRetryAt(null);
      syncPerf.markSynced();
      return;
    }

    let earliestDeferredRetryAt = 0;
    syncPerf.setQueueLength(pending.length);
    await logger.info('sync:flush', `Flush started with ${pending.length} pending mutations`);

    for (const mutation of pending) {
      if (Number(mutation.nextRetryAt || 0) > Date.now()) {
        if (!earliestDeferredRetryAt || Number(mutation.nextRetryAt) < earliestDeferredRetryAt) earliestDeferredRetryAt = Number(mutation.nextRetryAt);
        continue;
      }

      await logger.info('sync:flush', `Processing mutation ${mutation.id}`, {
        operation: mutation.operation || mutation.type,
        table: mutation.table || mutation.entity || 'orders',
        orderId: mutation.orderId,
        attempt: Number((mutation.attemptCount ?? mutation.retryCount) || 0)
      });

      try {
        setSyncStatus('syncing');
        setState({ isSyncing: true });
        syncPerf.setActiveRequest(true);
        const startedAt = Date.now();

        if (mutation.table === 'public_quote_snapshots' && mutation.payload) {
          const payloadBytes = JSON.stringify(mutation.payload).length;
          syncPerf.recordNetworkRequest();
          syncPerf.setLastNetworkRequest({ operation: 'public_quote_snapshots.upsert', orderId: mutation.orderId, bytes: payloadBytes });
          const { error } = await supabase
            .from('public_quote_snapshots')
            .upsert(mutation.payload as Record<string, unknown>, { onConflict: 'token' });
          if (error) throw error;
        } else if (mutation.type === 'delete') {
          if (isUuid(mutation.orderId)) {
            await deleteRemoteOrderWithStorageCleanup(mutation.orderId);
          }
          // If the deleted order was a public_form lead, ensure client_leads is also purged
          const deletedOrder = mutation.payload as Order | undefined;
          if (deletedOrder && (deletedOrder.leadSource === 'public_form' || deletedOrder.isLead)) {
            await purgePublicLeadArtifacts(mutation.orderId);
          }
        } else if (mutation.patch && !mutation.payload) {
          await persistOrderPatch(mutation.orderId, mutation.patch as Partial<Order>);
        } else if (mutation.payload) {
          const typedPayload = mutation.payload as Order;
          const payloadBytes = JSON.stringify(typedPayload).length;
          syncPerf.recordNetworkRequest();
          syncPerf.setLastNetworkRequest({ operation: 'orders.graph_upsert', orderId: mutation.orderId, bytes: payloadBytes });
          await logger.info('sync:flush', `Sending payload for ${mutation.orderId}`, { payloadBytes, table: mutation.table || 'orders' });
          const saved = await persistOrderGraph(typedPayload);
          await offlineDb.saveOrder(saved);
        }

        await offlineDb.removeMutation(mutation.id);
        const queueLength = await offlineDb.getMutationCount();
        cachedQueueLength = queueLength;
        syncPerf.setQueueLength(queueLength);
        syncPerf.setLastErrorType(null);
        syncPerf.setLastError(null);
        syncPausedUntil = 0;

        await logger.info('sync:flush', `Mutation ${mutation.id} synced`, {
          durationMs: Date.now() - startedAt,
          queueLength
        });
      } catch (error) {
        const errorType = classifySyncError(error);
        const retryCount = Number((mutation.attemptCount ?? mutation.retryCount) || 0) + 1;
        const nextRetryAt = Date.now();
        const isTimeoutLike = isNetworkError(error);

        syncPerf.setLastErrorType(errorType);
        syncPerf.setLastError(getErrorMessage(error, 'Mutation failed'));

        if (errorType === 'schema') {
          await offlineDb.removeMutation(mutation.id);
          await logger.error('sync:flush', `Schema mismatch for mutation ${mutation.id}; retries stopped`, {
            error: serializeError(error),
            orderId: mutation.orderId
          });
        } else if (retryCount > MAX_MUTATION_RETRY) {
          await offlineDb.removeMutation(mutation.id);
          await logger.error('sync:flush', `Mutation ${mutation.id} dropped after max retries`, { error: serializeError(error) });
        } else {
          syncPerf.markRetry();
          await offlineDb.enqueueMutation({
            ...mutation,
            attemptCount: retryCount,
            retryCount,
            lastError: getErrorMessage(error, 'Mutation failed'),
            nextRetryAt
          });
          if (!earliestDeferredRetryAt || nextRetryAt < earliestDeferredRetryAt) earliestDeferredRetryAt = nextRetryAt;
          if (isTimeoutLike) {
            syncPausedUntil = Math.max(syncPausedUntil, nextRetryAt);
            setSyncStatus('error');
          }
          await logger.warn('sync:flush', `Mutation ${mutation.id} failed`, {
            retryCount,
            nextRetryAt,
            pausedUntil: syncPausedUntil || null,
            error: serializeError(error)
          });
        }

        cachedQueueLength = await offlineDb.getMutationCount();
        syncPerf.setQueueLength(cachedQueueLength);
      } finally {
        syncPerf.setActiveRequest(false);
        setState({ isSyncing: false });
      }
    }

    if (earliestDeferredRetryAt > Date.now()) {
      setSyncStatus('error');
      syncPerf.setNextRetryAt(earliestDeferredRetryAt);
      return;
    }

    setSyncStatus('online');
    syncPerf.setNextRetryAt(null);
    syncPerf.markSynced();
    logSyncCategory('SYNC_STATE', 'flush_completed');
  } catch (error: unknown) {
    logSyncCategory('SYNC_STATE', 'flush_failed');
    broadcastSyncError(error, 'Offline sync failed');
  } finally {
    syncPerf.setActiveRequest(false);
    syncInProgress = false;
    setState({ isSyncing: false });
  }
});

export const subscribeOrderStore = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getOrderState = () => state;

export const fetchOrders = async () => runWithSyncMutex(async () => {
  const now = Date.now();
  const shouldThrottleFetch = state.isHydrated
    && !state.isLoading
    && !syncInProgress
    && now - lastFullFetchAt < MIN_FULL_FETCH_INTERVAL_MS;
  if (shouldThrottleFetch) return;

  lastFullFetchAt = now;
  setState({ isLoading: true, error: null });
  await logger.info('sync:fetch', 'Starting order hydration');

  const localOrders = await offlineDb.getOrders();
  await logger.info('sync:fetch', `Loaded ${localOrders.length} local orders`);
  setState({ orders: localOrders.map(normalizeOrder), isHydrated: true });

  if (LOCAL_ONLY || !navigator.onLine || !isCloudSyncConfigured || !supabase || isIdbAutoSyncPaused()) {
    await logger.info('sync:fetch', LOCAL_ONLY ? 'LOCAL_ONLY mode: using IndexedDB only' : 'Skipping cloud fetch (offline or missing supabase config)');
    setSyncStatus(navigator.onLine ? 'online' : 'offline');
    setState({ isLoading: false, isHydrated: true });
    return;
  }

  let { data, error } = await fetchOrdersGraphWithSchemaFallbacks();

  if (isOrdersTableMissingFromSchemaCache(error)) {
    await refreshSupabaseSchemaCache('orders-fetch-missing-table');
    const retry = await fetchOrdersGraphWithSchemaFallbacks();
    if (!retry.error) {
      data = retry.data;
      error = null;
      await logger.warn('sync:fetch', 'Orders sync recovered after schema cache refresh retry');
    }
  }

  const useLeadsOnlyFallback = isOrdersTableMissingFromSchemaCache(error);
  if (error && !useLeadsOnlyFallback) {
    const syncErrorType = classifySyncError(error);
    if (syncErrorType === 'network') {
      await logger.warn('sync:fetch', 'Cloud orders fetch failed due to network issue; keeping local orders cache', {
        error: serializeError(error)
      });
      setSyncStatus('offline');
      setState({ isLoading: false, isHydrated: true, error: null });
      return;
    }

    await logger.error('sync:fetch', 'Cloud orders fetch failed', { error: serializeError(error) });
    broadcastSyncError(error, error.message || 'Failed to load orders from Supabase');
    setState({ isLoading: false, isHydrated: true });
    return;
  }

  if (useLeadsOnlyFallback) {
    ordersTableUnavailable = true;
    await logger.warn('sync:fetch', 'Orders table missing in cloud schema cache; continuing with leads-only sync', {
      error: serializeError(error)
    });
  } else {
    ordersTableUnavailable = false;
  }

  let orders = useLeadsOnlyFallback
    ? localOrders.map(normalizeOrder)
    : (data || []).map(mapDbOrder);

  try {
    const leadsResponse = await leadsSync();

    if (leadsResponse.ok && Array.isArray(leadsResponse.data)) {
      const beforeMerge = orders.length;
      orders = await mergeCloudLeadsWithOrders(orders, leadsResponse.data);
      const newLeads = orders.length - beforeMerge;

      await logger.info('sync:fetch', `Merged ${leadsResponse.data.length} cloud leads into orders`, { newLeads });
    } else if (!leadsResponse.ok) {
      await logger.warn('sync:fetch', useLeadsOnlyFallback
        ? 'Lead sync failed while using leads-only fallback'
        : 'Lead sync failed, continuing with cloud orders only', {
        error: leadsResponse.error,
        code: leadsResponse.code
      });
    }
  } catch (error) {
    await logger.error('sync:fetch', 'Lead sync exception, continuing with orders only', {
      error: error instanceof Error ? error.message : String(error)
    });
  }

  const previousOrders = state.orders;
  await logger.info('sync:fetch', `Loaded ${orders.length} cloud orders`);
  const pendingMutations = await offlineDb.getMutations();
  cachedQueueLength = pendingMutations.length;
  syncPerf.setQueueLength(cachedQueueLength);
  await logger.info('sync:fetch', `Queue currently has ${pendingMutations.length} mutations`);

  if (orders.length === 0 && localOrders.length > 0 && pendingMutations.length > 0) {
    setState({ orders: localOrders.map(normalizeOrder), isLoading: false, isHydrated: true, error: null });
    void flushOfflineMutations();
    return;
  }

  const localById = new Map(localOrders.map((item) => [item.id, normalizeOrder(item)]));
  const pendingUpsertIds = new Set(pendingMutations.filter((mutation) => mutation.type === 'upsert').map((mutation) => mutation.orderId));
  const pendingDeleteIds = new Set(pendingMutations.filter((mutation) => mutation.type === 'delete').map((mutation) => mutation.orderId));

  const mergedOrders = orders
    .filter((cloudOrder) => !pendingDeleteIds.has(cloudOrder.id))
    .map((cloudOrder) => {
      if (!pendingUpsertIds.has(cloudOrder.id)) {
        // Preserve locally-saved financial fields if the server version is missing them
        // (e.g. when the remote schema lacks the logistics / pricing columns)
        const local = localById.get(cloudOrder.id);
        if (!local) return cloudOrder;
        return {
          ...cloudOrder,
          logistics: cloudOrder.logistics ?? local.logistics,
          markupPercent: cloudOrder.markupPercent ?? local.markupPercent,
          markupType: cloudOrder.markupType ?? local.markupType,
          markupFixedAed: cloudOrder.markupFixedAed ?? local.markupFixedAed,
          exchangeRate: cloudOrder.exchangeRate ?? local.exchangeRate,
          clientCurrency: cloudOrder.clientCurrency ?? local.clientCurrency,
          pricingEvents: (cloudOrder.pricingEvents && cloudOrder.pricingEvents.length > 0) ? cloudOrder.pricingEvents : local.pricingEvents,
        };
      }
      return localById.get(cloudOrder.id) || cloudOrder;
    });

  localById.forEach((localOrder, localId) => {
    if (!pendingUpsertIds.has(localId)) return;
    if (pendingDeleteIds.has(localId)) return;
    if (mergedOrders.some((order) => order.id === localId)) return;
    mergedOrders.push(localOrder);
  });

  await offlineDb.saveOrders(mergedOrders);
  setSyncStatus('online');
  setState({ orders: mergedOrders, isLoading: false, isHydrated: true, error: null });
  enqueueExistingImagesForCompression(mergedOrders);

  if (wasCloudHydratedAtLeastOnce) {
    notifyAboutIncomingLeads(previousOrders, mergedOrders);
  }
  wasCloudHydratedAtLeastOnce = true;

  if (pendingMutations.length > 0) {
    void flushOfflineMutations();
  }
});

const refreshLeadsOnly = async () => {
  if (LOCAL_ONLY || !navigator.onLine || !isCloudSyncConfigured || !state.isHydrated) return;
  if (syncInProgress || document.visibilityState !== 'visible') return;

  const now = Date.now();
  if (now - lastLeadRefreshAt < MIN_LEAD_REFRESH_INTERVAL_MS) return;
  lastLeadRefreshAt = now;

  try {
    const leadsResponse = await leadsSync();
    if (!leadsResponse.ok || !Array.isArray(leadsResponse.data) || leadsResponse.data.length === 0) return;
    const previousOrders = state.orders;
    const mergedOrders = await mergeCloudLeadsWithOrders(previousOrders, leadsResponse.data);
    const signature = (orders: Order[]) => orders
      .map((order) => `${order.id}:${order.updatedAt || order.createdAt || 0}:${order.leadUnread ? 1 : 0}`)
      .join('|');
    if (signature(mergedOrders) === signature(previousOrders)) return;
    setState({ orders: mergedOrders });
    enqueueExistingImagesForCompression(mergedOrders);
    await offlineDb.saveOrders(mergedOrders);
    if (wasCloudHydratedAtLeastOnce) {
      notifyAboutIncomingLeads(previousOrders, mergedOrders);
    }
  } catch (error) {
    await logger.warn('sync:leads-refresh', 'Leads-only refresh failed', {
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

export const fetchOrderDetails = async (orderId: string) => {
  if (!orderId || !isUuid(orderId) || ordersTableUnavailable || LOCAL_ONLY || !supabase || !navigator.onLine || !isCloudSyncConfigured) return;
  const orderColumns = getSelectableColumns('orders');
  const query = `${orderColumns.join(',')}, parts(*, price_variants(*))`;
  const response = await supabase.from('orders').select(query).eq('id', orderId).maybeSingle();
  if (response.error || !response.data) {
    await logger.warn('sync:fetch-details', 'Failed to load order details graph', {
      orderId,
      error: serializeError(response.error)
    });
    return;
  }

  const details = mapDbOrder(response.data as DbOrderGraphRow);
  const next = state.orders.map((order) => (order.id === details.id ? normalizeOrder({ ...order, ...details }) : order));
  setState({ orders: next });
  enqueueExistingImagesForCompression(next);
  await offlineDb.saveOrder(details);
};


const compressOrderImagesForAddFlow = async (order: Order): Promise<Order> => {
  const compressList = async (images: string[], labelPrefix: string) =>
    Promise.all(
      (images || []).map((image, index) => {
        if (!image.startsWith('data:image')) return Promise.resolve(image);
        return optimizeImageForUpload(image, `${labelPrefix}[${index}]`);
      })
    );

  const carPhotos = await compressList(order.carPhotos || [], `order:${order.id}:car`);
  const parts = await Promise.all(
    (order.parts || []).map(async (part) => {
      const partPhotos = await compressList(part.photos || [], `order:${order.id}:part:${part.id}`);
      const variants = await Promise.all(
        (part.variants || []).map(async (variant) => {
          const variantPhotos = await compressList(
            variant.photos || [],
            `order:${order.id}:part:${part.id}:variant:${variant.id}`
          );
          return { ...variant, photos: variantPhotos, photoUrl: variantPhotos[0] };
        })
      );

      return { ...part, photos: partPhotos, photoUrl: partPhotos[0], variants };
    })
  );

  return { ...order, carPhotos, carPhotoUrl: carPhotos[0], parts };
};

export const addOrderItem = async (order: Order) => {
  forgetLeadSyncOverrides(order.id);
  const compressedOrder = await compressOrderImagesForAddFlow(order);
  const localOrder = normalizeOrder({ ...compressedOrder, id: ensureUuid(compressedOrder.id) });
  pushNotification({
    type: NotificationType.ORDER_NEW,
    title: `Новый заказ: ${localOrder.brand} ${localOrder.model}`,
    message: `Клиент: ${localOrder.clientName || 'без имени'} · ${localOrder.year}`,
    orderId: localOrder.id,
    phone: localOrder.customerContact,
    brand: localOrder.brand,
    carModel: localOrder.model,
    carYear: Number(localOrder.year) || undefined,
    source: 'app',
    route: `/order/${localOrder.id}`,
    severity: localOrder.isVip ? 'critical' : 'info'
  });
  const next = [localOrder, ...state.orders.filter((o) => o.id !== localOrder.id)];
  setState({ orders: next, error: null });
  await offlineDb.saveOrder(localOrder);
  window.dispatchEvent(new CustomEvent('cloud-save-success'));

  await queueMutation('upsert', localOrder, localOrder.id);
  return true;
};

export const updateOrderItem = async (order: Order) => {
  const previousOrder = state.orders.find((o) => o.id === order.id);
  const normalized = normalizeOrder({ ...order, updatedAt: Date.now() });
  if (normalized.leadSource === "public_form") {
    if (!normalized.isLead || normalized.leadUnread === false || normalized.status !== "lead") {
      rememberLeadConverted(normalized.id);
    } else {
      forgetLeadSyncOverrides(normalized.id);
    }
  }
  if (previousOrder && previousOrder.status !== normalized.status) {
    pushNotification({
      type: NotificationType.ORDER_STATUS_CHANGED,
      title: `Статус заказа изменён`,
      message: `${normalized.brand} ${normalized.model}: ${previousOrder.status} → ${normalized.status}`,
      orderId: normalized.id,
      brand: normalized.brand,
      carModel: normalized.model,
      source: 'app',
      route: `/order/${normalized.id}`,
      severity: normalized.status === 'vip' ? 'critical' : 'info'
    });
  }
  const next = state.orders.map((o) => (o.id === normalized.id ? normalized : o));
  setState({ orders: next, error: null });
  const structuralDiff = hasStructuralDiff(previousOrder, normalized);
  const patch = structuralDiff ? {} : pickHotFieldPatch(previousOrder, normalized);
  scheduleLocalCommit(normalized, structuralDiff ? undefined : patch);
  window.dispatchEvent(new CustomEvent('cloud-save-success'));

  await queueMutation('upsert', structuralDiff ? normalized : undefined, normalized.id, patch);
  return true;
};

export const deleteOrderItem = async (orderId: string) => {
  const orderToDelete = state.orders.find((o) => o.id === orderId);
  rememberLeadDeleted(orderId);
  const next = state.orders.filter((o) => o.id !== orderId);
  setState({ orders: next, error: null });
  await offlineDb.deleteOrder(orderId);
  window.dispatchEvent(new CustomEvent('cloud-save-success'));

  if (orderToDelete?.leadSource === 'public_form' || orderToDelete?.isLead) {
    const purgeResult = await purgePublicLeadArtifacts(orderId);
    if (!purgeResult.ok) {
      await logger.warn('order:delete', 'Failed to purge public lead artifacts after lead deletion', {
        orderId,
        code: purgeResult.code,
        error: purgeResult.error
      });
    }
  }

  // Pass a minimal marker so flushOfflineMutations can purge client_leads on retry
  const deletePayload = (orderToDelete?.leadSource === 'public_form' || orderToDelete?.isLead)
    ? { leadSource: orderToDelete!.leadSource, isLead: orderToDelete!.isLead } as unknown as Order
    : undefined;
  await queueMutation('delete', deletePayload, orderId);
  return true;
};

export const updatePartItem = async (orderId: string, part: Part) => {
  const order = state.orders.find((item) => item.id === orderId);
  if (!order) return;

  const exists = order.parts.some((p) => p.id === part.id);
  const parts = exists ? order.parts.map((p) => (p.id === part.id ? part : p)) : [...order.parts, part];
  await updateOrderItem({ ...order, parts });
};

export const updatePriceVariantItem = async (partId: string, variant: PriceVariant) => {
  const order = state.orders.find((o) => o.parts.some((p) => p.id === partId));
  if (!order) return;

  const parts = order.parts.map((p) => {
    if (p.id !== partId) return p;
    const exists = p.variants.some((v) => v.id === variant.id);
    const variants = exists ? p.variants.map((v) => (v.id === variant.id ? variant : v)) : [...p.variants, variant];
    return { ...p, variants };
  });

  await updateOrderItem({ ...order, parts });
};

export const restoreOrdersExternal = (orders: Order[]) => {
  const normalized = orders.map(normalizeOrder);
  setState({ orders: normalized, isHydrated: true });
  void offlineDb.saveOrders(normalized);
};

// Compact change-detection key for a list of orders.
// Same pattern as `refreshLeadsOnly`. O(n) but called at most once per poll
// interval and only when the server actually returns data.
const ordersSignature = (orders: Order[]) =>
  orders.map((o) => `${o.id}:${o.updatedAt || o.createdAt || 0}:${o.leadUnread ? 1 : 0}`).join('|');

export const syncLeadsToState = async (cloudLeads: CloudLeadRow[]) => {
  if (cloudLeads.length === 0) return;

  const previousOrders = state.orders;
  const mergedOrders = await mergeCloudLeadsWithOrders(previousOrders, cloudLeads);

  // Skip re-render if nothing actually changed — prevents white flashes from polling
  if (ordersSignature(mergedOrders) === ordersSignature(previousOrders)) return;

  setState({ orders: mergedOrders });
  await offlineDb.saveOrders(mergedOrders);

  if (wasCloudHydratedAtLeastOnce) {
    notifyAboutIncomingLeads(previousOrders, mergedOrders);
  }
};

export const useOrderStore = () => {
  const [, setVersion] = useState(0);

  useEffect(() => subscribeOrderStore(() => setVersion((v) => v + 1)), []);

  useEffect(() => {
    if (!state.isHydrated && !lifecycleHydrationStarted) {
      lifecycleHydrationStarted = true;
      void fetchOrders();
    }
  }, []);

  useEffect(() => {
    if (LOCAL_ONLY || lifecycleEventsBound) return;
    lifecycleEventsBound = true;

    const onOnline = () => {
      void fetchOrders();
    };

    const onSwMessage = (event: MessageEvent) => {
      if (event.data?.type === 'flush-offline-mutations') {
        void flushOfflineMutations();
      }
    };

    const onIdbPaused = () => {
      setSyncStatus('error');
      setState({ isSyncing: false });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshLeadsOnly();
      }
    };

    const LEADS_POLL_INTERVAL_MS = 2 * 60 * 1000; // poll every 2 minutes
    const pollIntervalId = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') {
        void refreshLeadsOnly();
      }
    }, LEADS_POLL_INTERVAL_MS);

    window.addEventListener('online', onOnline);
    window.addEventListener('idb-autosync-paused', onIdbPaused as EventListener);
    document.addEventListener('visibilitychange', onVisibilityChange);
    navigator.serviceWorker?.addEventListener?.('message', onSwMessage);
    return () => {
      lifecycleEventsBound = false;
      window.clearInterval(pollIntervalId);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('idb-autosync-paused', onIdbPaused as EventListener);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      navigator.serviceWorker?.removeEventListener?.('message', onSwMessage);
    };
  }, []);

  const fetchOrdersCb = useCallback(fetchOrders, []);

  return {
    ...state,
    fetchOrders: fetchOrdersCb,
    addOrder: useCallback(addOrderItem, []),
    updateOrder: useCallback(updateOrderItem, []),
    deleteOrder: useCallback(deleteOrderItem, []),
    updatePart: useCallback(updatePartItem, []),
    updatePriceVariant: useCallback(updatePriceVariantItem, []),
    flushOfflineMutations: useCallback(() => flushOfflineMutations({ force: true }), [])
  };
};
