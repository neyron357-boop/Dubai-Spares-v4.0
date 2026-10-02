import { describe, expect, it } from 'vitest';
import { normalizeOrder } from '../../orderNormalization';
import { Priority, Source, type Order, type Part } from '../../types';
import {
  buildArchivedOrder,
  buildOrderBucketUpdate,
  buildRestoredOrder,
  getOrderBucket,
  getOrderCardView,
  isArchivedOrder,
} from '../../utils/orderCard';

const now = Date.UTC(2026, 9, 2, 12);
const makeOrder = (patch: Partial<Order> = {}): Order => ({
  id: '10000000-0000-4000-8000-000000000001',
  brand: 'BMW',
  model: '3 Series',
  year: '2017',
  clientName: 'Ахмад',
  vin: '',
  status: 'active',
  isArchived: false,
  isSold: false,
  parts: [],
  priority: Priority.MEDIUM,
  source: Source.OTHER,
  markupPercent: 10,
  exchangeRate: 3.67,
  createdAt: now - 3 * 3_600_000,
  ...patch,
});
const part = (id: string, hasOffer = false, patch: Partial<Part> = {}): Part => ({
  id,
  name: 'Передний бампер',
  isFound: false,
  variants: hasOffer
    ? [
        {
          id: `${id}-offer`,
          priceAed: 100,
          shopName: 'Parts Shop',
          phone: '',
          location: '',
          createdAt: now,
        },
      ]
    : [],
  ...patch,
});

describe('order card facts and workflow', () => {
  it('keeps interest separate from a complete parts search and a paid search deposit', () => {
    const view = getOrderCardView(
      makeOrder({ status: 'interest', searchDepositStatus: 'paid', parts: [part('one', true)] }),
      now,
    );
    expect(view).toMatchObject({
      title: 'BMW 3 Series',
      vehicleLabel: 'BMW 3 Series 2017',
      clientLabel: 'Ахмад',
      statusLabel: 'Интерес',
      foundParts: 1,
      totalParts: 1,
      progress: 100,
      paymentLabel: 'Депозит внесён',
      attention: null,
    });
  });

  it('does not call a partially sourced order complete or treat quantity as parts count', () => {
    const partial = makeOrder({ parts: [part('one', true, { quantity: 5 }), part('two')] });
    expect(getOrderCardView(partial, now)).toMatchObject({
      statusLabel: 'В поиске',
      foundParts: 1,
      totalParts: 2,
      progress: 50,
    });
    expect(
      getOrderCardView(
        makeOrder({ parts: [part('one', true), part('two', false, { isFound: true })] }),
        now,
      ),
    ).toMatchObject({ statusLabel: 'Детали подобраны', tone: 'green', progress: 100 });
  });

  it('handles empty requests without presenting progress or guessed client risk', () => {
    const view = getOrderCardView(makeOrder({ brand: ' ', model: '', clientName: ' ' }), now);
    expect(view).toMatchObject({
      title: 'Автомобиль не указан',
      clientLabel: 'Клиент не указан',
      foundParts: 0,
      totalParts: 0,
      progress: 0,
      statusLabel: 'В поиске',
      paymentLabel: null,
      attention: null,
    });
    expect(
      getOrderCardView(makeOrder({ clientName: '', customerContact: '+971 50000' }), now),
    ).toMatchObject({ clientLabel: '+971 50000' });
  });

  it('shows payment facts with full prepayment before deposit and clears obsolete deposit waiting', () => {
    expect(
      getOrderCardView(
        makeOrder({
          status: 'waiting_deposit',
          searchDepositStatus: 'pending',
          paymentStatus: 'full_prepayment_paid',
        }),
        now,
      ),
    ).toMatchObject({ paymentLabel: 'Предоплата получена', statusLabel: 'В поиске' });
    expect(
      getOrderCardView(makeOrder({ salesStatus: 'Paid', searchDepositStatus: 'paid' }), now),
    ).toMatchObject({ paymentLabel: 'Предоплата получена' });
    expect(
      getOrderCardView(makeOrder({ paymentStatus: 'search_deposit_paid' }), now).paymentLabel,
    ).toBe('Депозит внесён');
    expect(getOrderCardView(makeOrder({ salesStatus: 'Completed' }), now).paymentLabel).toBeNull();
  });

  it.each([
    [{ status: 'not_found' }, 'Не найдено'],
    [{ salesStatus: 'Price Sent' }, 'Цена отправлена'],
    [{ salesStatus: 'Pending Approval' }, 'Ждём ответ'],
    [{ searchDepositStatus: 'pending' }, 'Ожидаем депозит'],
    [{ isArchived: true, salesStatus: 'Price Sent' }, 'В архиве'],
    [{ isArchived: true, salesStatus: 'Completed' }, 'Завершён'],
    [{ status: 'sold', isSold: false }, 'Завершён'],
  ] as Array<[Partial<Order>, string]>)('preserves explicit workflow %j', (patch, statusLabel) => {
    expect(
      getOrderCardView(makeOrder({ parts: [part('one', true)], ...patch }), now).statusLabel,
    ).toBe(statusLabel);
  });

  it('uses creation age even after edits or pinning and clamps future creation times', () => {
    const order = makeOrder({ createdAt: now - 51 * 3_600_000, updatedAt: now, isPinned: true });
    expect(getOrderCardView(order, now).ageLabel).toBe('2 дн.');
    expect(getOrderCardView(makeOrder(), now).ageLabel).toBe('3 ч');
    expect(getOrderCardView(makeOrder({ createdAt: now + 60_000 }), now).ageLabel).toBe('Новый');
  });

  it('only warns about an actual purchase without full prepayment', () => {
    const purchasing = makeOrder({
      searchDepositStatus: 'paid',
      parts: [part('one', true, { status: 'ordered' })],
    });
    expect(getOrderCardView(purchasing, now).attention).toBe('Закупка без полной предоплаты');
    expect(
      getOrderCardView({ ...purchasing, paymentStatus: 'full_prepayment_paid' }, now).attention,
    ).toBeNull();
    expect(getOrderCardView(buildArchivedOrder(purchasing), now).attention).toBeNull();
  });
});

