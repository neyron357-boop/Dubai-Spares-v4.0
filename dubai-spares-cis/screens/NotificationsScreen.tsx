import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, ChevronRight, Clock3, AlertTriangle, Car, LocateFixed, Phone, Search, Archive, ArchiveRestore, RefreshCw, Copy, MessageCircle, ExternalLink, Undo2 } from 'lucide-react';
import {
  AppNotification,
  NotificationType,
  archiveNotification,
  completeFollowupNotification,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  restoreFromArchive,
  restoreNotificationReadState,
  snoozeNotification,
  clearAllNotifications
} from '../notificationCenter';

const FILTERS: Array<{ label: string; id: 'all' | 'orders' | 'radar' | 'followup' | 'system' | 'sync' }> = [
  { label: 'Все', id: 'all' },
  { label: 'Заказы', id: 'orders' },
  { label: 'Радар', id: 'radar' },
  { label: 'Follow-up', id: 'followup' },
  { label: 'Система', id: 'system' },
  { label: 'Ошибки/Синк', id: 'sync' }
];

const PAGE_SIZE = 60;

const normalizeNotificationRoute = (route?: string, orderId?: string) => {
  const fallback = orderId ? `/order/${orderId}` : '/';
  if (!route) return fallback;

  const trimmed = route.trim();
  if (!trimmed) return fallback;

  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const parsed = new URL(trimmed);
      const hashRoute = parsed.hash?.replace(/^#/, '') || '';
      if (hashRoute.startsWith('/')) return hashRoute.replace('/orders/', '/order/');
      return parsed.pathname.replace('/orders/', '/order/') || fallback;
    }
  } catch {
    // noop
  }

  if (trimmed.startsWith('#/')) return trimmed.slice(1).replace('/orders/', '/order/');
  if (trimmed.startsWith('/orders/')) return trimmed.replace('/orders/', '/order/');
  return trimmed.startsWith('/') ? trimmed : fallback;
};

