import { loadAppSettings } from './appSettings';
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
      displayName: 'Dubai Spares CIS'
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

const syncOrderSnapshotNow = async (order: Order) => {
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
        await publicQuoteCreateSnapshot(currentOrder, {
          currency: currentOrder.clientCurrency || 'USD',
          exchangeRate: Number(currentOrder.exchangeRate || 3.67),
          token,
          upsertByToken: true,
          ...buildSnapshotOptions()
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

export const scheduleLivePublicQuoteSync = (order: Order) => {
  const token = String(order.publicQuoteToken || '').trim();
  if (!token) return;
  pendingOrders.set(order.id, order);
  const existingTimer = timers.get(order.id);
  if (existingTimer) window.clearTimeout(existingTimer);
  const timer = window.setTimeout(() => {
    timers.delete(order.id);
    const queuedOrder = pendingOrders.get(order.id);
    if (!queuedOrder) return;
    void syncOrderSnapshotNow(queuedOrder);
  }, DEBOUNCE_MS);
  timers.set(order.id, timer);
};
