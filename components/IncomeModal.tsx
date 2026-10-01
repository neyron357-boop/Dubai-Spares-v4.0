import { ModalSurface } from './ui';
import { TrendingDown, TrendingUp, X } from 'lucide-react';
import React from 'react';
import { Order } from '../types';
import { calculateOrderTotals, nonNegativeMoney } from '../utils/quotePricing';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  orders: Order[];
}

const formatAed = (value: number) =>
  `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value || 0)} AED`;

const IncomeModal: React.FC<Props> = ({ isOpen, onClose, orders }) => {
  if (!isOpen) return null;

  const soldOrders = orders.filter((order) => {
    const salesStatus = String(order.salesStatus || '').toLowerCase();
    const isPaidOrCompleted = salesStatus === 'paid' || salesStatus === 'completed';
    return !order.isArchived && (order.isSold || isPaidOrCompleted);
  });
  const totals = soldOrders.reduce(
    (sum, order) => {
      const priced = calculateOrderTotals(order);
      const purchase = priced.lines.reduce(
        (total, line) =>
          total +
          nonNegativeMoney(line.variant.purchasePriceAed ?? line.variant.priceAed) * line.quantity,
        0,
      );
      const delivery = priced.deliveryAed,
        packing = priced.packingAed;
      const service = priced.commissionAed + priced.markupAed;
      const clientPrice = priced.totalAed;
      const calculatedProfit = clientPrice - purchase - delivery - packing - priced.cargoAed;
      const profit =
        Number.isFinite(Number(order.soldProfitUsd)) && Number(order.soldProfitUsd) !== 0
          ? Number(order.soldProfitUsd) * Number(order.exchangeRate || 3.67)
          : calculatedProfit;

      return {
        purchase: sum.purchase + purchase,
        delivery: sum.delivery + delivery,
        packing: sum.packing + packing,
        service: sum.service + service,
        cargo: sum.cargo + priced.cargoAed,
        discount: sum.discount + priced.discountAed,
        clientPrice: sum.clientPrice + clientPrice,
        profit: sum.profit + profit,
      };
    },
    {
      purchase: 0,
      delivery: 0,
      packing: 0,
      service: 0,
      cargo: 0,
      discount: 0,
      clientPrice: 0,
      profit: 0,
    },
  );

  const hasEnoughData = soldOrders.length > 0 && totals.clientPrice > 0 && totals.purchase > 0;
  const margin =
    hasEnoughData && totals.clientPrice > 0 ? (totals.profit / totals.clientPrice) * 100 : 0;
  const isProfit = totals.profit >= 0;

  const rows = [
    ['Закупка', totals.purchase],
    ['Доставка', totals.delivery],
    ['Упаковка', totals.packing],
    ['Сервис и наценка', totals.service],
    ['Перевозка', totals.cargo],
    ['Скидка', -totals.discount],
    ['Цена клиенту', totals.clientPrice],
  ] as const;

  return (
    <ModalSurface
      label="Доход компании"
      onClose={onClose}
      className="flex items-center justify-center  p-4 ui-dialog-layer"
    >
      <section
        className="flex max-h-[min(88dvh,720px)] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
              Финансы
            </p>
            <h2 className="text-lg font-bold text-slate-950">Доход компании</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-slate-600 active:scale-95"
          >
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
              <div
                className={`rounded-2xl border px-4 py-3 ${isProfit ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.16em] opacity-70">
                      {isProfit ? 'Прибыль' : 'Убыток'}
                    </p>
                    <p className="mt-1 text-3xl font-bold leading-none">
                      {formatAed(totals.profit)}
                    </p>
                  </div>
                  {isProfit ? <TrendingUp size={28} /> : <TrendingDown size={28} />}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="space-y-2">
                  {rows.map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-semibold text-slate-500">{label}:</span>
                      <span className="font-bold text-slate-900">{formatAed(value)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 border-t border-slate-100 pt-3">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-semibold text-slate-500">Прибыль:</span>
                    <span
                      className={`font-bold ${isProfit ? 'text-emerald-700' : 'text-rose-700'}`}
                    >
                      {formatAed(totals.profit)}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3 text-sm">
                    <span className="font-semibold text-slate-500">Маржа:</span>
                    <span
                      className={`font-bold ${isProfit ? 'text-emerald-700' : 'text-rose-700'}`}
                    >
                      {margin.toFixed(0)}%
                    </span>
                  </div>
                </div>
              </div>

              <p className="text-center text-[11px] font-semibold text-slate-400">
                Проданных заказов: {soldOrders.length}
              </p>
            </div>
          )}
        </div>
      </section>
    </ModalSurface>
  );
};

export default IncomeModal;
