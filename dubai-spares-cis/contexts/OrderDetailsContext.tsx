import React, { createContext, useContext, ReactNode } from 'react';
import { Order, Shop } from '../types';
import { useOrderPricing } from '../hooks/useOrderDetails/useOrderPricing';
import { useOrderSuppliers } from '../hooks/useOrderDetails/useOrderSuppliers';
import { useOrderForm } from '../hooks/useOrderDetails/useOrderForm';

export type OrderDetailsContextType = {
  order: Order;
  pricing: ReturnType<typeof useOrderPricing>;
  suppliers: ReturnType<typeof useOrderSuppliers>;
  form: ReturnType<typeof useOrderForm>;
  // Additional shared methods
  shareQuote: () => Promise<any>;
  openWhatsappClient: () => void;
  openClientChannel: () => void;
  updateCustomerStatus: (status: 'Lead' | 'VIP' | 'Inquiry') => void;
  copyText: (text: string, successMsg?: string) => Promise<void>;
  pasteVinFromClipboard: () => Promise<void>;
  addNewPart: () => void;
  handleSellClick: (e: React.MouseEvent) => void;
  setToast: (msg: any) => void;
};

const OrderDetailsContext = createContext<OrderDetailsContextType | null>(null);

export function OrderDetailsProvider({ 
  children, 
  value 
}: { 
  children: ReactNode; 
  value: OrderDetailsContextType 
}) {
  return (
    <OrderDetailsContext.Provider value={value}>
      {children}
    </OrderDetailsContext.Provider>
  );
}

export function useOrderDetailsContext() {
  const context = useContext(OrderDetailsContext);
  if (!context) {
    throw new Error('useOrderDetailsContext must be used within an OrderDetailsProvider');
  }
  return context;
}
