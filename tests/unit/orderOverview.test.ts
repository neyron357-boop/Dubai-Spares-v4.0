import { describe, expect, it } from 'vitest';
import { Priority, Source, type Order, type Part, type PriceVariant } from '../../types';
import { getOrderOverview } from '../../utils/orderOverview';

const variant = (id: string, price: number, patch: Partial<PriceVariant> = {}): PriceVariant => ({
  id,
  priceAed: price,
  shopName: 'Parts supplier',
  phone: '',
  location: '',
  createdAt: 1,
  ...patch,
});
const part = (id: string, patch: Partial<Part> = {}): Part => ({
  id,
  name: 'Бампер',
  isFound: false,
  variants: [],
  ...patch,
});
const order = (patch: Partial<Order> = {}): Order => ({
  id: '10000000-0000-4000-8000-000000000001',
  brand: 'BMW',
  model: '3 Series',
  year: '2017',
  vin: '',
  clientName: 'Ахмад',
  status: 'active',
  isSold: false,
  isArchived: false,
  parts: [],
  priority: Priority.MEDIUM,
  source: Source.OTHER,
  markupPercent: 10,
  exchangeRate: 3.67,
  createdAt: 1,
  ...patch,
});
const completePart = part('one', { variants: [variant('offer', 100)] });

describe('order overview facts', () => {
  it('separates sourced positions, selected offers and prices using the finance selection', () => {
    const view = getOrderOverview(
      order({
        searchDepositStatus: 'paid',
        parts: [
          part('manually-found', { isFound: true }),
          part('offer-selected', {
            bestOfferId: 'zero',
            variants: [variant('old', 100, { isBest: true }), variant('zero', 0)],
          }),
          part('offer-priced', { variants: [variant('selected', 200)] }),
          part('still-searching'),
        ],
      }),
    );
    expect(view).toMatchObject({
      totalParts: 4,
      sourcedParts: 3,
      selectedParts: 2,
      pricedParts: 1,
    });
    expect(view.nextAction.id).toBe('search');
    expect(
      getOrderOverview(
        order({
          searchDepositStatus: 'paid',
          parts: [part('manual', { isFound: true }), completePart],
        }),
      ).nextAction.id,
    ).toBe('offers');
  });

  it('does not count invalid or zero selected prices as quote ready', () => {
    const view = getOrderOverview(
      order({
        searchDepositStatus: 'paid',
        parts: [
          part('negative', { variants: [variant('a', -1)] }),
          part('infinite', { variants: [variant('b', Infinity)] }),
          part('zero', { variants: [variant('c', 100, { salePriceAed: 0 })] }),
        ],
      }),
    );
    expect(view).toMatchObject({ sourcedParts: 3, selectedParts: 3, pricedParts: 0 });
    expect(view.nextAction.id).toBe('offers');
  });

  it('recognizes deposit-only legacy records without inventing full prepayment', () => {
    const view = getOrderOverview(order({ searchDepositStatus: 'paid', parts: [completePart] }));
    expect(view).toMatchObject({
      depositPaid: true,
      fullPrepaymentPaid: false,
      paymentLabel: 'Депозит внесён',
      quoteCreated: false,
    });
    expect(view.nextAction.id).toBe('quote');
  });

  it('gives full payment precedence over deposit and does not automatically complete paid orders', () => {
    const view = getOrderOverview(
      order({
        paymentStatus: 'full_prepayment_paid',
        searchDepositStatus: 'pending',
        publicQuoteToken: 'local-quote',
        parts: [completePart],
        notes: [{ id: 'proof', text: 'Упаковка, cargo receipt', createdAt: 1, kind: 'proof' }],
      }),
    );
    expect(view).toMatchObject({
      depositPaid: true,
      fullPrepaymentPaid: true,
      paymentLabel: 'Предоплата получена',
      completed: false,
      archived: false,
    });
    expect(view.nextAction.id).toBe('proof');
    expect(getOrderOverview(order({ salesStatus: 'Paid' })).paymentLabel).toBe(
      'Предоплата получена',
    );
    expect(getOrderOverview(order({ salesStatus: 'Completed' })).paymentLabel).toBeNull();
  });

  it('reports only missing input facts and requests a country only for export', () => {
    const missing = getOrderOverview(order()).missingInputs;
    expect(missing.map((item) => item.id)).toEqual(['vin', 'photo', 'contact']);
    expect(missing.map((item) => item.action)).toEqual(['vehicle', 'photo', 'client']);
    const provided = {
      vin: 'WBA8E91090A123456',
      carPhotos: ['data:image/png;base64,image'],
      contactLinks: { telegramUrl: 'https://t.me/customer' },
    };
    expect(
      getOrderOverview(order({ ...provided, logistics: { deliveryType: 'uae' } })).missingInputs,
    ).toEqual([]);
    expect(
      getOrderOverview(order({ ...provided, logistics: { deliveryType: 'export' } })).missingInputs,
    ).toEqual([
      {
        id: 'delivery',
        action: 'finance',
        label: 'Указать доставку',
        description: 'Добавьте страну международной доставки.',
      },
    ]);
    expect(
      getOrderOverview(
        order({ ...provided, logistics: { deliveryType: 'export', cargoCountry: 'Казахстан' } }),
      ).missingInputs,
    ).toEqual([]);
  });

  it('describes legacy quote creation without claiming delivery and allows an explicit override', () => {
    const legacy = order({
      salesStatus: 'Price Sent',
      parts: [completePart],
      searchDepositStatus: 'paid',
    });
    expect(getOrderOverview(legacy)).toMatchObject({
      quoteCreated: true,
      statusLabel: 'Смета создана',
    });
    expect(getOrderOverview(legacy, { quoteCreated: false })).toMatchObject({
      quoteCreated: false,
    });
    expect(getOrderOverview(legacy, { quoteCreated: false }).nextAction.id).toBe('quote');
    expect(
      getOrderOverview(
        order({ publicQuoteToken: 'token', searchDepositStatus: 'paid', parts: [completePart] }),
      ).nextAction.id,
    ).toBe('prepayment');
    expect(getOrderOverview(order({ salesStatus: 'Paid' })).quoteCreated).toBe(false);
  });
});

describe('overview next action order', () => {
  it('allows request entry before deposit and then observes the supplier gate', () => {
    expect(getOrderOverview(order({ status: 'waiting_deposit' })).nextAction.id).toBe('add_parts');
    expect(getOrderOverview(order({ parts: [part('one')] })).nextAction.id).toBe('deposit');
    expect(
      getOrderOverview(order({ parts: [part('one')] }), { depositRequired: false }).nextAction.id,
    ).toBe('search');
  });

  it('prioritizes restoring archived leads and explicit completed orders over other actions', () => {
    const archivedLead = getOrderOverview(
      order({ status: 'archive', isLead: true, customerStatus: 'LEAD' }),
    );
    expect(archivedLead).toMatchObject({
      archived: true,
      completed: false,
      statusLabel: 'В архиве',
    });
    expect(archivedLead.nextAction.id).toBe('restore');
    for (const patch of [
      { isSold: true },
      { status: 'sold' },
      { salesStatus: 'Completed' },
    ] as Array<Partial<Order>>) {
      const view = getOrderOverview(order(patch));
      expect(view).toMatchObject({ archived: true, completed: true, statusLabel: 'Завершён' });
      expect(view.nextAction.id).toBe('restore');
    }
  });
});
