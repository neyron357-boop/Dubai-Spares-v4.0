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


const extractCityHints = (location: string): string[] => {
  const normalized = location.toLowerCase();
  const hints: string[] = [];
  if (normalized.includes('sharjah')) hints.push('Sharjah');
  if (normalized.includes('dubai')) hints.push('Dubai');
  return hints;
};

const buildShopFallbackQueries = (row: any): string[] => {
  const name = String(row?.name || '').trim();
  const specialization = Array.isArray(row?.specialization)
    ? row.specialization.map((item: unknown) => String(item || '').trim()).filter(Boolean)
    : [];
  const cities = extractCityHints(String(row?.location || ''));
  const queries = new Set<string>();

  if (name) {
    queries.add(name);
    queries.add(`${name} Dubai`);
    queries.add(`${name} Sharjah`);
  }
  for (const spec of specialization.slice(0, 3)) {
    const base = [name, spec].filter(Boolean).join(' ').trim();
    if (!base) continue;
    queries.add(base);
    if (cities.length === 0) {
      queries.add(`${base} Dubai`);
      queries.add(`${base} Sharjah`);
    } else {
      cities.forEach((city) => queries.add(`${base} ${city}`.trim()));
    }
  }

  return Array.from(queries);
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

    const resolved = await resolveCoordinatesFromLocation(String(row?.location || ''), {
      fallbackQueries: buildShopFallbackQueries(row)
    });
    if (!resolved || !hasValidCoordinates(resolved.lat, resolved.lng)) continue;

    const { error } = await supabase
      .from('shops')
      .update({ latitude: resolved.lat, longitude: resolved.lng })
      .eq('id', row.id);

    if (error) {
      await logger.warn('shops:repair', 'Failed to repair coordinates for critical shop', { shopId: row.id, name: row.name, error: error.message });
      continue;
    }

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
  const extendedFields = `${baseFields},specialization_models,specialization_years,specialization_body_types`;
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
