import { Order } from '../types';

export const isLeadOrder = (order: Pick<Order, 'isLead' | 'status' | 'customerStatus'>) =>
  order.isLead === true || order.status === 'lead' || order.customerStatus === 'LEAD';

export const isUnreadLeadOrder = (
  order: Pick<Order, 'isLead' | 'status' | 'customerStatus' | 'leadUnread' | 'isArchived'>
) => isLeadOrder(order) && order.leadUnread === true && !order.isArchived;

export const buildLeadToOrderUpdate = (order: Order): Order => ({
  ...order,
  status: order.status === 'lead' ? 'active' : (order.status || 'active'),
  customerStatus: 'INQUIRY',
  isLead: false,
  leadUnread: false,
  leadReadAt: Date.now(),
  statusChangedAt: Date.now(),
  statusChangedBy: 'current-user'
});
