import React from 'react';
import { MapPin, Phone, MessageCircle, History } from 'lucide-react';
import { OrderItemRow, RadarTargetItemRow, RadarTargetRow } from '../radarSessionService';

const statusTone: Record<string, string> = {
  planned: 'bg-slate-100 text-slate-700',
  in_route: 'bg-blue-100 text-blue-700',
  at_shop: 'bg-amber-100 text-amber-700',
  done: 'bg-emerald-100 text-emerald-700'
};

interface RadarCardProps {
  target: RadarTargetRow;
  shop: any;
  targetItems: RadarTargetItemRow[];
  orderItemsById: Record<string, OrderItemRow>;
  highlighted?: boolean;
  onChangeStatus: (next: 'in_route' | 'at_shop' | 'done') => void;
  onTel: () => void;
  onWa: () => void;
  onMap: () => void;
  onHistory: () => void;
  onItemStatus: (item: RadarTargetItemRow, status: 'found' | 'not_found' | 'partial' | 'follow_up') => void;
  onSavePrice: (item: RadarTargetItemRow, price: number | null) => void;
  expandedHistory?: boolean;
}

const RadarCard: React.FC<RadarCardProps> = ({
  target,
  shop,
  targetItems,
  orderItemsById,
  highlighted,
  onChangeStatus,
  onTel,
  onWa,
  onMap,
  onHistory,
  onItemStatus,
  onSavePrice,
  expandedHistory = false
}) => (
  <div id={`target-${target.id}`} className={`rounded-2xl border p-3 space-y-2 transition ${highlighted ? 'border-violet-400 bg-violet-50/50 shadow-md' : 'border-gray-100 bg-white'}`}>
    <div className="flex justify-between gap-3">
      <div>
        <p className="text-sm font-black">{shop?.name || target.shop_id}</p>
        <p className="text-xs text-gray-500">Score: {target.score ?? 0} · Distance: {target.distance_km ?? '—'} km</p>
      </div>
      <span className={`text-[11px] px-2 py-1 rounded-full font-bold ${statusTone[target.status] || statusTone.planned}`}>{target.status}</span>
    </div>

    <div className="flex flex-wrap gap-1 text-[10px] font-bold">
      {!!shop?.trustLevel && <span className="rounded-full bg-slate-100 px-2 py-0.5">Trust {shop.trustLevel}</span>}
      {!!shop?.heatLevel && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-700">Heat {shop.heatLevel}</span>}
      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">{shop?.hasDelivery ? 'Delivery' : 'No delivery'}</span>
      <span className="rounded-full bg-violet-50 px-2 py-0.5 text-violet-700">{shop?.whatsappFast ? 'Fast WA' : 'WA'}</span>
    </div>

    <div className="grid grid-cols-3 gap-2 text-xs font-black">
      <button type="button" onClick={() => onChangeStatus('in_route')} className="rounded-xl bg-blue-50 text-blue-700 py-2.5">📍 In route</button>
      <button type="button" onClick={() => onChangeStatus('at_shop')} className="rounded-xl bg-amber-50 text-amber-700 py-2.5">🏪 At shop</button>
      <button type="button" onClick={() => onChangeStatus('done')} className="rounded-xl bg-emerald-50 text-emerald-700 py-2.5">✅ Done</button>
    </div>

    <div className="grid grid-cols-4 gap-1 text-[10px] font-bold">
      <button type="button" onClick={onWa} className="rounded-lg border border-gray-200 py-1 inline-flex justify-center items-center gap-1"><MessageCircle size={11} />WA</button>
      <button type="button" onClick={onTel} className="rounded-lg border border-gray-200 py-1 inline-flex justify-center items-center gap-1"><Phone size={11} />Звонок</button>
      <button type="button" onClick={onMap} className="rounded-lg border border-gray-200 py-1 inline-flex justify-center items-center gap-1"><MapPin size={11} />Map</button>
      <button type="button" onClick={onHistory} className={`rounded-lg border py-1 inline-flex justify-center items-center gap-1 ${expandedHistory ? 'border-violet-300 bg-violet-50 text-violet-700' : 'border-gray-200'}`}><History size={11} />Hist</button>
    </div>

    <div className="space-y-2 rounded-xl border border-gray-100 bg-gray-50 p-2">
      {(targetItems || []).map((targetItem) => {
        const item = orderItemsById[targetItem.order_item_id];
        if (!item) return null;
        return (
          <div key={targetItem.id} className="rounded-lg border border-gray-200 bg-white p-2 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-bold text-gray-800">{item.part_name} · x{item.quantity || 1}</p>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">{targetItem.item_status}</span>
            </div>
            <div className="grid grid-cols-4 gap-1 text-[10px] font-bold">
              <button type="button" onClick={() => onItemStatus(targetItem, 'found')} className="rounded-md bg-emerald-50 py-1 text-emerald-700">✅</button>
              <button type="button" onClick={() => onItemStatus(targetItem, 'not_found')} className="rounded-md bg-rose-50 py-1 text-rose-700">❌</button>
              <button type="button" onClick={() => onItemStatus(targetItem, 'partial')} className="rounded-md bg-amber-50 py-1 text-amber-700">⚠️</button>
              <button type="button" onClick={() => onItemStatus(targetItem, 'follow_up')} className="rounded-md bg-violet-50 py-1 text-violet-700">⏳</button>
            </div>
            {targetItem.item_status === 'found' && (
              <form className="flex items-center gap-2" onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const input = form.elements.namedItem('price') as HTMLInputElement | null;
                const value = input ? Number(input.value) : NaN;
                onSavePrice(targetItem, Number.isFinite(value) ? value : null);
              }}>
                <input name="price" type="number" min="0" step="1" defaultValue={targetItem.price_aed ?? ''} placeholder="Цена AED" className="h-8 flex-1 rounded-lg border border-gray-200 px-2 text-[11px]" />
                <button type="submit" className="h-8 rounded-lg bg-emerald-600 px-2 text-[10px] font-black text-white">Сохранить</button>
              </form>
            )}
          </div>
        );
      })}
      {!targetItems.length && <p className="text-[10px] text-gray-500">Нет деталей заказа.</p>}
    </div>
  </div>
);

export default RadarCard;
