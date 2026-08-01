import { Order, Part } from '../types';

export type CargoDeliveryType = 'air' | 'express_air' | 'container';

export interface CargoTariff {
  country: string;
  airRegularUsdPerKg: number;
  airOversizedUsdPerKg: number;
  containerUsdPerKg: number;
  airSeatUsd: number;
  minAirKg: number;
  minContainerKg: number;
  airEtaDays: string;
  containerEtaDays: string;
}

export interface CargoCalculationResult {
  country: string;
  deliveryType: CargoDeliveryType;
  eta: string;
  realWeight: number;
  chargeableWeight: number;
  totalPlaces: number;
  oversizedWeight: number;
  regularWeight: number;
  baseCostUsd: number;
  additionalTotalUsd: number;
  totalCostUsd: number;
}

export const DEFAULT_CARGO_TARIFFS: CargoTariff[] = [
  { country: 'Россия', airRegularUsdPerKg: 6.12, airOversizedUsdPerKg: 10, containerUsdPerKg: 1.6, airSeatUsd: 10, minAirKg: 10, minContainerKg: 30, airEtaDays: '3-7', containerEtaDays: '25-45' },
  { country: 'Казахстан', airRegularUsdPerKg: 3.5, airOversizedUsdPerKg: 10, containerUsdPerKg: 1.4, airSeatUsd: 10, minAirKg: 10, minContainerKg: 30, airEtaDays: '4-8', containerEtaDays: '20-35' },
  { country: 'Таджикистан', airRegularUsdPerKg: 6.81, airOversizedUsdPerKg: 10, containerUsdPerKg: 1.9, airSeatUsd: 10, minAirKg: 10, minContainerKg: 30, airEtaDays: '6-12', containerEtaDays: '25-45' },
  { country: 'Узбекистан', airRegularUsdPerKg: 7.62, airOversizedUsdPerKg: 10, containerUsdPerKg: 1.7, airSeatUsd: 10, minAirKg: 10, minContainerKg: 30, airEtaDays: '4-8', containerEtaDays: '20-40' },
  { country: 'Кыргызстан', airRegularUsdPerKg: 6.81, airOversizedUsdPerKg: 10, containerUsdPerKg: 1.8, airSeatUsd: 10, minAirKg: 10, minContainerKg: 30, airEtaDays: '6-12', containerEtaDays: '20-35' }
];

export const calculateCargo = (order: Order, settings: { cargoTariffs?: CargoTariff[] }, forcedDeliveryType?: CargoDeliveryType): CargoCalculationResult => {
  const logistics = order.logistics || {};
  const country = logistics.cargoCountry || DEFAULT_CARGO_TARIFFS[0].country;
  const deliveryType = forcedDeliveryType || (logistics.cargoDeliveryType || 'air') as CargoDeliveryType;
  const tariffs = settings.cargoTariffs?.length ? settings.cargoTariffs : DEFAULT_CARGO_TARIFFS;
  const tariff = tariffs.find((item) => item.country === country) || tariffs[0] || DEFAULT_CARGO_TARIFFS[0];

  const groupedPlaces = new Set<string>();
  const totals = (order.parts || []).reduce((acc, part) => {
    const qty = Number(part.quantity || 1);
    const realWeight = Number((part as any).weightKg || 0) * qty;
    const chargeableWeight = realWeight;
    const rawPlaces = Number((part as any).places || 0);
    const placeGroup = String((part as any).cargoPlaceGroup || '').trim();
    const places = rawPlaces > 0 ? rawPlaces * qty : 0;
    const oversized = Boolean((part as any).isOversized);
    acc.realWeight += realWeight;
    acc.chargeableWeight += chargeableWeight;
    if (placeGroup) {
      groupedPlaces.add(placeGroup);
    } else {
      acc.totalPlaces += places;
    }
    if (oversized) {
      acc.oversizedWeight += chargeableWeight;
    } else {
      acc.regularWeight += chargeableWeight;
    }
    return acc;
  }, { realWeight: 0, chargeableWeight: 0, totalPlaces: 0, oversizedWeight: 0, regularWeight: 0 });

  totals.totalPlaces += groupedPlaces.size;

  const additional = logistics.additionalCostsUsd || {};
  const additionalTotal = Number(additional.packagingUsd || 0) + Number(additional.customsUsd || 0) + Number(additional.cityDeliveryUsd || 0) + Number(additional.insuranceUsd || 0);

  const hasCargoInputs = totals.chargeableWeight > 0 || totals.totalPlaces > 0;

  let baseCost = 0;
  let eta = tariff.airEtaDays;
  if (hasCargoInputs) {
    if (deliveryType === 'container') {
      const billableWeight = Math.max(totals.realWeight, Number(tariff.minContainerKg || 0));
      baseCost = billableWeight * Number(tariff.containerUsdPerKg || 0);
      eta = tariff.containerEtaDays;
    } else {
      const minWeight = Math.max(totals.chargeableWeight, Number(tariff.minAirKg || 0));
      const regularRate = Number(tariff.airRegularUsdPerKg || 0);
      const oversizedRate = Number(tariff.airOversizedUsdPerKg || tariff.airRegularUsdPerKg || 0);
      baseCost = (totals.regularWeight * Number(tariff.airRegularUsdPerKg || 0))
        + (totals.oversizedWeight * oversizedRate);
      const minBaseCost = minWeight * regularRate;
      if (baseCost < minBaseCost) baseCost = minBaseCost;
      baseCost += totals.totalPlaces * Number(tariff.airSeatUsd || 0);
    }
  }

  const totalCost = hasCargoInputs ? (baseCost + additionalTotal) : 0;
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

export const calculateCargoEstimates = (order: Order, settings: { cargoTariffs?: CargoTariff[] }) => {
  const air = calculateCargo(order, settings, 'air');
  const container = calculateCargo(order, settings, 'container');
  return { air, container };
};
