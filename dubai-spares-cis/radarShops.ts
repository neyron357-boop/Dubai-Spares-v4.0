import { Supplier, Shop } from './types';
import { supabase } from './supabase';
import { toast } from './feedback';
import { logger } from './logging';
import { logDatabaseIntegrity } from './dbIntegrity';
import { ensureUuid, isUuid } from './id';
import { resolveCoordinatesFromLocation } from './mapsLocation';
import { refreshSupabaseSchemaCache } from './schemaCache';

const toNumberArray = (values: unknown): number[] => {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
};

const parseCsv = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const hasValidCoordinates = (latitude?: number | null, longitude?: number | null) => {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  return Number(latitude) !== 0 && Number(longitude) !== 0;
};

const CRITICAL_SHOP_NAMES = new Set(['bmw', 'mm']);
const GEO_RETRY_LIMIT = 3;
const GEO_FAIL_COOLDOWN_MS = 60 * 60 * 1000;

const failedGeocodeCache = new Map<string, { failCount: number; blockedUntil: number }>();
const manualFixShops = new Set<string>();

const SHOPS_CACHE_TTL_MS = 10 * 60 * 1000;
let shopsFetchInFlight: Promise<Shop[]> | null = null;
let shopsCache: { expiresAt: number; data: Shop[] } | null = null;
let shopsTableMissing = false;


const extractCityHints = (location: string): string[] => {
  const normalized = location.toLowerCase();
  const hints: string[] = [];
  if (normalized.includes('sharjah')) hints.push('Sharjah');
  if (normalized.includes('dubai')) hints.push('Dubai');
  return hints;
};


const buildShopFallbackQueries = (row: any): string[] => {
  const name = String(row?.name || '').trim();
  const cities = extractCityHints(String(row?.location || ''));
  if (!name) return [];
  if (cities.length > 0) return cities.map((city) => `${name} ${city}`.trim());
  return [`${name} Dubai`, `${name} Sharjah`];
};

const shouldSkipGeocodeAttempt = (shopId: string) => {
  const entry = failedGeocodeCache.get(shopId);
  if (!entry) return false;
  if (entry.blockedUntil <= Date.now()) {
    failedGeocodeCache.delete(shopId);
    return false;
  }
  return true;
};

const markGeocodeFailure = (shopId: string) => {
  const prev = failedGeocodeCache.get(shopId) || { failCount: 0, blockedUntil: 0 };
  const failCount = prev.failCount + 1;
  const blockedUntil = failCount >= GEO_RETRY_LIMIT ? Date.now() + GEO_FAIL_COOLDOWN_MS : 0;
  failedGeocodeCache.set(shopId, { failCount, blockedUntil });
  return { failCount, blockedUntil };
};

const isMissingNeedsManualFixColumn = (error: unknown) => {
  if (typeof error !== 'object' || !error) return false;
  const anyErr = error as { code?: unknown; message?: unknown };
  return anyErr.code === 'PGRST204' && typeof anyErr.message === 'string' && anyErr.message.includes("'needs_manual_fix' column");
};

const markShopNeedsManualFix = async (shopId: string, row: any) => {
  manualFixShops.add(shopId);
  if (!supabase) return;

  const { error } = await supabase
    .from('shops')
    .update({ needs_manual_fix: true })
    .eq('id', row.id);

  if (error && !isMissingNeedsManualFixColumn(error)) {
    await logger.warn('shops:repair', 'Failed to mark shop as needs_manual_fix', {
      shopId: row.id,
      name: row.name,
      error: error.message
    });
  }
};

const clearGeocodeFailure = (shopId: string) => {
  failedGeocodeCache.delete(shopId);
};

