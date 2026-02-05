import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Order } from './types';
import { supabase } from './src/supabase';

interface OrderStore {
  orders: Order[];
  addOrder: (order: Order) => Promise<void>;
  updateOrder: (updatedOrder: Order) => Promise<void>;
  deleteOrder: (orderId: string) => Promise<void>;
  syncOrders: () => Promise<void>; // Функция для загрузки данных из облака
}

export const useOrderStore = create<OrderStore>()(
  persist(
    (set, get) => ({
      orders: [],

      // Синхронизация с облаком
      syncOrders: async () => {
        const { data, error } = await supabase.from('orders').select('data');
        if (!error && data) {
          const cloudOrders = data.map(item => item.data as Order);
          set({ orders: cloudOrders });
        }
      },

      addOrder: async (newOrder) => {
        // 1. Сохраняем локально для скорости
        set((state) => ({ orders: [newOrder, ...state.orders] }));
        
        // 2. Отправляем в облако
        await supabase.from('orders').insert([{ id: newOrder.id, data: newOrder }]);
      },

      updateOrder: async (updatedOrder) => {
        set((state) => ({
          orders: state.orders.map((o) => (o.id === updatedOrder.id ? updatedOrder : o)),
        }));

        await supabase.from('orders').update({ data: updatedOrder }).eq('id', updatedOrder.id);
      },

      deleteOrder: async (orderId) => {
        set((state) => ({
          orders: state.orders.filter((o) => o.id !== orderId),
        }));

        await supabase.from('orders').delete().eq('id', orderId);
      },
    }),
    {
      name: 'dubai-spares-storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
