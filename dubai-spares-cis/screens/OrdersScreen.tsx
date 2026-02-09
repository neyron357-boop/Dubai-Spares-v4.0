import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { Order, Priority, Part } from '../types';
import {
  Calendar,
  Tag,
  AlertCircle,
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

type TabType = 'active' | 'archive' | 'sold' | 'vip' | 'leads';
type SortType = 'date' | 'brand' | 'priority' | 'status';

const weights = { [Priority.HIGH]: 3, [Priority.MEDIUM]: 2, [Priority.LOW]: 1 };

const OrdersScreen: React.FC = () => {
  const { orders, deleteOrder, updateOrder } = useStore();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabType>('active');
  const [sortBy, setSortBy] = useState<SortType>('date');
  const [isIncomeOpen, setIsIncomeOpen] = useState(false);
  const [gallery, setGallery] = useState<{ images: string[]; index: number } | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const filteredOrders = useMemo(() => {
    let list = orders.filter(o => {
      if (activeTab === 'sold') return o.isSold;
      if (activeTab === 'archive') return o.isArchived && !o.isSold;
      if (activeTab === 'vip') return !!o.isVip && !o.isSold;
      if (activeTab === 'leads') return !!o.isLead && !o.isSold;
      return !o.isArchived && !o.isSold && !o.isVip && !o.isLead;
    });

    return [...list].sort((a, b) => {
      if (!!a.isPinned !== !!b.isPinned) return a.isPinned ? -1 : 1;
      switch (sortBy) {
        case 'brand': return a.brand.localeCompare(b.brand);
        case 'priority': return weights[b.priority] - weights[a.priority] || b.createdAt - a.createdAt;
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
        default: return b.createdAt - a.createdAt;
      }
    });
  }, [orders, activeTab, sortBy]);

  const getStatusColor = (createdAt: number, isSold: boolean) => {
    if (isSold) return 'border-l-4 border-green-700 bg-green-50/50';
    const diff = (Date.now() - createdAt) / (1000 * 60 * 60);
    if (diff < 24) return 'border-l-4 border-green-500';
    if (diff < 48) return 'border-l-4 border-yellow-500';
    return 'border-l-4 border-red-500';
  };

  const getAgeBadge = (createdAt: number) => {
    const diff = (Date.now() - createdAt) / (1000 * 60 * 60);
    const label = diff < 1 ? 'NEW' : diff < 24 ? `${Math.floor(diff)}h` : `${Math.floor(diff / 24)}d`;
    const style = diff < 24 ? 'bg-green-100 text-green-700' : diff < 48 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700';
    return <div className={`px-2 py-1 rounded text-[9px] font-black uppercase tracking-tighter flex items-center gap-1 ${style}`}><Clock size={8} /> {label}</div>;
  };

  const getPartPhoto = (part: Part) => (part.photos && part.photos.length > 0 ? part.photos[0] : part.photoUrl);
  const getPartPhotos = (part: Part) => (part.photos && part.photos.length > 0 ? part.photos : part.photoUrl ? [part.photoUrl] : []);
  const getCarPhotos = (order: Order) => (order.carPhotos && order.carPhotos.length > 0 ? order.carPhotos : order.carPhotoUrl ? [order.carPhotoUrl] : []);

  const openGallery = (e: React.MouseEvent, images: string[]) => {
    e.stopPropagation();
    if (images.length === 0) return;
    setGallery({ images, index: 0 });
  };

  const togglePin = (id: string) => {
    const target = orders.find(o => o.id === id);
    if (!target) return;
    updateOrder({ ...target, isPinned: !target.isPinned });
  };

  const confirmDelete = () => {
    if (deleteId) {
      deleteOrder(deleteId);
      setDeleteId(null);
    }
  };

  return (
    <div className="p-4 space-y-4 pb-20 overflow-x-hidden">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Мои Заказы</h1>
        <div className="flex gap-2">
          <button type="button" onClick={() => setIsIncomeOpen(true)} className="p-3 bg-blue-50 text-blue-600 rounded-xl"><BarChart3 size={20} /></button>
          <button type="button" onClick={() => navigate('/vendor')} className="px-4 py-2 bg-gray-900 text-white text-xs font-bold rounded-xl flex items-center gap-1.5">
            <Users size={16} /> Склад
          </button>
        </div>
      </div>

      <div className="flex p-1 bg-gray-100 rounded-xl shadow-inner gap-1">
        {([
          ['active', 'Актив'],
          ['vip', 'VIP'],
          ['archive', 'Архив'],
          ['leads', 'Лиды'],
          ['sold', 'Продано']
        ] as [TabType, string][]).map(([tab, title]) => (
          <button key={tab} type="button" onClick={() => setActiveTab(tab)} className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg ${activeTab === tab ? 'bg-white shadow-md text-blue-600' : 'text-gray-400'}`}>{title}</button>
        ))}
      </div>

      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
        {[
          { id: 'date', label: 'Дата', icon: Calendar },
          { id: 'brand', label: 'Марка', icon: Tag },
          { id: 'priority', label: 'Приоритет', icon: AlertCircle },
          { id: 'status', label: 'Статус', icon: PackageSearch },
        ].map((s) => (
          <button key={s.id} onClick={() => setSortBy(s.id as SortType)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg whitespace-nowrap text-[10px] font-bold uppercase tracking-tight ${sortBy === s.id ? 'bg-blue-600 text-white' : 'bg-white text-gray-400 border border-gray-100'}`}>
            <s.icon size={12} /> {s.label}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filteredOrders.length === 0 ? <div className="text-center py-20 bg-white rounded-3xl border-2 border-dashed border-gray-100 text-gray-300 text-xs font-bold uppercase tracking-widest">Заказов нет</div> : (
          filteredOrders.map((order) => (
            <div
              key={order.id}
              onClick={() => navigate(`/order/${order.id}`)}
              className={`p-4 rounded-3xl shadow-sm border relative overflow-hidden ${order.isVip ? 'bg-gradient-to-br from-yellow-50 via-amber-50 to-white border-yellow-200' : 'bg-white border-gray-100'} ${getStatusColor(order.createdAt, order.isSold)}`}
            >
              <div className="flex justify-between items-start mb-2 gap-2">
                <div>
                  <h3 className="font-black text-gray-900 text-lg leading-tight uppercase tracking-tight">{order.brand} {order.model}</h3>
                  <div className="flex flex-wrap gap-2 mt-1">
                    <div className="bg-gray-50 px-2 py-1 rounded-lg border border-gray-100"><p className="text-[10px] text-gray-700 font-mono font-black uppercase tracking-tight">VIN: {order.vin}</p></div>
                    {order.clientName && <div className="bg-gray-50 px-2 py-1 rounded-lg border border-gray-100 inline-flex items-center gap-1"><User size={10} className="text-gray-400"/><p className="text-[10px] text-gray-700 font-bold uppercase tracking-tight">{order.clientName}</p></div>}
                    <div className="bg-gray-50 px-2 py-1 rounded-lg border border-gray-100 inline-flex items-center gap-1"><Smartphone size={10} className="text-gray-400"/><p className="text-[10px] text-gray-700 font-bold uppercase tracking-tight">{order.source}</p></div>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1">
                  <div className="flex gap-1 items-center">
                    {order.isPinned && <Pin size={13} className="text-blue-600" />}
                    {order.isVip && <Star size={13} className="text-yellow-600 fill-yellow-500" />}
                    {order.isLead && <span className="px-1.5 py-0.5 rounded-md bg-purple-100 text-purple-700 text-[9px] font-black uppercase">Lead</span>}
                    {getAgeBadge(order.createdAt)}
                    <div className={`px-2 py-1 rounded text-[9px] font-black uppercase tracking-tighter ${order.priority === Priority.HIGH ? 'bg-red-100 text-red-600' : order.priority === Priority.MEDIUM ? 'bg-yellow-100 text-yellow-600' : 'bg-blue-100 text-blue-600'}`}>{order.priority}</div>
                  </div>
                </div>
              </div>

              {getCarPhotos(order).length > 0 && (
                <button type="button" onClick={(e) => openGallery(e, getCarPhotos(order))} className="mb-2 relative w-16 h-16 rounded-xl overflow-hidden border border-gray-100">
                  <img src={getCarPhotos(order)[0]} className="w-full h-full object-cover" />
                  {getCarPhotos(order).length > 1 && <div className="absolute bottom-0 right-0 bg-blue-600 text-white text-[9px] font-bold px-1 rounded-tl">+{getCarPhotos(order).length - 1}</div>}
                </button>
              )}

              <div className="mb-2 px-1"><p className="text-xs font-bold text-gray-600 leading-tight line-clamp-2">{order.parts.map(p => p.name).join(', ')}</p></div>

              <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-50">
                <div className="flex items-center gap-3">
                  <div className="flex -space-x-2">
                    {order.parts.slice(0, 3).map((part) => {
                      const photo = getPartPhoto(part);
                      return (
                        <div key={part.id} className="w-8 h-8 rounded-lg bg-gray-50 border-2 border-white flex items-center justify-center overflow-hidden">
                          {photo ? <img src={photo} className="w-full h-full object-cover cursor-pointer" onClick={(e) => openGallery(e, getPartPhotos(part))} /> : <PackageSearch size={16} className="text-gray-300" />}
                        </div>
                      );
                    })}
                  </div>
                  <div className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter">{order.parts.filter(p => p.isFound).length}/{order.parts.length} Найдено</div>
                </div>

                <div className="flex items-center gap-1">
                  <button onClick={(e) => { e.stopPropagation(); togglePin(order.id); }} className="p-2 text-gray-300 hover:text-blue-600"><Pin size={18} className={order.isPinned ? 'fill-blue-100 text-blue-600' : ''} /></button>
                  <button onClick={(e) => { e.stopPropagation(); setDeleteId(order.id); }} className="p-2 text-gray-200 hover:text-red-500"><Trash2 size={20} /></button>
                  <ChevronRight size={20} className="text-gray-200" />
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <ConfirmModal isOpen={!!deleteId} message="Вы уверены, что хотите удалить этот заказ?" onConfirm={confirmDelete} onCancel={() => setDeleteId(null)} />
      {isIncomeOpen && <IncomeModal isOpen={isIncomeOpen} onClose={() => setIsIncomeOpen(false)} orders={orders} />}
      {gallery && <ImagePreview images={gallery.images} initialIndex={gallery.index} onClose={() => setGallery(null)} />}
    </div>
  );
};

export default OrdersScreen;