const NotificationsScreen: React.FC = () => {
  const [notifications, setNotifications] = useState<AppNotification[]>(() => getNotifications());
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all');
  const [sort, setSort] = useState<'new' | 'severity'>('new');
  const [period, setPeriod] = useState<'all' | 'today' | 'yesterday' | 'week'>('all');
  const [tab, setTab] = useState<'active' | 'archive'>('active');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [undoVisible, setUndoVisible] = useState(false);
  const [undoSnapshot, setUndoSnapshot] = useState<Array<{ id: string; readAt?: number }>>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullStart, setPullStart] = useState<number | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    const update = () => setNotifications(getNotifications());
    window.addEventListener('notifications:changed', update);
    return () => window.removeEventListener('notifications:changed', update);
  }, []);

  useEffect(() => {
    const hasUnread = notifications.some((item) => !item.readAt);
    if (!hasUnread) return;
    markAllNotificationsRead();
  }, [notifications]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const unreadCount = useMemo(() => notifications.filter((item) => !item.readAt && !item.archivedAt).length, [notifications]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const yesterdayStart = todayStart.getTime() - 24 * 60 * 60 * 1000;

    const byTab = notifications.filter((item) => tab === 'archive' ? Boolean(item.archivedAt) : !item.archivedAt);
    const byFilter = byTab.filter((item) => {
      if (filter === 'all') return true;
      if (filter === 'orders') return [NotificationType.ORDER_NEW, NotificationType.ORDER_STATUS_CHANGED].includes(item.type);
      if (filter === 'radar') return [NotificationType.RADAR_RESULT, NotificationType.RADAR_ACTION].includes(item.type);
      if (filter === 'followup') return item.type === NotificationType.FOLLOWUP_DUE;
      if (filter === 'system') return item.type === NotificationType.SYSTEM_TIPS;
      return [NotificationType.SYNC_ERROR, NotificationType.OFFLINE_QUEUE].includes(item.type);
    });
    const byPeriod = byFilter.filter((item) => {
      if (period === 'all') return true;
      if (period === 'today') return item.createdAt >= todayStart.getTime();
      if (period === 'yesterday') return item.createdAt >= yesterdayStart && item.createdAt < todayStart.getTime();
      return item.createdAt >= (now - 7 * 24 * 60 * 60 * 1000);
    });
    const bySearch = debouncedQuery
      ? byPeriod.filter((item) => {
        const haystack = [
          item.title,
          item.message,
          item.phone,
          item.brand,
          item.carModel,
          item.orderId,
          item.supplierId
        ].join(' ').toLowerCase();
        return haystack.includes(debouncedQuery);
      })
      : byPeriod;

    const severityWeight: Record<AppNotification['severity'], number> = { critical: 4, warning: 3, success: 2, info: 1 };
    const sorted = [...bySearch].sort((a, b) => {
      if (sort === 'severity') {
        const diff = severityWeight[b.severity] - severityWeight[a.severity];
        if (diff !== 0) return diff;
      }
      return b.createdAt - a.createdAt;
    });
    return sorted;
  }, [notifications, tab, filter, period, debouncedQuery, sort]);

  const visibleItems = filtered.slice(0, visibleCount);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [filter, sort, period, debouncedQuery, tab]);

  const relativeTime = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    if (diff < 60_000) return 'только что';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} мин назад`;
    if (diff < 24 * 3_600_000) return `${Math.floor(diff / 3_600_000)} ч назад`;
    const date = new Date(timestamp);
    return date.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  const severityTone: Record<AppNotification['severity'], string> = {
    critical: 'border-rose-300 bg-rose-50 text-rose-700',
    warning: 'border-amber-300 bg-amber-50 text-amber-700',
    success: 'border-emerald-300 bg-emerald-50 text-emerald-700',
    info: 'border-sky-300 bg-sky-50 text-sky-700'
  };

  const iconForType = (type: NotificationType) => {
    if ([NotificationType.ORDER_NEW, NotificationType.ORDER_STATUS_CHANGED].includes(type)) return <Car size={14} />;
    if ([NotificationType.RADAR_ACTION, NotificationType.RADAR_RESULT].includes(type)) return <LocateFixed size={14} />;
    if (type === NotificationType.FOLLOWUP_DUE) return <Clock3 size={14} />;
    if ([NotificationType.SYNC_ERROR, NotificationType.OFFLINE_QUEUE].includes(type)) return <AlertTriangle size={14} />;
    return <Bell size={14} />;
  };

  const handleMarkAllRead = () => {
    if (unreadCount <= 0) return;
    const shouldProceed = window.confirm(`Отметить прочитанными ${unreadCount} уведомлений?`);
    if (!shouldProceed) return;
    setUndoSnapshot(notifications.map((item) => ({ id: item.id, readAt: item.readAt })));
    markAllNotificationsRead();
    setUndoVisible(true);
    window.setTimeout(() => setUndoVisible(false), 5000);
  };

  const refresh = async () => {
    setIsRefreshing(true);
    setNotifications(getNotifications());
    await new Promise((resolve) => window.setTimeout(resolve, 220));
    setIsRefreshing(false);
  };

  const onTouchStart = (event: React.TouchEvent) => {
    if (window.scrollY > 0) return;
    setPullStart(event.touches[0]?.clientY || null);
  };

  const onTouchMove = (event: React.TouchEvent) => {
    if (pullStart === null) return;
    const distance = Math.max(0, (event.touches[0]?.clientY || 0) - pullStart);
    setPullDistance(Math.min(distance, 100));
  };

  const onTouchEnd = async () => {
    if (pullDistance > 70) await refresh();
    setPullStart(null);
    setPullDistance(0);
  };

  return (
    <div className="p-4 space-y-3 pb-24 overflow-x-hidden bg-gray-50 min-h-full" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-black text-gray-900">Уведомления</h1>
        <button type="button" onClick={refresh} className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-[11px] font-black uppercase text-gray-600">
          <RefreshCw size={13} className={isRefreshing ? 'animate-spin' : ''} /> Обновить
        </button>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white p-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="rounded-lg bg-blue-50 px-3 py-2 text-[11px] font-bold text-blue-700">Непрочитанных: {unreadCount}</div>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={handleMarkAllRead} className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-[11px] font-black uppercase text-gray-600 disabled:opacity-50" disabled={unreadCount <= 0}>
              <CheckCheck size={14} /> Прочитано
            </button>
            <button type="button" onClick={() => clearAllNotifications(tab)} className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-black uppercase text-rose-700">
              Стереть все
            </button>
          </div>
        </div>

        <div className="flex rounded-xl bg-gray-100 p-1 text-[11px] font-black uppercase">
          <button type="button" onClick={() => setTab('active')} className={`flex-1 rounded-lg py-2 ${tab === 'active' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>Активные</button>
          <button type="button" onClick={() => setTab('archive')} className={`flex-1 rounded-lg py-2 ${tab === 'archive' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>Архив</button>
        </div>

        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск: phone, бренд, orderId" className="h-10 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-xs font-medium outline-none focus:border-blue-300" />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {FILTERS.map((chip) => (
            <button key={chip.id} type="button" onClick={() => setFilter(chip.id)} className={`shrink-0 rounded-full border px-3 py-1.5 text-[10px] font-black uppercase ${filter === chip.id ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-200 bg-white text-gray-500'}`}>
              {chip.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <select value={sort} onChange={(event) => setSort(event.target.value as 'new' | 'severity')} className="h-9 rounded-lg border border-gray-200 bg-white px-2 text-[11px] font-bold">
            <option value="new">Новые сверху</option>
            <option value="severity">Важные сверху</option>
          </select>
          <select value={period} onChange={(event) => setPeriod(event.target.value as typeof period)} className="h-9 rounded-lg border border-gray-200 bg-white px-2 text-[11px] font-bold">
            <option value="all">Все даты</option>
            <option value="today">Только сегодня</option>
            <option value="yesterday">Вчера</option>
            <option value="week">Неделя</option>
          </select>
        </div>
      </div>

      {pullDistance > 0 && <div className="text-center text-[10px] font-black uppercase text-blue-500">Pull-to-refresh {Math.round(pullDistance)}px</div>}

      {undoVisible && (
        <div className="sticky top-2 z-20 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-800 flex items-center justify-between">
          Отмечено как прочитано
          <button
            type="button"
            onClick={() => {
              restoreNotificationReadState(undoSnapshot);
              setUndoVisible(false);
            }}
            className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-2 py-1 text-[10px] font-black uppercase"
          >
            <Undo2 size={12} /> Undo
          </button>
        </div>
      )}

      {visibleItems.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 bg-white py-16 text-center text-xs font-black uppercase tracking-widest text-gray-300">
          Пока пусто
        </div>
      ) : (
        <div className="space-y-2">
          {visibleItems.map((item) => (
            <article
              key={item.id}
              onClick={() => {
                if (!item.orderId && !item.route) return;
                markNotificationRead(item.id);
                navigate(normalizeNotificationRoute(item.route, item.orderId));
              }}
              className={`w-full rounded-2xl border px-3 py-3 text-left transition-all ${item.readAt ? 'bg-white border-gray-100' : 'bg-indigo-50 border-indigo-100'} ${(item.orderId || item.route) ? 'cursor-pointer active:scale-[0.995]' : ''}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-black uppercase ${severityTone[item.severity]}`}>{iconForType(item.type)} {item.type.replace('_', ' ')}</span>
                    <p className="text-[10px] font-black uppercase text-gray-400">{relativeTime(item.createdAt)}</p>
                  </div>
                  <p className="mt-1 text-sm font-black text-gray-900 truncate">{item.title}</p>
                  <p className="mt-1 text-xs text-gray-600 leading-relaxed line-clamp-2">{item.message}</p>
                  <p className="mt-1 text-[10px] text-gray-500">{[item.source, item.brand, item.distanceM ? `${Math.round(item.distanceM)}м` : null].filter(Boolean).join(' · ')}</p>
                </div>
                <div className="flex items-center gap-1 text-gray-300 shrink-0">
                  {!item.readAt && <Bell size={14} className="text-indigo-500" />}
                  <ChevronRight size={16} />
                </div>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2" onClick={(event) => event.stopPropagation()}>
                {(item.orderId || item.route) && (
                  <button type="button" onClick={(event) => { event.stopPropagation(); markNotificationRead(item.id); navigate(normalizeNotificationRoute(item.route, item.orderId)); }} className="inline-flex h-8 items-center justify-center gap-1 rounded-lg bg-blue-600 px-2 text-[10px] font-black uppercase text-white">
                    <ExternalLink size={12} /> Открыть
                  </button>
                )}
                {item.phone && (
                  <>
                    <button type="button" onClick={() => window.open(`https://wa.me/${item.phone.replace(/\D/g, '')}`, '_blank')} className="inline-flex h-8 items-center justify-center gap-1 rounded-lg bg-emerald-50 px-2 text-[10px] font-black uppercase text-emerald-700">
                      <MessageCircle size={12} /> WhatsApp
                    </button>
                    <button type="button" onClick={() => window.open(`tel:${item.phone}`, '_self')} className="inline-flex h-8 items-center justify-center gap-1 rounded-lg bg-slate-100 px-2 text-[10px] font-black uppercase text-slate-700">
                      <Phone size={12} /> Call
                    </button>
                    <button type="button" onClick={() => navigator.clipboard?.writeText(item.phone || '')} className="inline-flex h-8 items-center justify-center gap-1 rounded-lg bg-gray-100 px-2 text-[10px] font-black uppercase text-gray-700">
                      <Copy size={12} /> Номер
                    </button>
                  </>
                )}
                {(item.mapUrl || (item.lat && item.lng)) && (
                  <button
                    type="button"
                    onClick={() => {
                      if (item.lat && item.lng) {
                        const link = `https://www.google.com/maps/dir/?api=1&destination=${item.lat},${item.lng}`;
                        window.open(link, '_blank');
                        return;
                      }
                      if (item.mapUrl) window.open(item.mapUrl, '_blank');
                    }}
                    className="inline-flex h-8 items-center justify-center gap-1 rounded-lg bg-indigo-50 px-2 text-[10px] font-black uppercase text-indigo-700"
                  >
                    <LocateFixed size={12} /> Карта
                  </button>
                )}

                {item.type === NotificationType.FOLLOWUP_DUE && (
                  <>
                    <button type="button" onClick={() => snoozeNotification(item.id, Date.now() + 15 * 60_000)} className="inline-flex h-8 items-center justify-center rounded-lg bg-amber-50 px-2 text-[10px] font-black uppercase text-amber-700">+15м</button>
                    <button type="button" onClick={() => snoozeNotification(item.id, Date.now() + 60 * 60_000)} className="inline-flex h-8 items-center justify-center rounded-lg bg-amber-50 px-2 text-[10px] font-black uppercase text-amber-700">+1ч</button>
                    <button type="button" onClick={() => snoozeNotification(item.id, (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); return d.getTime(); })())} className="inline-flex h-8 items-center justify-center rounded-lg bg-amber-50 px-2 text-[10px] font-black uppercase text-amber-700">Завтра</button>
                    <button type="button" onClick={() => completeFollowupNotification(item.id)} className="inline-flex h-8 items-center justify-center rounded-lg bg-emerald-100 px-2 text-[10px] font-black uppercase text-emerald-700">Готово</button>
                  </>
                )}

                <button type="button" onClick={() => (tab === 'archive' ? restoreFromArchive(item.id) : archiveNotification(item.id))} className="inline-flex h-8 items-center justify-center gap-1 rounded-lg bg-gray-100 px-2 text-[10px] font-black uppercase text-gray-700">
                  {tab === 'archive' ? <ArchiveRestore size={12} /> : <Archive size={12} />} {tab === 'archive' ? 'В активные' : 'Архив'}
                </button>
              </div>
            </article>
          ))}

          {visibleCount < filtered.length && (
            <button type="button" onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-xs font-black uppercase text-gray-600">
              Показать ещё ({filtered.length - visibleCount})
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default NotificationsScreen;
