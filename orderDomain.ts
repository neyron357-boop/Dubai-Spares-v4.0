import { Order } from './types';

export const diffOrderFields = (previousOrder: Order | undefined, nextOrder: Order): string[] => {
  if (!previousOrder) return ['created'];
  const keys = new Set([...Object.keys(previousOrder), ...Object.keys(nextOrder)]);
  return [...keys].filter((key) => JSON.stringify((previousOrder as any)[key]) !== JSON.stringify((nextOrder as any)[key]));
};

export const getOrderProjectionReason = (previousOrder: Order | undefined, nextOrder: Order): string => {
  if (!previousOrder) return 'order_created';
  if (JSON.stringify(previousOrder.pricingEvents || []) !== JSON.stringify(nextOrder.pricingEvents || [])) return 'pricing_changed';
  if (JSON.stringify(previousOrder.logistics || {}) !== JSON.stringify(nextOrder.logistics || {})) return 'logistics_changed';
  if ((previousOrder.status || '') !== (nextOrder.status || '')) return 'status_changed';
  if ((previousOrder.huntStatus || '') !== (nextOrder.huntStatus || '')) return 'hunt_status_changed';
  return 'order_updated';
};
