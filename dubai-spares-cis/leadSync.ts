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
  console.log('[toPayloadRecord] Input type:', typeof payload, payload);

  if (!payload) {
    console.warn('[toPayloadRecord] Empty payload');
    return {};
  }

  if (typeof payload === 'object' && !Array.isArray(payload)) {
    console.log('[toPayloadRecord] Already object');
    return payload as Record<string, unknown>;
  }

  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload);
      console.log('[toPayloadRecord] Parsed from string:', parsed);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch (error) {
      console.error('[toPayloadRecord] JSON parse error:', error, 'Input:', payload.substring(0, 100));
      return {};
    }
  }

  console.warn('[toPayloadRecord] Unknown payload type, returning empty object');
  return {};
};

const extractPayloadFromLead = async (lead: CloudLead): Promise<Record<string, unknown>> => {
  console.log('[extractPayloadFromLead] Lead ID:', lead.id);

  if (lead.payload_json) {
    const payload = toPayloadRecord(lead.payload_json);
    if (Object.keys(payload).length > 0) {
      console.log('[extractPayloadFromLead] Using payload_json');
      return payload;
    }
  }

  if (typeof lead.payload_b64 === 'string' && lead.payload_b64.trim()) {
    try {
      console.log('[extractPayloadFromLead] Trying payload_b64');
      const decoded = await decodePayloadFromCompressedTransport({
        payloadB64: lead.payload_b64,
        payloadCodec: lead.payload_codec || 'gzip'
      });

      if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) {
        console.log('[extractPayloadFromLead] Decoded from payload_b64');
        return decoded as Record<string, unknown>;
      }
    } catch (error) {
      console.error('[extractPayloadFromLead] Failed to decode payload_b64:', error);
    }
  }

  if (lead.payload) {
    const payload = toPayloadRecord(lead.payload);
    if (Object.keys(payload).length > 0) {
      console.log('[extractPayloadFromLead] Using legacy payload');
      return payload;
    }
  }

  console.warn('[extractPayloadFromLead] No valid payload found for lead:', lead.id);
  return {};
};

export const validateCloudLead = (lead: unknown): lead is CloudLead => {
  if (!lead || typeof lead !== 'object') {
    console.error('[validateCloudLead] Not an object:', lead);
    return false;
  }

  const entry = lead as Record<string, unknown>;
  const requiredFields = ['id', 'name', 'phone', 'created_at'] as const;
  const missingFields = requiredFields.filter((field) => !entry[field]);

  if (missingFields.length > 0) {
    console.error('[validateCloudLead] Missing fields:', missingFields, 'in lead:', entry.id);
    return false;
  }

  return true;
};

/**
 * Преобразует лид из Supabase в Order-объект.
 * Важно: выставляет leadUnread=true, чтобы входящий лид попал в уведомления.
 */
export const mapCloudLeadToOrder = async (lead: CloudLead): Promise<Order> => {
  const payload = await extractPayloadFromLead(lead);
  const year = payload.year;

  console.log('[mapCloudLeadToOrder] Mapping lead:', {
    id: lead.id,
    name: lead.name,
    phone: lead.phone,
    order_id: lead.order_id,
    payloadKeys: Object.keys(payload)
  });

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
    parts: Array.isArray(payload.parts) ? payload.parts : [],
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
  if (cloudLeads.length === 0) {
    console.log('[mergeCloudLeadsWithOrders] No cloud leads to merge');
    return existingOrders;
  }

  console.log('[mergeCloudLeadsWithOrders] Merging', cloudLeads.length, 'cloud leads');

  const existingById = new Map(existingOrders.map((order) => [order.id, order]));
  const merged = [...existingOrders];

  for (const lead of cloudLeads) {
    if (!validateCloudLead(lead)) {
      console.warn('[mergeCloudLeadsWithOrders] Skipping invalid lead:', lead);
      continue;
    }

    try {
      const mapped = await mapCloudLeadToOrder(lead);
      const existing = existingById.get(mapped.id);

      if (!existing) {
        console.log('[mergeCloudLeadsWithOrders] Adding new lead:', mapped.id);
        merged.push(mapped);
        continue;
      }

      if (existing.leadSource === 'public_form') {
        const index = merged.findIndex((order) => order.id === existing.id);
        if (index >= 0) {
          console.log('[mergeCloudLeadsWithOrders] Updating existing lead:', existing.id);
          merged[index] = {
            ...existing,
            leadUnread: existing.leadUnread === false ? false : true,
            updatedAt: Math.max(Number(existing.updatedAt || 0), mapped.updatedAt || 0)
          };
        }
      }
    } catch (error) {
      console.error('[mergeCloudLeadsWithOrders] Failed to map lead:', lead.id, error);
    }
  }

  console.log('[mergeCloudLeadsWithOrders] Result:', {
    before: existingOrders.length,
    after: merged.length,
    added: merged.length - existingOrders.length
  });

  return merged;
};
