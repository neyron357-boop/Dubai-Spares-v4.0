import { Supplier, Shop } from './types';
import { supabase } from './supabase';
import { toast } from './feedback';
import { logger } from './logging';
import { logDatabaseIntegrity } from './dbIntegrity';
import { ensureUuid, isUuid } from './id';
import { resolveCoordinatesFromLocation } from './mapsLocation';

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
    type: supplier.type === 'scrapyard' ? 'scrapyard' : 'new_parts',
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
  type: row.shop_type === 'scrapyard' ? 'scrapyard' : 'new_parts',
  zone: typeof row.zone === 'string' ? row.zone : '',
  heatLevel: Number.isFinite(Number(row.heat_level)) ? Number(row.heat_level) : 0,
  needsManualFix: !!row.needs_manual_fix,
  mainBrands: Array.isArray(row.main_brands) ? row.main_brands : [],
  specialization: Array.isArray(row.specialization) ? row.specialization : [],
  specializationModels: Array.isArray(row.specialization_models) ? row.specialization_models : [],
  specializationYears: toNumberArray(row.specialization_years),
  specializationBodyTypes: Array.isArray(row.specialization_body_types) ? row.specialization_body_types : []
});

const mapSuppliersToShops = (suppliers: Supplier[]): Shop[] => suppliers
  .map(normalizeSupplierMetadata)
  .filter((supplier) => supplier.coordinates)
  .map((supplier) => ({
    id: supplier.id,
    name: supplier.name,
    phone: supplier.phone,
    location: supplier.location,
    latitude: supplier.coordinates!.lat,
    longitude: supplier.coordinates!.lng,
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

export const fetchRadarShops = async (suppliers: Supplier[]): Promise<Shop[]> => {
  const supplierShops = mapSuppliersToShops(suppliers);
  if (!supabase) {
    return supplierShops;
  }

  const baseFields = 'id,name,phone,location,latitude,longitude,specialization';
  const extendedFields = `${baseFields},specialization_models,specialization_years,specialization_body_types,needs_manual_fix,shop_type,main_brands,zone,heat_level`;
  const primary = await supabase.from('shops').select(extendedFields);

  let data: any[] | null = null;
  if (primary.error && primary.error.code === '42703') {
    await logDatabaseIntegrity('shops:fetch', primary.error, { table: 'shops', phase: 'extended-select' });
    const fallback = await supabase.from('shops').select(baseFields);
    data = Array.isArray(fallback.data) ? fallback.data : null;
  } else {
    if (primary.error) {
      await logDatabaseIntegrity('shops:fetch', primary.error, { table: 'shops', phase: 'base-select' });
      if (primary.error.code === '42501') {
        await logger.error('shops:fetch', 'RLS denied access to shops table', { hint: 'Check shops select policy for anon/authenticated roles' });
      }
      toast('Ошибка загрузки магазинов радара', 'error');
    }
    data = Array.isArray(primary.data) ? primary.data : null;
  }

  if (Array.isArray(data) && data.length > 0) {
    await rerunCriticalCoordinatesParser(data);
    return mergeShops(data.map(mapShopRow), supplierShops);
  }

  return supplierShops;
};

export const upsertSupplierToShops = async (supplier: Supplier) => {
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
