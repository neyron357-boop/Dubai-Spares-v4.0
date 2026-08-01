import { useState, useEffect } from 'react';
import { Order, Shop, Part, Supplier } from '../../types';
import { supabase } from '../../supabase';
import { fetchRadarShops } from '../../radarShops';
import { logger } from '../../logging';
import { getShopRecommendationDiagnostics, getShopRecommendationLevel, isBrandMatch, isShopCompatibleWithOrder, getShopOrderMatchScore, buildShopMapLink } from '../../shopMatching';

const toRad = (v: number) => (v * Math.PI) / 180;
const distanceMeters = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const calc =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(calc), Math.sqrt(1 - calc));
};

export function useOrderSuppliers({
  order,
  suppliers,
  updateOrder
}: {
  order: Order;
  suppliers: Supplier[];
  updateOrder: (order: Order) => Promise<boolean>;
}) {
  const [shops, setShops] = useState<Shop[]>([]);
  const [shopsLoaded, setShopsLoaded] = useState(false);
  const [currentPosition, setCurrentPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [shopTagMap, setShopTagMap] = useState<Record<string, { models: string[]; years: string[] }>>({});

  useEffect(() => {
    let active = true;

    const loadShops = async () => {
      const loadedShops = await fetchRadarShops(suppliers);
      if (!active) return;
      setShops(loadedShops);
      setShopsLoaded(true);
    };

    const shopsChannel = supabase
      ?.channel('order-details-radar-shops')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shops' }, () => {
        void loadShops();
      })
      .subscribe();

    void loadShops();
    return () => {
      active = false;
      if (shopsChannel) {
        void supabase?.removeChannel(shopsChannel);
      }
    };
  }, [suppliers]);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      setCurrentPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    });
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('shop_order_tags');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') setShopTagMap(parsed);
    } catch {
      setShopTagMap({});
    }
  }, [order?.id, order?.model, order?.year]);

  useEffect(() => {
    if (!order || !shopsLoaded) return;

    const diagnostics = shops.map((shop) => ({ shop, diagnostics: getShopRecommendationDiagnostics(shop, order) }));
    const includedCount = diagnostics.filter(({ diagnostics: d }) => d.level !== 'none').length;
    const excludedCount = diagnostics.length - includedCount;

    void logger.debug('RECOMMENDATIONS', 'Input criteria', {
      orderId: order.id,
      brand: order.brand,
      model: order.model,
      year: order.year
    });

    void logger.info('RECOMMENDATIONS', 'Recommendation scan completed', {
      totalShops: diagnostics.length,
      includedCount,
      excludedCount
    });

    diagnostics
      .filter(({ diagnostics: d }) => d.level === 'none')
      .forEach(({ shop, diagnostics: d }) => {
        void logger.debug('RECOMMENDATIONS', `Shop '${shop.name}' excluded`, {
          shopId: shop.id,
          reason: d.reason || 'No tier criteria matched',
          brands: shop.specialization || [],
          models: shop.specializationModels || [],
          years: shop.specializationYears || []
        });
      });
  }, [order, shops, shopsLoaded]);

  const dismissedShopIds = new Set(order?.dismissedShopIds || []);

  const isStrictBrandShop = (shop: Shop) => {
    if (!order) return false;
    const shopBrands = Array.from(new Set([...(shop.specialization || []), ...(shop.mainBrands || [])]));
    return shopBrands.some((brand) => isBrandMatch(order.brand, brand));
  };

  const strictBrandShops = shops.filter((shop) => isStrictBrandShop(shop));
  const manuallyRecommendedShops = strictBrandShops.filter((shop) => (order?.recommendedShopIds || []).includes(shop.id) && !dismissedShopIds.has(shop.id));
  const autoRecommendedShops = strictBrandShops.filter((shop) => !dismissedShopIds.has(shop.id) && order && (isShopCompatibleWithOrder(shop, order) || getShopOrderMatchScore(shop, order) >= 2));

  const mergedRecommendations = Array.from(new Map([...manuallyRecommendedShops, ...autoRecommendedShops].map((shop) => [shop.id, shop])).values());
  const fallbackNearest = strictBrandShops
    .map((shop) => ({
      ...shop,
      score: order ? getShopOrderMatchScore(shop, order) : 0,
      distance: currentPosition ? distanceMeters(currentPosition, { lat: shop.latitude, lng: shop.longitude }) : Number.MAX_SAFE_INTEGER
    }))
    .filter((shop) => !mergedRecommendations.some((selected) => selected.id === shop.id))
    .sort((a, b) => (b.score - a.score) || (a.distance - b.distance))
    .slice(0, 4);

  const recommendedShops = [...mergedRecommendations.map((shop) => ({
    ...shop,
    distance: currentPosition ? distanceMeters(currentPosition, { lat: shop.latitude, lng: shop.longitude }) : Number.MAX_SAFE_INTEGER
  })), ...(mergedRecommendations.length > 0 ? [] : fallbackNearest)]
    .sort((a, b) => a.distance - b.distance);

  const groupedRecommendations = {
    high: recommendedShops.filter((shop) => order && getShopRecommendationLevel(shop, order) === 'high'),
    medium: recommendedShops.filter((shop) => order && getShopRecommendationLevel(shop, order) === 'medium'),
    low: recommendedShops.filter((shop) => order && getShopRecommendationLevel(shop, order) === 'low'),
    none: recommendedShops.filter((shop) => order && getShopRecommendationLevel(shop, order) === 'none')
  };

  const navigateToShop = (shop: Shop) => {
    window.open(buildShopMapLink(shop), '_blank');
  };

  const contactAllRecommendedShops = () => {
    if (!order) return;
    const firstPart = order.parts.find((part) => part.name.trim());
    const partName = firstPart?.name || 'part';
    const message = `Hi, do you have ${partName} for ${order.vin}?`;

    recommendedShops.forEach((shop) => {
      const rawPhone = (shop.phone || '').replace(/[^\d+]/g, '');
      if (!rawPhone) return;
      const whatsappUrl = `https://wa.me/${rawPhone.replace(/^\+/, '')}?text=${encodeURIComponent(message)}`;
      window.open(whatsappUrl, '_blank');
    });
  };

  const addManualRecommendation = (shopId: string) => {
    if (!shopId || !order) return;
    const current = new Set(order.recommendedShopIds || []);
    current.add(shopId);
    const nextDismissed = (order.dismissedShopIds || []).filter((id) => id !== shopId);
    updateOrder({ ...order, recommendedShopIds: Array.from(current), dismissedShopIds: nextDismissed });

    try {
      const raw = localStorage.getItem('shop_order_tags');
      const map = raw ? JSON.parse(raw) : {};
      const entry = map[shopId] || { models: [], years: [] };
      const models = Array.from(new Set([...(entry.models || []), order.model].filter(Boolean)));
      const years = Array.from(new Set([...(entry.years || []), order.year].filter(Boolean)));
      map[shopId] = { models, years };
      localStorage.setItem('shop_order_tags', JSON.stringify(map));
    } catch {
      // no-op
    }
  };

  const removeManualRecommendation = (shopId: string) => {
    if (!order) return;
    const next = (order.recommendedShopIds || []).filter((id) => id !== shopId);
    updateOrder({ ...order, recommendedShopIds: next });
  };

  const dismissShopRecommendation = (shopId: string) => {
    if (!order) return;
    const nextDismissed = Array.from(new Set([...(order.dismissedShopIds || []), shopId]));
    const nextRecommended = (order.recommendedShopIds || []).filter((id) => id !== shopId);
    updateOrder({ ...order, recommendedShopIds: nextRecommended, dismissedShopIds: nextDismissed });
  };

  const restoreDismissedRecommendations = () => {
    if (!order) return;
    updateOrder({ ...order, dismissedShopIds: [] });
  };

  return {
    shops,
    shopsLoaded,
    shopTagMap,
    currentPosition,
    dismissedShopIds,
    recommendedShops,
    groupedRecommendations,
    navigateToShop,
    contactAllRecommendedShops,
    addManualRecommendation,
    removeManualRecommendation,
    dismissShopRecommendation,
    restoreDismissedRecommendations
  };
}
