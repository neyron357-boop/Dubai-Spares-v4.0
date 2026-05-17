import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, BarChart3, CheckSquare, Clock3, Filter, MessageCircle, Pin, Search, Square, Star, Trash2 } from 'lucide-react';
import { useStore } from '../store';
import { Order, Priority } from '../types';
import IncomeModal from '../components/IncomeModal';
import ConfirmModal from '../components/ConfirmModal';
import { toast, vibrate } from '../feedback';
import { useLeadsPolling } from '../hooks/useLeadsPolling';

type TabType = 'active' | 'vip' | 'lead' | 'found' | 'urgent' | 'medium' | 'low' | 'sold' | 'archive';
const isLeadOrder = (order: Order) =>
  order.isLead === true
  || order.status === 'lead'
  || order.customerStatus === 'LEAD'
  || order.leadSource === 'public_form';
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

const isOrderFound = (order: Order) => order.parts.some((part) => part.isFound || (part.variants || []).length > 0);
const foundPartsCount = (order: Order) => order.parts.filter((part) => part.isFound || (part.variants || []).length > 0).length;

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
  contactActionLabel: string;
  onArchive: () => void;
  onLongPressDelete: () => void;
  onCardTap: () => void;
  disableCardTap?: boolean;
  disableSwipe?: boolean;
  children: React.ReactNode;
};

