import OrderCard from '../components/OrderCard';
import {
  buildArchivedOrder,
  buildRestoredOrder,
  buildOrderBucketUpdate,
  getOrderBucket,
  isArchivedOrder,
} from '../utils/orderCard';
import { useSessionState } from '../hooks/useSessionState';
import { ModalSurface } from '../components/ui';
import {
  AlertTriangle,
  Archive,
  BarChart3,
  Bell,
  Car,
  CheckCheck,
  CheckSquare,
  Clock3,
  Filter,
  LocateFixed,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ConfirmModal from '../components/ConfirmModal';
import IncomeModal from '../components/IncomeModal';
import { Button, Dialog, EmptyState, SearchField } from '../components/ui';
import { toast } from '../feedback';
import {
  AppNotification,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  NotificationType,
} from '../notificationCenter';
import { useStore } from '../store';
import { Order, Priority } from '../types';
import { isUnreadLeadOrder } from '../utils/orderClassification';

type TabType = 'active' | 'interest' | 'not_found' | 'archive';
type SortType = 'date_desc' | 'date_asc' | 'priority' | 'brand_asc' | 'age';
type SearchState = 'searching' | 'waiting_response' | 'found' | 'offer_sent' | 'sold' | 'archived';

const priorityWeight = { [Priority.HIGH]: 3, [Priority.MEDIUM]: 2, [Priority.LOW]: 1 };

const statusLabelMap: Record<SearchState, string> = {
  searching: 'В поиске',
  waiting_response: 'Ждём ответ',
  found: 'Детали подобраны',
  offer_sent: 'Цена отправлена',
  sold: 'Продано',
  archived: 'Архив',
};

const MAIN_TABS: Array<{ id: TabType; label: string }> = [
  { id: 'active', label: 'Актив' },
  { id: 'interest', label: 'Интерес' },
  { id: 'not_found', label: 'Не найдено' },
  { id: 'archive', label: 'Архив' },
];

const moveTabLabels: Record<TabType, string> = {
  active: 'Активные',
  interest: 'Просто интерес',
  not_found: 'Не найдено',
  archive: 'Архив',
};

const isArchiveBucketOrder = isArchivedOrder;
const getOrderMainTab = getOrderBucket;
const isActiveWorkOrder = (order: Order) => getOrderMainTab(order) === 'active';
const isInterestWorkOrder = (order: Order) => getOrderMainTab(order) === 'interest';
const isNotFoundWorkOrder = (order: Order) => getOrderMainTab(order) === 'not_found';

const getCardSearchStatus = (order: Order): SearchState => {
  if (order.isSold || order.status === 'sold' || order.salesStatus === 'Completed') return 'sold';
  if (isArchivedOrder(order)) return 'archived';
  if (order.salesStatus === 'Price Sent') return 'offer_sent';
  if (order.salesStatus === 'Pending Approval') return 'waiting_response';
  if (
    order.parts.length > 0 &&
    order.parts.every((part) => part.isFound || (part.variants || []).length > 0)
  )
    return 'found';
  return 'searching';
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
  info: 'bg-blue-50 text-blue-600',
};

const OrdersScreen: React.FC = () => {
  const { orders, isLoading, updateOrder, deleteOrder, bulkDeleteOrders } = useStore();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useSessionState<TabType>('orders:activeTab', 'active');
  const [sortBy, setSortBy] = useSessionState<SortType>('orders:sortBy', 'date_desc');
  const [searchText, setSearchText] = useSessionState('orders:searchText', '');
  const [debouncedSearch, setDebouncedSearch] = useState(searchText.trim().toLowerCase());
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isIncomeOpen, setIsIncomeOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const pendingOrderIds = useRef(new Set<string>());
  const [movingOrder, setMovingOrder] = useState(false);
  const [moveError, setMoveError] = useState('');
  const [archivingSelection, setArchivingSelection] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>(() => getNotifications());
  const [moveSheetOrderId, setMoveSheetOrderId] = useState<string | null>(null);

  const [brandFilters, setBrandFilters] = useSessionState<string[]>('orders:brandFilters', []);
  const [priorityFilter, setPriorityFilter] = useSessionState<Priority | 'all'>(
    'orders:priorityFilter',
    'all',
  );
  const [statusFilters, setStatusFilters] = useSessionState<SearchState[]>(
    'orders:statusFilters',
    [],
  );
  const [noResponseHours, setNoResponseHours] = useSessionState<number>(
    'orders:noResponseHours',
    0,
  );
  const [issueFilter, setIssueFilter] = useSessionState<
    'all' | 'missing_price' | 'missing_contact'
  >('orders:issueFilter', 'all');
  const [yearFrom, setYearFrom] = useSessionState('orders:yearFrom', '');
  const [yearTo, setYearTo] = useSessionState('orders:yearTo', '');

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

  const persistCardChange = async (order: Order, nextOrder: Order) => {
    if (pendingOrderIds.current.has(order.id)) return false;
    pendingOrderIds.current.add(order.id);
    try {
      return Boolean(await updateOrder(nextOrder));
    } finally {
      pendingOrderIds.current.delete(order.id);
    }
  };

  const archiveOrder = async (order: Order) => {
    const saved = await persistCardChange(order, buildArchivedOrder(order));
    if (saved) toast('Заказ в архиве', 'success');
    return saved;
  };

  const restoreOrder = async (order: Order) => {
    const saved = await persistCardChange(order, buildRestoredOrder(order));
    if (saved) toast('Заказ восстановлен', 'success');
    return saved;
  };

  const getOrderContactAction = (order: Order) => {
    const source = String(order.source || '').toLowerCase();
    const social = String(order.socialNickname || '').trim();
    if (source.includes('instagram')) {
      if (!social) return { label: 'Instagram', open: false, url: '' };
      const url = social.startsWith('http')
        ? social
        : `https://instagram.com/${social.replace(/^@/, '')}`;
      return { label: 'Instagram', open: true, url };
    }
    if (source.includes('tiktok')) {
      if (!social) return { label: 'TikTok', open: false, url: '' };
      const url = social.startsWith('http')
        ? social
        : `https://www.tiktok.com/@${social.replace(/^@/, '')}`;
      return { label: 'TikTok', open: true, url };
    }
    const phone = (order.customerContact || '').replace(/[^\d+]/g, '');
    if (!phone) return { label: 'WhatsApp', open: false, url: '' };
    const message = `Здравствуйте! Апдейт по заказу ${order.brand} ${order.model}`;
    return {
      label: 'WhatsApp',
      open: true,
      url: `https://wa.me/${phone.replace(/^\+/, '')}?text=${encodeURIComponent(message)}`,
    };
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
    if (!title) return false;
    try {
      await navigator.clipboard.writeText(title);
      toast(`Скопировано: ${title}`, 'success');
      return true;
    } catch {
      toast('Не удалось скопировать авто', 'error');
      return false;
    }
  };

  const moveOrderToTab = async (order: Order, tab: TabType) => {
    if (movingOrder) return;
    setMovingOrder(true);
    setMoveError('');
    try {
      const ok = await persistCardChange(order, buildOrderBucketUpdate(order, tab));
      if (ok) {
        toast(`Перемещено: ${moveTabLabels[tab]}`, 'success');
        setMoveSheetOrderId(null);
      } else setMoveError('Перенос не сохранён. Попробуйте ещё раз.');
    } finally {
      setMovingOrder(false);
    }
  };

  const allBrands = useMemo(
    () =>
      Array.from(new Set(orders.map((order) => order.brand))).sort((a, b) => a.localeCompare(b)),
    [orders],
  );
  const moveSheetOrder = useMemo(
    () => orders.find((order) => order.id === moveSheetOrderId) || null,
    [orders, moveSheetOrderId],
  );

  const tabCounts = useMemo(
    () => ({
      active: orders.filter(isActiveWorkOrder).length,
      interest: orders.filter(isInterestWorkOrder).length,
      not_found: orders.filter(isNotFoundWorkOrder).length,
      archive: orders.filter(isArchiveBucketOrder).length,
    }),
    [orders],
  );

  const openOrderPreview = (order: Order) => {
    if (isUnreadLeadOrder(order)) {
      const viewedLead = { ...order, leadUnread: false, leadReadAt: Date.now() };
      void updateOrder(viewedLead);
    }
    navigate(`/order/${order.id}`);
  };

  const filteredOrders = useMemo(() => {
    let list = orders.filter((order) => {
      if (activeTab === 'archive') return isArchiveBucketOrder(order);
      if (activeTab === 'interest') return isInterestWorkOrder(order);
      if (activeTab === 'not_found') return isNotFoundWorkOrder(order);
      return isActiveWorkOrder(order);
    });

    if (debouncedSearch) {
      list = list.filter((order) => {
        const notesText = (order.notes || []).map((note) => note.text || '').join(' ');
        const suppliersText = (order.parts || [])
          .flatMap((part) => (part.variants || []).map((variant) => variant.shopName || ''))
          .join(' ');
        return `${order.brand} ${order.model} ${order.vin || ''} ${order.id} ${order.clientName || ''} ${order.customerContact || ''} ${notesText} ${suppliersText}`
          .toLowerCase()
          .includes(debouncedSearch);
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
      if (sortBy === 'priority')
        return priorityWeight[b.priority] - priorityWeight[a.priority] || b.createdAt - a.createdAt;
      if (sortBy === 'brand_asc') return a.brand.localeCompare(b.brand);
      if (sortBy === 'age') return (a.updatedAt || a.createdAt) - (b.updatedAt || b.createdAt);
      return b.createdAt - a.createdAt;
    });
  }, [
    orders,
    activeTab,
    debouncedSearch,
    brandFilters,
    priorityFilter,
    statusFilters,
    noResponseHours,
    issueFilter,
    sortBy,
    yearFrom,
    yearTo,
  ]);

  const emptyStateMessage = useMemo(() => {
    if (activeTab === 'active')
      return {
        title: 'Нет активных заказов',
        description: 'Создайте заказ, добавьте детали и соберите предложения поставщиков.',
        cta: 'Создать заказ',
        action: () => navigate('/new'),
      };
    if (activeTab === 'interest')
      return {
        title: 'Пока нет заявок',
        description: 'Здесь будут обращения клиентов, которые ещё не перешли в работу.',
        cta: 'Открыть активные',
        action: () => setActiveTab('active'),
      };
    if (activeTab === 'not_found')
      return {
        title: 'Все детали в поиске или найдены',
        description: 'Заказы, для которых пока не удалось найти детали, появятся здесь.',
        cta: 'Открыть активные',
        action: () => setActiveTab('active'),
      };
    return {
      title: 'Архив пуст',
      description: 'Завершённые и отложенные заказы можно перенести в архив через меню карточки.',
      cta: 'Показать активные',
      action: () => setActiveTab('active'),
    };
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
    setSelectedOrderIds(selectVisible ? filteredOrders.map((order) => order.id) : []);
  };

  const finishSelectionMode = () => {
    if (archivingSelection) return;
    setIsSelectionMode(false);
    setSelectedOrderIds([]);
  };

  const toggleOrderSelected = (orderId: string) => {
    if (archivingSelection) return;
    setSelectedOrderIds((current) =>
      current.includes(orderId) ? current.filter((id) => id !== orderId) : [...current, orderId],
    );
  };

  const selectAllFiltered = () => {
    if (archivingSelection) return;
    setIsSelectionMode(true);
    setSelectedOrderIds(filteredOrders.map((order) => order.id));
  };

  const clearSelection = () => {
    if (!archivingSelection) setSelectedOrderIds([]);
  };

  const archiveSelectedOrders = async () => {
    if (!selectedOrderIds.length || archivingSelection) return;
    const selectedSet = new Set(selectedOrderIds);
    const targets = orders.filter((order) => selectedSet.has(order.id));
    setArchivingSelection(true);
    try {
      const results = await Promise.allSettled(
        targets.map((order) =>
          isArchivedOrder(order)
            ? Promise.resolve(true)
            : persistCardChange(order, buildArchivedOrder(order)),
        ),
      );
      const failed = targets
        .filter((_, index) => {
          const result = results[index];
          return result.status !== 'fulfilled' || !result.value;
        })
        .map((order) => order.id);
      setSelectedOrderIds(failed);
      if (!failed.length) {
        setIsSelectionMode(false);
        toast(`В архив отправлено: ${targets.length}`, 'success');
      } else {
        setIsSelectionMode(true);
        toast(`Не удалось сохранить ${failed.length} заказов. Они остаются выбранными.`, 'error');
      }
    } finally {
      setArchivingSelection(false);
    }
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
    toast(
      result.failed > 0
        ? `Удалено: ${deletedCount}, ошибок: ${result.failed}`
        : `Удалено заказов: ${deletedCount}`,
      deletedCount > 0 ? 'success' : 'error',
    );
  };

  const activeFiltersCount =
    brandFilters.length +
    statusFilters.length +
    (priorityFilter !== 'all' ? 1 : 0) +
    (noResponseHours > 0 ? 1 : 0) +
    (issueFilter !== 'all' ? 1 : 0) +
    (yearFrom ? 1 : 0) +
    (yearTo ? 1 : 0);
  const existingOrderIds = useMemo(() => new Set(orders.map((order) => order.id)), [orders]);
  const notificationPreviewItems = useMemo(
    () =>
      notifications
        .filter((item) => !item.archivedAt && (!item.orderId || existingOrderIds.has(item.orderId)))
        .slice(0, 6),
    [existingOrderIds, notifications],
  );
  const visibleUnreadNotifications = useMemo(
    () =>
      notifications.filter(
        (item) =>
          !item.archivedAt && !item.readAt && (!item.orderId || existingOrderIds.has(item.orderId)),
      ).length,
    [existingOrderIds, notifications],
  );

  const iconForNotification = (type: NotificationType) => {
    if ([NotificationType.ORDER_NEW, NotificationType.ORDER_STATUS_CHANGED].includes(type))
      return <Car size={15} />;
    if ([NotificationType.RADAR_ACTION, NotificationType.RADAR_RESULT].includes(type))
      return <LocateFixed size={15} />;
    if (type === NotificationType.FOLLOWUP_DUE) return <Clock3 size={15} />;
    if ([NotificationType.SYNC_ERROR, NotificationType.OFFLINE_QUEUE].includes(type))
      return <AlertTriangle size={15} />;
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
    <div className="ui-page space-y-5">
      <header className="screen-toolbar space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="ui-eyebrow">Подбор автозапчастей</p>
            <h1 className="text-[32px] leading-tight font-bold tracking-tight text-slate-900">
              Заказы
            </h1>
            <p className="mt-0.5 text-xs text-slate-500">
              {tabCounts.active} активных · {tabCounts.interest} интерес · {tabCounts.not_found} не
              найдено
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button icon={Plus} onClick={() => navigate('/new')} className="hidden sm:inline-flex">
              Новый заказ
            </Button>
            <button
              type="button"
              onClick={() => setIsIncomeOpen(true)}
              className="h-11 w-11 rounded-xl border border-slate-200 bg-white grid place-items-center"
              aria-label="Статистика"
            >
              <BarChart3 size={18} />
            </button>
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
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[11px] font-bold text-white">
                  {visibleUnreadNotifications > 99 ? '99+' : visibleUnreadNotifications}
                </span>
              )}
            </button>
          </div>
        </div>

        {isNotificationsOpen && (
          <ModalSurface
            label="Уведомления"
            onClose={() => setIsNotificationsOpen(false)}
            className=""
          >
            <div
              className="absolute left-1/2 top-[76px] w-[min(calc(100vw-2rem),360px)] -translate-x-1/2 overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.18)]"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                <div>
                  <p className="text-[15px] font-bold text-slate-950">Уведомления</p>
                  <p className="mt-0.5 text-[11px] font-bold text-slate-500">
                    {visibleUnreadNotifications > 0
                      ? `${visibleUnreadNotifications} новых`
                      : 'Все прочитано'}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={markPreviewNotificationsRead}
                    disabled={visibleUnreadNotifications === 0}
                    className="grid h-9 w-9 place-items-center rounded-xl bg-blue-50 text-blue-600 disabled:bg-slate-50 disabled:text-slate-300"
                    aria-label="Прочитать все"
                  >
                    <CheckCheck size={17} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsNotificationsOpen(false)}
                    className="grid h-9 w-9 place-items-center rounded-xl bg-slate-50 text-slate-500"
                    aria-label="Закрыть уведомления"
                  >
                    <X size={17} />
                  </button>
                </div>
              </div>

              <div className="max-h-[360px] overflow-y-auto p-2">
                {notificationPreviewItems.length === 0 ? (
                  <div className="grid min-h-[150px] place-items-center rounded-2xl bg-slate-50 px-5 text-center">
                    <div>
                      <Bell size={24} className="mx-auto text-slate-300" />
                      <p className="mt-2 text-sm font-bold text-slate-700">Пока нет уведомлений</p>
                      <p className="mt-1 text-xs font-semibold text-slate-400">
                        Новые события появятся здесь.
                      </p>
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
                          <span
                            className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl ${notificationSeverityClass[item.severity]}`}
                          >
                            {iconForNotification(item.type)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              {!item.readAt && (
                                <span className="h-2 w-2 shrink-0 rounded-full bg-blue-600" />
                              )}
                              <span className="truncate text-[13px] font-bold text-slate-950">
                                {item.title}
                              </span>
                            </span>
                            <span className="mt-0.5 line-clamp-2 text-[11px] font-semibold leading-4 text-slate-500">
                              {item.message}
                            </span>
                            <span className="mt-1 block text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">
                              {formatNotificationTime(item.createdAt)}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </ModalSurface>
        )}

        <div className="flex items-center gap-2">
          <SearchField
            label="Поиск заказов"
            value={searchText}
            onChange={(value) => {
              setSearchText(value);
              if (!value) setDebouncedSearch('');
            }}
            placeholder="Марка, VIN, ID, клиент, заметка"
            className="flex-1"
          />
          <button
            type="button"
            onClick={() => setIsFilterOpen(true)}
            className="h-11 rounded-2xl border border-slate-200 bg-white px-3 text-xs font-bold inline-flex items-center gap-1"
          >
            <Filter size={14} />
            Фильтр{activeFiltersCount > 0 ? ` (${activeFiltersCount})` : ''}
          </button>
          <button
            type="button"
            disabled={archivingSelection || (filteredOrders.length === 0 && !isSelectionMode)}
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
            {priorityFilter !== 'all' && (
              <span className="rounded-xl bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                Приоритет:{' '}
                {{ HIGH: 'Высокий', MEDIUM: 'Средний', LOW: 'Низкий', all: 'Все' }[priorityFilter]}
              </span>
            )}
            {brandFilters.length > 0 && (
              <span className="rounded-xl bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                Марки: {brandFilters.length}
              </span>
            )}
            {statusFilters.length > 0 && (
              <span className="rounded-xl bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                Статусы: {statusFilters.length}
              </span>
            )}
          </div>
        )}

        <div className="grid grid-cols-4 gap-1 rounded-2xl border border-slate-200 bg-white p-1">
          {MAIN_TABS.map(({ id: tab, label }) => (
            <button
              key={tab}
              aria-pressed={activeTab === tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`min-h-11 rounded-xl px-1.5 py-1 text-[11px] font-bold leading-tight transition ${
                activeTab === tab
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <span className="block truncate">{label}</span>
              <span className="block text-[11px] opacity-75">{tabCounts[tab]}</span>
            </button>
          ))}
        </div>

        {isSelectionMode && (
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar rounded-xl bg-slate-100/75 px-1.5 py-1">
            <span className="shrink-0 px-1.5 text-[11px] font-bold text-slate-500">
              {selectedOrderIds.length} выбрано
            </span>
            <button
              type="button"
              onClick={selectAllFiltered}
              disabled={archivingSelection}
              className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-bold text-slate-600 active:bg-white"
            >
              Все {filteredOrders.length}
            </button>
            <button
              type="button"
              onClick={clearSelection}
              disabled={archivingSelection}
              className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-bold text-slate-600 active:bg-white"
            >
              Снять
            </button>
            <button
              type="button"
              onClick={finishSelectionMode}
              disabled={archivingSelection}
              className="shrink-0 rounded-lg bg-slate-900 px-2.5 py-1 text-[11px] font-bold text-white active:scale-[0.98]"
            >
              Готово
            </button>
          </div>
        )}
      </header>

      <div className={filteredOrders.length ? 'orders-grid' : ''}>
        {showSkeleton ? (
          Array.from({ length: 4 }).map((_, idx) => (
            <div
              key={idx}
              className="rounded-2xl border border-slate-200 bg-white p-4 animate-pulse space-y-2"
            >
              <div className="h-5 w-44 rounded bg-slate-200" />
              <div className="h-4 w-56 rounded bg-slate-100" />
              <div className="h-6 w-24 rounded bg-slate-100" />
              <div className="h-2 w-full rounded bg-slate-100" />
            </div>
          ))
        ) : filteredOrders.length === 0 ? (
          <div className="ui-panel">
            <EmptyState
              icon={Car}
              title={
                searchText || activeFiltersCount ? 'Ничего не найдено' : emptyStateMessage.title
              }
              description={
                searchText || activeFiltersCount
                  ? 'Измените поисковый запрос или сбросьте фильтры, чтобы увидеть заказы.'
                  : emptyStateMessage.description
              }
              action={
                <Button
                  icon={Plus}
                  onClick={
                    searchText || activeFiltersCount
                      ? () => {
                          setSearchText('');
                          setDebouncedSearch('');
                          setBrandFilters([]);
                          setPriorityFilter('all');
                          setStatusFilters([]);
                          setNoResponseHours(0);
                          setIssueFilter('all');
                          setYearFrom('');
                          setYearTo('');
                        }
                      : emptyStateMessage.action
                  }
                >
                  {searchText || activeFiltersCount
                    ? 'Сбросить поиск и фильтры'
                    : emptyStateMessage.cta}
                </Button>
              }
            />
          </div>
        ) : (
          filteredOrders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              selectionMode={isSelectionMode}
              selected={selectedOrderIds.includes(order.id)}
              disabled={!!deleteId || isDeleting || archivingSelection}
              contactLabel={getOrderContactAction(order).label}
              contactAvailable={getOrderContactAction(order).open}
              onActivate={() =>
                isSelectionMode ? toggleOrderSelected(order.id) : openOrderPreview(order)
              }
              onContact={() => openWhatsapp(order)}
              onCopy={() => copyVehicleTitle(order)}
              onTogglePin={() => persistCardChange(order, { ...order, isPinned: !order.isPinned })}
              onArchive={() =>
                isArchiveBucketOrder(order) ? restoreOrder(order) : archiveOrder(order)
              }
              onMove={() => {
                setMoveError('');
                setMoveSheetOrderId(order.id);
              }}
              onDelete={() => setDeleteId(order.id)}
            />
          ))
        )}
      </div>

      {moveSheetOrder && (
        <ModalSurface
          label="Переместить заказ"
          onClose={() => {
            if (!movingOrder) setMoveSheetOrderId(null);
          }}
          className="flex items-center justify-center  px-4 py-6"
        >
          <div
            className="w-full max-w-md rounded-[28px] bg-white p-4 shadow-[0_24px_70px_rgba(15,23,42,0.22)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-200" />
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="break-words text-base font-bold text-slate-950">
                  {[moveSheetOrder.brand, moveSheetOrder.model, moveSheetOrder.year]
                    .filter(Boolean)
                    .join(' ')}
                </p>
                <p className="mt-1 text-xs font-semibold text-slate-500">
                  Переместить заказ во вкладку
                </p>
              </div>
              <button
                type="button"
                disabled={movingOrder}
                onClick={() => setMoveSheetOrderId(null)}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500"
                aria-label="Закрыть"
              >
                <X size={17} />
              </button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {MAIN_TABS.map((tab) => {
                const isCurrent = getOrderMainTab(moveSheetOrder) === tab.id;
                return (
                  <button
                    aria-current={isCurrent ? 'true' : undefined}
                    key={`move-${tab.id}`}
                    type="button"
                    disabled={isCurrent || movingOrder}
                    aria-busy={movingOrder}
                    onClick={() => void moveOrderToTab(moveSheetOrder, tab.id)}
                    className={`min-h-12 rounded-2xl border px-3 text-sm font-bold transition active:scale-[0.99] disabled:opacity-55 ${
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
            {moveError && (
              <p className="order-actions-error" role="alert">
                {moveError}
              </p>
            )}
          </div>
        </ModalSurface>
      )}

      {isFilterOpen && (
        <Dialog title="Фильтры и сортировка" onClose={() => setIsFilterOpen(false)}>
          <div className="mt-3 space-y-2">
            <label className="text-[11px] font-bold uppercase text-slate-500">Сортировка</label>
            <select
              aria-label="Сортировка"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortType)}
              className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm"
            >
              <option value="date_desc">Дата: новые</option>
              <option value="date_asc">Дата: старые</option>
              <option value="priority">Приоритет</option>
              <option value="brand_asc">Марка A–Z</option>
              <option value="age">Срок/давность</option>
            </select>
          </div>

          <div className="mt-3 space-y-2">
            <label className="text-[11px] font-bold uppercase text-slate-500">
              Марка автомобиля
            </label>
            <div className="flex flex-wrap gap-2">
              {allBrands.map((brand) => (
                <button
                  key={brand}
                  type="button"
                  onClick={() =>
                    setBrandFilters((current) =>
                      current.includes(brand)
                        ? current.filter((b) => b !== brand)
                        : [...current, brand],
                    )
                  }
                  className={`rounded-lg border px-2 py-1 text-xs font-bold ${brandFilters.includes(brand) ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600'}`}
                >
                  {brand}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <select
              aria-label="Приоритет"
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value as Priority | 'all')}
              className="h-11 rounded-xl border border-slate-200 px-2 text-sm"
            >
              <option value="all">Любой приоритет</option>
              <option value={Priority.HIGH}>High</option>
              <option value={Priority.MEDIUM}>Medium</option>
              <option value={Priority.LOW}>Low</option>
            </select>
            <select
              aria-label="Время без ответа"
              value={noResponseHours}
              onChange={(e) => setNoResponseHours(Number(e.target.value))}
              className="h-11 rounded-xl border border-slate-200 px-2 text-sm"
            >
              <option value={0}>Без ответа: все</option>
              <option value={3}>{'>'} 3ч</option>
              <option value={6}>{'>'} 6ч</option>
              <option value={12}>{'>'} 12ч</option>
              <option value={24}>{'>'} 24ч</option>
            </select>
          </div>

          <div className="mt-2">
            <select
              aria-label="Проблемы заказа"
              value={issueFilter}
              onChange={(e) => setIssueFilter(e.target.value as typeof issueFilter)}
              className="h-11 w-full rounded-xl border border-slate-200 px-2 text-sm"
            >
              <option value="all">Ошибки: все</option>
              <option value="missing_price">Без цены</option>
              <option value="missing_contact">Без контакта</option>
            </select>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <input
              aria-label="Год от"
              type="number"
              inputMode="numeric"
              value={yearFrom}
              onChange={(e) => setYearFrom(e.target.value.replace(/[^\d]/g, '').slice(0, 4))}
              placeholder="Год от"
              className="h-11 rounded-xl border border-slate-200 px-2 text-sm"
            />
            <input
              aria-label="Год до"
              type="number"
              inputMode="numeric"
              value={yearTo}
              onChange={(e) => setYearTo(e.target.value.replace(/[^\d]/g, '').slice(0, 4))}
              placeholder="Год до"
              className="h-11 rounded-xl border border-slate-200 px-2 text-sm"
            />
          </div>

          <div className="mt-3">
            <label className="text-[11px] font-bold uppercase text-slate-500">Статус поиска</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {(Object.keys(statusLabelMap) as SearchState[]).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() =>
                    setStatusFilters((current) =>
                      current.includes(status)
                        ? current.filter((item) => item !== status)
                        : [...current, status],
                    )
                  }
                  className={`rounded-lg border px-2 py-1 text-xs font-bold ${statusFilters.includes(status) ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600'}`}
                >
                  {statusLabelMap[status]}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setSortBy('date_desc');
                setBrandFilters([]);
                setPriorityFilter('all');
                setStatusFilters([]);
                setNoResponseHours(0);
                setIssueFilter('all');
                setYearFrom('');
                setYearTo('');
              }}
              className="h-11 flex-1 rounded-xl border border-slate-200 text-xs font-bold uppercase"
            >
              Сброс
            </button>
            <button
              type="button"
              onClick={() => setIsFilterOpen(false)}
              className="h-11 flex-1 rounded-xl bg-blue-600 text-xs font-bold uppercase text-white"
            >
              Применить
            </button>
          </div>
        </Dialog>
      )}

      <ConfirmModal
        isOpen={!!deleteId && deleteId !== '__bulk__'}
        message={isDeleting ? 'Удаляем…' : 'Вы уверены, что хотите удалить этот заказ?'}
        onConfirm={confirmDelete}
        onCancel={() => {
          if (!isDeleting) setDeleteId(null);
        }}
      />
      <ConfirmModal
        isOpen={isSelectionMode && deleteId === '__bulk__'}
        message={
          isBulkDeleting
            ? 'Удаляем выбранные заказы…'
            : `Удалить выбранные заказы (${selectedOrderIds.length})?`
        }
        onConfirm={deleteSelectedOrders}
        onCancel={() => {
          if (!isBulkDeleting) setDeleteId(null);
        }}
      />
      {isIncomeOpen && (
        <IncomeModal isOpen={isIncomeOpen} onClose={() => setIsIncomeOpen(false)} orders={orders} />
      )}

      {isSelectionMode && selectedOrderIds.length > 0 && (
        <div className="fixed bottom-[max(76px,calc(env(safe-area-inset-bottom)+64px))] left-1/2 z-40 -translate-x-1/2 rounded-full border border-slate-200 bg-white/95 p-1.5 shadow-[0_10px_30px_rgba(15,23,42,0.12)] backdrop-blur">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={archivingSelection || isBulkDeleting}
              aria-busy={archivingSelection}
              onClick={() => void archiveSelectedOrders()}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-full px-3 text-[11px] font-bold text-slate-600 transition active:bg-slate-100"
            >
              <Archive size={13} /> В архив
            </button>
            <button
              type="button"
              disabled={isBulkDeleting || archivingSelection}
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
