import { Order, Shop } from './types';
import { logger } from './logging';

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');

export const isBrandMatch = (orderBrand: string, supplierBrand: string) => {
  const a = normalize(orderBrand);
  const b = normalize(supplierBrand);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  return (a.includes('mercedes') && b.includes('mercedes')) || (a.includes('benz') && b.includes('mercedes'));
};

const isModelMatch = (orderModel: string, modelHint?: string) => {
  if (!modelHint || !orderModel) return false;
  const a = normalize(orderModel);
  const b = normalize(modelHint);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
};

const isYearMatch = (orderYear: string, years: number[] = []) => {
  if (!orderYear || years.length === 0) return false;
  const parsed = Number(orderYear);
  if (!Number.isFinite(parsed)) return false;
  return years.includes(parsed);
};



export interface ShopRecommendationDiagnostics {
  level: 'high' | 'medium' | 'low' | 'none';
  brandMatched: boolean;
  modelMatched: boolean;
  yearMatched: boolean;
  reason?: string;
}

export const getShopRecommendationDiagnostics = (
  shop: Shop,
  order: Pick<Order, 'brand' | 'model' | 'year'>
): ShopRecommendationDiagnostics => {
  const brands = shop.specialization || [];
  const models = shop.specializationModels || [];
  const years = shop.specializationYears || [];

  const brandMatched = brands.some((brand) => isBrandMatch(order.brand, brand));
  const modelMatched = models.some((model) => isModelMatch(order.model, model));
  const yearMatched = isYearMatch(order.year, years);

  if (!brandMatched) {
    const normalizedBrand = normalize(order.brand);
    const caseSensitiveMatch = brands.some((brand) => normalize(brand) === normalizedBrand && brand !== order.brand);
    return {
      level: 'none',
      brandMatched,
      modelMatched,
      yearMatched,
      reason: caseSensitiveMatch
        ? `Case-sensitivity mismatch: search "${order.brand}" vs shop brands [${brands.join(', ')}]`
        : `Brand not in array [${brands.join(', ')}]`
    };
  }

  if (modelMatched && yearMatched) {
    return { level: 'high', brandMatched, modelMatched, yearMatched };
  }

  if (modelMatched) {
    return {
      level: 'medium',
      brandMatched,
      modelMatched,
      yearMatched,
      reason: years.length > 0 ? `Year ${order.year || '—'} not in array [${years.join(', ')}]` : 'Year metadata missing; downgraded to medium'
    };
  }

  return {
    level: 'low',
    brandMatched,
    modelMatched,
    yearMatched,
    reason: models.length > 0
      ? `Model ${order.model || '—'} not in array [${models.join(', ')}]`
      : 'Model metadata missing; using brand-only match'
  };
};

export const getShopRecommendationLevel = (shop: Shop, order: Pick<Order, 'brand' | 'model' | 'year'>): 'high' | 'medium' | 'low' | 'none' => {
  return getShopRecommendationDiagnostics(shop, order).level;
};

export const isShopCompatibleWithOrder = (shop: Shop, order: Pick<Order, 'brand' | 'model' | 'year'>) => {
  const hasBrand = (shop.specialization || []).some((brand) => isBrandMatch(order.brand, brand));
  if (!hasBrand) return false;
  const modelMeta = shop.specializationModels || [];
  const yearsMeta = shop.specializationYears || [];
  const hasModel = modelMeta.length === 0 || modelMeta.some((model) => isModelMatch(order.model, model));
  const hasYear = yearsMeta.length === 0 || isYearMatch(order.year, yearsMeta);
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
  if (!brandMatched && brands.length > 0) return -1;
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

export const buildRoutePlanMapLink = (
  chain: Array<Pick<Shop, 'location' | 'latitude' | 'longitude'>>,
  origin?: { lat: number; lng: number } | null
) => {
  const withCoords = chain.filter((shop) => Number.isFinite(shop.latitude) && Number.isFinite(shop.longitude));
  if (withCoords.length === 0) return 'https://www.google.com/maps';

  const destination = withCoords[withCoords.length - 1];
  const originQuery = origin
    ? `${origin.lat},${origin.lng}`
    : `${withCoords[0].latitude},${withCoords[0].longitude}`;
  const waypointShops = origin ? withCoords.slice(0, -1) : withCoords.slice(1, -1);
  const waypoints = waypointShops.map((shop) => `${shop.latitude},${shop.longitude}`).join('|');

  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originQuery)}&destination=${encodeURIComponent(`${destination.latitude},${destination.longitude}`)}${waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : ''}`;
};

export const buildNearestShopsChain = (
  shops: Shop[],
  origin: { lat: number; lng: number } | null
) => {
  const pending = shops.filter((shop) => Number.isFinite(shop.latitude) && Number.isFinite(shop.longitude));
  if (pending.length <= 1) return pending;

  const chain: Shop[] = [];
  let cursor = origin
    ? { lat: origin.lat, lng: origin.lng }
    : { lat: pending[0].latitude, lng: pending[0].longitude };

  while (pending.length > 0) {
    let bestIndex = 0;
    let bestDistance = Number.MAX_SAFE_INTEGER;
    pending.forEach((shop, index) => {
      const d = distanceMeters(cursor, { lat: shop.latitude, lng: shop.longitude });
      if (d < bestDistance) {
        bestDistance = d;
        bestIndex = index;
      }
    });
    const [nearest] = pending.splice(bestIndex, 1);
    void logger.debug('RADAR_GEO', 'Smart route distance calculated', {
      from: cursor,
      to: { lat: Number(nearest.latitude), lng: Number(nearest.longitude), shopId: nearest.id, shopName: nearest.name },
      distanceMeters: bestDistance
    });
    chain.push(nearest);
    cursor = { lat: nearest.latitude, lng: nearest.longitude };
  }

  return chain;
};

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
      const level = getShopRecommendationLevel(shop, order);
      const confidence: RadarShopMatch['confidence'] = isRecommended || level === 'high' || isCompatible || matchScore >= 9
        ? 'high'
        : level === 'medium' || matchScore >= 3
          ? 'medium'
          : 'low';

      return { shop, distance, matchScore, radarScore, isRecommended, isCompatible, confidence };
    })
    .sort((a, b) => (a.distance - b.distance) || (b.radarScore - a.radarScore));
};
