import { describe, expect, it } from 'vitest';
import type { Order, Part, PriceVariant } from '../../types';
import {
  calculateOrderDiscountAed,
  calculateOrderTotals,
  getFinanceVariant,
  getPricedPartLines,
} from '../../utils/quotePricing';

const part = (id: string, price: number, quantity = 1): Part =>
  ({
    id,
    name: id,
    quantity,
    variants: [{ id: `${id}-offer`, priceAed: price, salePriceAed: price }],
  }) as Part;
const order = (patch: Partial<Order> = {}): Order =>
  ({
    parts: [part('a', 100, 2), part('b', 50)],
    markupType: 'percent',
    markupPercent: 10,
    exchangeRate: 3.67,
    logistics: { deliveryAed: 20, packingAed: 5, serviceFeeAed: 10, cargoTotalCostUsd: 10 },
    discountType: 'percent',
    discountPercent: 10,
    searchDepositAmountAed: 50,
    ...patch,
  }) as Order;

describe('consistent AED totals', () => {
  it('includes quantity, markup, international freight, discount and deposit', () => {
    expect(calculateOrderTotals(order())).toMatchObject({
      partsTotalAed: 275,
      cargoAed: 36.7,
      logisticsTotalAed: 71.7,
      grossTotalAed: 346.7,
      discountAed: 34.67,
      totalAed: 312.03,
      depositAed: 50,
      balanceDueAed: 262.03,
    });
  });
  it('allocates a fixed markup without losing a cent', () => {
    const lines = getPricedPartLines(
      order({
        parts: [part('a', 1), part('b', 1), part('c', 1)],
        markupType: 'fixed',
        markupFixedAed: 1,
      }),
    );
    expect(lines.map((line) => line.markupShareAed)).toEqual([0.33, 0.33, 0.34]);
    expect(
      calculateOrderTotals(
        order({ parts: [], logistics: {}, markupType: 'fixed', markupFixedAed: 100 }),
      ).totalAed,
    ).toBe(0);
  });
  it('uses the explicitly selected offer before an obsolete best flag', () => {
    const selected = { id: 'selected', priceAed: 100 } as PriceVariant;
    expect(
      getFinanceVariant({
        variants: [{ id: 'old', priceAed: 500, isBest: true }, selected],
        bestOfferId: 'selected',
      } as Part),
    ).toBe(selected);
  });
  it('caps discounts and balances at zero and never returns NaN for invalid data', () => {
    expect(
      calculateOrderTotals(
        order({ discountType: 'fixed', discountFixedAed: 10000, searchDepositAmountAed: 10000 }),
      ).totalAed,
    ).toBe(0);
    expect(calculateOrderTotals(order({ discountPercent: 100 })).balanceDueAed).toBe(0);
    expect(calculateOrderDiscountAed(100, { discountPercent: Number.NaN })).toBe(0);
    const totals = calculateOrderTotals(
      order({
        markupPercent: Number.NaN,
        logistics: { deliveryAed: -10, cargoTotalCostUsd: Infinity },
        exchangeRate: Infinity,
      }),
    );
    expect(totals.totalAed).toBe(225);
    expect(
      Object.values(totals).some((value) => typeof value === 'number' && !Number.isFinite(value)),
    ).toBe(false);
  });
});
