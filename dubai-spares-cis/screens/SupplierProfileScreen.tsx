import React, { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, ChevronLeft, MessageCircle, Phone, Route } from 'lucide-react';
import { useStore } from '../store';
import { offlineDb } from '../storage/offlineDb';

const SupplierProfileScreen: React.FC = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { suppliers, orders } = useStore();
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [radarInteractions, setRadarInteractions] = useState<any[]>([]);

  React.useEffect(() => {
    void offlineDb.getRadarInteractions().then(setRadarInteractions);
  }, []);

  const supplier = useMemo(() => suppliers.find((item) => item.id === id), [suppliers, id]);
  const activeOrder = useMemo(() => orders.find((order) => !order.isArchived && !order.isSold), [orders]);

  if (!supplier) return <div className="p-4">Supplier not found</div>;

  const history = radarInteractions.filter((item) => (item.shopName || '').trim().toLowerCase() === supplier.name.trim().toLowerCase());

  return (
    <div className="p-4 space-y-3 pb-24">
      <button type="button" onClick={() => navigate('/database')} className="inline-flex items-center gap-1 text-xs font-bold text-gray-500"><ChevronLeft size={14} />Back</button>
      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <h1 className="text-lg font-bold">{supplier.name}</h1>
        <p className="text-xs text-gray-500">Trust {supplier.trustLevel || 3}/5</p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <button type="button" onClick={() => window.open(`https://wa.me/${(supplier.phone || '').replace('+', '')}`, '_blank')} className="rounded-lg bg-emerald-50 px-2 py-2 text-xs font-bold text-emerald-700 inline-flex items-center justify-center gap-1"><MessageCircle size={13} />WhatsApp</button>
          <button type="button" onClick={() => window.open(`tel:${supplier.phone}`, '_self')} className="rounded-lg bg-slate-100 px-2 py-2 text-xs font-bold text-slate-700 inline-flex items-center justify-center gap-1"><Phone size={13} />Call</button>
          <button type="button" onClick={() => window.open(supplier.location.startsWith('http') ? supplier.location : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(supplier.location)}`, '_blank')} className="rounded-lg bg-blue-50 px-2 py-2 text-xs font-bold text-blue-700 inline-flex items-center justify-center gap-1"><Route size={13} />Route</button>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-2">
        <p className="text-xs font-bold text-gray-500 uppercase">Specialization & Brands</p>
        <div className="flex flex-wrap gap-1">{(supplier.mainBrands || supplier.brands || []).map((brand) => <span key={brand} className="rounded-full bg-gray-100 px-2 py-1 text-[11px] font-semibold">{brand}</span>)}</div>
        {!!supplier.models?.length && <p className="text-xs text-gray-600">Models: {supplier.models.join(', ')}</p>}
        {!!supplier.years?.length && <p className="text-xs text-gray-600">Years: {supplier.years.join(', ')}</p>}
      </div>

      {activeOrder && (
        <button
          type="button"
          onClick={() => {
            const next = new Set(activeOrder.recommendedShopIds || []);
            next.add(supplier.id);
            useStore.getState().updateOrder({ ...activeOrder, recommendedShopIds: Array.from(next), updatedAt: Date.now() });
          }}
          className="w-full rounded-xl bg-blue-600 py-3 text-sm font-bold text-white"
        >
          Add to Active Order
        </button>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-2">
        <button type="button" onClick={() => setHistoryExpanded((prev) => !prev)} className="w-full inline-flex items-center justify-between text-xs font-bold text-gray-700">Radar history <ChevronDown size={14} className={historyExpanded ? 'rotate-180' : ''} /></button>
        {historyExpanded && (
          <div className="space-y-1">
            {history.length === 0 ? <p className="text-xs text-gray-500">No history yet</p> : history.map((item) => <div key={item.id} className="rounded-lg border border-gray-100 px-2 py-1 text-xs">{new Date(item.createdAt).toLocaleString('ru-RU')} • {item.result}</div>)}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-1 text-xs">
        <p><b>Has delivery:</b> {supplier.hasDelivery ? 'Yes' : 'No'}</p>
        <p><b>Fast WhatsApp reply:</b> {supplier.whatsappFast ? 'Yes' : 'No'}</p>
        <p><b>Comment:</b> {supplier.comment || '—'}</p>
        <p><b>Website:</b> {supplier.website || '—'}</p>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-1 text-xs">
        <p><b>GPS:</b> {supplier.coordinates ? 'GPS saved ✅' : 'No GPS ⚠️'}</p>
        <p><b>Created:</b> {supplier.createdAt ? new Date(supplier.createdAt).toLocaleString('ru-RU') : '—'}</p>
        <p><b>Updated:</b> {supplier.updatedAt ? new Date(supplier.updatedAt).toLocaleString('ru-RU') : '—'}</p>
        <p><b>Sync:</b> {supplier.syncStatus || 'synced'}</p>
      </div>
    </div>
  );
};

export default SupplierProfileScreen;
