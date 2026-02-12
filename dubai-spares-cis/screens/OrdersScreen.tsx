import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, BarChart3, CheckCircle2, Clock3, Filter, Loader2, MessageCircle, Smartphone, Star, WifiOff, XCircle } from 'lucide-react';
import { useStore } from '../store';
import { Order, Priority } from '../types';
import IncomeModal from '../components/IncomeModal';
import ConfirmModal from '../components/ConfirmModal';
import { toast, vibrate } from '../feedback';

type TabType = 'active' | 'leads' | 'vip' | 'sold' | 'archive';
type SortType = 'date_desc' | 'date_asc' | 'priority' | 'brand_asc' | 'age';
type SearchState = 'searching' | 'waiting_response' | 'found' | 'offer_sent' | 'sold' | 'archived';

const priorityWeight = { [Priority.HIGH]: 3, [Priority.MEDIUM]: 2, [Priority.LOW]: 1 };

const ACTION_REVEAL = 72;
const LEFT_OPEN_WIDTH = 88;
const RIGHT_OPEN_WIDTH = 88;
const CLOSE_THRESHOLD = 24;
const OPEN_THRESHOLD_LEFT = 80;
const OPEN_THRESHOLD_RIGHT = 60;
const COMMIT_THRESHOLD_RIGHT = 140;
const SWIPE_DEAD_ZONE = 8;

type SwipeStatus = 'idle' | 'dragging_left' | 'dragging_right' | 'open_left' | 'open_right' | 'committed';

const statusLabelMap: Record<SearchState, string> = {
  searching: 'В поиске',
  waiting_response: 'Ждём ответ',
  found: 'Найдено',
  offer_sent: 'Оффер отправлен',
  sold: 'Продано',
  archived: 'Архив'
};

const isOrderFound = (order: Order) => order.parts.some((part) => part.isFound || part.variants.length > 0);
const foundPartsCount = (order: Order) => order.parts.filter((part) => part.isFound || part.variants.length > 0).length;

const getCardSearchStatus = (order: Order): SearchState => {
  if (order.isSold) return 'sold';
  if (order.isArchived) return 'archived';
  if (order.salesStatus === 'Price Sent') return 'offer_sent';
  if (order.salesStatus === 'Pending Approval') return 'waiting_response';
  if (isOrderFound(order)) return 'found';
  return 'searching';
};

const formatAge = (ts: number) => {
  const hours = (Date.now() - ts) / (1000 * 60 * 60);
  if (hours < 1) return 'NEW';
  if (hours < 24) return `${Math.floor(hours)}h`;
  return `${Math.floor(hours / 24)}d`;
};

type SwipeableOrderCardProps = {
  orderId: string;
  openCardId: string | null;
  setOpenCardId: (id: string | null) => void;
  onCommitWhatsapp: () => void;
  onOpenWhatsapp: () => void;
  onArchive: () => void;
  onLongPressDelete: () => void;
  onCardTap: () => void;
  disableCardTap?: boolean;
  children: React.ReactNode;
};

