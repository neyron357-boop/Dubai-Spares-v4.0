import { offlineDb } from './storage/offlineDb';
import { Order } from './types';

export const orderRepository = {
  saveOrder(order: Order) {
    return offlineDb.saveOrder(order);
  },
  saveOrders(orders: Order[]) {
    return offlineDb.saveOrders(orders);
  },
  deleteOrder(orderId: string) {
    return offlineDb.deleteOrder(orderId);
  },
  deleteOrders(orderIds: string[]) {
    return offlineDb.deleteOrders(orderIds);
  }
};
