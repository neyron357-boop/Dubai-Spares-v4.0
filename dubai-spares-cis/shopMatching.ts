import { Order, Shop } from './types';

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');

export const isBrandMatch = (orderBrand: string, supplierBrand: string) => {
  const a = normalize(orderBrand);
  const b = normalize(supplierBrand);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  return (a.includes('mercedes') && b.includes('mercedes')) || (a.includes('benz') && b.includes('mercedes'));
};

const isModelMatch = (orderModel: string, modelHint?: string) => {
  if (!modelHint || !orderModel) return true;
  const a = normalize(orderModel);
  const b = normalize(modelHint);
  if (!a || !b) return true;
  return a.includes(b) || b.includes(a);
};

const isYearMatch = (orderYear: string, years: number[] = []) => {
  if (!orderYear || years.length === 0) return true;
  const parsed = Number(orderYear);
  if (!Number.isFinite(parsed)) return true;
  return years.includes(parsed);
};

export const isShopCompatibleWithOrder = (shop: Shop, order: Pick<Order, 'brand' | 'model' | 'year'>) => {
  const hasBrand = (shop.specialization || []).some((brand) => isBrandMatch(order.brand, brand));
  if (!hasBrand) return false;
  const hasModel = isModelMatch(order.model, shop.specializationModels?.[0] || undefined)
    || (shop.specializationModels || []).some((model) => isModelMatch(order.model, model));
  const hasYear = isYearMatch(order.year, shop.specializationYears || []);
  return hasModel && hasYear;
};

export const buildShopMapLink = (shop: Pick<Shop, 'location' | 'latitude' | 'longitude'>) => {
  const loc = (shop.location || '').trim();
  if (loc.startsWith('http://') || loc.startsWith('https://')) return loc;
  if (loc.includes('google.com/maps') || loc.includes('goo.gl/maps')) return loc;
  if (Number.isFinite(shop.latitude) && Number.isFinite(shop.longitude)) {
    return `https://www.google.com/maps/search/?api=1&query=${shop.latitude},${shop.longitude}`;
  }
  return loc
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc)}`
    : 'https://www.google.com/maps';
};