const SwipeableOrderCard: React.FC<SwipeableOrderCardProps> = ({
  orderId,
  openCardId,
  setOpenCardId,
  onCommitWhatsapp,
  onOpenWhatsapp,
  onArchive,
  onLongPressDelete,
  onCardTap,
  disableCardTap = false,
  children
}) => {
  const [translateX, setTranslateX] = useState(0);
  const [status, setStatus] = useState<SwipeStatus>('idle');
  const [isDragging, setIsDragging] = useState(false);
  const [hasSwiped, setHasSwiped] = useState(() => window.localStorage.getItem('orders_swipe_hint_done') === '1');

  const pointerStart = useRef({ x: 0, y: 0 });
  const dragOriginX = useRef(0);
  const isHorizontalSwipe = useRef<boolean | null>(null);
  const moved = useRef(false);
  const thresholdBuzzed = useRef(false);
  const longPressTimer = useRef<number | null>(null);
  const suppressClickUntil = useRef(0);
  const longPressActive = useRef(false);

  const setSpringPosition = (nextX: number, nextState: SwipeStatus) => {
    setTranslateX(nextX);
    setStatus(nextState);
    setIsDragging(false);
  };

  useEffect(() => {
    if (openCardId !== orderId && (status === 'open_left' || status === 'open_right')) {
      setSpringPosition(0, 'idle');
    }
  }, [openCardId, orderId, status]);

  const clearLongPress = () => {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const leftProgress = Math.min(Math.max(-translateX / LEFT_OPEN_WIDTH, 0), 1);
  const rightProgress = Math.min(Math.max(translateX / RIGHT_OPEN_WIDTH, 0), 1);

  const applyResistance = (delta: number) => {
    const raw = dragOriginX.current + delta;
    if (raw > RIGHT_OPEN_WIDTH) {
      return RIGHT_OPEN_WIDTH + (raw - RIGHT_OPEN_WIDTH) * 0.32;
    }
    if (raw < -LEFT_OPEN_WIDTH) {
      return -LEFT_OPEN_WIDTH + (raw + LEFT_OPEN_WIDTH) * 0.32;
    }
    return raw;
  };

  const onPointerDown: React.PointerEventHandler<HTMLElement> = (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('button, a, input, textarea, select')) return;
    pointerStart.current = { x: event.clientX, y: event.clientY };
    dragOriginX.current = translateX;
    isHorizontalSwipe.current = null;
    moved.current = false;
    thresholdBuzzed.current = Math.abs(translateX) >= COMMIT_THRESHOLD_RIGHT;
    setIsDragging(true);
    clearLongPress();
    longPressTimer.current = window.setTimeout(() => {
      if (!moved.current && Math.abs(translateX) < SWIPE_DEAD_ZONE) {
        event.preventDefault();
        event.stopPropagation();
        longPressActive.current = true;
        suppressClickUntil.current = Date.now() + 400;
        vibrate([16]);
        onLongPressDelete();
      }
    }, 720);
  };

  const onPointerMove: React.PointerEventHandler<HTMLElement> = (event) => {
    if (!isDragging) return;
    const dx = event.clientX - pointerStart.current.x;
    const dy = event.clientY - pointerStart.current.y;

    if (Math.abs(dx) < SWIPE_DEAD_ZONE && Math.abs(dy) < SWIPE_DEAD_ZONE) return;

    if (isHorizontalSwipe.current === null) {
      isHorizontalSwipe.current = Math.abs(dx) > Math.abs(dy) * 1.2;
    }

    if (!isHorizontalSwipe.current) {
      setIsDragging(false);
      return;
    }

    moved.current = true;
    event.preventDefault();
    const nextX = applyResistance(dx);
    setTranslateX(nextX);
    setStatus(nextX < 0 ? 'dragging_left' : 'dragging_right');

    const crossed = nextX >= COMMIT_THRESHOLD_RIGHT;
    if (crossed !== thresholdBuzzed.current) {
      thresholdBuzzed.current = crossed;
      vibrate([10]);
    }

    if (Math.abs(nextX) > ACTION_REVEAL && !hasSwiped) {
      setHasSwiped(true);
      window.localStorage.setItem('orders_swipe_hint_done', '1');
    }
  };

  const onPointerUp: React.PointerEventHandler<HTMLElement> = (event) => {
    if (!isDragging) return;
    clearLongPress();
    const target = event.target as HTMLElement;
    if (target.closest('button, a, input, textarea, select')) {
      setIsDragging(false);
      return;
    }
    const dx = event.clientX - pointerStart.current.x;

    if (!moved.current) {
      if (status === 'open_left' || status === 'open_right') {
        setOpenCardId(null);
        setSpringPosition(0, 'idle');
      } else {
        const blocked = disableCardTap || longPressActive.current || Date.now() < suppressClickUntil.current;
        if (!blocked) onCardTap();
      }
      setIsDragging(false);
      return;
    }

    if (translateX >= COMMIT_THRESHOLD_RIGHT) {
      setStatus('committed');
      setTranslateX(COMMIT_THRESHOLD_RIGHT + 30);
      vibrate([16]);
      window.setTimeout(() => {
        onCommitWhatsapp();
        setOpenCardId(null);
        setSpringPosition(0, 'idle');
      }, 120);
      return;
    }

    if (translateX <= -OPEN_THRESHOLD_LEFT || dx <= -OPEN_THRESHOLD_LEFT) {
      setOpenCardId(orderId);
      setSpringPosition(-LEFT_OPEN_WIDTH, 'open_left');
      return;
    }

    if (translateX >= OPEN_THRESHOLD_RIGHT || dx >= OPEN_THRESHOLD_RIGHT) {
      setOpenCardId(orderId);
      setSpringPosition(RIGHT_OPEN_WIDTH, 'open_right');
      return;
    }

    if (Math.abs(translateX) <= CLOSE_THRESHOLD) {
      setOpenCardId(null);
      setSpringPosition(0, 'idle');
      return;
    }

    setOpenCardId(null);
    setSpringPosition(0, 'idle');
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 shadow-sm" data-swipe-card="true">
      <div className="absolute inset-0 flex items-stretch justify-between">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenWhatsapp();
            setOpenCardId(null);
            setSpringPosition(0, 'idle');
          }}
          className="flex h-full min-w-[88px] items-center justify-center bg-emerald-500/85 text-white"
          style={{ opacity: Math.max(rightProgress, 0.12) }}
        >
          <span className="inline-flex items-center gap-2" style={{ opacity: rightProgress, transform: `scale(${0.92 + rightProgress * 0.08})` }}>
            <MessageCircle size={18} /> WhatsApp
          </span>
        </button>

        <div className="flex h-full items-stretch">
          {[
            { label: 'Archive', action: onArchive, className: 'bg-slate-600/90 text-white', icon: <Archive size={16} /> }
          ].map((item, idx) => (
            <button
              key={item.label}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                item.action();
                setOpenCardId(null);
                setSpringPosition(0, 'idle');
              }}
              className={`h-full min-w-[70px] px-2 ${item.className}`}
              style={{
                opacity: leftProgress,
                transform: `translateY(${(1 - leftProgress) * 4}px) scale(${0.95 + leftProgress * 0.05})`,
                transitionDelay: `${idx * 18}ms`
              }}
            >
              <span className="flex flex-col items-center justify-center gap-1 text-[11px] font-black">
                {item.icon}
                <span className="opacity-80">{item.label}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <article
        className="relative rounded-2xl bg-white p-4"
        style={{
          transform: `translate3d(${translateX}px,0,0)`,
          transition: isDragging ? 'none' : 'transform 280ms cubic-bezier(0.22, 1, 0.36, 1)',
          willChange: 'transform',
          touchAction: 'pan-y'
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          clearLongPress();
          longPressActive.current = false;
          setIsDragging(false);
          setSpringPosition(0, 'idle');
        }}
      >
        <div className="pointer-events-none absolute inset-0 rounded-2xl shadow-[0_10px_24px_rgba(15,23,42,0.06)]" />
        <div className="relative z-10">{children}</div>
        {!hasSwiped && (
          <p className="mt-3 text-[10px] text-slate-400">Свайп → WhatsApp • Свайп ← Archive • Long press → Delete</p>
        )}
      </article>
    </div>
  );
};

