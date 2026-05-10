import { loadAppSettings } from './appSettings';
import { publishDomainEvent } from './domainEvents';
import { logger } from './logging';
import { publicQuoteCreateSnapshot } from './publicQuoteApi';
import { Order } from './types';

const DEBOUNCE_MS = 1200;
const pendingOrders = new Map<string, Order>();
const timers = new Map<string, number>();
const inFlight = new Map<string, Promise<void>>();

const buildSnapshotOptions = () => {
  const settings = loadAppSettings();
  return {
    owner: {
      whatsappPhone: settings.publicWhatsappNumber,
      displayName: 'Stark Motors'
    },
    publicSettings: {
      publicWhatsappNumber: settings.publicWhatsappNumber,
      publicTelegramUrl: settings.publicTelegramUrl,
      publicInstagramUrl: settings.publicInstagramUrl,
      publicDeliveryTerms: settings.publicDeliveryTerms,
      publicWorkTerms: settings.publicWorkTerms,
      publicCompanyLogoUrl: settings.publicCompanyLogoUrl,
      publicInvoiceSignatureUrl: settings.publicInvoiceSignatureUrl,
      publicManagerName: settings.publicManagerName,
      publicTermsFileUrl: settings.publicTermsFileUrl,
      publicTermsFileName: settings.publicTermsFileName,
      executorPhotoUrl: settings.executorPhotoUrl,
      executorRole: settings.executorRole
    }
  };
};

const projectionVersions = new Map<string, number>();

const syncOrderSnapshotNow = async (order: Order, reason = 'order_updated', sourceOrderUpdatedAt = Number(order.updatedAt || order.createdAt || Date.now())) => {
  const token = String(order.publicQuoteToken || '').trim();
  if (!token) return;
  const existing = inFlight.get(order.id);
  if (existing) {
    pendingOrders.set(order.id, order);
    await existing;
    return;
  }

  const task = (async () => {
    let nextOrder: Order | undefined = order;
    while (nextOrder) {
      const currentOrder = nextOrder;
      pendingOrders.delete(currentOrder.id);
      try {
        const projectionVersion = (projectionVersions.get(currentOrder.id) || 0) + 1;
        projectionVersions.set(currentOrder.id, projectionVersion);
        await publicQuoteCreateSnapshot(currentOrder, {
          currency: currentOrder.clientCurrency || 'USD',
          exchangeRate: Number(currentOrder.exchangeRate || 3.67),
          token,
          upsertByToken: true,
          projection_reason: reason,
          projected_at: new Date().toISOString(),
          source_order_updated_at: new Date(sourceOrderUpdatedAt).toISOString(),
          projection_version: projectionVersion,
          ...buildSnapshotOptions()
        } as any);
        await publishDomainEvent('PUBLIC_QUOTE_REFRESHED', {
          entityType: 'public_quote',
          entityId: token,
          aggregateId: currentOrder.id,
          dedupeKey: `public-quote-refreshed:${currentOrder.id}:${projectionVersion}`,
          idempotencyKey: `public-quote-refreshed:${currentOrder.id}:${projectionVersion}`,
          replaySafe: true,
          source: 'system',
          payload: { orderId: currentOrder.id, reason, projectedAt: Date.now(), sourceOrderUpdatedAt, projectionVersion }
        });
      } catch (error) {
        await logger.warn('public-quote:live-sync', 'Failed to refresh live public quote snapshot', {
          orderId: currentOrder.id,
          token,
          error: error instanceof Error ? error.message : 'unknown'
        });
      }
      nextOrder = pendingOrders.get(currentOrder.id);
    }
  })().finally(() => {
    inFlight.delete(order.id);
  });

  inFlight.set(order.id, task);
  await task;
};

export const scheduleLivePublicQuoteSync = (order: Order, options?: { reason?: string; sourceOrderUpdatedAt?: number }) => {
  const token = String(order.publicQuoteToken || '').trim();
  if (!token) return;
  pendingOrders.set(order.id, order);
  const existingTimer = timers.get(order.id);
  if (existingTimer) window.clearTimeout(existingTimer);
  const timer = window.setTimeout(() => {
    timers.delete(order.id);
    const queuedOrder = pendingOrders.get(order.id);
    if (!queuedOrder) return;
    void syncOrderSnapshotNow(queuedOrder, options?.reason || 'order_updated', options?.sourceOrderUpdatedAt || Number(queuedOrder.updatedAt || queuedOrder.createdAt || Date.now()));
  }, DEBOUNCE_MS);
  timers.set(order.id, timer);
};
