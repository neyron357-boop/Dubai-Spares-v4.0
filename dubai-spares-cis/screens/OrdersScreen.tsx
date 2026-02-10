import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { Order, Priority, Part, Shop } from '../types';
import { buildShopMapLink, isShopCompatibleWithOrder } from '../shopMatching';
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
  Star,
  Share2,
  LocateFixed
} from 'lucide-react';
import IncomeModal from '../components/IncomeModal';
import ImagePreview from '../components/ImagePreview';
import ConfirmModal from '../components/ConfirmModal';
import { shareMessage, buildOrderShareText } from '../shareUtils';
import { supabase } from '../supabase';
import { pushNotification, sendBrowserNotification } from '../notificationCenter';
import { toast, vibrate } from '../feedback';

type TabType = 'active' | 'archive' | 'sold' | 'vip' | 'leads' | 'new_leads';
type SortType = 'date' | 'brand' | 'priority' | 'status';

const weights = { [Priority.HIGH]: 3, [Priority.MEDIUM]: 2, [Priority.LOW]: 1 };
const toRad = (v: number) => (v * Math.PI) / 180;

const distanceMeters = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const calc =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(calc), Math.sqrt(1 - calc));
};

const OrdersScreen: React.FC = () => {
  const { orders, suppliers, isLoading, isSyncing, syncOrders, deleteOrder, updateOrder } = useStore();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabType>('active');
  const [sortBy, setSortBy] = useState<SortType>('date');
  const [isIncomeOpen, setIsIncomeOpen] = useState(false);
  const [gallery, setGallery] = useState<{ images: string[]; index: number } | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [nearbyFirst, setNearbyFirst] = useState(false);
  const [currentPosition, setCurrentPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [shops, setShops] = useState<Shop[]>([]);
  const [radarMessage, setRadarMessage] = useState<string | null>(null);
  const notifiedRef = useRef<Set<string>>(new Set());
  const prevLeadIdsRef = useRef<string[] | null>(null);
  const [seenLeadIds, setSeenLeadIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const saved = localStorage.getItem('notified_new_inquiry_ids');
      if (!saved) return;
      notifiedRef.current = new Set(JSON.parse(saved));
    } catch {
      notifiedRef.current = new Set();
    }
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('seen_new_inquiry_ids');
      if (!saved) return;
      setSeenLeadIds(new Set(JSON.parse(saved)));
    } catch {
      setSeenLeadIds(new Set());
    }
  }, []);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const pullStartY = useRef<number | null>(null);
  const pullTriggered = useRef(false);
  const swipeStartXRef = useRef<Record<string, number>>({});
  const [swipeOffsets, setSwipeOffsets] = useState<Record<string, number>>({});
  const swipedIdsRef = useRef<Record<string, boolean>>({});

  const refreshOrders = async () => {
    setIsRefreshing(true);
    try {
      await syncOrders();
    } finally {
      setIsRefreshing(false);
      setPullDistance(0);
      pullTriggered.current = false;
    }
  };

  const filteredOrders = useMemo(() => {
    let list = orders.filter(o => {
      if (activeTab === 'sold') return o.isSold;
      if (activeTab === 'archive') return o.isArchived && !o.isSold;
      if (activeTab === 'vip') return !!o.isVip && !o.isSold;
      if (activeTab === 'leads') return !!o.isLead && !o.isSold;
      if (activeTab === 'new_leads') return o.status === 'new_inquiry';
      return !o.isArchived && !o.isSold && !o.isVip && !o.isLead;
    });

    const nearestDistance = (order: Order) => {
      if (!currentPosition) return Number.MAX_SAFE_INTEGER;
      const matchedShops = shops.filter((shop) => isShopCompatibleWithOrder(shop, order));
      if (matchedShops.length === 0) return Number.MAX_SAFE_INTEGER;
      return Math.min(
        ...matchedShops.map((shop) => distanceMeters(currentPosition, { lat: shop.latitude, lng: shop.longitude }))
      );
    };

    return [...list].sort((a, b) => {
      if (!!a.isPinned !== !!b.isPinned) return a.isPinned ? -1 : 1;
      if (nearbyFirst) {
        const delta = nearestDistance(a) - nearestDistance(b);
        if (Math.abs(delta) > 0.001) return delta;
      }
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
  }, [orders, activeTab, sortBy, nearbyFirst, currentPosition, suppliers]);

  const unseenNewLeadCount = useMemo(() => {
    const currentNewLeadIds = orders
      .filter((order) => order.status === 'new_inquiry')
      .map((order) => order.id);
    return currentNewLeadIds.filter((id) => !seenLeadIds.has(id)).length;
  }, [orders, seenLeadIds]);

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

  const confirmDelete = async () => {
    if (!deleteId) return;
    const ok = await deleteOrder(deleteId);
    if (ok) setDeleteId(null);
  };

  const showSkeleton = isLoading && orders.length === 0;

  const toggleNearbyFirst = () => {
    if (nearbyFirst) {
      setNearbyFirst(false);
      return;
    }

    if (!navigator.geolocation) {
      toast('Геолокация не поддерживается на этом устройстве', 'error');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCurrentPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setNearbyFirst(true);
      },
      () => {
        toast('Включите GPS для сортировки Nearby First', 'error');
      }
    );
  };

  useEffect(() => {
    let active = true;
    const loadShops = async () => {
      if (!supabase) {
        const fallback = suppliers
          .filter((s) => s.coordinates)
          .map((s) => ({ id: s.id, name: s.name, phone: s.phone, location: s.location, latitude: s.coordinates!.lat, longitude: s.coordinates!.lng, specialization: s.brands || [] }));
        setShops(fallback);
        return;
      }
      let data: any[] | null = null;
      const baseShopFields = 'id,name,phone,location,latitude,longitude,specialization';
      const expandedShopFields = `${baseShopFields},specialization_models,specialization_years`;
      const primary = await supabase.from('shops').select(expandedShopFields);

      if (primary.error && primary.error.code === '42703') {
        const fallback = await supabase.from('shops').select(baseShopFields);
        data = Array.isArray(fallback.data) ? fallback.data : null;
      } else {
        data = Array.isArray(primary.data) ? primary.data : null;
      }

      if (!active) return;
      if (Array.isArray(data) && data.length > 0) {
        setShops(data.map((row: any) => ({
          id: String(row.id),
          name: row.name || 'Shop',
          phone: row.phone || '',
          location: row.location || '',
          latitude: Number(row.latitude),
          longitude: Number(row.longitude),
          specialization: Array.isArray(row.specialization) ? row.specialization : [],
          specializationModels: Array.isArray(row.specialization_models) ? row.specialization_models : [],
          specializationYears: Array.isArray(row.specialization_years) ? row.specialization_years.map((y: any) => Number(y)).filter((y: number) => Number.isFinite(y)) : []
        })));
      } else {
        const fallback = suppliers
          .filter((s) => s.coordinates)
          .map((s) => ({ id: s.id, name: s.name, phone: s.phone, location: s.location, latitude: s.coordinates!.lat, longitude: s.coordinates!.lng, specialization: s.brands || [] }));
        setShops(fallback);
      }
    };
    void loadShops();
    return () => {
      active = false;
    };
  }, [suppliers]);

  useEffect(() => {
    if (!navigator.geolocation || shops.length === 0) return;
    const watchId = navigator.geolocation.watchPosition((pos) => {
      setCurrentPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    });
    return () => navigator.geolocation.clearWatch(watchId);
  }, [shops.length]);

  useEffect(() => {
    if (!currentPosition || shops.length === 0) return;

    const runRadar = () => {
      const activeOrders = orders.filter((order) => order.status === 'new_inquiry' || order.status === 'in_progress');
      for (const order of activeOrders) {
        const matched = shops.find((shop) => {
          const isNearby = distanceMeters(currentPosition, { lat: shop.latitude, lng: shop.longitude }) <= 300;
          const isCompatible = isShopCompatibleWithOrder(shop, order) || (order.recommendedShopIds || []).includes(shop.id);
          return isNearby && isCompatible;
        });

        if (matched && !notifiedRef.current.has(`${order.id}:${matched.id}`)) {
          const meters = Math.round(distanceMeters(currentPosition, { lat: matched.latitude, lng: matched.longitude }));
          const mapLink = buildShopMapLink(matched);
          const message = `🎯 ${matched.name} рядом (${meters}м). ${order.brand} ${order.model} • Карта: ${mapLink}`;
          setRadarMessage(message);
          pushNotification({
            type: 'radar',
            title: `Радар: ${matched.name}`,
            body: message,
            route: `/order/${order.id}#shop-${matched.id}`,
            orderId: order.id,
            shopId: matched.id
          });
          setTimeout(() => setRadarMessage(null), 9000);
          if (navigator.vibrate) navigator.vibrate([240, 120, 240]);
          if (typeof Notification !== 'undefined') {
            if (Notification.permission === 'granted') {
              void sendBrowserNotification('Active Radar', {
                body: message,
                tag: `radar-${order.id}-${matched.id}`,
                requireInteraction: true,
                route: `/order/${order.id}#shop-${matched.id}`,
                url: buildShopMapLink(matched),
                data: { orderId: order.id, shopId: matched.id }
              });
            } else if (Notification.permission === 'default') {
              void Notification.requestPermission();
            }
          }
          notifiedRef.current.add(`${order.id}:${matched.id}`);
          localStorage.setItem('notified_new_inquiry_ids', JSON.stringify(Array.from(notifiedRef.current)));
          break;
        }
      }
    };

    runRadar();
    const intervalId = window.setInterval(runRadar, 45000);
    return () => window.clearInterval(intervalId);
  }, [currentPosition, orders, shops]);

  useEffect(() => {
    const currentLeadIds = orders
      .filter((order) => order.status === 'new_inquiry')
      .map((order) => order.id)
      .sort();

    if (!prevLeadIdsRef.current) {
      prevLeadIdsRef.current = currentLeadIds;
      return;
    }

    const prevIds = new Set(prevLeadIdsRef.current);
    const hasNewLead = currentLeadIds.some((id) => !prevIds.has(id));

    if (hasNewLead) {
      const newLead = orders.find((order) => order.status === 'new_inquiry' && !prevIds.has(order.id));
      if (newLead) {
        pushNotification({
          type: 'order',
          title: `Новый заказ: ${newLead.brand} ${newLead.model}`,
          body: `Источник: ${newLead.source || 'не указан'}`,
          route: `/order/${newLead.id}`,
          orderId: newLead.id
        });
        void sendBrowserNotification('Новый заказ', {
          body: `${newLead.brand} ${newLead.model} • ${newLead.source || 'Без источника'}`,
          tag: `new-order-${newLead.id}`,
          route: `/order/${newLead.id}`,
          requireInteraction: true,
          vibrate: [260, 100, 260]
        });
      }
      vibrate([200, 60, 140]);
      try {
        const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioContextClass) {
          const audioContext = new AudioContextClass();
          const oscillator = audioContext.createOscillator();
          const gain = audioContext.createGain();

          oscillator.type = 'sine';
          oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
          oscillator.connect(gain);
          gain.connect(audioContext.destination);

          gain.gain.setValueAtTime(0.001, audioContext.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.2, audioContext.currentTime + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.35);

          oscillator.start();
          oscillator.stop(audioContext.currentTime + 0.36);
          window.setTimeout(() => void audioContext.close(), 450);
        }
      } catch {
        // ignore browsers that block autoplay without interaction
      }
    }

    prevLeadIdsRef.current = currentLeadIds;
  }, [orders]);

  useEffect(() => {
    if (activeTab !== 'new_leads') return;
    const currentNewLeadIds = orders
      .filter((order) => order.status === 'new_inquiry')
      .map((order) => order.id);

    if (currentNewLeadIds.length === 0) return;

    setSeenLeadIds((current) => {
      const updated = new Set(current);
      currentNewLeadIds.forEach((id) => updated.add(id));
      localStorage.setItem('seen_new_inquiry_ids', JSON.stringify(Array.from(updated)));
      return updated;
    });
  }, [activeTab, orders]);


  const archiveBySwipe = (order: Order) => {
    if (order.isArchived) return;
    void updateOrder({ ...order, isArchived: true });
    vibrate([12, 40, 20]);
    toast('Заказ перемещён в архив', 'success');
  };

  const canSwipeToArchive = activeTab === 'active';

  const emptyStateMessage =
    activeTab === 'archive'
      ? { title: 'Архив пока пуст', subtitle: 'Смахните карточку влево на вкладке «Актив», чтобы архивировать заказ.', cta: 'Открыть активные' }
      : activeTab === 'sold'
      ? { title: 'Нет проданных заказов', subtitle: 'Отмечайте сделки как проданные, чтобы считать прибыль и аналитику.', cta: 'Перейти к активным' }
      : { title: 'Заказы не найдены', subtitle: 'Добавьте новый заказ, чтобы начать подбор и отслеживание.', cta: 'Создать заказ' };

  return (
    <div
      className="p-4 space-y-4 pb-20 overflow-x-hidden"
      onTouchStart={(e) => {
        if (window.scrollY > 0) return;
        pullStartY.current = e.touches[0].clientY;
      }}
      onTouchMove={(e) => {
        if (pullTriggered.current || pullStartY.current === null || window.scrollY > 0) return;
        const delta = e.touches[0].clientY - pullStartY.current;
        if (delta > 0) {
          setPullDistance(Math.min(80, delta * 0.45));
        }
      }}
      onTouchEnd={() => {
        if (pullDistance >= 56 && !isRefreshing) {
          pullTriggered.current = true;
          if (navigator.vibrate) navigator.vibrate(12);
          void refreshOrders();
          return;
        }
        pullStartY.current = null;
        setPullDistance(0);
      }}
    >
      <div className="transition-all duration-200 overflow-hidden" style={{ height: pullDistance ? `${pullDistance}px` : 0 }}>
        <div className="h-full flex items-center justify-center text-[10px] font-bold text-gray-500">
          {isRefreshing ? 'Обновление…' : pullDistance >= 56 ? 'Отпустите для обновления' : 'Потяните для обновления'}
        </div>
      </div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Мои Заказы</h1>
        <div className="flex gap-2">
          <button type="button" onClick={() => setIsIncomeOpen(true)} className="p-3 bg-blue-50 text-blue-600 rounded-xl"><BarChart3 size={20} /></button>
          <button type="button" onClick={() => navigate('/vendor')} className="px-4 py-2 bg-gray-900 text-white text-xs font-bold rounded-xl flex items-center gap-1.5">
            <Users size={16} /> Склад
          </button>
          <button type="button" disabled={isRefreshing} onClick={() => void refreshOrders()} className="px-3 py-2 bg-white border border-gray-200 text-[10px] font-black rounded-xl">{isRefreshing ? '...' : 'Sync'}</button>
        </div>
      </div>

      {radarMessage && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">{radarMessage}</div>}

      <div className="flex p-1 bg-gray-100 rounded-xl shadow-inner gap-1">
        {([
          ['active', 'Актив'],
          ['vip', 'VIP'],
          ['archive', 'Архив'],
          ['new_leads', 'New Leads'],
          ['leads', 'Лиды'],
          ['sold', 'Продано']
        ] as [TabType, string][]).map(([tab, title]) => {
          const isNewLeadsTab = tab === 'new_leads';
          const hasUnseenLeads = isNewLeadsTab && unseenNewLeadCount > 0;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`relative flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg ${activeTab === tab ? 'bg-white shadow-md text-blue-600' : 'text-gray-400'} ${hasUnseenLeads ? 'animate-pulse text-rose-600' : ''}`}
            >
              {title}
              {hasUnseenLeads && (
                <span className="absolute -top-1.5 right-1 inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] text-white">
                  {unseenNewLeadCount}
                </span>
              )}
            </button>
          );
        })}
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
        <button onClick={toggleNearbyFirst} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg whitespace-nowrap text-[10px] font-bold uppercase tracking-tight ${nearbyFirst ? 'bg-emerald-600 text-white' : 'bg-white text-gray-400 border border-gray-100'}`}>
          <LocateFixed size={12} /> Nearby First
        </button>
      </div>

      <div className="space-y-3">
        {showSkeleton ? (
          Array.from({ length: 4 }).map((_, idx) => (
            <div key={`skeleton-${idx}`} className="p-4 rounded-3xl bg-white border border-gray-100 animate-pulse space-y-3">
              <div className="h-5 w-40 bg-gray-200 rounded" />
              <div className="h-3 w-52 bg-gray-100 rounded" />
              <div className="h-16 w-16 bg-gray-100 rounded-xl" />
              <div className="h-3 w-full bg-gray-100 rounded" />
              <div className="h-3 w-2/3 bg-gray-100 rounded" />
            </div>
          ))
        ) : filteredOrders.length === 0 ? (
          <div className="text-center py-14 px-5 bg-white rounded-3xl border border-gray-100 shadow-sm">
            <p className="text-base font-black text-gray-700">{emptyStateMessage.title}</p>
            <p className="mt-2 text-xs text-gray-400">{emptyStateMessage.subtitle}</p>
            <button
              type="button"
              onClick={() => (activeTab === 'active' ? navigate('/new') : setActiveTab('active'))}
              className="mt-4 inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-2 text-[11px] font-black uppercase tracking-wide text-white"
            >
              {emptyStateMessage.cta}
            </button>
          </div>
        ) : (
          filteredOrders.map((order) => (
            <div
              key={order.id}
              onClick={() => {
                if (swipedIdsRef.current[order.id]) {
                  swipedIdsRef.current[order.id] = false;
                  return;
                }
                navigate(`/order/${order.id}`);
              }}
              onTouchStart={(e) => {
                if (!canSwipeToArchive) return;
                swipeStartXRef.current[order.id] = e.touches[0].clientX;
                swipedIdsRef.current[order.id] = false;
              }}
              onTouchMove={(e) => {
                if (!canSwipeToArchive) return;
                const startX = swipeStartXRef.current[order.id];
                if (typeof startX !== 'number') return;
                const delta = e.touches[0].clientX - startX;
                if (delta < 0) {
                  swipedIdsRef.current[order.id] = Math.abs(delta) > 24;
                  setSwipeOffsets((prev) => ({ ...prev, [order.id]: Math.max(delta, -132) }));
                }
              }}
              onTouchEnd={() => {
                if (!canSwipeToArchive) return;
                const offset = swipeOffsets[order.id] || 0;
                if (offset <= -96) archiveBySwipe(order);
                setSwipeOffsets((prev) => ({ ...prev, [order.id]: 0 }));
                delete swipeStartXRef.current[order.id];
              }}
              className={`p-4 rounded-3xl shadow-sm border relative overflow-hidden transition-transform duration-300 ease-out ${order.isVip ? 'bg-gradient-to-br from-yellow-50 via-amber-50 to-white border-yellow-200' : 'bg-white border-gray-100'} ${getStatusColor(order.createdAt, order.isSold)}`}
              style={{ transform: `translateX(${canSwipeToArchive ? swipeOffsets[order.id] || 0 : 0}px)` }}
            >
              {canSwipeToArchive && <div className="absolute inset-y-0 -right-24 w-24 bg-amber-500/90 text-white text-[10px] font-black uppercase tracking-widest flex items-center justify-center">Архив</div>}
              {order.salesStatus === 'Price Sent' && (Date.now() - (order.updatedAt || order.createdAt)) > 24 * 60 * 60 * 1000 && (
                <div className="absolute top-2 right-2 z-10 px-2 py-1 rounded-full bg-amber-100 text-amber-700 text-[9px] font-black uppercase">Follow up</div>
              )}
              <div className="flex justify-between items-start mb-2 gap-2">
                <div>
                  <h3 className="font-black text-gray-900 text-lg leading-tight uppercase tracking-tight">{order.brand} {order.model}</h3>
                  <div className="flex flex-wrap gap-2 mt-1">
                    <div className="bg-gray-50 px-2 py-1 rounded-lg border border-gray-100"><p className="text-[10px] text-gray-700 font-mono font-black uppercase tracking-tight">VIN: {order.vin}</p></div>
                    {order.clientName && <div className="bg-gray-50 px-2 py-1 rounded-lg border border-gray-100 inline-flex items-center gap-1 max-w-full"><User size={10} className="text-gray-400"/><p className="text-[10px] text-gray-700 font-bold uppercase tracking-tight truncate">{order.clientName}</p></div>}
                    {order.customerContact && <div className="bg-gray-50 px-2 py-1 rounded-lg border border-gray-100 inline-flex items-center gap-1 max-w-full"><Smartphone size={10} className="text-gray-400"/><p className="text-[10px] text-gray-700 font-bold tracking-tight truncate">{order.customerContact}</p></div>}
                    <div className="bg-gray-50 px-2 py-1 rounded-lg border border-gray-100 inline-flex items-center gap-1 max-w-full"><Smartphone size={10} className="text-gray-400"/><p className="text-[10px] text-gray-700 font-bold uppercase tracking-tight truncate">{order.source}</p></div>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1">
                  <div className="flex gap-1 items-center">
                    {order.isPinned && <Pin size={13} className="text-blue-600" />}
                    {order.isVip && <Star size={13} className="text-yellow-600 fill-yellow-500" />}
                    {order.isLead && <span className="px-1.5 py-0.5 rounded-md bg-purple-100 text-purple-700 text-[9px] font-black uppercase">Lead</span>}
                    <span className="px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[9px] font-black uppercase">{order.salesStatus || 'Inquiry'}</span>
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
                  <button onClick={(e) => { e.stopPropagation(); navigate(`/order/${order.id}#manual-link`); }} className="px-2 py-1 rounded-md text-[9px] font-black uppercase bg-indigo-50 text-indigo-600">Manual Link</button>
                  <button onClick={(e) => { e.stopPropagation(); void shareMessage(buildOrderShareText(order)); }} className="p-2 text-gray-300 hover:text-emerald-600"><Share2 size={18} /></button>
                  <button onClick={(e) => { e.stopPropagation(); togglePin(order.id); }} className="p-2 text-gray-300 hover:text-blue-600"><Pin size={18} className={order.isPinned ? 'fill-blue-100 text-blue-600' : ''} /></button>
                  <button onClick={(e) => { e.stopPropagation(); setDeleteId(order.id); }} className="p-2 text-gray-200 hover:text-red-500"><Trash2 size={20} /></button>
                  <ChevronRight size={20} className="text-gray-200" />
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <ConfirmModal isOpen={!!deleteId} message={isSyncing ? 'Удаление...' : 'Вы уверены, что хотите удалить этот заказ?'} onConfirm={confirmDelete} onCancel={() => setDeleteId(null)} />
      {isIncomeOpen && <IncomeModal isOpen={isIncomeOpen} onClose={() => setIsIncomeOpen(false)} orders={orders} />}
      {gallery && <ImagePreview images={gallery.images} initialIndex={gallery.index} onClose={() => setGallery(null)} />}
    </div>
  );
};

export default OrdersScreen;
