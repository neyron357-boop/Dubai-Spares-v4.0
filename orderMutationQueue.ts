import { Order } from './types';

export type OrderMutationOperation = 'upsert' | 'delete';

export interface OrderMutationIntent {
  operation: OrderMutationOperation;
  orderId: string;
  order?: Order;
  patch?: Partial<Order>;
}

export const createOrderMutationIntent = (operation: OrderMutationOperation, orderId: string, order?: Order, patch?: Partial<Order>): OrderMutationIntent => ({
  operation,
  orderId,
  order,
  patch
});
