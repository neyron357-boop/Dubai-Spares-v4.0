import { Order, Shop } from './types';
import { logger } from './logging';

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');

const hasValidCoordinates = (latitude: number, longitude: number) => Number.isFinite(latitude) && Number.isFinite(longitude) && latitude !== 0 && longitude !== 0;

const UNIVERSAL_BRAND_TOKENS = new Set(['universal', 'all', 'all brands', 'any', 'multi-brand', 'multibrand']);

const isUniversalBrand = (value: string) => UNIVERSAL_BRAND_TOKENS.has(value.trim().toLowerCase());

const hasUniversalSpecialization = (brands: string[] = []) => brands.some((brand) => isUniversalBrand(brand));

const getShopBrandPool = (shop: Shop) => Array.from(new Set([...(shop.specialization || []), ...(shop.mainBrands || [])].filter(Boolean)));

const isBrandEligible = (shop: Shop, orderBrand: string) => {
  const brands = getShopBrandPool(shop);
  if (brands.length === 0) return true;
  return hasUniversalSpecialization(brands) || brands.some((brand) => isBrandMatch(orderBrand, brand));
};

const isZeroCoordinateString = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const coordMatch = trimmed.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (!coordMatch) return false;
  return Number(coordMatch[1]) === 0 && Number(coordMatch[2]) === 0;
};

const isZeroCoordinateMapUrl = (value: string) => {
  if (!value.startsWith('http://') && !value.startsWith('https://')) return false;
  try {
    const parsed = new URL(value);
    const blob = `${parsed.pathname}${parsed.search}`;
    return isZeroCoordinateString(blob);
  } catch {
    return false;
  }
};

export const isBrandMatch = (orderBrand: string, supplierBrand: string) => {
  const a = normalize(orderBrand);
  const b = normalize(supplierBrand);
  if (!a || !b) return false;
  return a === b;
};

const isModelMatch = (orderModel: string, modelHint?: string) => {
  if (!modelHint || !orderModel) return false;
  const a = normalize(orderModel);
  const b = normalize(modelHint);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
};

const isBodyTypeMatch = (orderBodyType?: string, shopBodyType?: string) => {
  const a = normalize(orderBodyType || '');
  const b = normalize(shopBodyType || '');
  if (!a || !b) return false;
  return a === b;
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
  bodyTypeMatched: boolean;
  reason?: string;
}

export const getShopRecommendationDiagnostics = (
  shop: Shop,
  order: Pick<Order, 'brand' | 'model' | 'year' | 'bodyType'>
): ShopRecommendationDiagnostics => {
  const brands = getShopBrandPool(shop);
  const models = shop.specializationModels || [];
  const years = shop.specializationYears || [];
  const bodyTypes = shop.specializationBodyTypes || [];

  const brandMatched = isBrandEligible(shop, order.brand);
  const modelMatched = models.some((model) => isModelMatch(order.model, model));
  const yearMatched = isYearMatch(order.year, years);
  const bodyTypeMatched = bodyTypes.length === 0 || bodyTypes.some((bodyType) => isBodyTypeMatch(order.bodyType, bodyType));

  if (!brandMatched) {
    return {
      level: 'none',
      brandMatched,
      modelMatched,
      yearMatched,
      bodyTypeMatched,
      reason: `Strict brand mismatch: order=${order.brand}, shop=[${brands.join(', ')}]`
    };
  }

  if (!bodyTypeMatched) {
    return {
      level: 'none',
      brandMatched,
      modelMatched,
      yearMatched,
      bodyTypeMatched,
      reason: `Body type mismatch: order=${order.bodyType || '—'}, shop=[${bodyTypes.join(', ')}]`
    };
  }

  if (modelMatched && yearMatched) {
    return { level: 'high', brandMatched, modelMatched, yearMatched, bodyTypeMatched };
  }

  if (modelMatched) {
    return {
      level: 'medium',
      brandMatched,
      modelMatched,
      yearMatched,
      bodyTypeMatched,
      reason: years.length > 0 ? `Year ${order.year || '—'} not in array [${years.join(', ')}]` : 'Year metadata missing; downgraded to medium'
    };
  }

  return {
    level: 'low',
    brandMatched,
    modelMatched,
    yearMatched,
    bodyTypeMatched,
    reason: models.length > 0
      ? `Model ${order.model || '—'} not in array [${models.join(', ')}]`
      : 'Model metadata missing; using brand-only match'
  };
};

export const getShopRecommendationLevel = (shop: Shop, order: Pick<Order, 'brand' | 'model' | 'year' | 'bodyType'>): 'high' | 'medium' | 'low' | 'none' => {
  return getShopRecommendationDiagnostics(shop, order).level;
};

export const isShopCompatibleWithOrder = (shop: Shop, order: Pick<Order, 'brand' | 'model' | 'year' | 'bodyType'>) => {
  const hasBrand = isBrandEligible(shop, order.brand);
  if (!hasBrand) return false;
  const modelMeta = shop.specializationModels || [];
  const yearsMeta = shop.specializationYears || [];
  const bodyTypeMeta = shop.specializationBodyTypes || [];
  const hasModel = modelMeta.length === 0 || modelMeta.some((model) => isModelMatch(order.model, model));
  const hasYear = yearsMeta.length === 0 || isYearMatch(order.year, yearsMeta);
  const hasBodyType = bodyTypeMeta.length === 0 || bodyTypeMeta.some((bodyType) => isBodyTypeMatch(order.bodyType, bodyType));
  return hasModel && hasYear && hasBodyType;
};

