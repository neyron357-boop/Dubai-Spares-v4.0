import { scheduleLivePublicQuoteSync } from './publicQuoteSync';
import { publishDomainEvent, subscribeDomainEvent } from './domainEvents';
import { enqueueCustomerNotificationEvent } from './customerEngagement';
import { recordReactiveEvent } from './reactiveDiagnostics';

let installed = false;

export const installOrderProjectionDispatcher = () => {
  if (installed) return;
  installed = true;

  subscribeDomainEvent('ORDER_UPDATED', async (event) => {
    const { order, previousOrder } = event.payload;
    const projections = ['local_order_state', 'supabase_order_graph'];
    let reason = 'order_updated';

    if (JSON.stringify(previousOrder?.pricingEvents || []) !== JSON.stringify(order.pricingEvents || [])) {
      projections.push('public_quote_snapshot', 'ui_totals', 'customer_activity_log', 'telegram_notification_queue');
      reason = 'pricing_changed';
      enqueueCustomerNotificationEvent(order, 'quote_updated', `Обновлена смета по заказу ${order.brand} ${order.model}`);
    }
    if (JSON.stringify(previousOrder?.logistics || {}) !== JSON.stringify(order.logistics || {})) {
      projections.push('public_quote_snapshot', 'customer_activity_log', 'telegram_notification_queue');
      reason = 'logistics_changed';
      enqueueCustomerNotificationEvent(order, 'logistics_updated', `Обновлена логистика по заказу ${order.brand} ${order.model}`);
    }
    if ((previousOrder?.status || '') !== (order.status || '')) {
      projections.push('in_app_notifications', 'customer_activity_log', 'telegram_notification_queue');
      reason = 'status_changed';
      enqueueCustomerNotificationEvent(order, 'status_changed', `Статус заказа изменён: ${previousOrder?.status || '—'} → ${order.status || '—'}`);
      await publishDomainEvent('ORDER_STATUS_CHANGED', {
        entityType: 'order',
        entityId: order.id,
        aggregateId: order.id,
        dedupeKey: `order-status:${order.id}:${order.updatedAt || 0}`,
        idempotencyKey: `order-status:${order.id}:${order.updatedAt || 0}`,
        replaySafe: true,
        source: 'system',
        payload: { order, previousStatus: previousOrder?.status, nextStatus: order.status }
      });
    }
    if ((previousOrder?.huntStatus || '') !== (order.huntStatus || '')) {
      projections.push('hunt_public_tracking_state', 'customer_activity_log', 'telegram_notification_queue');
      reason = 'hunt_status_changed';
      enqueueCustomerNotificationEvent(order, 'hunt_history', `Обновился прогресс поиска по заказу ${order.brand} ${order.model}`);
      await publishDomainEvent('ORDER_HUNT_STATUS_CHANGED', {
        entityType: 'order',
        entityId: order.id,
        aggregateId: order.id,
        dedupeKey: `order-hunt:${order.id}:${order.updatedAt || 0}`,
        idempotencyKey: `order-hunt:${order.id}:${order.updatedAt || 0}`,
        replaySafe: true,
        source: 'system',
        payload: { order, previousHuntStatus: previousOrder?.huntStatus, nextHuntStatus: order.huntStatus }
      });
    }
    if (JSON.stringify(previousOrder?.vendorContacts || []) !== JSON.stringify(order.vendorContacts || [])) {
      projections.push('customer_activity_log', 'telegram_notification_queue');
      reason = 'shipment_updated';
      enqueueCustomerNotificationEvent(order, 'shipment_updated', `Есть обновление по отправке/исполнителям для заказа ${order.brand} ${order.model}`);
    }

    scheduleLivePublicQuoteSync(order, { reason, sourceOrderUpdatedAt: Number(order.updatedAt || order.createdAt || Date.now()) });
    await publishDomainEvent('PUBLIC_QUOTE_REFRESH_REQUIRED', {
      entityType: 'public_quote',
      entityId: order.publicQuoteToken || order.id,
      aggregateId: order.id,
      dedupeKey: `public-quote:${order.id}:${order.updatedAt || 0}:${reason}`,
      idempotencyKey: `public-quote:${order.id}:${order.updatedAt || 0}:${reason}`,
      replaySafe: true,
      source: 'system',
      payload: {
        order,
        reason,
        sourceOrderUpdatedAt: Number(order.updatedAt || order.createdAt || Date.now()),
        projectionVersion: Number(order.updatedAt || order.createdAt || Date.now())
      }
    });

    recordReactiveEvent(event, {
      projections: [...new Set(projections)],
      subscribers: ['order_projection_dispatcher'],
      queueTargets: ['order_mutation_queue', 'telegram_notification_queue'],
      cloudTargets: ['supabase_order_graph', 'public_quote_snapshot'],
      reason
    });
  });

  subscribeDomainEvent('SETTINGS_PUBLIC_CHANGED', async (event) => {
    recordReactiveEvent(event, {
      projections: ['settings_derived_public_payload', 'public_quote_snapshot', 'tracking_page_branding', 'telegram_deep_link_payload'],
      subscribers: ['order_projection_dispatcher'],
      cloudTargets: ['app_state']
    });
  });
};
