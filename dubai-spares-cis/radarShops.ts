import { Supplier, Shop } from './types';
import { supabase } from './supabase';
import { toast } from './feedback';

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

export const fetchRadarShops = async (suppliers: Supplier[]): Promise<Shop[]> => {
  if (!supabase) {
    return mapSuppliersToShops(suppliers);
  }

  const baseFields = 'id,name,phone,location,latitude,longitude,specialization';
  const extendedFields = `${baseFields},specialization_models,specialization_years`;
  const primary = await supabase.from('shops').select(extendedFields);

  let data: any[] | null = null;
  if (primary.error && primary.error.code === '42703') {
    const fallback = await supabase.from('shops').select(baseFields);
    data = Array.isArray(fallback.data) ? fallback.data : null;
  } else {
    if (primary.error) {
      toast('Ошибка загрузки магазинов радара', 'error');
    }
    data = Array.isArray(primary.data) ? primary.data : null;
  }

  if (Array.isArray(data) && data.length > 0) {
    return data.map(mapShopRow);
  }

  return mapSuppliersToShops(suppliers);
};
