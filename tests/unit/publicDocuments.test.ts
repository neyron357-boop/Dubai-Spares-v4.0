import { describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '../../appSettings';
import { ensurePayloadReadModel } from '../../publicQuoteApi';
import { buildQuoteSnapshot, extractOrderIdFromQuoteSlug } from '../../shareUtils';
import type { Order } from '../../types';
import {
  buildInvoicePayloadFromOrder,
  buildInvoicePayloadFromSnapshot,
} from '../../utils/invoiceDocument';
import { normalizePublicQuoteSnapshotPayload } from '../../utils/publicQuoteSnapshot';
import { calculateOrderTotals } from '../../utils/quotePricing';

const order = {
  id: 'doc-test',
  brand: 'Toyota',
  model: 'Camry',
  year: '2020',
  clientName: 'QA Client',
  parts: [
    {
      id: 'part',
      name: 'Bumper',
      quantity: 3,
      bestOfferId: 'selected',
      variants: [
        { id: 'old', priceAed: 900, isBest: true },
        {
          id: 'selected',
          priceAed: 100,
          purchasePriceAed: 40,
          phone: 'private-supplier',
          shopName: 'Private shop',
        },
      ],
    },
  ],
  logistics: { deliveryAed: 10, packingAed: 5, serviceFeeAed: 2, cargoTotalCostUsd: 10 },
  exchangeRate: 3.67,
  markupPercent: 10,
  discountPercent: 5,
  searchDepositAmountAed: 50,
  notes: [
    { id: 'secret', text: 'Internal expense', kind: 'proof', visibility: 'internal' },
    { id: 'public', text: 'Client proof', kind: 'proof', visibility: 'client' },
  ],
} as unknown as Order;

describe('customer documents', () => {
  it('matches the internal total in shared links and both invoices', () => {
    const totals = calculateOrderTotals(order);
    const snapshot = normalizePublicQuoteSnapshotPayload(buildQuoteSnapshot(order))!;
    const invoice = buildInvoicePayloadFromOrder(order, {} as AppSettings);
    const clientInvoice = buildInvoicePayloadFromSnapshot(snapshot);
    expect(snapshot.grandTotalAed).toBe(totals.totalAed);
    expect(snapshot.balanceDueAed).toBe(totals.balanceDueAed);
    expect(snapshot.items[0]).toMatchObject({ qty: 3, totalAed: 330 });
    expect(invoice.totalAed).toBe(totals.totalAed);
    expect(clientInvoice.totalAed).toBe(totals.totalAed);
  });
  it('does not embed internal proof notes or supplier purchase details', () => {
    const serialized = JSON.stringify(buildQuoteSnapshot(order));
    expect(serialized).toContain('Client proof');
    expect(serialized).not.toContain('Internal expense');
    expect(serialized).not.toContain('private-supplier');
    expect(serialized).not.toContain('purchasePriceAed');
  });
  it('preserves a declared zero total and falls back past null fields', () => {
    const snapshot = buildQuoteSnapshot({
      ...order,
      discountType: 'fixed',
      discountFixedAed: 10000,
    });
    expect(normalizePublicQuoteSnapshotPayload(snapshot)!.grandTotalAed).toBe(0);
    const fallback = normalizePublicQuoteSnapshotPayload({
      ...snapshot,
      breakdown: { delivery: null, total: null, balance_due: null },
      totals: { grand_total_aed: 90, balance_due_aed: 40 },
    })!;
    expect(fallback.grandTotalAed).toBe(90);
    expect(fallback.balanceDueAed).toBe(40);
  });
  it('normalizes a client read without writing or replacing an agreed discounted total', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const payload = {
      items: [{ id: 'one', name: 'Bumper', qty: 1, unit_price: 100 }],
      totals: { grand_total_aed: 75, discount_aed: 25 },
    };
    for (const payload_json of [payload, null]) {
      const row = { id: 'read-only', payload_json } as Parameters<typeof ensurePayloadReadModel>[0];
      const result = await ensurePayloadReadModel(row, payload);
      expect((result.payload as typeof payload).totals.grand_total_aed).toBe(75);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not crash on a malformed encoded URL', () => {
    expect(extractOrderIdFromQuoteSlug('%E0%A4%A')).toBe('%E0%A4%A');
  });
});
