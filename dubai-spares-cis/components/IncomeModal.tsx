import React from 'react';
import { Order } from '../types';
import { X, TrendingDown, TrendingUp } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  orders: Order[];
}

const formatAed = (value: number) => `${Number(value || 0).toFixed(0)} AED`;

const IncomeModal: React.FC<Props> = ({ isOpen, onClose, orders }) => {
  if (!isOpen) return null;

  const soldOrders = orders.filter((order) => {
    const salesStatus = String(order.salesStatus || '').toLowerCase();
    const isPaidOrCompleted = salesStatus === 'paid' || salesStatus === 'completed';
    return !order.isArchived && (order.isSold || isPaidOrCompleted);
  });
  const totals = soldOrders.reduce((sum, order) => {
    const partsTotal = order.parts.reduce((partSum, part) => {
      const quantity = Math.max(1, Number(part.quantity || 1));
      const selected = (part.variants || []).find((variant) => variant.id === part.bestOfferId || variant.isBest) || part.variants?.[0];
      if (!selected) return partSum;
      const purchase = Number(selected.purchasePriceAed ?? selected.priceAed ?? 0) * quantity;
      const sale = Number(selected.salePriceAed ?? selected.priceAed ?? 0) * quantity;
      return {
        purchase: partSum.purchase + purchase,
        sale: partSum.sale + sale
      };
    }, { purchase: 0, sale: 0 });

    const delivery = Number(order.logistics?.deliveryAed || 0);
    const packing = Number(order.logistics?.packingAed || 0);
    const service = Number(order.logistics?.serviceFeeAed || 0);
    const markup = order.markupType === 'fixed'
      ? Number(order.markupFixedAed || 0)
      : partsTotal.sale * (Number(order.markupPercent || 0) / 100);
    const clientPrice = partsTotal.sale + delivery + packing + service + markup;
    const calculatedProfit = clientPrice - partsTotal.purchase - delivery - packing;
    const profit = Number.isFinite(Number(order.soldProfitUsd)) && Number(order.soldProfitUsd) !== 0
      ? Number(order.soldProfitUsd) * Number(order.exchangeRate || 3.67)
      : calculatedProfit;

    return {
      purchase: sum.purchase + partsTotal.purchase,
      delivery: sum.delivery + delivery,
      packing: sum.packing + packing,
      service: sum.service + service + markup,
      clientPrice: sum.clientPrice + clientPrice,
      profit: sum.profit + profit
    };
  }, { purchase: 0, delivery: 0, packing: 0, service: 0, clientPrice: 0, profit: 0 });

  const hasEnoughData = soldOrders.length > 0 && totals.clientPrice > 0 && totals.purchase > 0;
  const margin = hasEnoughData && totals.clientPrice > 0 ? (totals.profit / totals.clientPrice) * 100 : 0;
  const isProfit = totals.profit >= 0;

  const rows = [
    ['Закупка', totals.purchase],
    ['Доставка', totals.delivery],
    ['Упаковка', totals.packing],
    ['Сервисный сбор', totals.service],
    ['Цена клиенту', totals.clientPrice]
  ] as const;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Доход компании"
        className="flex max-h-[min(88dvh,720px)] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Finance</p>
            <h2 className="text-lg font-black text-slate-950">Доход компании</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-slate-600 active:scale-95">
            <X size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
          {!hasEnoughData ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-semibold text-slate-500">
              Недостаточно данных для расчёта дохода
            </div>
          ) : (
            <div className="space-y-4">
              <div className={`rounded-2xl border px-4 py-3 ${isProfit ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] opacity-70">{isProfit ? 'Прибыль' : 'Убыток'}</p>
                    <p className="mt-1 text-3xl font-black leading-none">{formatAed(totals.profit)}</p>
                  </div>
                  {isProfit ? <TrendingUp size={28} /> : <TrendingDown size={28} />}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="space-y-2">
                  {rows.map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-semibold text-slate-500">{label}:</span>
                      <span className="font-black text-slate-900">{formatAed(value)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 border-t border-slate-100 pt-3">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-semibold text-slate-500">Прибыль:</span>
                    <span className={`font-black ${isProfit ? 'text-emerald-700' : 'text-rose-700'}`}>{formatAed(totals.profit)}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3 text-sm">
                    <span className="font-semibold text-slate-500">Маржа:</span>
                    <span className={`font-black ${isProfit ? 'text-emerald-700' : 'text-rose-700'}`}>{margin.toFixed(0)}%</span>
                  </div>
                </div>
              </div>

              <p className="text-center text-[11px] font-semibold text-slate-400">Проданных заказов: {soldOrders.length}</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default IncomeModal;
