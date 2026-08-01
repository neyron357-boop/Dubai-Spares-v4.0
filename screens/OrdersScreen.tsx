import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Archive, BarChart3, Bell, Car, CheckCheck, CheckSquare, Clock3, Copy, Filter, LocateFixed, MessageCircle, MoreHorizontal, Pin, Search, Square, Star, Trash2, X } from 'lucide-react';
import { useStore } from '../store';
import { Order, Priority } from '../types';
import IncomeModal from '../components/IncomeModal';
import ConfirmModal from '../components/ConfirmModal';
import { toast, vibrate } from '../feedback';
import { useLeadsPolling } from '../hooks/useLeadsPolling';
import { isLeadOrder, isUnreadLeadOrder } from '../utils/orderClassification';
import { deriveSafetySalesSummary } from '../utils/safetySales';
import { AppNotification, getNotifications, markAllNotificationsRead, markNotificationRead, NotificationType } from '../notificationCenter';
import SafeImage from '../components/SafeImage';

type TabType = 'active' | 'interest' | 'not_found' | 'archive';
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

const safetyRiskStyles: Record<string, string> = {
  safe: 'bg-emerald-50 text-emerald-700',
  caution: 'bg-amber-50 text-amber-700',
  high: 'bg-orange-50 text-orange-700',
  refuse: 'bg-rose-50 text-rose-700'
};
const leadQualityStyles: Record<string, string> = {
  cold: 'bg-slate-100 text-slate-600',
  warm: 'bg-sky-50 text-sky-700',
  hot: 'bg-orange-50 text-orange-700',
  paid: 'bg-emerald-50 text-emerald-700',
  risky: 'bg-rose-50 text-rose-700'
};

const MAIN_TABS: Array<{ id: TabType; label: string }> = [
  { id: 'active', label: 'Актив' },
  { id: 'interest', label: 'Интерес' },
  { id: 'not_found', label: 'Не найдено' },
  { id: 'archive', label: 'Архив' }
];

const moveTabLabels: Record<TabType, string> = {
  active: 'Активные',
  interest: 'Просто интерес',
  not_found: 'Не найдено',
  archive: 'Архив'
};

const isOrderFound = (order: Order) => order.parts.some((part) => part.isFound || (part.variants || []).length > 0);
const foundPartsCount = (order: Order) => order.parts.filter((part) => part.isFound || (part.variants || []).length > 0).length;
const isArchiveBucketOrder = (order: Order) => order.isArchived || order.isSold || order.status === 'archive' || order.status === 'sold';
const getOrderMainTab = (order: Order): TabType => {
  if (isArchiveBucketOrder(order)) return 'archive';
  if (order.status === 'interest') return 'interest';
  if (order.status === 'not_found') return 'not_found';
  if (isLeadOrder(order)) return 'interest';
  return 'active';
};
const isActiveWorkOrder = (order: Order) => getOrderMainTab(order) === 'active';
const isInterestWorkOrder = (order: Order) => getOrderMainTab(order) === 'interest';
const isNotFoundWorkOrder = (order: Order) => getOrderMainTab(order) === 'not_found';

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

