import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Order, OrderPricingEvent, Part } from '../../types';
import { calculateCargo, calculateCargoEstimates, DEFAULT_CARGO_TARIFFS } from '../../utils/cargo';
import { calculateOrderDiscountAed, getPricedPartLines, getFinanceVariant } from '../../utils/quotePricing';
import { QuoteRates, QuoteCurrency } from '../../shareUtils';

const sanitizeDecimalInput = (raw: string) => {
  const normalized = raw.replace(/,/g, '.').replace(/[^\d.]/g, '');
  const [head = '', ...tail] = normalized.split('.');
  return tail.length > 0 ? `${head}.${tail.join('')}` : head;
};

const sanitizeNumericInput = (raw: string) => {
  const cleaned = raw.replace(/[^\d]/g, '');
  if (!cleaned) return '';
  const withoutLeading = cleaned.replace(/^0+(?=\d)/, '');
  return withoutLeading || '0';
};

const formatPricingEventValue = (value: unknown) => {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
};

const createPricingEvent = (field: OrderPricingEvent['field'], label: string, previousValue: unknown, nextValue: unknown): OrderPricingEvent | null => {
  const prev = formatPricingEventValue(previousValue);
  const next = formatPricingEventValue(nextValue);
  if (prev === next) return null;
  return {
    id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    field,
    label,
    previousValue: prev,
    nextValue: next,
    createdAt: Date.now()
  };
};