const OrdersScreen: React.FC = () => {
  const { orders, isLoading, error, syncOrders, updateOrder, deleteOrder } = useStore();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<TabType>('active');
  const [sortBy, setSortBy] = useState<SortType>('date_desc');
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isIncomeOpen, setIsIncomeOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  const [brandFilters, setBrandFilters] = useState<string[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<Priority | 'all'>('all');
  const [statusFilters, setStatusFilters] = useState<SearchState[]>([]);
  const [noResponseHours, setNoResponseHours] = useState<number>(0);
  const [issueFilter, setIssueFilter] = useState<'all' | 'missing_price' | 'missing_contact'>('all');


  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(searchText.trim().toLowerCase()), 300);
    return () => window.clearTimeout(t);
  }, [searchText]);

  useEffect(() => {
    const onOnline = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest('[data-swipe-card="true"]')) {
        setOpenSwipeId(null);
      }
    };
    const onScroll = () => setOpenSwipeId(null);
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  const refreshOrders = async () => {
    if (isOffline) return;
    setIsRefreshing(true);
    try {
      await syncOrders();
    } finally {
      setIsRefreshing(false);
    }
  };

  const archiveOrder = (order: Order) => {
    if (order.isArchived) return;
    void updateOrder({ ...order, isArchived: true });
    toast('Заказ в архиве', 'success');
  };

  const restoreOrder = (order: Order) => {
    if (!order.isArchived) return;
    void updateOrder({ ...order, isArchived: false });
    toast('Заказ восстановлен', 'success');
  };

  const openWhatsapp = (order: Order) => {
    const phone = (order.customerContact || '').replace(/[^\d+]/g, '');
    if (!phone) {
      toast('Нет контакта клиента', 'error');
      return;
    }
    const message = `Здравствуйте! Апдейт по заказу ${order.brand} ${order.model}`;
    window.open(`https://wa.me/${phone.replace(/^\+/, '')}?text=${encodeURIComponent(message)}`, '_blank');
  };

  const allBrands = useMemo(() => Array.from(new Set(orders.map((order) => order.brand))).sort((a, b) => a.localeCompare(b)), [orders]);


  const isUnreadPublicLead = (order: Order) => order.leadSource === 'public_form' && order.leadUnread === true && !order.isArchived;

  const tabCounts = useMemo(() => ({
    active: orders.filter((o) => !o.isArchived && !o.isSold && !isUnreadPublicLead(o)).length,
    leads: orders.filter((o) => isUnreadPublicLead(o) && !o.isSold).length,
    vip: orders.filter((o) => o.isVip && !o.isSold).length,
    sold: orders.filter((o) => o.isSold).length,
    archive: orders.filter((o) => o.isArchived && !o.isSold).length
  }), [orders]);

  const filteredOrders = useMemo(() => {
    let list = orders.filter((order) => {
      if (activeTab === 'sold') return order.isSold;
      if (activeTab === 'archive') return order.isArchived && !order.isSold;
      if (activeTab === 'vip') return order.isVip && !order.isSold;
      if (activeTab === 'leads') return isUnreadPublicLead(order) && !order.isSold;
      return !order.isArchived && !order.isSold && !isUnreadPublicLead(order);
    });

    if (debouncedSearch) {
      list = list.filter((order) => `${order.brand} ${order.model} ${order.clientName} ${order.customerContact || ''}`.toLowerCase().includes(debouncedSearch));
    }

    if (brandFilters.length > 0) {
      list = list.filter((order) => brandFilters.includes(order.brand));
    }

    if (priorityFilter !== 'all') {
      list = list.filter((order) => order.priority === priorityFilter);
    }

    if (statusFilters.length > 0) {
      list = list.filter((order) => statusFilters.includes(getCardSearchStatus(order)));
    }

    if (noResponseHours > 0) {
      list = list.filter((order) => {
        const hours = (Date.now() - (order.updatedAt || order.createdAt)) / (1000 * 60 * 60);
        return hours >= noResponseHours;
      });
    }

    if (issueFilter === 'missing_price') {
      list = list.filter((order) => order.parts.some((part) => part.variants.length === 0));
    }
    if (issueFilter === 'missing_contact') {
      list = list.filter((order) => !order.customerContact?.trim());
    }

    return [...list].sort((a, b) => {
      if (!!a.isPinned !== !!b.isPinned) return a.isPinned ? -1 : 1;
      if (sortBy === 'date_asc') return a.createdAt - b.createdAt;
      if (sortBy === 'priority') return priorityWeight[b.priority] - priorityWeight[a.priority] || b.createdAt - a.createdAt;
      if (sortBy === 'brand_asc') return a.brand.localeCompare(b.brand);
      if (sortBy === 'age') return (a.updatedAt || a.createdAt) - (b.updatedAt || b.createdAt);
      return b.createdAt - a.createdAt;
    });
  }, [orders, activeTab, debouncedSearch, brandFilters, priorityFilter, statusFilters, noResponseHours, issueFilter, sortBy]);

  const emptyStateMessage = useMemo(() => {
    if (activeTab === 'active') return { title: 'Нет активных заказов', cta: 'Создать заказ', action: () => navigate('/new') };
    if (activeTab === 'leads') return { title: 'Нет лидов', cta: 'Импортировать / Создать', action: () => navigate('/new') };
    if (activeTab === 'archive') return { title: 'Архив пуст', cta: 'Показать активные', action: () => setActiveTab('active') };
    return { title: 'Пока пусто', cta: 'Открыть активные', action: () => setActiveTab('active') };
  }, [activeTab, navigate]);

  const syncState: 'synced' | 'syncing' | 'error' | 'offline' = isOffline ? 'offline' : isRefreshing ? 'syncing' : error ? 'error' : 'synced';

  const showSkeleton = isLoading && orders.length === 0;



  const [openSwipeId, setOpenSwipeId] = useState<string | null>(null);


  const confirmDelete = async () => {
    if (!deleteId) return;
    setIsDeleting(true);
    const ok = await deleteOrder(deleteId);
    if (ok) setDeleteId(null);
    setIsDeleting(false);
  };

  return (
    <div className="space-y-4 px-4 pt-4 pb-[calc(6rem+env(safe-area-inset-bottom))] overflow-x-hidden">
      {(isOffline || error) && (
        <div className={`rounded-xl border px-3 py-2 text-xs font-bold ${isOffline ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-rose-300 bg-rose-50 text-rose-800'} flex items-center justify-between gap-2`}>
          <span>{isOffline ? 'Офлайн • данные из кеша' : 'Ошибка синхронизации'}</span>
          {!isOffline && <button type="button" onClick={() => void refreshOrders()} className="rounded-lg bg-white px-2 py-1 text-[10px] uppercase">Повторить</button>}
        </div>
      )}

      <header className="sticky top-0 z-20 space-y-3 bg-[#f7f8fc] pt-1 pb-2">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-black tracking-tight text-slate-900">Заказы</h1>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setIsIncomeOpen(true)} className="h-11 w-11 rounded-xl border border-slate-200 bg-white grid place-items-center" aria-label="Статистика"><BarChart3 size={18} /></button>
            <button type="button" onClick={() => navigate('/vendor')} className="h-11 px-3 rounded-xl border border-slate-200 bg-white text-[11px] font-black uppercase">Склад</button>
            <button type="button" disabled={isOffline || isRefreshing} onClick={() => void refreshOrders()} className="h-11 w-11 rounded-xl border border-slate-200 bg-white grid place-items-center disabled:opacity-50" aria-label="Синхронизация">
              {syncState === 'synced' && <CheckCircle2 size={18} className="text-emerald-600" />}
              {syncState === 'syncing' && <Loader2 size={18} className="text-blue-600 animate-spin" />}
              {syncState === 'error' && <XCircle size={18} className="text-rose-600" />}
              {syncState === 'offline' && <WifiOff size={18} className="text-amber-600" />}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label className="flex h-11 flex-1 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3">
            <Smartphone size={14} className="text-slate-400" />
            <input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Поиск заказа" className="w-full bg-transparent text-sm outline-none" />
            {searchText && <button type="button" onClick={() => setSearchText('')} className="text-xs text-slate-500">Очистить</button>}
          </label>
          <button type="button" onClick={() => setIsFilterOpen(true)} className="h-11 rounded-2xl border border-slate-200 bg-white px-3 text-xs font-black uppercase inline-flex items-center gap-1"><Filter size={14} />Фильтр</button>
        </div>

        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
          {([
            ['active', 'Актив'],
            ['leads', 'Лиды'],
            ['vip', 'VIP'],
            ['sold', 'Продано'],
            ['archive', 'Архив']
          ] as [TabType, string][]).map(([tab, label]) => (
            <button key={tab} type="button" onClick={() => setActiveTab(tab)} className={`whitespace-nowrap rounded-xl border px-3 py-2 text-[11px] font-black ${activeTab === tab ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-600'}`}>
              {label} ({tabCounts[tab]})
            </button>
          ))}
        </div>
      </header>

      <div className="space-y-3">
        {showSkeleton ? (
          Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className="rounded-2xl border border-slate-200 bg-white p-4 animate-pulse space-y-2">
              <div className="h-5 w-44 rounded bg-slate-200" />
              <div className="h-4 w-56 rounded bg-slate-100" />
              <div className="h-6 w-24 rounded bg-slate-100" />
              <div className="h-2 w-full rounded bg-slate-100" />
            </div>
          ))
        ) : filteredOrders.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-12 text-center">
            <p className="text-base font-black text-slate-800">{emptyStateMessage.title}</p>
            <button type="button" onClick={emptyStateMessage.action} className="mt-4 rounded-xl bg-blue-600 px-4 py-2 text-xs font-black uppercase text-white">{emptyStateMessage.cta}</button>
          </div>
        ) : (
          filteredOrders.map((order) => {
            const totalParts = order.parts.length;
            const foundParts = foundPartsCount(order);
            const progress = totalParts > 0 ? Math.round((foundParts / totalParts) * 100) : 0;
            const status = getCardSearchStatus(order);
            const contactLabel = order.clientName?.trim() || order.customerContact || 'Без контакта';
            const ageLabel = formatAge(order.updatedAt || order.createdAt);
            const profitAed = order.soldProfitUsd === undefined ? null : Math.round(order.soldProfitUsd * (order.exchangeRate || 3.67));

            return (
              <SwipeableOrderCard
                key={order.id}
                orderId={order.id}
                openCardId={openSwipeId}
                setOpenCardId={setOpenSwipeId}
                onCommitWhatsapp={() => openWhatsapp(order)}
                onOpenWhatsapp={() => openWhatsapp(order)}
                onArchive={() => {
                  order.isArchived ? restoreOrder(order) : archiveOrder(order);
                }}
                onLongPressDelete={() => setDeleteId(order.id)}
                onCardTap={() => navigate(`/order/${order.id}`)}
                disableCardTap={!!deleteId || isDeleting}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-black text-slate-900">{order.brand} {order.model} <span className="text-sm font-semibold text-slate-500">{order.year}</span></h3>
                    {isUnreadPublicLead(order) && (
                      <span className="mt-1 inline-flex items-center gap-2 rounded-full bg-amber-50 px-2 py-1 text-[10px] font-black text-amber-700">
                        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-rose-500" /> NEW LEAD
                      </span>
                    )}
                    <p className="mt-0.5 truncate text-sm text-slate-600 inline-flex items-center gap-1">{contactLabel}{order.isVip && <Star size={12} className="text-amber-500" />} • {order.source || 'Источник —'}</p>
                  </div>
                  <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-black uppercase text-slate-700 inline-flex items-center gap-1"><Clock3 size={11} /> {ageLabel}</span>
                </div>

                <div className="mt-2 flex items-center gap-2">
                  <span className="rounded-lg bg-blue-50 px-2 py-1 text-[11px] font-black text-blue-700">{statusLabelMap[status]}</span>
                  {order.priority === Priority.HIGH && <span className="text-[10px] font-black text-rose-600 uppercase">Срочно</span>}
                </div>

                <p className="mt-3 text-xs text-slate-500">Детали: {totalParts} • Найдено: {foundParts} ({progress}%)</p>

                <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-sm font-bold">
                  {profitAed === null ? (
                    <span className="text-slate-600">Маржа: не рассчитано</span>
                  ) : profitAed >= 0 ? (
                    <span className="text-emerald-700">Прибыль: +{profitAed} AED</span>
                  ) : (
                    <span className="text-rose-700">Убыток: {profitAed} AED</span>
                  )}
                </div>

                <p className="mt-3 border-t border-slate-100 pt-3 text-[11px] text-slate-400">Свайп → WhatsApp • Свайп ← Archive</p>
              </SwipeableOrderCard>
            );
          })
        )}
      </div>

      {isFilterOpen && (
        <div className="fixed inset-0 z-40 bg-black/35" onClick={() => setIsFilterOpen(false)}>
          <div className="absolute bottom-0 left-0 right-0 rounded-t-3xl bg-white p-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-black text-slate-900">Фильтры и сортировка</h2>

            <div className="mt-3 space-y-2">
              <label className="text-[11px] font-black uppercase text-slate-500">Сортировка</label>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortType)} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm">
                <option value="date_desc">Дата: новые</option>
                <option value="date_asc">Дата: старые</option>
                <option value="priority">Приоритет</option>
                <option value="brand_asc">Марка A–Z</option>
                <option value="age">Срок/давность</option>
              </select>
            </div>

            <div className="mt-3 space-y-2">
              <label className="text-[11px] font-black uppercase text-slate-500">Марка (multi)</label>
              <div className="flex flex-wrap gap-2">
                {allBrands.map((brand) => (
                  <button key={brand} type="button" onClick={() => setBrandFilters((current) => current.includes(brand) ? current.filter((b) => b !== brand) : [...current, brand])} className={`rounded-lg border px-2 py-1 text-xs font-bold ${brandFilters.includes(brand) ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600'}`}>{brand}</button>
                ))}
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as Priority | 'all')} className="h-11 rounded-xl border border-slate-200 px-2 text-sm">
                <option value="all">Любой приоритет</option>
                <option value={Priority.HIGH}>High</option>
                <option value={Priority.MEDIUM}>Medium</option>
                <option value={Priority.LOW}>Low</option>
              </select>
              <select value={noResponseHours} onChange={(e) => setNoResponseHours(Number(e.target.value))} className="h-11 rounded-xl border border-slate-200 px-2 text-sm">
                <option value={0}>Без ответа: все</option>
                <option value={3}>{'>'} 3ч</option>
                <option value={6}>{'>'} 6ч</option>
                <option value={12}>{'>'} 12ч</option>
                <option value={24}>{'>'} 24ч</option>
              </select>
            </div>

            <div className="mt-2">
              <select value={issueFilter} onChange={(e) => setIssueFilter(e.target.value as typeof issueFilter)} className="h-11 w-full rounded-xl border border-slate-200 px-2 text-sm">
                <option value="all">Ошибки: все</option>
                <option value="missing_price">Без цены</option>
                <option value="missing_contact">Без контакта</option>
              </select>
            </div>

            <div className="mt-3">
              <label className="text-[11px] font-black uppercase text-slate-500">Статус поиска</label>
              <div className="mt-2 flex flex-wrap gap-2">
                {(Object.keys(statusLabelMap) as SearchState[]).map((status) => (
                  <button key={status} type="button" onClick={() => setStatusFilters((current) => current.includes(status) ? current.filter((item) => item !== status) : [...current, status])} className={`rounded-lg border px-2 py-1 text-xs font-bold ${statusFilters.includes(status) ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600'}`}>
                    {statusLabelMap[status]}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => {
                setSortBy('date_desc');
                setBrandFilters([]);
                setPriorityFilter('all');
                setStatusFilters([]);
                setNoResponseHours(0);
                setIssueFilter('all');
              }} className="h-11 flex-1 rounded-xl border border-slate-200 text-xs font-black uppercase">Сброс</button>
              <button type="button" onClick={() => setIsFilterOpen(false)} className="h-11 flex-1 rounded-xl bg-blue-600 text-xs font-black uppercase text-white">Применить</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal isOpen={!!deleteId} message={isDeleting ? 'Удаляем…' : 'Вы уверены, что хотите удалить этот заказ?'} onConfirm={confirmDelete} onCancel={() => { if (!isDeleting) setDeleteId(null); }} />
      {isIncomeOpen && <IncomeModal isOpen={isIncomeOpen} onClose={() => setIsIncomeOpen(false)} orders={orders} />}
    </div>
  );
};

export default OrdersScreen;
