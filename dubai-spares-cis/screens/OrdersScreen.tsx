import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { Order, Priority, Part } from '../types';
import {
  BarChart3,
  Trash2,
  PackageSearch,
  Users,
  ChevronRight,
  User,
  Smartphone,
  Clock,
  Pin,
  Star
} from 'lucide-react';
import IncomeModal from '../components/IncomeModal';
import ImagePreview from '../components/ImagePreview';
import ConfirmModal from '../components/ConfirmModal';

type TabType = 'active' | 'vip' | 'archive' | 'sold';
type SortType = 'date' | 'brand' | 'priority' | 'status';

const getPriorityWeight = (p: Priority) => ({ [Priority.HIGH]: 3, [Priority.MEDIUM]: 2, [Priority.LOW]: 1 }[p]);

const OrdersScreen: React.FC = () => {
  const { orders, deleteOrder, updateOrder } = useStore();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabType>('active');
  const [sortBy, setSortBy] = useState<SortType>('date');
  const [isIncomeOpen, setIsIncomeOpen] = useState(false);
  const [gallery, setGallery] = useState<{ images: string[]; index: number } | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [touchMap, setTouchMap] = useState<Record<string, number>>({});

  const filteredOrders = useMemo(() => {
    let list = orders.filter(o => {
      if (activeTab === 'sold') return o.isSold;
      if (activeTab === 'archive') return o.isArchived && !o.isSold;
      if (activeTab === 'vip') return o.isVip && !o.isArchived && !o.isSold;
      return !o.isArchived && !o.isSold && !o.isVip;
    });

    return [...list].sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;

      switch (sortBy) {
        case 'brand':
          return a.brand.localeCompare(b.brand);
        case 'priority':
          return getPriorityWeight(b.priority) - getPriorityWeight(a.priority) || b.createdAt - a.createdAt;
        case 'status': {
          const score = (o: Order) => {
            if (o.parts.length === 0) return 0;
            const found = o.parts.filter(p => p.variants.length > 0).length;
            if (found === o.parts.length) return 3;
            if (found > 0) return 2;
            return 1;
          };
          return score(b) - score(a) || b.createdAt - a.createdAt;
        }
        default:
          return b.createdAt - a.createdAt;
      }
    });
  }, [orders, activeTab, sortBy]);

  const getAgeBadge = (createdAt: number) => {
    const diff = (Date.now() - createdAt) / (1000 * 60 * 60);
    const label = diff < 1 ? 'NEW' : diff < 24 ? `${Math.floor(diff)}h` : `${Math.floor(diff / 24)}d`;
    const style = diff < 24 ? 'bg-green-100 text-green-700' : diff < 48 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700';
    return <div className={`px-2 py-1 rounded text-[9px] font-black uppercase tracking-tighter flex items-center gap-1 ${style}`}><Clock size={8} /> {label}</div>;
  };

  const getOrderProfit = (order: Order) => {
    if (order.isSold && order.soldProfitUsd !== undefined) return order.soldProfitUsd.toFixed(0);
    let totalCostAed = 0;
    let foundParts = 0;
    order.parts.forEach(p => {
      if (p.isFound && p.variants.length > 0) {
        totalCostAed += p.variants[0].priceAed;
        foundParts++;
      }
    });
    if (foundParts === 0) return null;
    const totalSellAed = totalCostAed * (1 + order.markupPercent / 100);
    return ((totalSellAed - totalCostAed) / order.exchangeRate).toFixed(0);
  };

  const getPartPhoto = (part: Part) => part.photos?.[0] ?? part.photoUrl;
  const getPartPhotos = (part: Part) => part.photos?.length ? part.photos : (part.photoUrl ? [part.photoUrl] : []);
  const getCarPhotos = (order: Order) => order.carPhotos?.length ? order.carPhotos : (order.carPhotoUrl ? [order.carPhotoUrl] : []);

  const openGallery = (e: React.MouseEvent, images: string[]) => {
    e.stopPropagation();
    if (!images.length) return;
    setGallery({ images, index: 0 });
  };

  const onTouchStart = (id: string, e: React.TouchEvent) => setTouchMap(prev => ({ ...prev, [id]: e.targetTouches[0].clientX }));

  const onTouchEnd = (order: Order, e: React.TouchEvent) => {
    const start = touchMap[order.id];
    if (start === undefined) return;
    const end = e.changedTouches[0].clientX;
    if (end - start > 70) {
      updateOrder({ ...order, isPinned: !order.isPinned });
    }
  };

  return (
    <div className="p-4 space-y-4 pb-20 overflow-x-hidden">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Мои Заказы</h1>
        <div className="flex gap-2">
          <button type="button" onClick={() => setIsIncomeOpen(true)} className="p-3 bg-blue-50 text-blue-600 rounded-xl"><BarChart3 size={20} /></button>
          <button type="button" onClick={() => navigate('/vendor')} className="px-4 py-2 bg-gray-900 text-white text-xs font-bold rounded-xl flex items-center gap-1.5"><Users size={16} /> Склад</button>
        </div>
      </div>

      <div className="flex p-1 bg-gray-100 rounded-xl shadow-inner gap-1 overflow-x-auto no-scrollbar">
        {([
          ['active', 'Актив'],
          ['vip', 'VIP'],
          ['archive', 'Архив'],
          ['sold', 'Продано']
        ] as [TabType, string][]).map(([tab, label]) => (
          <button key={tab} type="button" onClick={() => setActiveTab(tab)} className={`px-3 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg whitespace-nowrap ${activeTab === tab ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>{label}</button>
        ))}
      </div>

      <div className="flex p-1 bg-gray-100 rounded-xl shadow-inner gap-1 overflow-x-auto no-scrollbar">
        {(['date', 'brand', 'priority', 'status'] as SortType[]).map(sort => (
          <button key={sort} onClick={() => setSortBy(sort)} className={`px-3 py-1.5 text-[10px] rounded-lg font-black uppercase whitespace-nowrap ${sortBy === sort ? 'bg-white shadow-sm' : 'text-gray-500'}`}>{sort}</button>
        ))}
      </div>

      <div className="space-y-3">
        {filteredOrders.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-3xl border-2 border-dashed border-gray-100 text-gray-300 text-xs font-bold uppercase tracking-widest">Заказов нет</div>
        ) : filteredOrders.map(order => {
          const carPhotos = getCarPhotos(order);
          return (
            <div
              key={order.id}
              onTouchStart={(e) => onTouchStart(order.id, e)}
              onTouchEnd={(e) => onTouchEnd(order, e)}
              onClick={() => navigate(`/order/${order.id}`)}
              className="bg-white p-4 rounded-3xl shadow-sm border border-gray-100 relative overflow-hidden active:bg-gray-50"
            >
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h3 className="font-black text-gray-900 text-lg leading-tight uppercase tracking-tight flex items-center gap-2">
                    {order.isPinned && <Pin size={14} className="text-amber-500" />}
                    {order.isVip && <Star size={14} className="text-purple-600" />}
                    {order.brand} {order.model}
                  </h3>
                  <div className="flex flex-wrap gap-2 mt-1">
                    <div className="bg-gray-50 px-2 py-1 rounded-lg border border-gray-100 text-[10px] font-mono font-black">VIN: {order.vin || '—'}</div>
                    {order.clientName && <div className="bg-gray-50 px-2 py-1 rounded-lg border border-gray-100 inline-flex items-center gap-1 text-[10px] font-bold"><User size={10} />{order.clientName}</div>}
                    <div className="bg-gray-50 px-2 py-1 rounded-lg border border-gray-100 inline-flex items-center gap-1 text-[10px] font-bold"><Smartphone size={10} />{order.source}</div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <div className="flex gap-1">{getAgeBadge(order.createdAt)}<div className={`px-2 py-1 rounded text-[9px] font-black ${order.priority === Priority.HIGH ? 'bg-red-100 text-red-600' : order.priority === Priority.MEDIUM ? 'bg-yellow-100 text-yellow-600' : 'bg-blue-100 text-blue-600'}`}>{order.priority}</div></div>
                  {getOrderProfit(order) && <div className="text-green-600 text-xs font-black">+${getOrderProfit(order)}</div>}
                </div>
              </div>

              {carPhotos.length > 0 && (
                <button onClick={(e) => openGallery(e, carPhotos)} className="w-full h-28 mb-2 rounded-2xl overflow-hidden border border-gray-100 relative">
                  <img src={carPhotos[0]} className="w-full h-full object-cover" />
                  {carPhotos.length > 1 && <span className="absolute right-2 bottom-2 text-[10px] bg-black/60 text-white px-2 py-0.5 rounded-full">+{carPhotos.length - 1}</span>}
                </button>
              )}

              <div className="mb-2 px-1"><p className="text-xs font-bold text-gray-600 leading-tight line-clamp-2">{order.parts.map(p => p.name).join(', ')}</p></div>

              <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-50">
                <div className="flex items-center gap-3">
                  <div className="flex -space-x-2">
                    {order.parts.slice(0, 3).map(part => {
                      const photo = getPartPhoto(part);
                      return (
                        <div key={part.id} className="w-8 h-8 rounded-lg bg-gray-50 border-2 border-white flex items-center justify-center overflow-hidden shadow-sm relative z-10">
                          {photo ? <img src={photo} className="w-full h-full object-cover cursor-pointer" onClick={(e) => openGallery(e, getPartPhotos(part))} /> : <PackageSearch size={16} className="text-gray-300" />}
                        </div>
                      );
                    })}
                  </div>
                  <div className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter">{order.parts.filter(p => p.isFound).length}/{order.parts.length} Найдено</div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={(e) => { e.stopPropagation(); setDeleteId(order.id); }} className="p-4 -m-2 text-gray-200 hover:text-red-500"><Trash2 size={20} /></button>
                  <ChevronRight size={20} className="text-gray-200" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <ConfirmModal isOpen={!!deleteId} message="Вы уверены, что хотите удалить этот заказ?" onConfirm={() => { if (deleteId) deleteOrder(deleteId); setDeleteId(null); }} onCancel={() => setDeleteId(null)} />
      {isIncomeOpen && <IncomeModal isOpen={isIncomeOpen} onClose={() => setIsIncomeOpen(false)} orders={orders} />}
      {gallery && <ImagePreview images={gallery.images} initialIndex={gallery.index} onClose={() => setGallery(null)} />}
    </div>
  );
};

export default OrdersScreen;
