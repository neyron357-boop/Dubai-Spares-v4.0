import { Supplier, Shop } from './types';
import { ensureUuid } from './id';

const toNumberArray = (values: unknown): number[] => {
  if (!Array.isArray(values)) return [];
  return values.map((value) => Number(value)).filter((value) => Number.isFinite(value));
};

const parseCsv = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean);

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
    id: ensureUuid(supplier.id),
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

export const fetchRadarShops = async (suppliers: Supplier[]): Promise<Shop[]> => mapSuppliersToShops(suppliers);

export const upsertSupplierToShops = async (_supplier: Supplier) => {};

export const deleteSupplierFromShops = async (_supplierId: string) => {};
