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
    .filter(o => o.isSold)
    .map(o => {
      let profitAed = Number(o.soldProfitUsd || 0) * Number(o.exchangeRate || 3.67);
      
      const totals = o.parts.reduce((sum, p) => {
        if (!(p.isFound && p.variants.length > 0)) return sum;
        const variant = p.variants[0];
        const purchase = Number(variant.purchasePriceAed ?? variant.priceAed ?? 0);
        const sale = Number(variant.salePriceAed ?? variant.priceAed ?? 0);
        return { purchase: sum.purchase + purchase, sale: sum.sale + sale };
      }, { purchase: 0, sale: 0 });
      if (!Number.isFinite(profitAed) || profitAed === 0) {
        profitAed = (totals.sale - totals.purchase) + (o.markupType === 'fixed' ? Number(o.markupFixedAed || 0) : totals.sale * (Number(o.markupPercent || 0) / 100));
      }
      const commissionAed = Number(o.logistics?.serviceFeeAed || 0);
      return { ...o, profitAed, commissionAed, totalIncomeAed: profitAed + commissionAed };
    });

  const totalIncome = orderStats.reduce((sum, o) => sum + o.totalIncomeAed, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="bg-white w-full max-w-md rounded-t-[32px] overflow-hidden animate-in slide-in-from-bottom duration-300 max-h-[80dvh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-6 pb-2 border-b border-gray-50 flex items-center justify-between shrink-0">
          <h2 className="text-lg font-bold">Доход компании</h2>
          <button onClick={onClose} className="p-2 bg-gray-100 rounded-full"><X size={20} /></button>
        </div>

        <div className="p-6 flex-1 overflow-y-auto no-scrollbar space-y-6">
          <div className="bg-green-600 text-white p-8 rounded-[24px] shadow-xl text-center relative overflow-hidden">
            <TrendingUp size={120} className="absolute -right-4 -bottom-4 opacity-10" />
            <span className="text-sm font-medium opacity-80 uppercase tracking-widest text-green-100">Итоговая чистая прибыль</span>
            <div className="text-5xl font-black mt-2">{totalIncome.toFixed(0)} AED</div>
          </div>

          <div className="space-y-3 pb-10">
            <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest px-1">Проданные заказы ({orderStats.length})</h3>
            {orderStats.length === 0 ? (
              <div className="text-center py-10 text-gray-400 text-sm italic">Проданных заказов пока нет</div>
            ) : (
              orderStats.map(o => (
                <div key={o.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl">
                  <div>
                    <div className="font-bold text-sm uppercase tracking-tight">{o.brand} {o.model}</div>
                    <div className="text-[10px] text-gray-400 font-bold flex items-center gap-1 mt-0.5 uppercase tracking-tighter">
                      <Calendar size={10} /> {new Date(o.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-black text-green-600">+{o.totalIncomeAed.toFixed(0)} AED</div>
                    {o.commissionAed > 0 && <div className="text-[10px] text-emerald-700">включая комиссию {o.commissionAed.toFixed(0)} AED</div>}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default IncomeModal;
