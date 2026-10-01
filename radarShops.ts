import { Shop, Supplier } from './types';
const toNumberArray = (values: unknown): number[] => {
  if (!Array.isArray(values)) return [];
  return values.map((value) => Number(value)).filter((value) => Number.isFinite(value));
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

  const bodyTypes = Array.isArray(supplier.bodyTypes)
    ? supplier.bodyTypes
    : typeof (supplier as Supplier & { bodyTypes?: unknown }).bodyTypes === 'string'
      ? parseCsv((supplier as Supplier & { bodyTypes?: string }).bodyTypes || '')
      : [];

  const mainPartCategories = Array.isArray(supplier.mainPartCategories)
    ? supplier.mainPartCategories
    : typeof (supplier as Supplier & { mainPartCategories?: unknown }).mainPartCategories ===
        'string'
      ? parseCsv((supplier as Supplier & { mainPartCategories?: string }).mainPartCategories || '')
      : [];

  return {
    ...supplier,
    type: supplier.type || 'new_parts',
    zone: typeof supplier.zone === 'string' ? supplier.zone : '',
    heatLevel: Number.isFinite(Number(supplier.heatLevel)) ? Number(supplier.heatLevel) : 0,
    mainBrands: Array.isArray(supplier.mainBrands)
      ? supplier.mainBrands
      : Array.isArray(supplier.brands)
        ? supplier.brands
        : [],
    brands: Array.isArray(supplier.brands) ? supplier.brands : [],
    models,
    years,
    bodyTypes,
    mainPartCategories,
  };
};

const mapSuppliersToShops = (suppliers: Supplier[]): Shop[] =>
  suppliers.map(normalizeSupplierMetadata).map((supplier) => ({
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
    specializationBodyTypes: supplier.bodyTypes || [],
  }));

const loadSuppliers = (): Supplier[] => {
  try {
    return JSON.parse(localStorage.getItem('dubai_spares_suppliers') || '[]');
  } catch {
    return [];
  }
};
export const fetchRadarShops = async (suppliers: Supplier[]): Promise<Shop[]> =>
  mapSuppliersToShops(suppliers);
export const getSuppliersEnriched = async (): Promise<Supplier[]> =>
  loadSuppliers().map(normalizeSupplierMetadata);
export const fetchSuppliersFromShops = getSuppliersEnriched;
export const updateSupplierContacts = async (id: string, phone: string, whatsapp: string) => {
  const suppliers = loadSuppliers().map((supplier) =>
    supplier.id === id ? { ...supplier, phone, whatsapp, updatedAt: Date.now() } : supplier,
  );
  localStorage.setItem('dubai_spares_suppliers', JSON.stringify(suppliers));
  window.dispatchEvent(new Event('local-suppliers-updated'));
};
export const fetchShopsInRadius = async (
  lat: number,
  lng: number,
  radiusKm: number,
): Promise<Shop[]> => {
  const shops = mapSuppliersToShops(loadSuppliers());
  const radians = (value: number) => (value * Math.PI) / 180;
  return shops.filter((shop) => {
    const dLat = radians(shop.latitude - lat),
      dLng = radians(shop.longitude - lng);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(radians(lat)) * Math.cos(radians(shop.latitude)) * Math.sin(dLng / 2) ** 2;
    return (
      shop.latitude &&
      shop.longitude &&
      6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) <= radiusKm
    );
  });
};
