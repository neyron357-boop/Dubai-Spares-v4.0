import React, { useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useStore } from '../store';
import { useAppSettings } from '../appSettings';
import { useOrderPricing } from '../hooks/useOrderDetails/useOrderPricing';
import { useOrderSuppliers } from '../hooks/useOrderDetails/useOrderSuppliers';
import { useOrderForm } from '../hooks/useOrderDetails/useOrderForm';
import { OrderDetailsProvider } from '../contexts/OrderDetailsContext';
import { Priority, Order, Source, Shop } from '../types';
import { syncPerf } from '../syncPerf';
import { shareQuoteLink } from '../shareUtils';

// We will import tabs here later
// import { OrderOverviewTab } from '../components/OrderDetail/OrderOverviewTab';

export const OrderDetailsScreenV2: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const backTo = typeof (location.state as { backTo?: unknown } | null)?.backTo === 'string'
    ? String((location.state as { backTo?: unknown }).backTo)
    : '/orders';

  const { orders, isLoading, updateOrder, suppliers, fetchOrderDetails } = useStore();
  const { settings, updateSettings } = useAppSettings();

  const foundOrder = orders.find(o => o.id === id);
  const orderMissing = !foundOrder;
  const order = foundOrder ?? ({
    id: id || '',
    brand: '',
    model: '',
    year: '',
    vin: '',
    priority: Priority.MEDIUM,
    clientName: '',
    source: Source.OTHER,
    parts: [],
    markupPercent: 0,
    exchangeRate: 3.67,
    createdAt: Date.now(),
    isArchived: false,
    isSold: false
  } as Order);

  useEffect(() => {
    if (!id) return;
    const currentOrder = orders.find((item) => item.id === id);
    if (currentOrder && (currentOrder.isLead || (currentOrder.parts && currentOrder.parts.length > 0))) return;
    void fetchOrderDetails(id);
  }, [id, orders, fetchOrderDetails]);

  // Hooks
  const pricing = useOrderPricing({
    order,
    settings,
    preferredExchangeRate: settings.defaultExchangeRate || 3.67,
    currentQuoteRates: settings.defaultQuoteRates || {},
    updateOrder,
    updateSettings,
    buildQuoteRateInputs: (r) => ({}), // stub
    syncPerf,
    setToast: console.log,
    draftFields: {}
  });

  const suppliersHook = useOrderSuppliers({
    order,
    suppliers,
    updateOrder
  });

  const form = useOrderForm({
    order,
    updateOrder,
    syncPerf
  });

  if (orderMissing && isLoading) {
    return <div>Loading...</div>;
  }

  const contextValue = {
    order,
    pricing,
    suppliers: suppliersHook,
    form,
    shareQuote: async () => {},
    openWhatsappClient: () => {},
    openClientChannel: () => {},
    updateCustomerStatus: () => {},
    copyText: async () => {},
    pasteVinFromClipboard: async () => {},
    addNewPart: () => {},
    handleSellClick: () => {},
    setToast: console.log
  };

  return (
    <OrderDetailsProvider value={contextValue}>
      <div className="flex flex-col h-full bg-white pb-32 relative">
        <h1>Header Stub</h1>
        {/* Tabs will go here */}
      </div>
    </OrderDetailsProvider>
  );
};