export const getShopOrderMatchScore = (shop: Shop, order: Pick<Order, 'brand' | 'model' | 'year' | 'bodyType'>) => {
  let score = 0;
  const brands = getShopBrandPool(shop);
  const models = shop.specializationModels || [];
  const years = shop.specializationYears || [];
  const bodyTypes = shop.specializationBodyTypes || [];

  const hasAnyMeta = brands.length > 0 || models.length > 0 || years.length > 0 || bodyTypes.length > 0;
  if (!hasAnyMeta) return 1;

  const brandMatched = isBrandEligible(shop, order.brand);
  if (!brandMatched && brands.length > 0) return -1;
  if (brandMatched) score += 6;

  const bodyTypeMatched = bodyTypes.length === 0 || bodyTypes.some((bodyType) => isBodyTypeMatch(order.bodyType, bodyType));
  if (!bodyTypeMatched) return -1;
  if (bodyTypes.length > 0 && bodyTypeMatched) score += 2;

  const modelMatched = models.some((model) => isModelMatch(order.model, model));
  if (modelMatched) score += 3;

  const yearMatched = isYearMatch(order.year, years);
  if (yearMatched && years.length > 0) score += 2;

  if (score === 0 && (brands.length > 0 || models.length > 0 || bodyTypes.length > 0)) {
    return -1;
  }

  return score;
};

export const buildShopMapLink = (shop: Pick<Shop, 'location' | 'latitude' | 'longitude'>) => {
  const loc = (shop.location || '').trim();
  if (hasValidCoordinates(shop.latitude, shop.longitude)) {
    return `https://www.google.com/maps/search/?api=1&query=${shop.latitude},${shop.longitude}`;
  }
  if ((loc.startsWith('http://') || loc.startsWith('https://')) && !isZeroCoordinateMapUrl(loc)) return loc;
  if ((loc.includes('google.com/maps') || loc.includes('goo.gl/maps')) && !isZeroCoordinateString(loc)) return loc;
  if (isZeroCoordinateString(loc) || isZeroCoordinateMapUrl(loc)) {
    return 'https://www.google.com/maps';
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
  distance: number | null;
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
  const withCoords = chain.filter((shop) => hasValidCoordinates(shop.latitude, shop.longitude));
  if (withCoords.length === 0) return 'https://www.google.com/maps';

  // Google Maps API supports up to 8 waypoints (10 stops including origin + destination)
  const MAX_WAYPOINTS = 8;

  const destination = withCoords[withCoords.length - 1];
  const hasValidOrigin = !!origin && hasValidCoordinates(origin.lat, origin.lng);
  const originQuery = hasValidOrigin
    ? `${origin!.lat},${origin!.lng}`
    : `${withCoords[0].latitude},${withCoords[0].longitude}`;
  const waypointShops = (hasValidOrigin ? withCoords.slice(0, -1) : withCoords.slice(1, -1)).slice(0, MAX_WAYPOINTS);
  const waypoints = waypointShops.map((shop) => `${shop.latitude},${shop.longitude}`).join('|');

  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originQuery)}&destination=${encodeURIComponent(`${destination.latitude},${destination.longitude}`)}${waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : ''}`;
};

export const buildNearestShopsChain = (
  shops: Shop[],
  origin: { lat: number; lng: number } | null
) => {
  const pending = shops.filter((shop) => hasValidCoordinates(shop.latitude, shop.longitude));
  if (pending.length <= 1) return pending;

  const chain: Shop[] = [];
  let cursor = origin && hasValidCoordinates(origin.lat, origin.lng)
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
  order: Pick<Order, 'brand' | 'model' | 'year' | 'recommendedShopIds' | 'bodyType'>,
  shops: Shop[],
  currentPosition: { lat: number; lng: number } | null
) => {
  return shops
    .filter((shop) => isBrandEligible(shop, order.brand))
    .map((shop) => {
      const isRecommended = (order.recommendedShopIds || []).includes(shop.id);
      const isCompatible = isShopCompatibleWithOrder(shop, order);
      const matchScore = isRecommended ? 100 : getShopOrderMatchScore(shop, order);
      const hasShopCoords = hasValidCoordinates(shop.latitude, shop.longitude);
      const hasValidPosition = !!currentPosition && hasValidCoordinates(currentPosition.lat, currentPosition.lng);
      const distance = hasShopCoords && hasValidPosition
        ? distanceMeters(currentPosition!, { lat: shop.latitude, lng: shop.longitude })
        : null;
      const distanceBonus = distance !== null
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
    .sort((a, b) => ((a.distance ?? Number.POSITIVE_INFINITY) - (b.distance ?? Number.POSITIVE_INFINITY)) || (b.radarScore - a.radarScore));
};