const getMissingShopsColumnName = (error: unknown): string | null => {
  if (typeof error !== 'object' || !error) return null;
  const anyErr = error as { code?: unknown; message?: unknown };
  if (typeof anyErr.message !== 'string') return null;

  if (anyErr.code === 'PGRST204') {
    const match = anyErr.message.match(/Could not find the '([^']+)' column of 'shops'/);
    return match?.[1] || null;
  }

  if (anyErr.code === '42703') {
    const postgresMatch = anyErr.message.match(/column\s+shops\.([a-zA-Z0-9_]+)\s+does not exist/i);
    const quotedMatch = anyErr.message.match(/column\s+["']?shops["']?\.["']?([a-zA-Z0-9_]+)["']?\s+does not exist/i);
    return postgresMatch?.[1] || quotedMatch?.[1] || null;
  }

  return null;
};

const isMissingShopsTable = (error: unknown): boolean => {
  if (typeof error !== 'object' || !error) return false;
  const anyErr = error as { code?: unknown; message?: unknown };
  return anyErr.code === 'PGRST205'
    && typeof anyErr.message === 'string'
    && anyErr.message.includes("'public.shops'");
};

export const normalizeSupplierMetadata = (supplier: Supplier): Supplier => {
  const models = Array.isArray(supplier.models)
    ? supplier.models
    : typeof (supplier as Supplier & { models?: unknown }).models === 'string'
      ? parseCsv((supplier as Supplier & { models?: string }).models || '')
      : [];

  const years = Array.isArray(supplier.years)
    ? supplier.years.filter((year) => Number.isFinite(year))
    : typeof (supplier as Supplier & { years?: unknown }).years === 'string'
      ? toNumberArray(parseCsv((supplier as Supplier & { years?: string }).years || ''))
      : [];

  const bodyTypes = Array.isArray(supplier.bodyTypes)
    ? supplier.bodyTypes
    : typeof (supplier as Supplier & { bodyTypes?: unknown }).bodyTypes === 'string'
      ? parseCsv((supplier as Supplier & { bodyTypes?: string }).bodyTypes || '')
      : [];

  return {
    ...supplier,
    type: supplier.type || 'new_parts',
    zone: typeof supplier.zone === 'string' ? supplier.zone : '',
    heatLevel: Number.isFinite(Number(supplier.heatLevel)) ? Number(supplier.heatLevel) : 0,
    mainBrands: Array.isArray(supplier.mainBrands) ? supplier.mainBrands : (Array.isArray(supplier.brands) ? supplier.brands : []),
    brands: Array.isArray(supplier.brands) ? supplier.brands : [],
    models,
    years,
    bodyTypes
  };
};

const mapShopRow = (row: any): Shop => ({
  id: String(row.id),
  name: row.name || 'Shop',
  phone: row.phone || '',
  location: row.location || '',
  latitude: Number(row.latitude),
  longitude: Number(row.longitude),
  type: row.shop_type || 'new_parts',
  zone: typeof row.zone === 'string' ? row.zone : '',
  heatLevel: Number.isFinite(Number(row.heat_level)) ? Number(row.heat_level) : 0,
  needsManualFix: !!row.needs_manual_fix,
  mainBrands: Array.isArray(row.main_brands) ? row.main_brands : [],
  specialization: Array.isArray(row.specialization) ? row.specialization : [],
  specializationTag: typeof row.specialization_tag === 'string' ? row.specialization_tag : '',
  specializationModels: Array.isArray(row.specialization_models) ? row.specialization_models : [],
  specializationYears: toNumberArray(row.specialization_years),
  specializationBodyTypes: Array.isArray(row.specialization_body_types) ? row.specialization_body_types : [],
  businessHours: typeof row.business_hours === 'object' && row.business_hours !== null ? row.business_hours : undefined,
  businessHoursTimezone: typeof row.business_hours_timezone === 'string' ? row.business_hours_timezone : undefined
});

const mapSuppliersToShops = (suppliers: Supplier[]): Shop[] => suppliers
  .map(normalizeSupplierMetadata)
  .map((supplier) => ({
    id: supplier.id,
    name: supplier.name,
    phone: supplier.phone,
    location: supplier.location,
    latitude: Number(supplier.coordinates?.lat || 0),
    longitude: Number(supplier.coordinates?.lng || 0),
    type: supplier.type,
    zone: supplier.zone,
    heatLevel: supplier.heatLevel,
    mainBrands: supplier.mainBrands || supplier.brands || [],
    specialization: supplier.brands || [],
    specializationModels: supplier.models || [],
    specializationYears: supplier.years || [],
    specializationBodyTypes: supplier.bodyTypes || []
  }));

const mergeShops = (primary: Shop[], fallback: Shop[]): Shop[] => {
  const merged = new Map<string, Shop>();
  primary.forEach((shop) => merged.set(shop.id, shop));
  fallback.forEach((shop) => {
    if (!merged.has(shop.id)) {
      merged.set(shop.id, shop);
    }
  });
  return Array.from(merged.values());
};

const rerunCriticalCoordinatesParser = async (rows: any[]) => {
  if (!supabase || !Array.isArray(rows) || rows.length === 0) return;

  for (const row of rows) {
    const normalizedName = String(row?.name || '').trim().toLowerCase();
    if (!CRITICAL_SHOP_NAMES.has(normalizedName)) continue;
    if (hasValidCoordinates(Number(row?.latitude), Number(row?.longitude))) continue;
    const shopId = String(row?.id || '');
    if (!shopId) continue;
    if (manualFixShops.has(shopId) || row?.needs_manual_fix === true) continue;

    if (shouldSkipGeocodeAttempt(shopId)) {
      await logger.debug('shops:repair', 'Skipping geocode retry due to cooldown', { shopId, name: row?.name });
      continue;
    }

    const resolved = await resolveCoordinatesFromLocation(String(row?.location || ''), {
      fallbackQueries: buildShopFallbackQueries(row)
    });
    if (!resolved || !hasValidCoordinates(resolved.lat, resolved.lng)) {
      const failState = markGeocodeFailure(shopId);
      await logger.warn('shops:repair', 'Failed to resolve coordinates for critical shop', {
        shopId,
        name: row?.name,
        failCount: failState.failCount,
        blockedUntil: failState.blockedUntil || null
      });

      if (failState.failCount >= GEO_RETRY_LIMIT) {
        row.needs_manual_fix = true;
        await markShopNeedsManualFix(shopId, row);
        await logger.warn('shops:repair', 'Shop marked as needs_manual_fix after retry limit', {
          shopId,
          name: row?.name,
          failCount: failState.failCount
        });
      }
      continue;
    }

    const { error } = await supabase
      .from('shops')
      .update({ latitude: resolved.lat, longitude: resolved.lng })
      .eq('id', row.id);

    if (error) {
      await logger.warn('shops:repair', 'Failed to repair coordinates for critical shop', { shopId: row.id, name: row.name, error: error.message });
      continue;
    }

    clearGeocodeFailure(shopId);
    row.latitude = resolved.lat;
    row.longitude = resolved.lng;
    await logger.info('shops:repair', 'Re-ran location parser for critical shop', { shopId: row.id, name: row.name, coordinates: resolved });
  }
};

const fetchRadarShopsFresh = async (suppliers: Supplier[]): Promise<Shop[]> => {
  const supplierShops = mapSuppliersToShops(suppliers);
  if (!supabase || shopsTableMissing) {
    return supplierShops;
  }

  let selectFields = [
    'id',
    'name',
    'phone',
    'location',
    'latitude',
    'longitude',
    'specialization',
    'specialization_tag',
    'business_hours',
    'business_hours_timezone',
    'specialization_models',
    'specialization_years',
    'specialization_body_types',
    'needs_manual_fix',
    'shop_type',
    'main_brands',
    'zone',
    'heat_level'
  ];

  let data: any[] | null = null;
  let lastError: { code?: string; message?: string } | null = null;

  while (selectFields.length > 0) {
    const response = await supabase.from('shops').select(selectFields.join(','));
    if (!response.error) {
      data = Array.isArray(response.data) ? response.data : null;
      lastError = null;
      break;
    }

    lastError = response.error;
    const missingColumn = getMissingShopsColumnName(response.error);
    if (!missingColumn || !selectFields.includes(missingColumn)) {
      break;
    }

    await logDatabaseIntegrity('shops:fetch', response.error, { table: 'shops', column: missingColumn, phase: 'column-fallback' });
    await logger.warn('shops:fetch', `shops.${missingColumn} is missing in remote schema; retrying fetch without that column`);
    selectFields = selectFields.filter((column) => column !== missingColumn);
  }

  if (lastError) {
    if (isMissingShopsTable(lastError)) {
      await logDatabaseIntegrity('shops:fetch', lastError, { table: 'shops', phase: 'missing-table-fallback' });
      await refreshSupabaseSchemaCache('shops-fetch-missing-table');
      const retryResponse = await supabase.from('shops').select(selectFields.join(','));
      if (!retryResponse.error) {
        shopsTableMissing = false;
        data = Array.isArray(retryResponse.data) ? retryResponse.data : null;
        lastError = null;
      } else {
        shopsTableMissing = true;
        await logger.warn('shops:fetch', 'Remote shops table is missing; using local supplier fallback only', {
          hint: 'Run latest Supabase migrations to create public.shops.'
        });
        return supplierShops;
      }
    }

    await logDatabaseIntegrity('shops:fetch', lastError, { table: 'shops', phase: 'select' });
    if (lastError.code === '42501') {
      await logger.error('shops:fetch', 'RLS denied access to shops table', { hint: 'Check shops select policy for anon/authenticated roles' });
    }
    toast('Ошибка загрузки магазинов. Проверьте подключение к интернету.', 'error');
  }

  if (Array.isArray(data) && data.length > 0) {
    await rerunCriticalCoordinatesParser(data);
    return mergeShops(data.map(mapShopRow), supplierShops);
  }

  return supplierShops;
};

export const fetchRadarShops = async (suppliers: Supplier[]): Promise<Shop[]> => {
  const supplierShops = mapSuppliersToShops(suppliers);
  const now = Date.now();

  if (shopsCache && shopsCache.expiresAt > now) {
    void (async () => {
      if (shopsFetchInFlight) return;
      shopsFetchInFlight = fetchRadarShopsFresh(suppliers)
        .then((fresh) => {
          shopsCache = { data: fresh, expiresAt: Date.now() + SHOPS_CACHE_TTL_MS };
          return fresh;
        })
        .finally(() => {
          shopsFetchInFlight = null;
        });
      await shopsFetchInFlight;
    })();
    return mergeShops(shopsCache.data, supplierShops);
  }

  if (shopsFetchInFlight) {
    const result = await shopsFetchInFlight;
    return mergeShops(result, supplierShops);
  }

  shopsFetchInFlight = fetchRadarShopsFresh(suppliers)
    .then((fresh) => {
      shopsCache = { data: fresh, expiresAt: Date.now() + SHOPS_CACHE_TTL_MS };
      return fresh;
    })
    .finally(() => {
      shopsFetchInFlight = null;
    });

  const result = await shopsFetchInFlight;
  return mergeShops(result, supplierShops);
};

export const upsertSupplierToShops = async (supplier: Supplier) => {
  shopsCache = null;
  if (!supabase) return;

  const normalized = normalizeSupplierMetadata(supplier);
  const shopId = ensureUuid(normalized.id);

  const payload = {
    id: shopId,
    name: normalized.name,
    phone: normalized.phone,
    location: normalized.location,
    latitude: normalized.coordinates?.lat ?? null,
    longitude: normalized.coordinates?.lng ?? null,
    shop_type: normalized.type || 'new_parts',
    main_brands: normalized.mainBrands || normalized.brands || [],
    zone: normalized.zone || '',
    heat_level: normalized.heatLevel || 0,
    needs_manual_fix: false,
    specialization: normalized.brands || [],
    specialization_models: normalized.models || [],
    specialization_years: normalized.years || [],
    specialization_body_types: normalized.bodyTypes || []
  };

  const { error } = await supabase.from('shops').upsert(payload, { onConflict: 'id' });
  if (error) {
    await logDatabaseIntegrity('shops:upsert', error, { supplierId: supplier.id, normalizedShopId: shopId, supplierIdIsUuid: isUuid(supplier.id) });
    void logger.warn('shops:upsert', 'Failed to upsert supplier into shops table', {
      supplierId: supplier.id,
      normalizedShopId: shopId,
      supplierName: supplier.name,
      error: error.message
    });
  }
};

export const deleteSupplierFromShops = async (supplierId: string) => {
  shopsCache = null;
  if (!supabase) return;

  const normalizedShopId = ensureUuid(supplierId);
  const { error } = await supabase
    .from('shops')
    .delete()
    .eq('id', normalizedShopId);

  if (error) {
    await logDatabaseIntegrity('shops:delete', error, {
      supplierId,
      normalizedShopId,
      supplierIdIsUuid: isUuid(supplierId)
    });
    await logger.warn('shops:delete', 'Failed to delete supplier from shops table', {
      supplierId,
      normalizedShopId,
      error: error.message
    });
  }
};


export const fetchShopsInRadius = async (
  latitude: number,
  longitude: number,
  radiusKm: number
): Promise<Shop[]> => {
  if (!supabase) return [];

  const latDelta = radiusKm / 111.32;
  const lngDelta = radiusKm / 111.32;

  const { data, error } = await supabase
    .from('shops')
    .select('*')
    .eq('is_active', true)
    .filter('latitude', 'gte', latitude - latDelta)
    .filter('latitude', 'lte', latitude + latDelta)
    .filter('longitude', 'gte', longitude - lngDelta)
    .filter('longitude', 'lte', longitude + lngDelta);

  if (error) {
    await logger.error('shops:fetch-radius', 'Failed to fetch shops in radius', {
      latitude,
      longitude,
      radiusKm,
      code: error.code,
      message: error.message
    });
    throw new Error(`shops:fetch: ${error.message}`);
  }

  return Array.isArray(data) ? data.map(mapShopRow) : [];
};
