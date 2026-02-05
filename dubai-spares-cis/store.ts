import { useState, useEffect, useCallback } from 'react';
import { Order, Supplier } from './types';
import { supabase } from './supabase';

const ORDERS_KEY = 'dubai_spares_orders';
const SUPPLIERS_KEY = 'dubai_spares_suppliers';

// ✅ Supabase single-row state
const APP_STATE_TABLE = 'app_state';
const APP_STATE_ID = 'main'; // одна строка на проект

// Global Memory State (Singleton Pattern)
let globalOrders: Order[] = [];
let globalSuppliers: Supplier[] = [];
let listeners = new Set<() => void>();

let hasLoadedOnce = false;           // чтобы загрузка не повторялась
let saveTimer: number | null = null; // debounce
let saving = false;                  // защита от параллельных записей

// ✅ Safe load to avoid app reset when JSON is corrupted
const safeLoadArray = <T,>(key: string): T[] => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error(`Failed to parse ${key}:`, e);
    return [];
  }
};

const persistLocalNow = () => {
  try {
    localStorage.setItem(ORDERS_KEY, JSON.stringify(globalOrders));
    localStorage.setItem(SUPPLIERS_KEY, JSON.stringify(globalSuppliers));
  } catch (e) {
    console.error('Failed to persist local data:', e);
  }
};

// ✅ Safe init from local (fast start). Потом заменим на Supabase (если есть)
globalOrders = safeLoadArray<Order>(ORDERS_KEY);
globalSuppliers = safeLoadArray<Supplier>(SUPPLIERS_KEY);

const notifyListeners = () => {
  persistLocalNow();
  listeners.forEach(listener => listener());
};

// -------------------- SUPABASE HELPERS --------------------

const supabaseEnabled = () => {
  // если env не задан — клиент будет с пустыми строками
  return typeof import.meta !== 'undefined'
    && !!(import.meta as any).env?.VITE_SUPABASE_URL
    && !!(import.meta as any).env?.VITE_SUPABASE_ANON_KEY;
};

const loadFromSupabase = async () => {
  if (!supabaseEnabled()) return;

  try {
    const { data, error } = await supabase
      .from(APP_STATE_TABLE)
      .select('data')
      .eq('id', APP_STATE_ID)
      .maybeSingle();

    if (error) {
      console.error('Supabase load error:', error);
      return;
    }

    const payload = (data as any)?.data;
    if (!payload || typeof payload !== 'object') return;

    const orders = Array.isArray(payload.orders) ? payload.orders : null;
    const suppliers = Array.isArray(payload.suppliers) ? payload.suppliers : null;

    // если в базе пусто — не затираем локальные данные
    if (!orders && !suppliers) return;

    globalOrders = orders ?? globalOrders;
    globalSuppliers = suppliers ?? globalSuppliers;

    // сохраняем локально как кэш
    persistLocalNow();
    listeners.forEach(l => l());
  } catch (e) {
    console.error('Supabase load exception:', e);
  }
};

const saveToSupabase = async () => {
  if (!supabaseEnabled()) return;
  if (saving) return;
  saving = true;

  try {
    const payload = {
      orders: globalOrders,
      suppliers: globalSuppliers,
    };

    const { error } = await supabase
      .from(APP_STATE_TABLE)
      .upsert(
        { id: APP_STATE_ID, data: payload, updated_at: new Date().toISOString() } as any,
        { onConflict: 'id' }
      );

    if (error) {
      console.error('Supabase save error:', error);
    }
  } catch (e) {
    console.error('Supabase save exception:', e);
  } finally {
    saving = false;
  }
};

const scheduleSupabaseSave = () => {
  // debounce 400ms — чтобы не долбить базу на каждое нажатие
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveToSupabase();
  }, 400);
};

// ----------------------------------------------------------

export const useStore = () => {
  const [_, setVersion] = useState(0);

  useEffect(() => {
    const listener = () => setVersion(v => v + 1);
    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  }, []);

  // ✅ 1) Первичная загрузка из Supabase (один раз)
  useEffect(() => {
    if (hasLoadedOnce) return;
    hasLoadedOnce = true;

    // Быстрый старт уже есть (localStorage),
    // но сразу подтянем серверные данные (общие для всех).
    loadFromSupabase();
  }, []);

  // ✅ Extra persistence for iOS/Safari/PWA when app is minimized/closed
  useEffect(() => {
    const onPageHide = () => {
      persistLocalNow();
      // важный момент: при закрытии — сразу пушим в supabase (без debounce)
      saveToSupabase();
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        persistLocalNow();
        saveToSupabase();
      }
    };

    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const addOrder = useCallback((order: Order) => {
    globalOrders = [order, ...globalOrders];
    notifyListeners();
    scheduleSupabaseSave();
  }, []);

  const updateOrder = useCallback((updatedOrder: Order) => {
    globalOrders = globalOrders.map(o => (o.id === updatedOrder.id ? updatedOrder : o));
    notifyListeners();
    scheduleSupabaseSave();
  }, []);

  const deleteOrder = useCallback((id: string) => {
    globalOrders = globalOrders.filter(o => o.id !== id);
    notifyListeners();
    scheduleSupabaseSave();
  }, []);

  const addSupplier = useCallback((supplier: Supplier) => {
    globalSuppliers = [supplier, ...globalSuppliers];
    notifyListeners();
    scheduleSupabaseSave();
  }, []);

  const updateSupplier = useCallback((updated: Supplier) => {
    globalSuppliers = globalSuppliers.map(s => (s.id === updated.id ? updated : s));
    notifyListeners();
    scheduleSupabaseSave();
  }, []);

  const deleteSupplier = useCallback((id: string) => {
    globalSuppliers = globalSuppliers.filter(s => s.id !== id);
    notifyListeners();
    scheduleSupabaseSave();
  }, []);

  const getBackupData = useCallback(() => {
    return {
      orders: globalOrders,
      suppliers: globalSuppliers,
      version: '1.4-supabase',
      exportedAt: new Date().toISOString()
    };
  }, []);

  const restoreData = useCallback((data: any) => {
    if (!data || !Array.isArray(data.orders)) {
      throw new Error('Неверный формат данных');
    }
    globalOrders = data.orders;
    globalSuppliers = Array.isArray(data.suppliers) ? data.suppliers : [];
    notifyListeners();
    scheduleSupabaseSave();
  }, []);

  return {
    orders: globalOrders,
    suppliers: globalSuppliers,
    addOrder,
    updateOrder,
    deleteOrder,
    addSupplier,
    updateSupplier,
    deleteSupplier,
    getBackupData,
    restoreData
  };
};
