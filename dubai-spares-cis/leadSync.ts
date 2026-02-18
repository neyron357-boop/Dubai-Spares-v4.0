import { Order } from './types';
import { logger } from './logging';

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; code: string };

interface CloudLead {
  id: string;
  name: string;
  phone: string;
  message?: string;
  order_id?: string | null;
  created_at: string;
  updated_at: string;
  payload?: unknown;
  payload_json?: unknown;
}

/**
 * Converts a CloudLead to an Order object
 * Marks it as unread so notifyAboutIncomingLeads() can detect it
 */
export const mapCloudLeadToOrder = (lead: CloudLead): Order => {
  const payload = lead.payload_json || lead.payload || {};
  const payloadObj = typeof payload === 'string' ? { data: payload } : (payload as any);

  return {
    id: lead.id,
    brand: payloadObj.brand || '-',
    model: payloadObj.model || '-',
    year: payloadObj.year?.toString() || '',
    bodyType: payloadObj.bodyType || '',
    vin: payloadObj.vin || '',
    vinPhotoUrl: '',
    carPhotoUrl: '',
    carPhotos: [],
    parts: [],
    clientName: lead.name || 'Unknown',
    customerContact: lead.phone || '',
    priority: 'HIGH' as const,
    status: 'in_progress' as const,
    salesStatus: undefined,
    source: 'public_form' as const,
    leadSource: 'public_form' as const,
    leadUnread: true,
    createdAt: new Date(lead.created_at).toISOString(),
    updatedAt: new Date(lead.updated_at).toISOString(),
    isArchived: false,
    isSold: false,
    isVip: false,
    markup: 0,
    markupPercent: 15,
    markupType: 'percent' as const,
    markupFixedAed: 0,
    exchangeRate: 3.67,
    clientCurrency: 'AED' as const,
    fxUpdatedAt: new Date().toISOString(),
    notes: [],
    logistics: undefined,
    markupBasis: 'total' as const,
    pricingEvents: []
  };
};

/**
 * Merges cloud leads with existing orders
 * Prevents duplicates and updates existing leads
 */
export const mergeCloudLeadsWithOrders = (
  existingOrders: Order[],
  cloudLeads: CloudLead[]
): Order[] => {
  const existingById = new Map(existingOrders.map(o => [o.id, o]));
  const merged: Order[] = [];
  const processedIds = new Set<string>();

  cloudLeads.forEach(lead => {
    processedIds.add(lead.id);
    const existing = existingById.get(lead.id);

    if (existing) {
      merged.push({
        ...existing,
        leadUnread: existing.leadUnread !== false ? true : false
      });
    } else {
      merged.push(mapCloudLeadToOrder(lead));
    }
  });

  existingOrders.forEach(order => {
    if (!processedIds.has(order.id)) {
      merged.push(order);
    }
  });

  return merged;
};