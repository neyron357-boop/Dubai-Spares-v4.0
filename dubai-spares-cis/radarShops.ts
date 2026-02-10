import { Supplier, Shop } from './types';
import { supabase } from './supabase';
import { toast } from './feedback';
import { logger } from './logging';
import { logDatabaseIntegrity } from './dbIntegrity';

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

  return {
    ...supplier,
    brands: Array.isArray(supplier.brands) ? supplier.brands : [],
    models,
    years
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
  specializationYears: toNumberArray(row.specialization_years)
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
    specializationYears: supplier.years || []
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

export const fetchRadarShops = async (suppliers: Supplier[]): Promise<Shop[]> => {
  const supplierShops = mapSuppliersToShops(suppliers);
  if (!supabase) {
    return supplierShops;
  }

  const baseFields = 'id,name,phone,location,latitude,longitude,specialization';
  const extendedFields = `${baseFields},specialization_models,specialization_years`;
  const primary = await supabase.from('shops').select(extendedFields);

  let data: any[] | null = null;
  if (primary.error && primary.error.code === '42703') {
    await logDatabaseIntegrity('shops:fetch', primary.error, { table: 'shops', phase: 'extended-select' });
    const fallback = await supabase.from('shops').select(baseFields);
    data = Array.isArray(fallback.data) ? fallback.data : null;
  } else {
    if (primary.error) {
      await logDatabaseIntegrity('shops:fetch', primary.error, { table: 'shops', phase: 'base-select' });
      toast('Ошибка загрузки магазинов радара', 'error');
    }
    data = Array.isArray(primary.data) ? primary.data : null;
  }

  if (Array.isArray(data) && data.length > 0) {
    return mergeShops(data.map(mapShopRow), supplierShops);
  }

  return supplierShops;
};

export const upsertSupplierToShops = async (supplier: Supplier) => {
  if (!supabase) return;

  const normalized = normalizeSupplierMetadata(supplier);
  const payload = {
    id: normalized.id,
    name: normalized.name,
    phone: normalized.phone,
    location: normalized.location,
    latitude: normalized.coordinates?.lat ?? null,
    longitude: normalized.coordinates?.lng ?? null,
    specialization: normalized.brands || [],
    specialization_models: normalized.models || [],
    specialization_years: normalized.years || []
  };

  const { error } = await supabase.from('shops').upsert(payload, { onConflict: 'id' });
  if (error) {
    await logDatabaseIntegrity('shops:upsert', error, { supplierId: supplier.id });
    void logger.warn('shops:upsert', 'Failed to upsert supplier into shops table', {
      supplierId: supplier.id,
      supplierName: supplier.name,
      error: error.message
    });
  }
};