const formatNotificationTime = (timestamp: number) => {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return 'только что';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} мин`;
  if (diff < 24 * 3_600_000) return `${Math.floor(diff / 3_600_000)} ч`;
  return new Date(timestamp).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
};

const normalizeNotificationRoute = (route?: string, orderId?: string) => {
  const fallback = orderId ? `/order/${orderId}` : '';
  if (!route?.trim()) return fallback;
  const trimmed = route.trim();
  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const parsed = new URL(trimmed);
      const hashRoute = parsed.hash?.replace(/^#/, '') || '';
      if (hashRoute.startsWith('/')) return hashRoute.replace('/orders/', '/order/');
      return parsed.pathname.replace('/orders/', '/order/') || fallback;
    }
  } catch {
    return fallback;
  }
  if (trimmed.startsWith('#/')) return trimmed.slice(1).replace('/orders/', '/order/');
  if (trimmed.startsWith('/orders/')) return trimmed.replace('/orders/', '/order/');
  return trimmed.startsWith('/') ? trimmed : fallback;
};

const notificationSeverityClass: Record<AppNotification['severity'], string> = {
  critical: 'bg-rose-50 text-rose-600',
  warning: 'bg-amber-50 text-amber-600',
  success: 'bg-emerald-50 text-emerald-600',
  info: 'bg-blue-50 text-blue-600'
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
            { label: 'В архив', action: onArchive, className: 'bg-slate-600/90 text-white', icon: <Archive size={16} /> }
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
  const { orders, isLoading, updateOrder, deleteOrder, bulkDeleteOrders } = useStore();
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
  const [openSwipeId, setOpenSwipeId] = useState<string | null>(null);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>(() => getNotifications());
  const [moveSheetOrderId, setMoveSheetOrderId] = useState<string | null>(null);

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
    const updateUnreadNotifications = () => {
      setNotifications(getNotifications());
    };
    updateUnreadNotifications();
    window.addEventListener('notifications:changed', updateUnreadNotifications);
    window.addEventListener('focus', updateUnreadNotifications);
    document.addEventListener('visibilitychange', updateUnreadNotifications);
    return () => {
      window.removeEventListener('notifications:changed', updateUnreadNotifications);
      window.removeEventListener('focus', updateUnreadNotifications);
      document.removeEventListener('visibilitychange', updateUnreadNotifications);
    };
  }, []);


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

  const archiveOrder = (order: Order) => {
    if (isArchiveBucketOrder(order)) return;
    void updateOrder({ ...order, isArchived: true, status: 'archive', statusChangedAt: Date.now(), statusChangedBy: 'current-user' });
    toast('Заказ в архиве', 'success');
  };

  const restoreOrder = (order: Order) => {
    if (!isArchiveBucketOrder(order)) return;
    void updateOrder({ ...order, isArchived: false, isSold: false, status: 'active', statusChangedAt: Date.now(), statusChangedBy: 'current-user' });
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

  const copyVehicleTitle = async (order: Order) => {
    const title = [order.brand, order.model, order.year].filter(Boolean).join(' ').trim();
    if (!title) return;
    try {
      await navigator.clipboard.writeText(title);
      toast(`Скопировано: ${title}`, 'success');
    } catch {
      toast('Не удалось скопировать авто', 'error');
    }
  };

  const moveOrderToTab = async (order: Order, tab: TabType) => {
    const now = Date.now();
    const keepAsLead = tab === 'interest' && isLeadOrder(order);
    const base = {
      ...order,
      isLead: keepAsLead ? order.isLead : false,
      customerStatus: keepAsLead ? order.customerStatus : (order.customerStatus === 'LEAD' ? 'INQUIRY' : order.customerStatus),
      leadUnread: keepAsLead ? order.leadUnread : false,
      leadReadAt: keepAsLead ? order.leadReadAt : now,
      statusChangedAt: now,
      statusChangedBy: 'current-user'
    };
    const nextOrder: Order = tab === 'archive'
      ? { ...base, isArchived: true, status: 'archive' }
      : {
          ...base,
          isArchived: false,
          isSold: false,
          status: tab === 'interest' ? 'interest' : tab === 'not_found' ? 'not_found' : 'active'
        };

    const ok = await updateOrder(nextOrder);
    if (ok) {
      toast(`Перемещено: ${moveTabLabels[tab]}`, 'success');
      setMoveSheetOrderId(null);
    }
  };

  const allBrands = useMemo(() => Array.from(new Set(orders.map((order) => order.brand))).sort((a, b) => a.localeCompare(b)), [orders]);
  const moveSheetOrder = useMemo(() => orders.find((order) => order.id === moveSheetOrderId) || null, [orders, moveSheetOrderId]);


  const tabCounts = useMemo(() => ({
    active: orders.filter(isActiveWorkOrder).length,
    interest: orders.filter(isInterestWorkOrder).length,
    not_found: orders.filter(isNotFoundWorkOrder).length,
    archive: orders.filter((o) => isArchiveBucketOrder(o) && !isLeadOrder(o)).length
  }), [orders]);

  const openOrderPreview = (order: Order) => {
    if (isUnreadLeadOrder(order)) {
      const viewedLead = { ...order, leadUnread: false, leadReadAt: Date.now() };
      void updateOrder(viewedLead);
    }
    navigate(`/order/${order.id}`);
  };

  const filteredOrders = useMemo(() => {
    let list = orders.filter((order) => {
      if (activeTab === 'archive') return isArchiveBucketOrder(order) && !isLeadOrder(order);
      if (activeTab === 'interest') return isInterestWorkOrder(order);
      if (activeTab === 'not_found') return isNotFoundWorkOrder(order);
      return isActiveWorkOrder(order);
    });

    if (debouncedSearch) {
      list = list.filter((order) => {
        const notesText = (order.notes || []).map((note) => note.text || '').join(' ');
        const suppliersText = (order.parts || []).flatMap((part) => (part.variants || []).map((variant) => variant.shopName || '')).join(' ');
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
    if (activeTab === 'interest') return { title: 'В интересе пока пусто', cta: 'Открыть активные', action: () => setActiveTab('active') };
    if (activeTab === 'not_found') return { title: 'Список "Не найдено" пуст', cta: 'Открыть активные', action: () => setActiveTab('active') };
    return { title: 'Архив пуст', cta: 'Показать активные', action: () => setActiveTab('active') };
  }, [activeTab, navigate]);

  const showSkeleton = isLoading && orders.length === 0;
  const confirmDelete = async () => {
    if (!deleteId || deleteId === '__bulk__') return;
    setIsDeleting(true);
    const ok = await deleteOrder(deleteId);
    if (ok) setDeleteId(null);
    setIsDeleting(false);
  };

  const startSelectionMode = (selectVisible = false) => {
    setIsSelectionMode(true);
    setOpenSwipeId(null);
    setSelectedOrderIds(selectVisible ? filteredOrders.map((order) => order.id) : []);
  };

  const finishSelectionMode = () => {
    setIsSelectionMode(false);
    setOpenSwipeId(null);
    setSelectedOrderIds([]);
  };

  const toggleOrderSelected = (orderId: string) => {
    setSelectedOrderIds((current) => current.includes(orderId) ? current.filter((id) => id !== orderId) : [...current, orderId]);
  };

  const selectAllFiltered = () => {
    setIsSelectionMode(true);
    setSelectedOrderIds(filteredOrders.map((order) => order.id));
  };

  const clearSelection = () => setSelectedOrderIds([]);

  const archiveSelectedOrders = async () => {
    if (selectedOrderIds.length === 0) return;
    const selectedSet = new Set(selectedOrderIds);
    const targets = orders.filter((order) => selectedSet.has(order.id) && !order.isArchived);
    await Promise.all(targets.map((order) => updateOrder({ ...order, isArchived: true, status: 'archive', statusChangedAt: Date.now(), statusChangedBy: 'current-user' })));
    toast(`В архив отправлено: ${targets.length}`, 'success');
    clearSelection();
    setIsSelectionMode(false);
  };

  const deleteSelectedOrders = async () => {
    if (selectedOrderIds.length === 0) return;
    setIsBulkDeleting(true);

    const result = await bulkDeleteOrders(selectedOrderIds);
    const deletedCount = result.deleted;

    setIsBulkDeleting(false);
    setDeleteId(null);
    setSelectedOrderIds([]);
    setIsSelectionMode(false);
    toast(result.failed > 0 ? `Удалено: ${deletedCount}, ошибок: ${result.failed}` : `Удалено заказов: ${deletedCount}`, deletedCount > 0 ? 'success' : 'error');
  };

  const activeFiltersCount = brandFilters.length + statusFilters.length + (priorityFilter !== 'all' ? 1 : 0) + (noResponseHours > 0 ? 1 : 0) + (issueFilter !== 'all' ? 1 : 0) + (yearFrom ? 1 : 0) + (yearTo ? 1 : 0);
  const existingOrderIds = useMemo(() => new Set(orders.map((order) => order.id)), [orders]);
  const notificationPreviewItems = useMemo(
    () => notifications
      .filter((item) => !item.archivedAt && (!item.orderId || existingOrderIds.has(item.orderId)))
      .slice(0, 6),
    [existingOrderIds, notifications]
  );
  const visibleUnreadNotifications = useMemo(
    () => notifications.filter((item) => !item.archivedAt && !item.readAt && (!item.orderId || existingOrderIds.has(item.orderId))).length,
    [existingOrderIds, notifications]
  );

  const iconForNotification = (type: NotificationType) => {
    if ([NotificationType.ORDER_NEW, NotificationType.ORDER_STATUS_CHANGED].includes(type)) return <Car size={15} />;
    if ([NotificationType.RADAR_ACTION, NotificationType.RADAR_RESULT].includes(type)) return <LocateFixed size={15} />;
    if (type === NotificationType.FOLLOWUP_DUE) return <Clock3 size={15} />;
    if ([NotificationType.SYNC_ERROR, NotificationType.OFFLINE_QUEUE].includes(type)) return <AlertTriangle size={15} />;
    return <Bell size={15} />;
  };

  const openNotification = (item: AppNotification) => {
    markNotificationRead(item.id);
    setIsNotificationsOpen(false);
    const route = normalizeNotificationRoute(item.route, item.orderId);
    if (route) navigate(route);
  };

  const markPreviewNotificationsRead = () => {
    if (visibleUnreadNotifications <= 0) return;
    markAllNotificationsRead();
    setNotifications(getNotifications());
  };

  return (
    <div className="space-y-4 px-4 pt-4 pb-[calc(6rem+env(safe-area-inset-bottom))] overflow-x-hidden">

      <header className="sticky top-0 z-20 space-y-3 bg-[#f7f8fc] pt-1 pb-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-[30px] leading-[34px] font-black tracking-tight text-slate-900">Заказы</h1>
            <p className="mt-0.5 text-xs text-slate-500">{tabCounts.active} активных · {tabCounts.interest} интерес · {tabCounts.not_found} не найдено</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setIsIncomeOpen(true)} className="h-11 w-11 rounded-xl border border-slate-200 bg-white grid place-items-center" aria-label="Статистика"><BarChart3 size={18} /></button>
            <button
              type="button"
              onClick={() => {
                setIsNotificationsOpen((current) => !current);
              }}
              className={`relative grid h-11 w-11 shrink-0 place-items-center rounded-xl border bg-white text-slate-700 shadow-sm transition active:scale-[0.98] ${isNotificationsOpen ? 'border-blue-500 ring-4 ring-blue-100' : 'border-slate-200'}`}
              aria-label="Открыть оповещения"
            >
              <Bell size={18} />
              {visibleUnreadNotifications > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[8px] font-black text-white">
                  {visibleUnreadNotifications > 99 ? '99+' : visibleUnreadNotifications}
                </span>
              )}
            </button>
          </div>
        </div>

        {isNotificationsOpen && (
          <div className="fixed inset-0 z-30" onClick={() => setIsNotificationsOpen(false)}>
            <div
              className="absolute left-1/2 top-[76px] w-[min(calc(100vw-2rem),360px)] -translate-x-1/2 overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.18)]"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                <div>
                  <p className="text-[15px] font-black text-slate-950">Уведомления</p>
                  <p className="mt-0.5 text-[11px] font-bold text-slate-500">{visibleUnreadNotifications > 0 ? `${visibleUnreadNotifications} новых` : 'Все прочитано'}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={markPreviewNotificationsRead} disabled={visibleUnreadNotifications === 0} className="grid h-9 w-9 place-items-center rounded-xl bg-blue-50 text-blue-600 disabled:bg-slate-50 disabled:text-slate-300" aria-label="Прочитать все">
                    <CheckCheck size={17} />
                  </button>
                  <button type="button" onClick={() => setIsNotificationsOpen(false)} className="grid h-9 w-9 place-items-center rounded-xl bg-slate-50 text-slate-500" aria-label="Закрыть уведомления">
                    <X size={17} />
                  </button>
                </div>
              </div>

              <div className="max-h-[360px] overflow-y-auto p-2">
                {notificationPreviewItems.length === 0 ? (
                  <div className="grid min-h-[150px] place-items-center rounded-2xl bg-slate-50 px-5 text-center">
                    <div>
                      <Bell size={24} className="mx-auto text-slate-300" />
                      <p className="mt-2 text-sm font-black text-slate-700">Пока нет уведомлений</p>
                      <p className="mt-1 text-xs font-semibold text-slate-400">Новые события появятся здесь.</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {notificationPreviewItems.map((item) => {
                      const canOpen = Boolean(normalizeNotificationRoute(item.route, item.orderId));
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => openNotification(item)}
                          disabled={!canOpen}
                          className="flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition hover:bg-slate-50 active:scale-[0.99] disabled:cursor-default disabled:opacity-80"
                        >
                          <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl ${notificationSeverityClass[item.severity]}`}>
                            {iconForNotification(item.type)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              {!item.readAt && <span className="h-2 w-2 shrink-0 rounded-full bg-blue-600" />}
                              <span className="truncate text-[13px] font-black text-slate-950">{item.title}</span>
                            </span>
                            <span className="mt-0.5 line-clamp-2 text-[11px] font-semibold leading-4 text-slate-500">{item.message}</span>
                            <span className="mt-1 block text-[10px] font-black uppercase tracking-[0.08em] text-slate-400">{formatNotificationTime(item.createdAt)}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <label className="flex h-11 flex-1 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3">
            <Search size={14} className="text-slate-400" />
            <input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Марка, VIN, ID, клиент, заметка" className="h-full w-full bg-transparent text-sm outline-none" />
            {searchText && <button type="button" onClick={() => { setSearchText(''); setDebouncedSearch(''); }} className="h-8 rounded-xl px-2 text-xs text-slate-500">Очистить</button>}
          </label>
          <button type="button" onClick={() => setIsFilterOpen(true)} className="h-11 rounded-2xl border border-slate-200 bg-white px-3 text-xs font-black inline-flex items-center gap-1"><Filter size={14} />Фильтр{activeFiltersCount > 0 ? ` (${activeFiltersCount})` : ''}</button>
          <button
            type="button"
            disabled={filteredOrders.length === 0 && !isSelectionMode}
            onClick={() => {
              setIsNotificationsOpen(false);
              if (isSelectionMode) {
                finishSelectionMode();
                return;
              }
              startSelectionMode(false);
            }}
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border transition active:scale-[0.98] disabled:opacity-35 ${
              isSelectionMode
                ? 'border-blue-200 bg-blue-50 text-blue-600'
                : 'border-slate-200 bg-white text-slate-400'
            }`}
            aria-label={isSelectionMode ? 'Закончить выбор заказов' : 'Выбрать несколько заказов'}
            title={isSelectionMode ? 'Готово' : 'Выбрать'}
          >
            {isSelectionMode ? <X size={16} /> : <CheckSquare size={16} />}
          </button>
        </div>

        {activeFiltersCount > 0 && (
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
            {priorityFilter !== 'all' && <span className="rounded-xl bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">Приоритет: {priorityFilter}</span>}
            {brandFilters.length > 0 && <span className="rounded-xl bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">Марки: {brandFilters.length}</span>}
            {statusFilters.length > 0 && <span className="rounded-xl bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">Статусы: {statusFilters.length}</span>}
          </div>
        )}

        <div className="grid grid-cols-4 gap-1 rounded-2xl border border-slate-200 bg-white p-1">
          {MAIN_TABS.map(({ id: tab, label }) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`min-h-10 rounded-xl px-1.5 py-1 text-[10px] font-black leading-tight transition ${
                activeTab === tab
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <span className="block truncate">{label}</span>
              <span className="block text-[9px] opacity-75">{tabCounts[tab]}</span>
            </button>
          ))}
        </div>

        {isSelectionMode && (
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar rounded-xl bg-slate-100/75 px-1.5 py-1">
            <span className="shrink-0 px-1.5 text-[11px] font-bold text-slate-500">{selectedOrderIds.length} выбрано</span>
            <button type="button" onClick={selectAllFiltered} className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-bold text-slate-600 active:bg-white">
              Все {filteredOrders.length}
            </button>
            <button type="button" onClick={clearSelection} className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-bold text-slate-600 active:bg-white">
              Снять
            </button>
            <button type="button" onClick={finishSelectionMode} className="shrink-0 rounded-lg bg-slate-900 px-2.5 py-1 text-[11px] font-bold text-white active:scale-[0.98]">
              Готово
            </button>
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
            const unreadLead = isUnreadLeadOrder(order);
            const safety = deriveSafetySalesSummary(order);
            const mainTab = getOrderMainTab(order);
            const vehicleTitle = [order.brand, order.model, order.year].filter(Boolean).join(' ').trim();
            const workflowLabel = mainTab === 'interest' || mainTab === 'not_found' ? moveTabLabels[mainTab] : statusLabelMap[status];

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
                  isArchiveBucketOrder(order) ? restoreOrder(order) : archiveOrder(order);
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
                <div className={`rounded-2xl p-1 -m-1 ${isVipOrder ? 'bg-amber-50/70 border border-amber-200' : unreadLead ? 'bg-amber-50/60 border border-amber-200/70' : ''}`}>
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
                      <SafeImage src={(order.carPhotos && order.carPhotos[0]) || order.carPhotoUrl} alt={`${order.brand} ${order.model}`} className="h-16 w-16 shrink-0 rounded-2xl object-cover border border-slate-200" />
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
                              void copyVehicleTitle(order);
                            }}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500"
                            aria-label="Скопировать марку, модель и год"
                            title={vehicleTitle || 'Скопировать авто'}
                          >
                            <Copy size={13} />
                          </button>
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
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setMoveSheetOrderId(order.id);
                            }}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500"
                            aria-label="Переместить заказ"
                            title="Переместить"
                          >
                            <MoreHorizontal size={14} />
                          </button>
                        </div>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-black text-blue-700">{workflowLabel}</span>
                        {order.priority === Priority.HIGH && <span className="rounded-full bg-rose-50 px-2 py-1 text-[10px] font-black text-rose-600">Срочно</span>}
                        {unreadLead && <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-black text-amber-700">Новый лид</span>}
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-600 inline-flex items-center gap-1"><Clock3 size={10} /> {ageLabel}</span>
                        <span className={`rounded-full px-2 py-1 text-[10px] font-black ${leadQualityStyles[safety.leadQuality.level]}`}>{safety.leadQuality.label}</span>
                        <span className={`rounded-full px-2 py-1 text-[10px] font-black ${safetyRiskStyles[safety.dealRisk.level]}`}>{safety.dealRisk.label}</span>
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

      {moveSheetOrder && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-950/35 px-4 py-6" onClick={() => setMoveSheetOrderId(null)}>
          <div
            className="w-full max-w-md rounded-[28px] bg-white p-4 shadow-[0_24px_70px_rgba(15,23,42,0.22)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-200" />
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-base font-black text-slate-950">
                  {[moveSheetOrder.brand, moveSheetOrder.model, moveSheetOrder.year].filter(Boolean).join(' ')}
                </p>
                <p className="mt-1 text-xs font-semibold text-slate-500">Переместить заказ во вкладку</p>
              </div>
              <button type="button" onClick={() => setMoveSheetOrderId(null)} className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-500" aria-label="Закрыть">
                <X size={17} />
              </button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {MAIN_TABS.map((tab) => {
                const isCurrent = getOrderMainTab(moveSheetOrder) === tab.id;
                return (
                  <button
                    key={`move-${tab.id}`}
                    type="button"
                    disabled={isCurrent}
                    onClick={() => void moveOrderToTab(moveSheetOrder, tab.id)}
                    className={`min-h-12 rounded-2xl border px-3 text-sm font-black transition active:scale-[0.99] disabled:opacity-55 ${
                      isCurrent
                        ? 'border-blue-200 bg-blue-50 text-blue-700'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {moveTabLabels[tab.id]}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {isFilterOpen && (
        <div className="fixed inset-0 z-[80] bg-black/35" onClick={() => setIsFilterOpen(false)}>
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

      {isSelectionMode && selectedOrderIds.length > 0 && (
        <div className="fixed bottom-[max(76px,calc(env(safe-area-inset-bottom)+64px))] left-1/2 z-40 -translate-x-1/2 rounded-full border border-slate-200 bg-white/95 p-1.5 shadow-[0_10px_30px_rgba(15,23,42,0.12)] backdrop-blur">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void archiveSelectedOrders()}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-full px-3 text-[11px] font-bold text-slate-600 transition active:bg-slate-100"
            >
              <Archive size={13} /> В архив
            </button>
            <button
              type="button"
              disabled={isBulkDeleting}
              onClick={() => setDeleteId('__bulk__')}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-full bg-rose-50 px-3 text-[11px] font-bold text-rose-600 transition active:bg-rose-100 disabled:opacity-40"
            >
              <Trash2 size={13} /> Удалить
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default OrdersScreen;
