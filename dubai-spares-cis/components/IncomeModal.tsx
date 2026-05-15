import React from 'react';
import { Order } from '../types';
import { X, TrendingUp, Calendar, DollarSign } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  orders: Order[];
}

const IncomeModal: React.FC<Props> = ({ isOpen, onClose, orders }) => {
  if (!isOpen) return null;

  const orderStats = orders
    .filter((order) => order.isSold)
    .map((order) => {
      let profitAed = Number(order.soldProfitUsd || 0) * Number(order.exchangeRate || 3.67);

      const totals = order.parts.reduce((sum, part) => {
        if (!(part.isFound && part.variants.length > 0)) return sum;
        const variant = part.variants[0];
        const purchase = Number(variant.purchasePriceAed ?? variant.priceAed ?? 0);
        const sale = Number(variant.salePriceAed ?? variant.priceAed ?? 0);
        return { purchase: sum.purchase + purchase, sale: sum.sale + sale };
      }, { purchase: 0, sale: 0 });

      if (!Number.isFinite(profitAed) || profitAed === 0) {
        profitAed = (totals.sale - totals.purchase) + (order.markupType === 'fixed'
          ? Number(order.markupFixedAed || 0)
          : totals.sale * (Number(order.markupPercent || 0) / 100));
      }

      const commissionAed = Number(order.logistics?.serviceFeeAed || 0);
      return { ...order, profitAed, commissionAed, totalIncomeAed: profitAed + commissionAed };
    });

  const totalIncome = orderStats.reduce((sum, order) => sum + order.totalIncomeAed, 0);
  const totalProfit = orderStats.reduce((sum, order) => sum + order.profitAed, 0);
  const totalCommission = orderStats.reduce((sum, order) => sum + order.commissionAed, 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 py-[max(1rem,env(safe-area-inset-top))] backdrop-blur-sm"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Доход компании"
        className="flex max-h-[min(720px,calc(100dvh-2rem-env(safe-area-inset-top)-env(safe-area-inset-bottom)))] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-200"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-600">Finance</p>
            <h2 className="text-lg font-black text-slate-950">Доход компании</h2>
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

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="rounded-3xl bg-emerald-600 p-5 text-white shadow-lg">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-emerald-100">Итого</p>
                <div className="mt-2 text-4xl font-black leading-none">{totalIncome.toFixed(0)} AED</div>
              </div>
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white/15">
                <TrendingUp size={22} />
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
              <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Прибыль</p>
              <p className="mt-1 text-lg font-black text-slate-950">{totalProfit.toFixed(0)} AED</p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
              <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Комиссия</p>
              <p className="mt-1 text-lg font-black text-slate-950">{totalCommission.toFixed(0)} AED</p>
            </div>
          </div>

          <div className="mt-5 space-y-2 pb-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Проданные заказы</h3>
              <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-500">{orderStats.length}</span>
            </div>

            {orderStats.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-semibold text-slate-400">
                Проданных заказов пока нет
              </div>
            ) : (
              orderStats.map((order) => (
                <article key={order.id} className="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-slate-950">{order.brand} {order.model}</p>
                      <p className="mt-1 flex items-center gap-1 text-[11px] font-bold text-slate-400">
                        <Calendar size={11} /> {new Date(order.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="flex items-center justify-end gap-1 text-base font-black text-emerald-600">
                        <DollarSign size={14} /> {order.totalIncomeAed.toFixed(0)}
                      </p>
                      {order.commissionAed > 0 && (
                        <p className="text-[10px] font-bold text-emerald-700">комиссия {order.commissionAed.toFixed(0)} AED</p>
                      )}
                    </div>
                  </div>
                </article>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
};

export default IncomeModal;
