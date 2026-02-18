import { Order, Priority, Source } from './types';

export type CloudLead = {
  id: string;
  name: string;
  phone: string;
  message?: string;
  created_at: string;
  updated_at: string;
  payload_json?: unknown;
  order_id?: string | null;
};

const toTimestamp = (value: string | number | null | undefined): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) return asNumber;
    const asDate = Date.parse(value);
    if (!Number.isNaN(asDate)) return asDate;
  }
  return Date.now();
};

const toPayloadRecord = (payload: unknown): Record<string, unknown> => {
  if (!payload) return {};
  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload);
      return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
};

/**
 * Преобразует лид из Supabase в Order-объект.
 * Важно: выставляет leadUnread=true, чтобы входящий лид попал в уведомления.
 */
export const mapCloudLeadToOrder = (lead: CloudLead): Order => {
  const payload = toPayloadRecord(lead.payload_json);
  const year = payload.year;

  return {
    id: lead.order_id || lead.id,
    brand: typeof payload.brand === 'string' ? payload.brand : '-',
    model: typeof payload.model === 'string' ? payload.model : '-',
    year: typeof year === 'number' || typeof year === 'string' ? `${year}` : '',
    bodyType: typeof payload.bodyType === 'string' ? payload.bodyType : '',
    vin: typeof payload.vin === 'string' ? payload.vin : '',
    vinPhotoUrl: '',
    carPhotoUrl: '',
    carPhotos: [],
    parts: [],
    clientName: lead.name || 'Public Lead',
    customerContact: lead.phone || '',
    priority: Priority.HIGH,
    status: 'lead',
    source: Source.OTHER,
    leadSource: 'public_form',
    leadUnread: true,
    createdAt: toTimestamp(lead.created_at),
    updatedAt: toTimestamp(lead.updated_at),
    isArchived: false,
    isSold: false,
    isVip: false,
    isLead: true,
    markupPercent: 15,
    markupType: 'percent',
    markupFixedAed: 0,
    exchangeRate: 3.67,
    clientCurrency: 'AED',
    fxUpdatedAt: Date.now(),
    notes: [],
    pricingEvents: []
  };
};

/**
 * Объединяет облачные лиды с существующими заказами без дубликатов.
 */
export const mergeCloudLeadsWithOrders = (existingOrders: Order[], cloudLeads: CloudLead[]): Order[] => {
  if (cloudLeads.length === 0) return existingOrders;

  const existingById = new Map(existingOrders.map((order) => [order.id, order]));
  const merged = [...existingOrders];

  cloudLeads.forEach((lead) => {
    const mapped = mapCloudLeadToOrder(lead);
    const existing = existingById.get(mapped.id);

    if (!existing) {
      merged.push(mapped);
      return;
    }

    if (existing.leadSource === 'public_form') {
      const index = merged.findIndex((order) => order.id === existing.id);
      if (index >= 0) {
        merged[index] = {
          ...existing,
          leadUnread: existing.leadUnread === false ? false : true,
          updatedAt: Math.max(Number(existing.updatedAt || 0), mapped.updatedAt || 0)
        };
      }
    }
  });

  return merged;
};
