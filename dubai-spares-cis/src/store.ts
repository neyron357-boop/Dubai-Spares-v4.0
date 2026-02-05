import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Order } from './types';
import { supabase } from './supabase'; // Исправлен путь к файлу supabase

interface OrderStore {
  orders: Order[];
  addOrder: (order: Order) => Promise<void>;
  updateOrder: (updatedOrder: Order) => Promise<void>;
  deleteOrder: (orderId: string) => Promise<void>;
  syncOrders: () => Promise<void>;
}

export const useOrderStore = create<OrderStore>()(
  persist(
    (set, get) => ({
      orders: [],

      // Загрузка данных из облака Supabase в приложение
      syncOrders: async () => {
        try {
          const { data, error } = await supabase.from('orders').select('data');
          if (error) throw error;
          
          if (data) {
            const cloudOrders = data.map(item => item.data as Order);
            set({ orders: cloudOrders });
          }
        } catch (err) {
          console.error('Ошибка синхронизации:', err);
        }
      },

      addOrder: async (newOrder) => {
        // 1. Сначала сохраняем локально, чтобы пользователь сразу увидел результат
        set((state) => ({ orders: [newOrder, ...state.orders] }));
        
        // 2. Отправляем в облако
        try {
          const { error } = await supabase.from('orders').insert([{ id: newOrder.id, data: newOrder }]);
          if (error) throw error;
        } catch (err) {
          console.error('Ошибка при сохранении заказа:', err);
        }
      },

      updateOrder: async (updatedOrder) => {
        set((state) => ({
          orders: state.orders.map((o) => (o.id === updatedOrder.id ? updatedOrder : o)),
        }));

        try {
          const { error } = await supabase.from('orders').update({ data: updatedOrder }).eq('id', updatedOrder.id);
          if (error) throw error;
        } catch (err) {
          console.error('Ошибка при обновлении:', err);
        }
      },

      deleteOrder: async (orderId) => {
        set((state) => ({
          orders: state.orders.filter((o) => o.id !== orderId),
        }));

        try {
          const { error } = await supabase.from('orders').delete().eq('id', orderId);
          if (error) throw error;
        } catch (err) {
          console.error('Ошибка при удалении:', err);
        }
      },
    }),
    {
      name: 'dubai-spares-storage', // Имя ключа в браузере
      storage: createJSONStorage(() => localStorage),
    }
  )
);

