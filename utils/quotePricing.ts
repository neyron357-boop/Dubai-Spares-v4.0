import type { Order, Part, PriceVariant } from '../types';
import { normalizePartQuantity } from './groupItems';

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
export const nonNegativeMoney = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

export type PricedPartLine = {
  part: Part;
  variant: PriceVariant;
  quantity: number;
  baseUnitAed: number;
  baseLineTotalAed: number;
  markupShareAed: number;
  discountShareAed: number;
  grossClientLineTotalAed: number;
  clientUnitAed: number;
  clientLineTotalAed: number;
};

export const getFinanceVariant = (part: Part): PriceVariant | null => {
  const variants = Array.isArray(part.variants) ? part.variants : [];
  return variants.find((variant) => variant.id === part.bestOfferId) || variants.find((variant) => variant.isBest) || variants[0] || null;
};

export const getVariantClientBasePriceAed = (variant?: PriceVariant | null) => (
  nonNegativeMoney(variant?.salePriceAed ?? variant?.priceAed ?? 0)
);

export const calculateOrderDiscountAed = (
  grossTotalAed: number,
  order: Pick<Order, 'discountType' | 'discountPercent' | 'discountFixedAed'>
) => {
  grossTotalAed = nonNegativeMoney(grossTotalAed);
  const discountType = order.discountType || 'percent';
  const rawDiscountAed = discountType === 'fixed'
    ? nonNegativeMoney(order.discountFixedAed)
    : grossTotalAed * (nonNegativeMoney(order.discountPercent) / 100);
  return Math.min(grossTotalAed, Math.max(0, round2(rawDiscountAed)));
};

export const getPricedPartLines = (
  order: Pick<Order, 'parts' | 'markupType' | 'markupPercent' | 'markupFixedAed' | 'discountType' | 'discountPercent' | 'discountFixedAed'>,
): PricedPartLine[] => {
  const pricedBase = (order.parts || [])
    .map((part) => {
      const variant = getFinanceVariant(part);
      const quantity = normalizePartQuantity(part.quantity);
      const baseUnitAed = getVariantClientBasePriceAed(variant);
      if (!variant || baseUnitAed <= 0) return null;
      return {
        part,
        variant,
        quantity,
        baseUnitAed,
        baseLineTotalAed: round2(baseUnitAed * quantity),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const markupType = order.markupType || 'percent';
  const fixedMarkupShare = markupType === 'fixed' && pricedBase.length > 0
    ? nonNegativeMoney(order.markupFixedAed) / pricedBase.length
    : 0;
  const markupPercent = nonNegativeMoney(order.markupPercent);

  let allocatedFixedMarkup = 0;
  const grossLines = pricedBase.map((item, index) => {
    const fixedShare = index === pricedBase.length - 1
      ? round2(nonNegativeMoney(order.markupFixedAed) - allocatedFixedMarkup)
      : round2(fixedMarkupShare);
    const markupShareAed = markupType === 'fixed'
      ? fixedShare
      : item.baseLineTotalAed * (markupPercent / 100);
    if (markupType === 'fixed') allocatedFixedMarkup = round2(allocatedFixedMarkup + markupShareAed);
    const grossClientLineTotalAed = round2(item.baseLineTotalAed + markupShareAed);
    return {
      ...item,
      markupShareAed: round2(markupShareAed),
      grossClientLineTotalAed,
    };
  });

  return grossLines.map((item) => {
    const discountShareAed = 0;
    const clientLineTotalAed = item.grossClientLineTotalAed;
    return {
      ...item,
      discountShareAed,
      clientLineTotalAed,
      clientUnitAed: round2(clientLineTotalAed / Math.max(1, item.quantity)),
    };
  });
};

/** All internal and customer-facing documents use the same AED totals. */
export const calculateOrderTotals = (order: Order) => {
  const lines = getPricedPartLines(order);
  const partsTotalAed = round2(lines.reduce((sum, line) => sum + line.clientLineTotalAed, 0));
  const deliveryAed = round2(nonNegativeMoney(order.logistics?.deliveryAed));
  const packingAed = round2(nonNegativeMoney(order.logistics?.packingAed));
  const commissionAed = round2(nonNegativeMoney(order.logistics?.serviceFeeAed));
  const exchangeRate = Number(order.exchangeRate) > 0 && Number.isFinite(Number(order.exchangeRate)) ? Number(order.exchangeRate) : 3.67;
  const cargoAed = round2(nonNegativeMoney(order.logistics?.cargoTotalCostUsd) * exchangeRate);
  const logisticsTotalAed = round2(deliveryAed + packingAed + commissionAed + cargoAed);
  const grossTotalAed = round2(partsTotalAed + logisticsTotalAed);
  const discountAed = calculateOrderDiscountAed(grossTotalAed, order);
  const totalAed = round2(Math.max(0, grossTotalAed - discountAed));
  const depositAed = round2(nonNegativeMoney(order.searchDepositAmountAed));
  return {
    lines, partsTotalAed, deliveryAed, packingAed, commissionAed, cargoAed, logisticsTotalAed,
    grossTotalAed, discountAed, totalAed, depositAed,
    balanceDueAed: round2(Math.max(0, totalAed - depositAed)),
    markupAed: round2(lines.reduce((sum, line) => sum + line.markupShareAed, 0)),
  };
};
