import type { Order, Part, PriceVariant } from '../types';
import { normalizePartQuantity } from './groupItems';

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

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
  return variants.find((variant) => variant.id === part.bestOfferId || variant.isBest) || variants[0] || null;
};

export const getVariantClientBasePriceAed = (variant?: PriceVariant | null) => (
  Number(variant?.salePriceAed ?? variant?.priceAed ?? 0)
);

export const calculateOrderDiscountAed = (
  grossTotalAed: number,
  order: Pick<Order, 'discountType' | 'discountPercent' | 'discountFixedAed'>
) => {
  const discountType = order.discountType || 'percent';
  const rawDiscountAed = discountType === 'fixed'
    ? Number(order.discountFixedAed || 0)
    : grossTotalAed * (Number(order.discountPercent || 0) / 100);
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
    ? Number(order.markupFixedAed || 0) / pricedBase.length
    : 0;
  const markupPercent = Number(order.markupPercent || 0);

  let allocatedFixedMarkup = 0;
  const grossLines = pricedBase.map((item, index) => {
    const fixedShare = index === pricedBase.length - 1
      ? round2(Number(order.markupFixedAed || 0) - allocatedFixedMarkup)
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

  return grossLines.map((item, index) => {
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