const SwipeableOrderCard: React.FC<SwipeableOrderCardProps> = ({
  orderId,
  openCardId,
  setOpenCardId,
  onCommitWhatsapp,
  onOpenWhatsapp,
  contactActionLabel,
  onArchive,
  onLongPressDelete,
  onCardTap,
  disableCardTap = false,
  disableSwipe = false,
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

  useEffect(() => {
    if (!disableSwipe) return;
    setSpringPosition(0, 'idle');
  }, [disableSwipe]);

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
    if (disableSwipe) return;
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
    if (disableSwipe || !isDragging) return;
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
    if (disableSwipe || !isDragging) return;
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
      {!disableSwipe && (
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
            <MessageCircle size={18} /> {contactActionLabel}
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
      )}

      <article
        className="relative rounded-2xl bg-white p-4"
        style={{
          transform: disableSwipe ? 'translate3d(0,0,0)' : `translate3d(${translateX}px,0,0)`,
          transition: isDragging ? 'none' : 'transform 280ms cubic-bezier(0.22, 1, 0.36, 1)',
          willChange: 'transform',
          touchAction: disableSwipe ? 'auto' : 'pan-y'
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
        {!hasSwiped && null}
      </article>
    </div>
  );
};

const OrdersScreen: React.FC = () => {
  const { orders, isLoading, syncOrders, updateOrder, deleteOrder } = useStore();
  const navigate = useNavigate();

  useLeadsPolling(true);

  const [activeTab, setActiveTab] = useState<TabType>('active');
  const [sortBy, setSortBy] = useState<SortType>('date_desc');
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isIncomeOpen, setIsIncomeOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [openSwipeId, setOpenSwipeId] = useState<string | null>(null);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const [brandFilters, setBrandFilters] = useState<string[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<Priority | 'all'>('all');
  const [statusFilters, setStatusFilters] = useState<SearchState[]>([]);
  const [noResponseHours, setNoResponseHours] = useState<number>(0);
  const [issueFilter, setIssueFilter] = useState<'all' | 'missing_price' | 'missing_contact'>('all');
  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');


  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(searchText.trim().toLowerCase()), 300);
    return () => window.clearTimeout(t);
  }, [searchText]);


  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest('[data-swipe-card="true"]')) {
        setOpenSwipeId(null);
      }
    };

    let scrollRaf = 0;
    const onScroll = () => {
      if (!openSwipeId || scrollRaf) return;
      scrollRaf = window.requestAnimationFrame(() => {
        scrollRaf = 0;
        setOpenSwipeId(null);
      });
    };

    document.addEventListener('pointerdown', onPointerDown);
    if (openSwipeId) window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      if (openSwipeId) window.removeEventListener('scroll', onScroll);
      if (scrollRaf) window.cancelAnimationFrame(scrollRaf);
    };
  }, [openSwipeId]);

  const refreshOrders = async () => {
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

  const getOrderContactAction = (order: Order) => {
    const source = String(order.source || '').toLowerCase();
    const social = String(order.socialNickname || '').trim();
    if (source.includes('instagram')) {
      if (!social) return { label: 'Instagram', open: false, url: '' };
      const url = social.startsWith('http') ? social : `https://instagram.com/${social.replace(/^@/, '')}`;
      return { label: 'Instagram', open: true, url };
    }
    if (source.includes('tiktok')) {
      if (!social) return { label: 'TikTok', open: false, url: '' };
      const url = social.startsWith('http') ? social : `https://www.tiktok.com/@${social.replace(/^@/, '')}`;
      return { label: 'TikTok', open: true, url };
    }
    const phone = (order.customerContact || '').replace(/[^\d+]/g, '');
    if (!phone) return { label: 'WhatsApp', open: false, url: '' };
    const message = `Здравствуйте! Апдейт по заказу ${order.brand} ${order.model}`;
    return { label: 'WhatsApp', open: true, url: `https://wa.me/${phone.replace(/^\+/, '')}?text=${encodeURIComponent(message)}` };
  };

  const openWhatsapp = (order: Order) => {
    const action = getOrderContactAction(order);
    if (!action.open) {
      toast('Нет контакта клиента', 'error');
      return;
    }
    window.open(action.url, '_blank');
  };

  const allBrands = useMemo(() => Array.from(new Set(orders.map((order) => order.brand))).sort((a, b) => a.localeCompare(b)), [orders]);


  const isUnreadPublicLead = (order: Order) => order.leadSource === 'public_form' && order.leadUnread === true && !order.isArchived;

  const tabCounts = useMemo(() => ({
    active: orders.filter((o) => !o.isArchived && !o.isSold && !isLeadOrder(o)).length,
    vip: orders.filter((o) => o.isVip && !o.isArchived && !o.isSold && !isLeadOrder(o)).length,
    lead: orders.filter((o) => !o.isArchived && !o.isSold && isLeadOrder(o)).length,
    found: orders.filter((o) => !o.isArchived && !o.isSold && !isLeadOrder(o) && isOrderFound(o)).length,
    urgent: orders.filter((o) => !o.isArchived && !o.isSold && !isLeadOrder(o) && o.priority === Priority.HIGH).length,
    medium: orders.filter((o) => !o.isArchived && !o.isSold && !isLeadOrder(o) && o.priority === Priority.MEDIUM).length,
    low: orders.filter((o) => !o.isArchived && !o.isSold && !isLeadOrder(o) && o.priority === Priority.LOW).length,
    sold: orders.filter((o) => !o.isArchived && o.isSold).length,
    archive: orders.filter((o) => o.isArchived).length
  }), [orders]);

  const openOrderPreview = (order: Order) => {
    if (isUnreadPublicLead(order)) {
      const viewedLead = { ...order, leadUnread: false };
      void updateOrder(viewedLead);
    }
    navigate(`/order/${order.id}`);
  };

  const filteredOrders = useMemo(() => {
    let list = orders.filter((order) => {
      if (activeTab === 'archive') return order.isArchived;
      if (activeTab === 'vip') return order.isVip && !order.isArchived && !order.isSold && !isLeadOrder(order);
      if (activeTab === 'lead') return !order.isArchived && !order.isSold && isLeadOrder(order);
      if (activeTab === 'found') return !order.isArchived && !order.isSold && !isLeadOrder(order) && isOrderFound(order);
      if (activeTab === 'urgent') return !order.isArchived && !order.isSold && !isLeadOrder(order) && order.priority === Priority.HIGH;
      if (activeTab === 'medium') return !order.isArchived && !order.isSold && !isLeadOrder(order) && order.priority === Priority.MEDIUM;
      if (activeTab === 'low') return !order.isArchived && !order.isSold && !isLeadOrder(order) && order.priority === Priority.LOW;
      if (activeTab === 'sold') return !order.isArchived && order.isSold;
      return !order.isArchived && !order.isSold && !isLeadOrder(order);
    });

    if (debouncedSearch) {
      list = list.filter((order) => {
        const notesText = (order.notes || []).map((note) => note.text || '').join(' ');
        const suppliersText = (order.parts || []).flatMap((part) => (part.variants || []).map((variant) => variant.shopName || variant.supplierName || '')).join(' ');
        return `${order.brand} ${order.model} ${order.vin || ''} ${order.id} ${order.clientName || ''} ${order.customerContact || ''} ${notesText} ${suppliersText}`.toLowerCase().includes(debouncedSearch);
      });
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
      list = list.filter((order) => order.parts.some((part) => (part.variants || []).length === 0));
    }
    if (issueFilter === 'missing_contact') {
      list = list.filter((order) => !order.customerContact?.trim());
    }

    const fromYearNum = Number(yearFrom);
    const toYearNum = Number(yearTo);
    if (Number.isFinite(fromYearNum) && yearFrom.trim()) {
      list = list.filter((order) => Number(order.year) >= fromYearNum);
    }
    if (Number.isFinite(toYearNum) && yearTo.trim()) {
      list = list.filter((order) => Number(order.year) <= toYearNum);
    }

    return [...list].sort((a, b) => {
      if (!!a.isPinned !== !!b.isPinned) return a.isPinned ? -1 : 1;
      if (sortBy === 'date_asc') return a.createdAt - b.createdAt;
      if (sortBy === 'priority') return priorityWeight[b.priority] - priorityWeight[a.priority] || b.createdAt - a.createdAt;
      if (sortBy === 'brand_asc') return a.brand.localeCompare(b.brand);
      if (sortBy === 'age') return (a.updatedAt || a.createdAt) - (b.updatedAt || b.createdAt);
      return b.createdAt - a.createdAt;
    });
  }, [orders, activeTab, debouncedSearch, brandFilters, priorityFilter, statusFilters, noResponseHours, issueFilter, sortBy, yearFrom, yearTo]);

  const emptyStateMessage = useMemo(() => {
    if (activeTab === 'active') return { title: 'Нет активных заказов', cta: 'Создать заказ', action: () => navigate('/new') };
    if (activeTab === 'archive') return { title: 'Архив пуст', cta: 'Показать активные', action: () => setActiveTab('active') };
    return { title: 'Пока пусто', cta: 'Открыть активные', action: () => setActiveTab('active') };
  }, [activeTab, navigate]);

  const showSkeleton = isLoading && orders.length === 0;
  const confirmDelete = async () => {
    if (!deleteId || deleteId === '__bulk__') return;
    setIsDeleting(true);
    const ok = await deleteOrder(deleteId);
    if (ok) setDeleteId(null);
    setIsDeleting(false);
  };

  const toggleSelectionMode = () => {
    setIsSelectionMode((current) => !current);
    setOpenSwipeId(null);
    setSelectedOrderIds([]);
  };

  const toggleOrderSelected = (orderId: string) => {
    setSelectedOrderIds((current) => current.includes(orderId) ? current.filter((id) => id !== orderId) : [...current, orderId]);
  };

  const selectAllFiltered = () => {
    setSelectedOrderIds(filteredOrders.map((order) => order.id));
  };

  const clearSelection = () => setSelectedOrderIds([]);

  const archiveSelectedOrders = async () => {
    if (selectedOrderIds.length === 0) return;
    const selectedSet = new Set(selectedOrderIds);
    const targets = orders.filter((order) => selectedSet.has(order.id) && !order.isArchived);
    await Promise.all(targets.map((order) => updateOrder({ ...order, isArchived: true })));
    toast(`В архив отправлено: ${targets.length}`, 'success');
    clearSelection();
    setIsSelectionMode(false);
  };

  const deleteSelectedOrders = async () => {
    if (selectedOrderIds.length === 0) return;
    setIsBulkDeleting(true);

    let deletedCount = 0;
    for (const id of selectedOrderIds) {
      const removed = await deleteOrder(id);
      if (removed) deletedCount += 1;
    }

    setIsBulkDeleting(false);
    setDeleteId(null);
    setSelectedOrderIds([]);
    setIsSelectionMode(false);
    toast(`Удалено заказов: ${deletedCount}`, deletedCount > 0 ? 'success' : 'error');
  };

  const activeFiltersCount = brandFilters.length + statusFilters.length + (priorityFilter !== 'all' ? 1 : 0) + (noResponseHours > 0 ? 1 : 0) + (issueFilter !== 'all' ? 1 : 0) + (yearFrom ? 1 : 0) + (yearTo ? 1 : 0);

  return (
    <div className="space-y-4 px-4 pt-4 pb-[calc(6rem+env(safe-area-inset-bottom))] overflow-x-hidden">

      <header className="sticky top-0 z-20 space-y-3 bg-[#f7f8fc] pt-1 pb-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-[30px] leading-[34px] font-black tracking-tight text-slate-900">Заказы</h1>
            <p className="mt-0.5 text-xs text-slate-500">{tabCounts.active} активных · {tabCounts.lead} лидов · {tabCounts.found} найдено</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setIsIncomeOpen(true)} className="h-11 w-11 rounded-xl border border-slate-200 bg-white grid place-items-center" aria-label="Статистика"><BarChart3 size={18} /></button>
            <button type="button" onClick={() => navigate('/database')} className="h-11 w-11 rounded-xl border border-slate-200 bg-white grid place-items-center" aria-label="База поставщиков"><Archive size={16} /></button>
            <button
              type="button"
              onClick={toggleSelectionMode}
              className={`h-11 rounded-xl border px-3 text-xs font-black ${isSelectionMode ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-700'}`}
            >
              {isSelectionMode ? 'Готово' : 'Выбрать'}
            </button>
            <button type="button" disabled={isRefreshing} onClick={() => void refreshOrders()} className="h-11 w-11 rounded-xl border border-slate-200 bg-white grid place-items-center disabled:opacity-50" aria-label="Обновить">
              <Clock3 size={18} className={isRefreshing ? 'animate-spin text-slate-500' : 'text-slate-700'} />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label className="flex h-11 flex-1 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3">
            <Search size={14} className="text-slate-400" />
            <input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Марка, VIN, ID, клиент, заметка" className="w-full bg-transparent text-sm outline-none" />
            {searchText && <button type="button" onClick={() => { setSearchText(''); setDebouncedSearch(''); void refreshOrders(); }} className="text-xs text-slate-500">Очистить</button>}
          </label>
          <button type="button" onClick={() => setIsFilterOpen(true)} className="h-11 rounded-2xl border border-slate-200 bg-white px-3 text-xs font-black inline-flex items-center gap-1"><Filter size={14} />Фильтр{activeFiltersCount > 0 ? ` (${activeFiltersCount})` : ''}</button>
        </div>

        {activeFiltersCount > 0 && (
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
            {priorityFilter !== 'all' && <span className="rounded-xl bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">Приоритет: {priorityFilter}</span>}
            {brandFilters.length > 0 && <span className="rounded-xl bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">Марки: {brandFilters.length}</span>}
            {statusFilters.length > 0 && <span className="rounded-xl bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">Статусы: {statusFilters.length}</span>}
          </div>
        )}

        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
          {([
            ['active', 'Активные'],
            ['vip', 'VIP'],
            ['lead', 'Лиды'],
            ['found', 'Найденные'],
            ['sold', 'Проданные'],
            ['archive', 'Архив']
          ] as [TabType, string][]).map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`whitespace-nowrap rounded-2xl border px-3 py-2 text-[11px] font-black transition ${
                activeTab === tab
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-slate-200 bg-white text-slate-600'
              }`}
            >
              {label} <span className="opacity-80">{tabCounts[tab]}</span>
            </button>
          ))}
        </div>

        {isSelectionMode && (
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
            <button type="button" onClick={selectAllFiltered} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-black text-slate-700">
              Выбрать все ({filteredOrders.length})
            </button>
            <button type="button" onClick={clearSelection} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-black text-slate-700">
              Снять выбор
            </button>
            <span className="rounded-xl bg-blue-50 px-3 py-2 text-[11px] font-black text-blue-700">Выбрано: {selectedOrderIds.length}</span>
          </div>
        )}

      </header>

      <div className="space-y-4">
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
            const isVipOrder = order.isVip;
            const isUnreadLeadOrder = isUnreadPublicLead(order);

            return (
              <SwipeableOrderCard
                key={order.id}
                orderId={order.id}
                openCardId={openSwipeId}
                setOpenCardId={setOpenSwipeId}
                onCommitWhatsapp={() => openWhatsapp(order)}
                onOpenWhatsapp={() => openWhatsapp(order)}
                contactActionLabel={getOrderContactAction(order).label}
                onArchive={() => {
                  order.isArchived ? restoreOrder(order) : archiveOrder(order);
                }}
                onLongPressDelete={() => setDeleteId(order.id)}
                onCardTap={() => {
                  if (isSelectionMode) {
                    toggleOrderSelected(order.id);
                    return;
                  }
                  openOrderPreview(order);
                }}
                disableCardTap={!!deleteId || isDeleting}
                disableSwipe={isSelectionMode}
              >
                <div className={`rounded-2xl p-1 -m-1 ${isVipOrder ? 'bg-amber-50/70 border border-amber-200' : isUnreadLeadOrder ? 'bg-amber-50/60 border border-amber-200/70' : ''}`}>
                  <div className="flex items-start gap-3">
                    {isSelectionMode && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleOrderSelected(order.id);
                        }}
                        className={`mt-1 inline-flex h-7 w-7 items-center justify-center rounded-lg border ${selectedOrderIds.includes(order.id) ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-500'}`}
                        aria-label={selectedOrderIds.includes(order.id) ? 'Снять выбор заказа' : 'Выбрать заказ'}
                      >
                        {selectedOrderIds.includes(order.id) ? <CheckSquare size={14} /> : <Square size={14} />}
                      </button>
                    )}
                    {((order.carPhotos && order.carPhotos[0]) || order.carPhotoUrl) ? (
                      <img src={(order.carPhotos && order.carPhotos[0]) || order.carPhotoUrl} alt={`${order.brand} ${order.model}`} className="h-16 w-16 shrink-0 rounded-2xl object-cover border border-slate-200" />
                    ) : (
                      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-100 text-lg font-black text-slate-400">
                        {order.brand?.[0] || '?'}
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-black text-slate-900">{order.brand} {order.model}</h3>
                          <p className="mt-0.5 truncate text-xs text-slate-500">
                            {order.year || '—'} · {order.vin || contactLabel || 'Без контакта'}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {isVipOrder && <Star size={12} className="shrink-0 text-amber-500 fill-amber-500" />}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void updateOrder({ ...order, isPinned: !order.isPinned });
                            }}
                            className={`inline-flex h-8 w-8 items-center justify-center rounded-xl border ${order.isPinned ? 'border-amber-300 bg-amber-100 text-amber-700' : 'border-slate-200 bg-white text-slate-500'}`}
                            aria-label={order.isPinned ? 'Открепить заказ' : 'Закрепить заказ'}
                          >
                            <Pin size={13} className={order.isPinned ? 'fill-current' : ''} />
                          </button>
                        </div>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-black text-blue-700">{statusLabelMap[status]}</span>
                        {order.priority === Priority.HIGH && <span className="rounded-full bg-rose-50 px-2 py-1 text-[10px] font-black text-rose-600">Срочно</span>}
                        {isUnreadLeadOrder && <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-black text-amber-700">Новый лид</span>}
                        {activeTab === 'lead' && order.searchDepositStatus === 'pending' && (
                          <span className="rounded-full bg-fuchsia-600 px-2 py-1 text-[10px] font-black text-white shadow-sm shadow-fuchsia-500/30">
                            Ожидает оплаты 50 AED
                          </span>
                        )}
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-600 inline-flex items-center gap-1"><Clock3 size={10} /> {ageLabel}</span>
                      </div>

                      <div className="mt-3">
                        <div className="mb-1 flex items-center justify-between text-[10px] font-bold text-slate-500">
                          <span>Найдено деталей</span>
                          <span>{foundParts}/{totalParts || 0} · {progress}%</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-emerald-500 transition-all duration-300" style={{ width: `${progress}%` }} />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
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


            <div className="mt-3 grid grid-cols-2 gap-2">
              <input
                type="number"
                inputMode="numeric"
                value={yearFrom}
                onChange={(e) => setYearFrom(e.target.value.replace(/[^\d]/g, '').slice(0, 4))}
                placeholder="Год от"
                className="h-11 rounded-xl border border-slate-200 px-2 text-sm"
              />
              <input
                type="number"
                inputMode="numeric"
                value={yearTo}
                onChange={(e) => setYearTo(e.target.value.replace(/[^\d]/g, '').slice(0, 4))}
                placeholder="Год до"
                className="h-11 rounded-xl border border-slate-200 px-2 text-sm"
              />
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
                setYearFrom('');
                setYearTo('');
              }} className="h-11 flex-1 rounded-xl border border-slate-200 text-xs font-black uppercase">Сброс</button>
              <button type="button" onClick={() => setIsFilterOpen(false)} className="h-11 flex-1 rounded-xl bg-blue-600 text-xs font-black uppercase text-white">Применить</button>
            </div>
          </div>
        </div>
      )}

            <ConfirmModal isOpen={!!deleteId && deleteId !== '__bulk__'} message={isDeleting ? 'Удаляем…' : 'Вы уверены, что хотите удалить этот заказ?'} onConfirm={confirmDelete} onCancel={() => { if (!isDeleting) setDeleteId(null); }} />
      <ConfirmModal
        isOpen={isSelectionMode && deleteId === '__bulk__'}
        message={isBulkDeleting ? 'Удаляем выбранные заказы…' : `Удалить выбранные заказы (${selectedOrderIds.length})?`}
        onConfirm={deleteSelectedOrders}
        onCancel={() => {
          if (!isBulkDeleting) setDeleteId(null);
        }}
      />
      {isIncomeOpen && <IncomeModal isOpen={isIncomeOpen} onClose={() => setIsIncomeOpen(false)} orders={orders} />}

      {isSelectionMode && (
        <div className="fixed inset-x-3 bottom-[max(70px,calc(env(safe-area-inset-bottom)+58px))] z-40 rounded-2xl border border-slate-200 bg-white/95 p-2 shadow-lg backdrop-blur">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={selectedOrderIds.length === 0}
              onClick={() => void archiveSelectedOrders()}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 text-xs font-black disabled:opacity-50"
            >
              <Archive size={14} /> В архив
            </button>
            <button
              type="button"
              disabled={selectedOrderIds.length === 0 || isBulkDeleting}
              onClick={() => setDeleteId('__bulk__')}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-rose-600 text-xs font-black text-white disabled:opacity-50"
            >
              <Trash2 size={14} /> Удалить
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default OrdersScreen;
