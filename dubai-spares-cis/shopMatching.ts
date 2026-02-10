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

export const getShopOrderMatchScore = (shop: Shop, order: Pick<Order, 'brand' | 'model' | 'year'>) => {
  let score = 0;
  const brands = shop.specialization || [];
  const models = shop.specializationModels || [];
  const years = shop.specializationYears || [];

  const hasAnyMeta = brands.length > 0 || models.length > 0 || years.length > 0;
  if (!hasAnyMeta) return 1;

  const brandMatched = brands.some((brand) => isBrandMatch(order.brand, brand));
  if (brandMatched) score += 6;

  const modelMatched = models.some((model) => isModelMatch(order.model, model));
  if (modelMatched) score += 3;

  const yearMatched = isYearMatch(order.year, years);
  if (yearMatched && years.length > 0) score += 2;

  if (score === 0 && (brands.length > 0 || models.length > 0)) {
    return -1;
  }

  return score;
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

const toRad = (v: number) => (v * Math.PI) / 180;

const distanceMeters = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const earthRadiusMeters = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const calc =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(calc), Math.sqrt(1 - calc));
};

export interface RadarShopMatch {
  shop: Shop;
  distance: number;
  matchScore: number;
  radarScore: number;
  isRecommended: boolean;
  isCompatible: boolean;
  confidence: 'high' | 'medium' | 'low';
}

export const getRadarShopMatches = (
  order: Pick<Order, 'brand' | 'model' | 'year' | 'recommendedShopIds'>,
  shops: Shop[],
  currentPosition: { lat: number; lng: number } | null
) => {
  return shops
    .map((shop) => {
      const isRecommended = (order.recommendedShopIds || []).includes(shop.id);
      const isCompatible = isShopCompatibleWithOrder(shop, order);
      const matchScore = isRecommended ? 100 : getShopOrderMatchScore(shop, order);
      const distance = currentPosition ? distanceMeters(currentPosition, { lat: shop.latitude, lng: shop.longitude }) : Number.MAX_SAFE_INTEGER;
      const distanceBonus = Number.isFinite(distance)
        ? distance <= 300 ? 6 : distance <= 800 ? 4 : distance <= 2000 ? 2 : 0
        : 0;
      const radarScore = matchScore + distanceBonus + (isCompatible ? 4 : 0);
      const confidence: RadarShopMatch['confidence'] = isRecommended || isCompatible || matchScore >= 9
        ? 'high'
        : matchScore >= 3
          ? 'medium'
          : 'low';

      return { shop, distance, matchScore, radarScore, isRecommended, isCompatible, confidence };
    })
    .sort((a, b) => (b.radarScore - a.radarScore) || (a.distance - b.distance));
};
