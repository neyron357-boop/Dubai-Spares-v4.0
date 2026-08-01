import { useState, useRef, useEffect, useCallback } from 'react';
import { Order, OrderPricingEvent } from '../../types';

const formatPricingEventValue = (value: unknown) => {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
};

const createPricingEvent = (field: OrderPricingEvent['field'], label: string, previousValue: unknown, nextValue: unknown): OrderPricingEvent | null => {
  const prev = formatPricingEventValue(previousValue);
  const next = formatPricingEventValue(nextValue);
  if (prev === next) return null;
  return {
    id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    field,
    label,
    previousValue: prev,
    nextValue: next,
    createdAt: Date.now()
  };
};

export function useOrderForm({
  order,
  updateOrder,
  syncPerf
}: {
  order: Order;
  updateOrder: (order: Order) => Promise<boolean>;
  syncPerf: any;
}) {
  const [draftFields, setDraftFields] = useState<Partial<Record<keyof Order, any>>>({});
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingOverviewBlock, setEditingOverviewBlock] = useState<'client' | 'vehicle' | null>(null);
  const [newPartName, setNewPartName] = useState('');
  const [newPartQuantity, setNewPartQuantity] = useState('1');
  const [newPartKind, setNewPartKind] = useState<'single' | 'group'>('single');
  const [newPartComment, setNewPartComment] = useState('');
  
  const deferredFieldTimersRef = useRef<Partial<Record<keyof Order, number>>>({});
  const deferredFieldValuesRef = useRef<Partial<Record<keyof Order, any>>>({});
  const orderRef = useRef<Order | undefined>(order);
  const lastKeystrokeAtRef = useRef<number>(0);

  const isClientEditMode = editingOverviewBlock === 'client' || isEditMode;
  const isVehicleEditMode = editingOverviewBlock === 'vehicle' || isEditMode;

  useEffect(() => {
    orderRef.current = order;
  }, [order]);

  useEffect(() => {
    return () => {
      Object.keys(deferredFieldTimersRef.current).forEach((field) => {
        const typedField = field as keyof Order;
        const timerId = deferredFieldTimersRef.current[typedField];
        if (timerId) window.clearTimeout(timerId);
        const pendingValue = deferredFieldValuesRef.current[typedField];
        const latestOrder = orderRef.current;
        if (pendingValue !== undefined && latestOrder) {
          void updateOrder({ ...latestOrder, [typedField]: pendingValue });
        }
      });
    };
  }, [updateOrder]);

  const commitDeferredOrderField = useCallback((field: keyof Order, rawValue?: any) => {
    const currentOrder = orderRef.current;
    if (!currentOrder) return;
    const value = rawValue ?? deferredFieldValuesRef.current[field];
    
    const trackedFieldLabels: Partial<Record<keyof Order, string>> = {
      markupPercent: 'Маржа %',
      markupType: 'Тип наценки',
      markupFixedAed: 'Наценка (фикс AED)',
      exchangeRate: 'Курс валюты',
      clientCurrency: 'Валюта клиента',
      discountPercent: 'Скидка %',
      discountType: 'Тип скидки',
      discountFixedAed: 'Скидка (фикс AED)'
    };

    const trackedLabel = trackedFieldLabels[field];
    const event = trackedLabel
      ? createPricingEvent(field as OrderPricingEvent['field'], trackedLabel, currentOrder[field], value)
      : null;

    updateOrder({
      ...currentOrder,
      [field]: value,
      pricingEvents: event ? [event, ...(currentOrder.pricingEvents || [])] : currentOrder.pricingEvents
    });

    setDraftFields((prev) => {
      const { [field]: _unused, ...rest } = prev;
      return rest;
    });
    deferredFieldValuesRef.current[field] = undefined;
    deferredFieldTimersRef.current[field] = undefined;
  }, [updateOrder]);

  const flushDeferredOrderField = useCallback((field: keyof Order) => {
    const timer = deferredFieldTimersRef.current[field];
    if (timer) window.clearTimeout(timer);
    if (deferredFieldValuesRef.current[field] !== undefined) {
      commitDeferredOrderField(field);
    }
  }, [commitDeferredOrderField]);

  const updateOrderField = useCallback((field: keyof Order, value: any) => {
    const keyStart = performance.now();
    const shouldDebounce = (typeof value === 'string' || typeof value === 'number')
      && !['markupPercent', 'markupType', 'markupFixedAed', 'discountPercent', 'discountType', 'discountFixedAed', 'clientCurrency', 'salesStatus', 'priority', 'deliveryType', 'socialNickname'].includes(String(field));

    if (!shouldDebounce) {
      commitDeferredOrderField(field, value);
      syncPerf.recordTypingSample(Math.round((performance.now() - keyStart) * 100) / 100);
      return;
    }

    lastKeystrokeAtRef.current = performance.now();
    setDraftFields((prev) => ({ ...prev, [field]: value }));
    deferredFieldValuesRef.current[field] = value;
    const existingTimer = deferredFieldTimersRef.current[field];
    if (existingTimer) window.clearTimeout(existingTimer);
    
    deferredFieldTimersRef.current[field] = window.setTimeout(() => {
      commitDeferredOrderField(field);
    }, 650);
    
    syncPerf.recordTypingSample(Math.round((performance.now() - keyStart) * 100) / 100);
  }, [commitDeferredOrderField, syncPerf]);

  return {
    draftFields,
    isEditMode,
    setIsEditMode,
    editingOverviewBlock,
    setEditingOverviewBlock,
    isClientEditMode,
    isVehicleEditMode,
    updateOrderField,
    flushDeferredOrderField,
    newPartName, setNewPartName,
    newPartQuantity, setNewPartQuantity,
    newPartKind, setNewPartKind,
    newPartComment, setNewPartComment
  };
}
