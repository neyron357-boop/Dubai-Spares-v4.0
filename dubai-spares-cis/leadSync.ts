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


const LEAD_SYNC_STATE_KEY = 'lead_sync_state_v1';

type LeadSyncState = {
  ignoredIds: string[];
  convertedIds: string[];
};

const loadLeadSyncState = (): LeadSyncState => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LEAD_SYNC_STATE_KEY) || '{}');
    return {
      ignoredIds: Array.isArray(parsed.ignoredIds) ? parsed.ignoredIds.filter((item: unknown): item is string => typeof item === 'string') : [],
      convertedIds: Array.isArray(parsed.convertedIds) ? parsed.convertedIds.filter((item: unknown): item is string => typeof item === 'string') : []
    };
  } catch {
    return { ignoredIds: [], convertedIds: [] };
  }
};

const safeMessagePayload = (value: unknown): Record<string, unknown> => {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
};

const toStringArray = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];

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
  const messagePayload = safeMessagePayload(payload.message);
  const mergedPayload: Record<string, unknown> = { ...messagePayload, ...payload };
  const year = mergedPayload.year;
  const fallbackName = typeof mergedPayload.name === 'string' ? mergedPayload.name : (lead.name || 'Public Lead');
  const fallbackPhone = typeof mergedPayload.phone === 'string' ? mergedPayload.phone : (lead.phone || '');
  const partNames = Array.isArray(mergedPayload.requestedParts) ? mergedPayload.requestedParts : [];
  const parsedParts = Array.isArray(mergedPayload.parts) ? mergedPayload.parts : partNames;

  // Normalise notes: preserve audios and photos from existing note objects
  const rawNotes = Array.isArray(mergedPayload.notes) ? mergedPayload.notes : [];
  const notes = rawNotes.length > 0
    ? rawNotes.map((n: unknown) => {
        if (!n || typeof n !== 'object') return { id: createId(), text: typeof n === 'string' ? n : '', photos: [], audios: [], createdAt: Date.now() };
        const note = n as Record<string, unknown>;
        return {
          ...note,
          id: typeof note.id === 'string' ? note.id : createId(),
          text: typeof note.text === 'string' ? note.text : '',
          photos: toStringArray(note.photos),
          audios: toStringArray(note.audios),
          createdAt: typeof note.createdAt === 'number' ? note.createdAt : Date.now()
        };
      })
    : (typeof mergedPayload.message === 'string' ? [{ id: createId(), text: mergedPayload.message, photos: [], audios: [], createdAt: Date.now() }] : []);

  // Collect all carPhotos including from vinPhotos fallback
  const carPhotos = toStringArray(mergedPayload.carPhotos);
  const vinPhotos = toStringArray(mergedPayload.vinPhotos);

  const incomingSource = typeof mergedPayload.source === 'string' ? mergedPayload.source : '';
  const normalizedSource = Object.values(Source).includes(incomingSource as Source)
    ? (incomingSource as Source)
    : Source.OTHER;

  return {
    id: lead.order_id || lead.id,
    brand: typeof mergedPayload.brand === 'string' && mergedPayload.brand ? mergedPayload.brand : '-',
    model: typeof mergedPayload.model === 'string' && mergedPayload.model ? mergedPayload.model : '-',
    year: typeof year === 'number' || typeof year === 'string' ? `${year}` : '',
    bodyType: typeof mergedPayload.bodyType === 'string' ? mergedPayload.bodyType : '',
    vin: typeof mergedPayload.vin === 'string' ? mergedPayload.vin : '',
    vinPhotoUrl: vinPhotos[0] || '',
    carPhotoUrl: carPhotos[0] || '',
    carPhotos,
    parts: parsedParts.map((p: unknown) => {
      if (typeof p === 'string') {
        return { id: createId(), name: p, variants: [], photos: [], isFound: false };
      }
      const part = p && typeof p === 'object' && !Array.isArray(p) ? p as Record<string, unknown> : {};
      return {
        ...part,
        id: typeof part.id === 'string' ? part.id : createId(),
        name: typeof part.name === 'string' ? part.name : 'Part',
        variants: Array.isArray(part.variants) ? part.variants : [],
        photos: toStringArray(part.photos),
        isFound: !!part.isFound
      };
    }),
    clientName: lead.name || fallbackName,
    customerContact: lead.phone || fallbackPhone,
    socialNickname: typeof mergedPayload.socialNickname === 'string' ? mergedPayload.socialNickname : undefined,
    priority: Priority.HIGH,
    status: 'lead',
    source: normalizedSource,
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
    notes: notes as any[],
    pricingEvents: []
  };
};


/**
 * Объединяет облачные лиды с существующими заказами без дубликатов.
 */
export const mergeCloudLeadsWithOrders = async (existingOrders: Order[], cloudLeads: CloudLead[]): Promise<Order[]> => {
  if (cloudLeads.length === 0) return existingOrders;

  const existingById = new Map(existingOrders.map((order) => [order.id, order]));
  const syncState = loadLeadSyncState();
  const ignored = new Set(syncState.ignoredIds);
  const converted = new Set(syncState.convertedIds);
  const merged = [...existingOrders];

  for (const lead of cloudLeads) {
    if (!validateCloudLead(lead)) continue;

    try {
      const mapped = await mapCloudLeadToOrder(lead);
      const rawLeadId = typeof lead.id === 'string' ? lead.id.trim() : '';
      const serverMarkedConverted = typeof lead.order_id === 'string' && lead.order_id.trim().length > 0;
      if (ignored.has(mapped.id) || (rawLeadId && ignored.has(rawLeadId))) continue;
      const existing = existingById.get(mapped.id);

      if (!existing) {
        if (converted.has(mapped.id) || (rawLeadId && converted.has(rawLeadId)) || serverMarkedConverted) continue;
        merged.push(mapped);
        continue;
      }

      if (existing.leadSource === 'public_form' || existing.isLead) {
        const index = merged.findIndex((order) => order.id === existing.id);
        if (index >= 0) {
          const isConverted = converted.has(existing.id) || (rawLeadId && converted.has(rawLeadId)) || serverMarkedConverted;
          merged[index] = {
            ...existing,
            leadUnread: isConverted ? false : (existing.leadUnread === false ? false : true),
            isLead: isConverted ? false : existing.isLead,
            status: isConverted ? 'active' : existing.status,
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