describe('order card bucket transitions', () => {
  it.each([{ status: 'lead' }, { isLead: true }, { customerStatus: 'LEAD' }] as Array<
    Partial<Order>
  >)('retains the lead identity represented by %j when archiving changes the status', (patch) => {
    const archived = normalizeOrder(buildArchivedOrder(makeOrder(patch), now));
    expect(getOrderBucket(archived)).toBe('archive');
    expect(getOrderBucket(normalizeOrder(buildRestoredOrder(archived, now)))).toBe('interest');
  });

  it('keeps archived leads visible in the archive and restores their original lead state', () => {
    const lead = makeOrder({
      status: 'lead',
      isLead: true,
      customerStatus: 'LEAD',
      leadUnread: true,
      paymentStatus: 'search_deposit_paid',
    });
    const archived = normalizeOrder(buildArchivedOrder(lead, now));
    expect(isArchivedOrder(archived)).toBe(true);
    expect(getOrderBucket(archived)).toBe('archive');
    expect(archived).toMatchObject({ isLead: true, customerStatus: 'LEAD', leadUnread: true });
    const restored = normalizeOrder(buildRestoredOrder(archived, now + 1));
    expect(getOrderBucket(restored)).toBe('interest');
    expect(restored).toMatchObject({
      isArchived: false,
      isLead: true,
      customerStatus: 'LEAD',
      leadUnread: true,
      paymentStatus: 'search_deposit_paid',
    });
  });

  it.each(['active', 'not_found'] as const)(
    'converts a lead deliberately moved to %s without changing payment',
    (bucket) => {
      const converted = normalizeOrder(
        buildOrderBucketUpdate(
          makeOrder({
            status: 'lead',
            isLead: true,
            customerStatus: 'LEAD',
            leadUnread: true,
            paymentStatus: 'search_deposit_paid',
          }),
          bucket,
          now,
        ),
      );
      expect(getOrderBucket(converted)).toBe(bucket);
      expect(converted).toMatchObject({
        isLead: false,
        customerStatus: 'INQUIRY',
        leadUnread: false,
        leadReadAt: now,
        statusChangedAt: now,
        paymentStatus: 'search_deposit_paid',
      });
    },
  );

  it.each(['none', 'search_deposit_paid', 'full_prepayment_paid'] as const)(
    'restores a completed order with %s without the normalizer archiving it again',
    (paymentStatus) => {
      const completed = normalizeOrder(makeOrder({ salesStatus: 'Completed', paymentStatus }));
      const restored = normalizeOrder(buildRestoredOrder(completed, now));
      expect(isArchivedOrder(restored)).toBe(false);
      expect(getOrderBucket(restored)).toBe('active');
      expect(restored).toMatchObject({
        isSold: false,
        isArchived: false,
        status: 'active',
        paymentStatus,
        salesStatus: paymentStatus === 'full_prepayment_paid' ? 'Paid' : 'Inquiry',
      });
    },
  );
});
