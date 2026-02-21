import { decodePayloadFromCompressedTransport } from './cloudCodec';
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
  payload_b64?: string;
  payload_codec?: string;
  payload?: unknown;
};

const createId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

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
  if (typeof payload === 'object' && !Array.isArray(payload)) return payload as Record<string, unknown>;
  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return {};
};

const extractPayloadFromLead = async (lead: CloudLead): Promise<Record<string, unknown>> => {
  if (lead.payload_json) {
    const payload = toPayloadRecord(lead.payload_json);
    if (Object.keys(payload).length > 0) return payload;
  }

  if (typeof lead.payload_b64 === 'string' && lead.payload_b64.trim()) {
    try {
      const decoded = await decodePayloadFromCompressedTransport<Record<string, unknown>>(
        lead.payload_b64,
        lead.payload_codec || 'gzip+b64'
      );
      if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) return decoded as Record<string, unknown>;
    } catch {
      // fall through to next extraction method
    }
  }

  if (lead.payload) {
    const payload = toPayloadRecord(lead.payload);
    if (Object.keys(payload).length > 0) return payload;
  }

  return {};
};

export const validateCloudLead = (lead: unknown): lead is CloudLead => {
  if (!lead || typeof lead !== 'object') return false;
  const entry = lead as Record<string, unknown>;
  return !!(entry.id && entry.created_at);
};

/**
 * Преобразует лид из Supabase в Order-объект.
 * Важно: выставляет leadUnread=true, чтобы входящий лид попал в уведомления.
 */
export const mapCloudLeadToOrder = async (lead: CloudLead): Promise<Order> => {
  const payload = await extractPayloadFromLead(lead);
  const year = payload.year;
  const fallbackName = typeof payload.name === 'string' ? payload.name : 'Public Lead';
  const fallbackPhone = typeof payload.phone === 'string' ? payload.phone : '';

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
    parts: Array.isArray(payload.parts)
      ? payload.parts.map((p: unknown) => {
          const part = p && typeof p === 'object' && !Array.isArray(p) ? p as Record<string, unknown> : {};
          return { ...part, variants: Array.isArray(part.variants) ? part.variants : [] };
        })
      : [],
    clientName: lead.name || fallbackName,
    customerContact: lead.phone || fallbackPhone,
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
    notes: typeof payload.message === 'string'
      ? [{ id: createId(), text: payload.message, createdAt: Date.now() }]
      : [],
    pricingEvents: []
  };
};

/**
 * Объединяет облачные лиды с существующими заказами без дубликатов.
 */
export const mergeCloudLeadsWithOrders = async (existingOrders: Order[], cloudLeads: CloudLead[]): Promise<Order[]> => {
  if (cloudLeads.length === 0) return existingOrders;

  const existingById = new Map(existingOrders.map((order) => [order.id, order]));
  const merged = [...existingOrders];

  for (const lead of cloudLeads) {
    if (!validateCloudLead(lead)) continue;

    try {
      const mapped = await mapCloudLeadToOrder(lead);
      const existing = existingById.get(mapped.id);

      if (!existing) {
        merged.push(mapped);
        continue;
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
    } catch {
      // skip malformed leads silently
    }
  }

  return merged;
};
