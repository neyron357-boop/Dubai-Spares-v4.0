import { Order, Part } from '../types';

export type CargoDeliveryType = 'air' | 'express_air' | 'container';

export interface CargoTariff {
  country: string;
  airUsdPerKg: number;
  expressAirUsdPerKg: number;
  containerUsdPerKg: number;
  oversizedUsdPerKg: number;
  regularUsdPerKg: number;
  airSeatUsd: number;
  minAirKg: number;
  minContainerKg: number;
  minContainerCbm: number;
  airEtaDays: string;
  containerEtaDays: string;
}

export const DEFAULT_CARGO_TARIFFS: CargoTariff[] = [
  { country: 'Россия', airUsdPerKg: 5.5, expressAirUsdPerKg: 12, containerUsdPerKg: 1.6, oversizedUsdPerKg: 10, regularUsdPerKg: 5.5, airSeatUsd: 10, minAirKg: 10, minContainerKg: 30, minContainerCbm: 1, airEtaDays: '3-7', containerEtaDays: '25-40' },
  { country: 'Казахстан', airUsdPerKg: 6, expressAirUsdPerKg: 12, containerUsdPerKg: 1.4, oversizedUsdPerKg: 10, regularUsdPerKg: 5.5, airSeatUsd: 10, minAirKg: 10, minContainerKg: 30, minContainerCbm: 1, airEtaDays: '4-7', containerEtaDays: '20-35' },
  { country: 'Таджикистан', airUsdPerKg: 5, expressAirUsdPerKg: 11, containerUsdPerKg: 1.9, oversizedUsdPerKg: 10, regularUsdPerKg: 5.5, airSeatUsd: 10, minAirKg: 10, minContainerKg: 30, minContainerCbm: 1, airEtaDays: '4-10', containerEtaDays: '25-45' },
  { country: 'Узбекистан', airUsdPerKg: 5.5, expressAirUsdPerKg: 11, containerUsdPerKg: 1.7, oversizedUsdPerKg: 10, regularUsdPerKg: 5.5, airSeatUsd: 10, minAirKg: 10, minContainerKg: 30, minContainerCbm: 1, airEtaDays: '4-8', containerEtaDays: '20-40' },
  { country: 'Кыргызстан', airUsdPerKg: 5.5, expressAirUsdPerKg: 11, containerUsdPerKg: 1.8, oversizedUsdPerKg: 10, regularUsdPerKg: 5.5, airSeatUsd: 10, minAirKg: 10, minContainerKg: 30, minContainerCbm: 1, airEtaDays: '4-7', containerEtaDays: '20-35' }
];

const getPartVolumeWeight = (part: Part) => {
  const l = Number((part as any).lengthCm || 0);
  const w = Number((part as any).widthCm || 0);
  const h = Number((part as any).heightCm || 0);
  if (l <= 0 || w <= 0 || h <= 0) return 0;
  return (l * w * h) / 6000;
};

const getPartVolumeCbm = (part: Part) => {
  const l = Number((part as any).lengthCm || 0);
  const w = Number((part as any).widthCm || 0);
  const h = Number((part as any).heightCm || 0);
  if (l <= 0 || w <= 0 || h <= 0) return 0;
  return (l * w * h) / 1000000;
};

export const calculateCargo = (order: Order, settings: { cargoTariffs?: CargoTariff[] }) => {
  const logistics = order.logistics || {};
  const country = logistics.cargoCountry || DEFAULT_CARGO_TARIFFS[0].country;
  const deliveryType = (logistics.cargoDeliveryType || 'air') as CargoDeliveryType;
  const tariffs = settings.cargoTariffs?.length ? settings.cargoTariffs : DEFAULT_CARGO_TARIFFS;
  const tariff = tariffs.find((item) => item.country === country) || tariffs[0] || DEFAULT_CARGO_TARIFFS[0];

  const totals = (order.parts || []).reduce((acc, part) => {
    const qty = Number(part.quantity || 1);
    const realWeight = Number((part as any).weightKg || 0) * qty;
    const volumeWeight = getPartVolumeWeight(part) * qty;
    const volumeCbm = getPartVolumeCbm(part) * qty;
    const places = Math.max(1, Number((part as any).places || 1)) * qty;
    const oversized = Boolean((part as any).isOversized);
    acc.realWeight += realWeight;
    acc.volumeWeight += volumeWeight;
    acc.chargeableWeight += Math.max(realWeight, volumeWeight);
    acc.volumeCbm += volumeCbm;
    acc.totalPlaces += places;
    if (oversized) {
      acc.oversizedWeight += Math.max(realWeight, volumeWeight);
    } else {
      acc.regularWeight += Math.max(realWeight, volumeWeight);
    }
    return acc;
  }, { realWeight: 0, volumeWeight: 0, chargeableWeight: 0, volumeCbm: 0, totalPlaces: 0, oversizedWeight: 0, regularWeight: 0 });

  const additional = logistics.additionalCostsUsd || {};
  const additionalTotal = Number(additional.packagingUsd || 0) + Number(additional.customsUsd || 0) + Number(additional.cityDeliveryUsd || 0) + Number(additional.insuranceUsd || 0);

  let baseCost = 0;
  let eta = tariff.airEtaDays;
  if (deliveryType === 'container') {
    const billableWeight = Math.max(totals.realWeight, Number(tariff.minContainerKg || 0));
    baseCost = billableWeight * Number(tariff.containerUsdPerKg || 0);
    eta = tariff.containerEtaDays;
  } else {
    const minWeight = Math.max(totals.chargeableWeight, Number(tariff.minAirKg || 0));
    if (deliveryType === 'express_air') {
      baseCost = minWeight * Number(tariff.expressAirUsdPerKg || 0);
    } else {
      baseCost = (totals.regularWeight * Number(tariff.regularUsdPerKg || tariff.airUsdPerKg || 0))
        + (totals.oversizedWeight * Number(tariff.oversizedUsdPerKg || tariff.airUsdPerKg || 0));
      if (baseCost <= 0) baseCost = minWeight * Number(tariff.airUsdPerKg || 0);
      baseCost += totals.totalPlaces * Number(tariff.airSeatUsd || 0);
      if (baseCost <= 0 && minWeight > 0) baseCost = minWeight * Number(tariff.airUsdPerKg || 0);
    }
  }

  const totalCost = baseCost + additionalTotal;
  return {
    country,
    deliveryType,
    eta,
    ...totals,
    baseCostUsd: Number(baseCost.toFixed(2)),
    additionalTotalUsd: Number(additionalTotal.toFixed(2)),
    totalCostUsd: Number(totalCost.toFixed(2))
  };
};