export function useOrderPricing({
  order,
  settings,
  preferredExchangeRate,
  currentQuoteRates,
  updateOrder,
  updateSettings,
  buildQuoteRateInputs,
  syncPerf,
  setToast,
  draftFields
}: {
  order: Order;
  settings: any;
  preferredExchangeRate: number;
  currentQuoteRates: QuoteRates;
  updateOrder: (order: Order) => Promise<boolean>;
  updateSettings: (patch: any) => void;
  buildQuoteRateInputs: (rates: QuoteRates) => Record<string, string>;
  syncPerf: any;
  setToast: (msg: any) => void;
  draftFields: any;
}) {
  const [logisticsDraft, setLogisticsDraft] = useState<Record<'deliveryAed' | 'packingAed' | 'serviceFeeAed', string>>({
    deliveryAed: String(Number(order?.logistics?.deliveryAed || 0)),
    packingAed: String(Number(order?.logistics?.packingAed || 0)),
    serviceFeeAed: String(Number(order?.logistics?.serviceFeeAed || 0))
  });

  const [rateInput, setRateInput] = useState(order ? preferredExchangeRate.toString() : '3.67');
  const [quoteRateInputs, setQuoteRateInputs] = useState<Record<string, string>>(() => buildQuoteRateInputs(currentQuoteRates));
  const [markupFixedInput, setMarkupFixedInput] = useState(order?.markupFixedAed?.toString() || '0');
  const [discountFixedInput, setDiscountFixedInput] = useState(order?.discountFixedAed?.toString() || '0');

  const pricingSaveDebounceRef = useRef<number | null>(null);
  const pricingAutoSaveTimerRef = useRef<number | null>(null);
  const markupCommitTimerRef = useRef<number | null>(null);
  const discountCommitTimerRef = useRef<number | null>(null);
  const exchangeRateCommitTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (order) setRateInput(preferredExchangeRate.toString());
    setQuoteRateInputs(buildQuoteRateInputs(currentQuoteRates));
  }, [order?.id, order?.exchangeRate, preferredExchangeRate, currentQuoteRates]);

  useEffect(() => {
    setMarkupFixedInput((order?.markupFixedAed || 0).toString());
  }, [order?.id, order?.markupFixedAed]);

  useEffect(() => {
    setDiscountFixedInput((order?.discountFixedAed || 0).toString());
  }, [order?.id, order?.discountFixedAed]);

  useEffect(() => {
    if (!order?.id) return;
    setLogisticsDraft({
      deliveryAed: String(Number(order.logistics?.deliveryAed || 0)),
      packingAed: String(Number(order.logistics?.packingAed || 0)),
      serviceFeeAed: String(Number(order.logistics?.serviceFeeAed || 0))
    });
  }, [order?.id, order?.logistics?.deliveryAed, order?.logistics?.packingAed, order?.logistics?.serviceFeeAed]);

  const onLogisticsDraftChange = useCallback((field: 'deliveryAed' | 'packingAed' | 'serviceFeeAed', nextValue: string) => {
    setLogisticsDraft((prev) => ({ ...prev, [field]: nextValue }));
  }, []);

  const scheduleDebouncedSaveLog = useCallback(() => {
    if (pricingSaveDebounceRef.current) window.clearTimeout(pricingSaveDebounceRef.current);
    pricingSaveDebounceRef.current = window.setTimeout(() => {
      pricingSaveDebounceRef.current = null;
    }, 1000);
  }, []);

  const hasPendingPricingChanges = useMemo(() => {
    if (!order) return false;
    const hasLogisticsDiff = (['deliveryAed', 'packingAed', 'serviceFeeAed'] as const).some((field) => {
      const draftValue = Number(logisticsDraft[field] || 0);
      const savedValue = Number(order.logistics?.[field] || 0);
      return draftValue !== savedValue;
    });
    const hasMarkupDiff = (order.markupType || 'percent') === 'fixed'
      && (Number(markupFixedInput || 0) !== Number(order.markupFixedAed || 0));
    return hasLogisticsDiff || hasMarkupDiff;
  }, [logisticsDraft, markupFixedInput, order]);

  const saveLogisticsDraft = useCallback(() => {
    if (!hasPendingPricingChanges) return;

    const eventLabels: Record<'deliveryAed' | 'packingAed' | 'serviceFeeAed', string> = {
      deliveryAed: 'Cargo AED',
      packingAed: 'Упаковка AED',
      serviceFeeAed: 'Комиссия AED'
    };
    const eventFieldMap: Record<'deliveryAed' | 'packingAed' | 'serviceFeeAed', OrderPricingEvent['field']> = {
      deliveryAed: 'logistics.deliveryAed',
      packingAed: 'logistics.packingAed',
      serviceFeeAed: 'logistics.serviceFeeAed'
    };

    const baseLogistics = {
      ...order.logistics,
      deliveryAed: Number(logisticsDraft.deliveryAed || 0),
      packingAed: Number(logisticsDraft.packingAed || 0),
      serviceFeeAed: Number(logisticsDraft.serviceFeeAed || 0)
    };

    const nextParts = order.parts || [];
    const nextCargo = calculateCargo({ ...order, parts: nextParts, logistics: baseLogistics }, settings);
    const nextEstimates = calculateCargoEstimates({ ...order, parts: nextParts, logistics: baseLogistics }, settings);
    const nextLogistics = {
      ...baseLogistics,
      cargoEtaDays: nextCargo.eta,
      cargoTotalWeightKg: nextCargo.realWeight,
      cargoChargeableWeightKg: nextCargo.chargeableWeight,
      cargoTotalPlaces: nextCargo.totalPlaces,
      cargoBaseCostUsd: nextCargo.baseCostUsd,
      cargoTotalCostUsd: nextCargo.totalCostUsd,
      cargoAirEtaDays: nextEstimates.air.eta,
      cargoAirCostUsd: nextEstimates.air.totalCostUsd,
      cargoContainerEtaDays: nextEstimates.container.eta,
      cargoContainerCostUsd: nextEstimates.container.totalCostUsd
    };

    const nextMarkupFixed = Number(markupFixedInput || 0);
    const previousMarkupFixed = Number(order.markupFixedAed || 0);
    const previousMarkupType = order.markupType || 'percent';
    const shouldPersistFixedMarkup = previousMarkupType === 'fixed';

    const nextEvents = (['deliveryAed', 'packingAed', 'serviceFeeAed'] as const)
      .map((field) => createPricingEvent(
        eventFieldMap[field],
        eventLabels[field],
        Number(order.logistics?.[field] || 0),
        Number(nextLogistics[field] || 0)
      ))
      .filter(Boolean) as OrderPricingEvent[];

    const markupAmountEvent = shouldPersistFixedMarkup
      ? createPricingEvent('markupFixedAed', 'Наценка (фикс AED)', previousMarkupFixed, nextMarkupFixed)
      : null;
    const mergedEvents = [markupAmountEvent, ...nextEvents].filter(Boolean) as OrderPricingEvent[];

    updateOrder({
      ...order,
      parts: nextParts,
      markupFixedAed: shouldPersistFixedMarkup ? nextMarkupFixed : order.markupFixedAed,
      markupType: previousMarkupType,
      logistics: nextLogistics,
      pricingEvents: mergedEvents.length ? [...mergedEvents, ...(order.pricingEvents || [])] : order.pricingEvents
    });
    scheduleDebouncedSaveLog();
    setToast({ message: 'Услуги сохранены' });
  }, [hasPendingPricingChanges, logisticsDraft, markupFixedInput, order, settings, updateOrder, scheduleDebouncedSaveLog, setToast]);

  useEffect(() => {
    if (!hasPendingPricingChanges) return;
    if (pricingAutoSaveTimerRef.current) window.clearTimeout(pricingAutoSaveTimerRef.current);
    pricingAutoSaveTimerRef.current = window.setTimeout(() => {
      pricingAutoSaveTimerRef.current = null;
      saveLogisticsDraft();
    }, 900);

    return () => {
      if (pricingAutoSaveTimerRef.current) {
        window.clearTimeout(pricingAutoSaveTimerRef.current);
        pricingAutoSaveTimerRef.current = null;
      }
    };
  }, [hasPendingPricingChanges, saveLogisticsDraft]);


  // Computed
  const selectedOfferTotals = useMemo(() => (order.parts || []).reduce((sum, part) => {
    const matchingVariant = getFinanceVariant(part);
    const quantity = Math.max(1, Number(part.quantity || 1));
    if (!matchingVariant) return sum;
    const bestSale = Number(matchingVariant.salePriceAed ?? matchingVariant.priceAed ?? 0);
    const bestPurchase = Number(matchingVariant.purchasePriceAed ?? matchingVariant.priceAed ?? 0);
    return {
      sale: sum.sale + (bestSale * quantity),
      purchase: sum.purchase + (bestPurchase * quantity)
    };
  }, { sale: 0, purchase: 0 }), [order.parts]);
  
  const selectedOfferTotal = selectedOfferTotals.sale;
  
  const logistics = useMemo(() => ({
    deliveryType: order.logistics?.deliveryType || 'uae',
    deliveryAed: Number(logisticsDraft.deliveryAed || 0),
    packingAed: Number(logisticsDraft.packingAed || 0),
    serviceFeeAed: Number(logisticsDraft.serviceFeeAed || 0)
  }), [order.logistics?.deliveryType, logisticsDraft]);
  
  const logisticsTotal = useMemo(() => logistics.deliveryAed + logistics.packingAed + logistics.serviceFeeAed, [logistics]);
  const cargoCalc = useMemo(() => calculateCargo(order, settings), [order, settings]);
  const effectiveExchangeRate = currentQuoteRates.USD ? 1 / currentQuoteRates.USD : preferredExchangeRate;
  const cargoTotalUsd = Number(order.logistics?.cargoTotalCostUsd ?? 0);
  const cargoTotalAed = cargoTotalUsd * effectiveExchangeRate;
  const logisticsWithCargoTotal = logisticsTotal + cargoTotalAed;
  
  const markupType = order.markupType || 'percent';
  const effectiveMarkupPercent = Number(draftFields.markupPercent ?? order.markupPercent ?? 0);
  const discountType = order.discountType || 'percent';
  const effectiveDiscountPercent = Number(draftFields.discountPercent ?? order.discountPercent ?? 0);
  
  const pricingPreviewOrder = useMemo(() => ({
    ...order,
    markupPercent: effectiveMarkupPercent,
    markupFixedAed: markupType === 'fixed' ? Number(markupFixedInput || 0) : order.markupFixedAed,
    discountPercent: effectiveDiscountPercent,
    discountFixedAed: discountType === 'fixed' ? Number(discountFixedInput || 0) : order.discountFixedAed
  }), [order, effectiveMarkupPercent, markupType, markupFixedInput, effectiveDiscountPercent, discountType, discountFixedInput]);
  
  const pricedPartLines = useMemo(() => getPricedPartLines(pricingPreviewOrder), [pricingPreviewOrder]);
  const markupAed = useMemo(() => pricedPartLines.reduce((sum, line) => sum + line.markupShareAed, 0), [pricedPartLines]);
  const sellPartsTotalAed = useMemo(() => pricedPartLines.reduce((sum, line) => sum + line.clientLineTotalAed, 0), [pricedPartLines]);
  const discountAed = useMemo(() => calculateOrderDiscountAed(sellPartsTotalAed + logisticsWithCargoTotal, pricingPreviewOrder), [logisticsWithCargoTotal, pricingPreviewOrder, sellPartsTotalAed]);
  const sellTotalAed = sellPartsTotalAed + logisticsWithCargoTotal;
  
  const depositAmountAed = Math.max(0, Number(order.searchDepositAmountAed || 0));
  const balanceDueAed = Math.max(0, sellTotalAed - depositAmountAed);
  const canComputeProfit = selectedOfferTotal > 0;
  const baseMarginAed = canComputeProfit ? selectedOfferTotals.sale - selectedOfferTotals.purchase : 0;
  const netProfitAed = canComputeProfit ? baseMarginAed + markupAed - discountAed : null;
  const marginPercent = canComputeProfit && netProfitAed !== null && sellTotalAed > 0 ? (netProfitAed / sellTotalAed) * 100 : null;
  const isMarkupMissing = canComputeProfit && markupAed <= 0;
  const lowMargin = canComputeProfit && selectedOfferTotal > 0 && markupAed > 0 && markupAed / selectedOfferTotal < 0.03;
  const isLoss = canComputeProfit && sellTotalAed < selectedOfferTotal + logisticsWithCargoTotal;

  const calculateCurrentProfit = useCallback(() => {
    if (!canComputeProfit || netProfitAed === null) return 0;
    return netProfitAed / effectiveExchangeRate;
  }, [canComputeProfit, netProfitAed, effectiveExchangeRate]);

  const profitUsd = order.isSold && order.soldProfitUsd !== undefined
    ? order.soldProfitUsd.toFixed(2)
    : calculateCurrentProfit().toFixed(2);


  // Return all states and functions
  return {
    logisticsDraft,
    onLogisticsDraftChange,
    rateInput,
    setRateInput,
    quoteRateInputs,
    setQuoteRateInputs,
    markupFixedInput,
    setMarkupFixedInput,
    discountFixedInput,
    setDiscountFixedInput,
    exchangeRateCommitTimerRef,
    markupCommitTimerRef,
    discountCommitTimerRef,
    selectedOfferTotals,
    selectedOfferTotal,
    logistics,
    logisticsTotal,
    cargoCalc,
    effectiveExchangeRate,
    cargoTotalUsd,
    cargoTotalAed,
    logisticsWithCargoTotal,
    markupType,
    effectiveMarkupPercent,
    discountType,
    effectiveDiscountPercent,
    pricingPreviewOrder,
    pricedPartLines,
    markupAed,
    sellPartsTotalAed,
    discountAed,
    sellTotalAed,
    depositAmountAed,
    balanceDueAed,
    canComputeProfit,
    baseMarginAed,
    netProfitAed,
    marginPercent,
    isMarkupMissing,
    lowMargin,
    isLoss,
    calculateCurrentProfit,
    profitUsd
  };
}
