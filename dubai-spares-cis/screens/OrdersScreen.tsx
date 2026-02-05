import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOrderStore } from '../store'; // Используем обновленный стор
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
  Clock
} from 'lucide-react';
import IncomeModal from '../components/IncomeModal';
import ImagePreview from '../components/ImagePreview';
import ConfirmModal from '../components/ConfirmModal';

type TabType = 'active' | 'archive' | 'sold';
type SortType = 'date' | 'brand' | 'priority' | 'status';

const OrdersScreen: React.FC = () => {
  // Подключаем данные и функции
  const orders = useOrderStore((state) => state.orders);
  const deleteOrder = useOrderStore((state) => state.deleteOrder);
  const syncOrders = useOrderStore((state) => state.syncOrders);

  // Загружаем данные из облака при открытии экрана
  useEffect(() => {
    syncOrders();
  }, [syncOrders]);

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
      return !o.isArchived && !o.isSold;
    });
    
    return [...list].sort((a, b) => {
      switch (sortBy) {
        case 'brand': return a.brand.localeCompare(b.brand);
        case 'priority': {
          const weights = { [Priority.HIGH]: 3, [Priority.MEDIUM]: 2, [Priority.LOW]: 1 };
          return weights[b.priority] - weights[a.priority];
        }
        case 'status': {
          const getFoundStatusScore = (o: Order) => {
            if (o.parts.length === 0) return 0;
            const foundCount = o.parts.filter(p => p.variants && p.variants.length > 0).length;
            if (foundCount === o.parts.length) return 3;
            if (foundCount > 0) return 2;
            return 1;
          };
          return getFoundStatusScore(b) - getFoundStatusScore(a) || (b.createdAt - a.createdAt);
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
    let label = '';
    let style = '';
    if (diff < 1) label = 'NEW';
    else if (diff < 24) label = `${Math.floor(diff)}h`;
    else label = `${Math.floor(diff / 24)}d`;

    if (diff < 24) style = 'bg-green-100 text-green-700';
    else if (diff < 48) style = 'bg-yellow-100 text-yellow-700';
    else style = 'bg-red-100 text-red-700';

    return (
      <div className={`px-2 py-1 rounded text-[9px] font-black uppercase tracking-tighter flex items-center gap-1 ${style}`}>
        <Clock size={8} /> {label}
      </div>
    );
  };

  const getOrderProfit = (order: Order) => {
    if (order.isSold && order.soldProfitUsd !== undefined) return order.soldProfitUsd.toFixed(0);
    let totalCostAed = 0;
    let foundParts = 0;
    order.parts.forEach(p => {
      if (p.isFound && p.variants && p.variants.length > 0) {
        totalCostAed += p.variants[0].priceAed;
        foundParts++;
      }
    });
    if (foundParts === 0) return null;
    const totalSellAed = totalCostAed * (1 + order.markupPercent / 100);
    return ((totalSellAed - totalCostAed) / order.exchangeRate).toFixed(0);
  };

  const confirmDelete = () => {
    if (deleteId) {
      deleteOrder(deleteId);
      setDeleteId(null);
    }
  };

  const getPartPhoto = (part: Part) => {
    if (part.photos && part.photos.length > 0) return part.photos[0];
    return part.photoUrl;
  };
  
  const getPartPhotos = (part: Part) => {
      if (part.photos && part.photos.length > 0) return part.photos;
      if (part.photoUrl) return [part.photoUrl];
      return [];
  };

  const openGallery = (e: React.MouseEvent, part: Part) => {
    e.stopPropagation();
    const images = getPartPhotos(part);
    if (images.length === 0) return;
    setGallery({ images, index: 0 });
  };

  return (
    <div className="p-4 space-y-4 pb-20 overflow-x-hidden">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Мои Заказы</h1>
        <div className="flex gap-2">
          <button 
            type="button"
            onClick={() => setIsIncomeOpen(true)} 
            className="p-3 bg-blue-50 text-blue-600 rounded-xl active:bg-blue-100 transition-colors"
          >
            <BarChart3 size={20} />
          </button>
          <button 
            type="button"
            onClick={() => navigate('/vendor')} 
            className="px-4 py-2 bg-gray-900 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 active:scale-95 transition-transform"
          >
            <Users size={16} /> Склад
          </button>
        </div>
      </div>

      {/* Табы */}
      <div className="flex p-1 bg-gray-100 rounded-xl shadow-inner">
        {(['active', 'archive', 'sold'] as TabType[]).map((tab) => (
          <button 
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all duration-200 ${activeTab === tab ? 'bg-white shadow-md text-blue-600' : 'text-gray-400'}`}
          >
            {tab === 'active' ? 'Актив' : tab === 'archive' ? 'Архив' : 'Продано'}
          </button>
        ))}
      </div>

      {/* Сортировка */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
        {[
          { id: 'date', label: 'Дата', icon: Calendar },
          { id: 'brand', label: 'Марка', icon: Tag },
          { id: 'priority', label: 'Приоритет', icon: AlertCircle },
          { id: 'status', label: 'Статус', icon: PackageSearch },
        ].map((s) => (
          <button
            key={s.id}
            onClick={() => setSortBy(s.id as SortType)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg whitespace-nowrap text-[10px] font-bold uppercase tracking-tight transition-all ${sortBy === s.id ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-400 border border-gray-100'}`}
          >
            <s.icon size={12} />
            {s.label}
          </button>
        ))}
      </div>

      {/* Список заказов */}
      <div className="space-y-3">
        {filteredOrders.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-3xl border-2 border-dashed border-gray-100 text-gray-300 text-xs font-bold uppercase tracking-widest">
            Заказов нет
          </div>
        ) : (
          filteredOrders.map((order) => (
            <div
              key={order.id}
              onClick={() => navigate(`/order/${order.id}`)}
              className={`bg-white p-4 rounded-3xl shadow-sm border border-gray-100 relative overflow-hidden active:bg-gray-50 transition-colors ${getStatusColor(order.createdAt, order.isSold)}`}
            >
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h3 className="font-black text-gray-900 text-lg leading-tight uppercase tracking-tight">
                    {order.brand} {order.model}
                  </h3>
                  <div className="flex flex-wrap gap-2 mt-1">
                    <div className="bg-gray-50 px-2 py-1 rounded-lg border border-gray-100 inline-block">
                      <p className="text-[10px] text-gray-700 font-mono font-black uppercase tracking-tight">
                        VIN: {order.vin}
                      </p>
                    </div>
                    {order.clientName && (
                      <div className="bg-gray-50 px-2 py-1 rounded-lg border border-gray-100 inline-flex items-center gap-1">
                         <User size={10} className="text-gray-400"/>
                         <p className="text-[10px] text-gray-700 font-bold uppercase tracking-tight truncate max-w-[80px]">
                           {order.clientName}
                         </p>
                      </div>
                    )}
                    <div className="bg-gray-50 px-2 py-1 rounded-lg border border-gray-100 inline-flex items-center gap-1">
                       <Smartphone size={10} className="text-gray-400"/>
                       <p className="text-[10px] text-gray-700 font-bold uppercase tracking-tight">
                         {order.source}
                       </p>
                    </div>
                  </div>
                </div>
                
                <div className="flex flex-col items-end gap-1">
                   <div className="flex gap-1">
                      {getAgeBadge(order.createdAt)}
                      <div className={`px-2 py-1 rounded text-[9px] font-black uppercase tracking-tighter ${
                        order.priority === Priority.HIGH ? 'bg-red-100 text-red-600' :
                        order.priority === Priority.MEDIUM ? 'bg-yellow-100 text-yellow-600' : 'bg-blue-100 text-blue-600'
                      }`}>
                        {order.priority}
                      </div>
                   </div>
                  {getOrderProfit(order) && (
                    <div className="text-green-600 text-xs font-black">
                      +${getOrderProfit(order)}
                    </div>
                  )}
                </div>
              </div>

              <div className="mb-2 px-1">
                <p className="text-xs font-bold text-gray-600 leading-tight line-clamp-2">
                  {order.parts.map(p => p.name).join(', ')}
                </p>
              </div>

              <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-50">
                <div className="flex items-center gap-3">
                  <div className="flex -space-x-2">
                    {order.parts.slice(0, 3).map((part, i) => {
                      const photo = getPartPhoto(part);
                      return (
                        <div key={part.id} className="w-8 h-8 rounded-lg bg-gray-50 border-2 border-white flex items-center justify-center overflow-hidden shadow-sm relative z-10">
                          {photo ? (
                            <img 
                              src={photo} 
                              className="w-full h-full object-cover cursor-pointer" 
                              onClick={(e) => openGallery(e, part)}
                            />
                          ) : (
                            <PackageSearch size={16} className="text-gray-300" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter">
                    {order.parts.filter(p => p.isFound).length}/{order.parts.length} Найдено
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeleteId(order.id); }}
                    className="p-4 -m-2 text-gray-200 hover:text-red-500 transition-colors relative z-20"
                  >
                    <Trash2 size={20} />
                  </button>
                  <ChevronRight size={20} className="text-gray-200" />
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <ConfirmModal 
        isOpen={!!deleteId} 
        message="Вы уверены, что хотите удалить этот заказ?" 
        onConfirm={confirmDelete} 
        onCancel={() => setDeleteId(null)} 
      />
      
      {isIncomeOpen && <IncomeModal isOpen={isIncomeOpen} onClose={() => setIsIncomeOpen(false)} orders={orders} />}
      {gallery && (
        <ImagePreview 
          images={gallery.images} 
          initialIndex={gallery.index} 
          onClose={() => setGallery(null)} 
        />
      )}
    </div>
  );
};

export default OrdersScreen;
