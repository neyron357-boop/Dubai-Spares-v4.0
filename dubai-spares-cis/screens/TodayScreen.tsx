import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Bell, ChevronDown, ChevronRight, ChevronUp, Clock, Mail, MapPin, Play, RefreshCw, Settings, User } from 'lucide-react';
import { useStore } from '../store';
import { Order, Priority } from '../types';
import { loadAppSettings, saveAppSettings } from '../appSettings';
import { toast } from '../feedback';

/* ─────────────────── helpers ─────────────────── */

const MS_HOUR = 60 * 60 * 1000;
const MS_DAY = 24 * MS_HOUR;

const startOfToday = (): number => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const startOfWeek = (): number => {
  return Date.now() - 7 * MS_DAY;
};

const formatCurrentDate = (): string => {
  return new Date().toLocaleDateString('ru-RU', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
  });
};

const formatElapsed = (ms: number): string => {
  const hours = Math.floor(ms / MS_HOUR);
  const minutes = Math.floor((ms % MS_HOUR) / (60 * 1000));
  if (hours > 0) return `${hours}ч ${minutes}м`;
  return `${minutes}м`;
};

const formatDays = (ms: number): string => {
  const days = Math.floor(ms / MS_DAY);
  const hours = Math.floor((ms % MS_DAY) / MS_HOUR);
  if (days > 0) return `${days} д.`;
  return `${hours}ч`;
};

/** Extract the "area" label from a location string like "Area 2", "Dubai", etc. */
const parseArea = (location: string): string => {
  if (!location || location.toLowerCase() === 'online') return 'Online';
  const match = location.match(/area\s*(\d+)/i);
  if (match) return `Area ${match[1]}`;
  if (/dubai/i.test(location)) return 'Dubai';
  if (location.trim()) return location.trim();
  return 'Другое';
};

/** Get the primary area for routing from an order's parts variants */
const getOrderArea = (order: Order): string => {
  for (const part of order.parts) {
    for (const variant of part.variants || []) {
      if (variant.location && variant.location.toLowerCase() !== 'online') {
        return parseArea(variant.location);
      }
    }
  }
  // Fall back to notes or default
  return 'Другое';
};

/** True if this order needs a physical visit (has non-online location or is a field task) */
const needsPhysicalVisit = (order: Order): boolean => {
  // Check if any part variant has a non-online location
  for (const part of order.parts) {
    for (const variant of part.variants || []) {
      if (variant.location && variant.location.toLowerCase() !== 'online') return true;
    }
  }
  // Active orders that haven't been priced yet also need field work
  const s = order.salesStatus;
  return s === 'Inquiry' || s === 'Paid';
};

/** Compute weekly profit (AED) from completed orders in last 7 days */
const computeWeeklyEarnings = (orders: Order[]): number => {
  const since = startOfWeek();
  return orders
    .filter((o) => o.salesStatus === 'Completed' && Number(o.statusChangedAt || o.updatedAt || 0) >= since)
    .reduce((sum, o) => {
      const costAed = o.parts.reduce((acc, part) => {
        const variants = part.variants || [];
        const best = variants.reduce((min, v) => {
          const p = Number(v.priceAed || 0);
          return p > 0 ? (min === 0 ? p : Math.min(min, p)) : min;
        }, 0);
        return acc + best;
      }, 0);
      return sum + costAed * (Number(o.markupPercent) || 0) / 100;
    }, 0);
};

/** Task type label for route block */
const getTaskLabel = (order: Order): string => {
  const carLabel = `${order.brand} ${order.model}`.trim() || 'Авто';
  const firstPart = order.parts[0];
  const partName = firstPart?.name || 'деталь';
  const extra = order.isVip ? ' (VIP)' : '';

  if (order.salesStatus === 'Paid') return `Забрать ${partName} ${carLabel}${extra}`;
  if (order.salesStatus === 'Price Sent' || order.salesStatus === 'Pending Approval') {
    return `Уточнить ${partName} ${carLabel}${extra}`;
  }
  return `Найти ${partName} ${carLabel}${extra}`;
};

/** Pluralize Russian word for "лид" */
const pluralLead = (n: number): string => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return `${n} лидов`;
  if (mod10 === 1) return `${n} лид`;
  if (mod10 >= 2 && mod10 <= 4) return `${n} лида`;
  return `${n} лидов`;
};

/* ─────────────────── types ─────────────────── */

interface RouteZone {
  area: string;
  tasks: Order[];
}

/* ─────────────────── sub-components ─────────────────── */

const ProgressBar: React.FC<{ value: number; max: number }> = ({ value, max }) => {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-2 w-full rounded-full bg-[#2A2A2A] overflow-hidden">
      <div
        className="h-2 rounded-full bg-[#4CAF50] transition-all duration-700"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
};

const UrgentCard: React.FC<{ order: Order; onClick: () => void }> = ({ order, onClick }) => {
  const elapsed = Date.now() - Number(order.statusChangedAt || order.updatedAt || order.createdAt);
  const isOverdue = elapsed > 2 * MS_HOUR;
  const carLabel = `${order.brand} ${order.model}`.trim() || 'Авто';
  const reason = order.isVip ? 'VIP СРОЧНО' : `не отвечает ${formatElapsed(elapsed)}`;

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-xl bg-[#2A1A1A] border border-[#F44336]/40 p-3 space-y-1"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-bold text-white truncate">{carLabel}</span>
        <span className="text-[11px] font-semibold text-[#F44336] shrink-0">● СРОЧНО</span>
      </div>
      <div className="flex items-center gap-1 text-xs text-gray-400">
        <AlertCircle size={12} className="text-[#F44336] shrink-0" />
        <span className={isOverdue ? 'text-[#F44336] font-semibold' : ''}>{reason}</span>
      </div>
    </button>
  );
};

const WaitingCard: React.FC<{ order: Order; onRemind: () => void }> = ({ order, onRemind }) => {
  const elapsed = Date.now() - Number(order.statusChangedAt || order.updatedAt || order.createdAt);
  const carLabel = `${order.brand} ${order.model}`.trim() || 'Авто';
  const statusLabel = order.salesStatus === 'Price Sent' ? 'Ожидание ответа' : 'Уточнение';

  return (
    <div className="rounded-xl bg-[#1E1E1E] border border-[#2A2A2A] p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white truncate">{carLabel}</p>
          <p className="text-xs text-gray-400 mt-0.5">{statusLabel} {formatDays(elapsed)}</p>
        </div>
        <button
          type="button"
          onClick={onRemind}
          className="shrink-0 px-3 py-1.5 rounded-lg bg-[#2196F3]/20 border border-[#2196F3]/40 text-[#2196F3] text-xs font-semibold"
        >
          Напомнить
        </button>
      </div>
    </div>
  );
};

interface RouteTaskRowProps {
  order: Order;
  checked: boolean;
  onCheck: () => void;
  onClick: () => void;
}

const RouteTaskRow: React.FC<RouteTaskRowProps> = ({ order, checked, onCheck, onClick }) => {
  const label = getTaskLabel(order);
  const isVip = order.isVip;

  return (
    <div className="flex items-center gap-3 py-2 px-1">
      <button
        type="button"
        aria-label="Отметить задачу выполненной"
        onClick={onCheck}
        className={`shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${checked ? 'bg-[#4CAF50] border-[#4CAF50]' : 'border-gray-500 bg-transparent'}`}
      >
        {checked && <span className="text-white text-[10px] font-black">✓</span>}
      </button>
      <button
        type="button"
        onClick={onClick}
        className={`flex-1 text-left text-sm ${checked ? 'line-through text-gray-500' : 'text-white'}`}
      >
        {label}
        {isVip && <span className="ml-1.5 text-[10px] font-bold text-[#FFD700] uppercase">VIP</span>}
        {order.priority === Priority.HIGH && !isVip && (
          <span className="ml-1.5 text-[10px] font-bold text-[#F44336] uppercase">СРОЧНО</span>
        )}
      </button>
    </div>
  );
};

interface ZoneSectionProps {
  zone: RouteZone;
  index: number;
  checkedTasks: Set<string>;
  onCheckTask: (orderId: string) => void;
  onOpenOrder: (orderId: string) => void;
  onStartRoute: (area: string) => void;
}

const ZoneSection: React.FC<ZoneSectionProps> = ({ zone, index, checkedTasks, onCheckTask, onOpenOrder, onStartRoute }) => {
  const [expanded, setExpanded] = useState(true);
  const isPrimary = index === 0;
  const label = isPrimary
    ? `Сначала едь в ${zone.area} (${zone.tasks.length} ${zone.tasks.length === 1 ? 'задача' : 'задач'})`
    : `Потом в ${zone.area} (${zone.tasks.length} ${zone.tasks.length === 1 ? 'задача' : 'задач'})`;

  return (
    <div className="rounded-xl bg-[#1E1E1E] border border-[#2A2A2A] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <MapPin size={14} className="text-[#2196F3] shrink-0" />
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex-1 text-left text-sm font-semibold text-white"
        >
          {label}
        </button>
        <button
          type="button"
          onClick={() => onStartRoute(zone.area)}
          className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg bg-[#2196F3]/20 border border-[#2196F3]/40 text-[#2196F3] text-[11px] font-bold"
        >
          <Play size={10} />
          Начать
        </button>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 text-gray-500"
        >
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>
      {expanded && (
        <div className="border-t border-[#2A2A2A] px-3 pb-1 divide-y divide-[#2A2A2A]/50">
          {zone.tasks.map((order) => (
            <RouteTaskRow
              key={order.id}
              order={order}
              checked={checkedTasks.has(order.id)}
              onCheck={() => onCheckTask(order.id)}
              onClick={() => onOpenOrder(order.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/* ─────────────────── Snackbar ─────────────────── */

const SNACKBAR_KEY = 'today_snackbar';

interface SnackbarState {
  orderId: string;
  message: string;
  timer: number;
}

/* ─────────────────── main screen ─────────────────── */

const TODAY_CHECKED_KEY = 'today_checked_tasks_v1';

const loadChecked = (): Set<string> => {
  try {
    const raw = localStorage.getItem(TODAY_CHECKED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as { date: string; ids: string[] };
    const today = new Date().toDateString();
    if (parsed.date !== today) return new Set();
    return new Set(parsed.ids);
  } catch {
    return new Set();
  }
};

const saveChecked = (ids: Set<string>) => {
  try {
    localStorage.setItem(TODAY_CHECKED_KEY, JSON.stringify({
      date: new Date().toDateString(),
      ids: Array.from(ids),
    }));
  } catch {
    // ignore
  }
};

const TodayScreen: React.FC = () => {
  const navigate = useNavigate();
  const { orders } = useStore();
  const [settings, setSettings] = useState(() => loadAppSettings());
  const [checkedTasks, setCheckedTasks] = useState<Set<string>>(loadChecked);
  const [snackbar, setSnackbar] = useState<SnackbarState | null>(null);
  const snackbarTimerRef = useRef<number | null>(null);
  const [showAllUrgent, setShowAllUrgent] = useState(false);
  const [showAllWaiting, setShowAllWaiting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Reload settings on focus
  useEffect(() => {
    const onFocus = () => setSettings(loadAppSettings());
    window.addEventListener('focus', onFocus);
    window.addEventListener('app-settings-updated', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('app-settings-updated', onFocus);
    };
  }, []);

  /* ── derived data ── */

  const activeOrders = useMemo(
    () => orders.filter((o) => !o.isArchived && !o.isSold && !o.isLead),
    [orders],
  );

  const weeklyEarnings = useMemo(() => computeWeeklyEarnings(orders), [orders]);

  // Active task count: non-archived, non-sold, non-lead, non-completed orders
  const activeTasks = useMemo(
    () => activeOrders.filter((o) => o.salesStatus !== 'Completed').length,
    [activeOrders],
  );

  // Completed today = orders changed to Completed today
  const completedTodayCount = useMemo(() => {
    const todayStart = startOfToday();
    return orders.filter(
      (o) => o.salesStatus === 'Completed' && Number(o.statusChangedAt || o.updatedAt || 0) >= todayStart,
    ).length + checkedTasks.size;
  }, [orders, checkedTasks]);

  // Urgent tasks: VIP or HIGH priority + active + either VIP tag or Price Sent >2h
  const urgentOrders = useMemo(() => {
    return activeOrders.filter((o) => {
      if (o.salesStatus === 'Completed') return false;
      if (o.isVip || o.priority === Priority.HIGH) return true;
      if (o.salesStatus === 'Price Sent') {
        const elapsed = Date.now() - Number(o.statusChangedAt || o.createdAt);
        return elapsed > 2 * MS_HOUR;
      }
      return false;
    });
  }, [activeOrders]);

  // Route tasks: active orders needing physical visit, not yet checked
  const routeOrders = useMemo(() => {
    return activeOrders.filter(
      (o) => o.salesStatus !== 'Completed' && needsPhysicalVisit(o) && !checkedTasks.has(o.id),
    );
  }, [activeOrders, checkedTasks]);

  // Group route tasks by area, sorted by count desc
  const routeZones = useMemo((): RouteZone[] => {
    const byArea = new Map<string, Order[]>();
    routeOrders.forEach((o) => {
      const area = getOrderArea(o);
      if (area === 'Online') return;
      const arr = byArea.get(area) || [];
      arr.push(o);
      byArea.set(area, arr);
    });
    return Array.from(byArea.entries())
      .map(([area, tasks]) => ({ area, tasks }))
      .sort((a, b) => b.tasks.length - a.tasks.length);
  }, [routeOrders]);

  // Waiting clients: Price Sent or Pending Approval > 24h
  const waitingOrders = useMemo(() => {
    return activeOrders.filter((o) => {
      if (o.salesStatus !== 'Price Sent' && o.salesStatus !== 'Pending Approval') return false;
      const elapsed = Date.now() - Number(o.statusChangedAt || o.createdAt);
      return elapsed > MS_DAY;
    });
  }, [activeOrders]);

  // Lead orders
  const leadOrders = useMemo(
    () => orders.filter((o) => o.isLead && !o.isArchived),
    [orders],
  );

  /* ── interactions ── */

  const handleCheckTask = useCallback((orderId: string) => {
    const next = new Set(checkedTasks);

    if (next.has(orderId)) {
      next.delete(orderId);
      saveChecked(next);
      setCheckedTasks(next);
      return;
    }

    next.add(orderId);
    saveChecked(next);
    setCheckedTasks(next);

    // Show snackbar with undo
    if (snackbarTimerRef.current !== null) window.clearTimeout(snackbarTimerRef.current);
    setSnackbar({ orderId, message: 'Задача выполнена', timer: 5 });

    snackbarTimerRef.current = window.setTimeout(() => {
      setSnackbar(null);
    }, 5000);
  }, [checkedTasks]);

  const handleUndoCheck = useCallback(() => {
    if (!snackbar) return;
    const next = new Set(checkedTasks);
    next.delete(snackbar.orderId);
    saveChecked(next);
    setCheckedTasks(next);
    setSnackbar(null);
    if (snackbarTimerRef.current !== null) window.clearTimeout(snackbarTimerRef.current);
  }, [snackbar, checkedTasks]);

  const handleRemind = useCallback((order: Order) => {
    const part = order.parts[0];
    const partName = part?.name || 'деталь';
    const phone = order.contactLinks?.phone || order.customerContact || '';
    const msg = encodeURIComponent(
      `Здравствуйте! Напоминаю о вашем запросе на ${partName} (${order.brand} ${order.model}). Жду обратной связи.`,
    );
    const url = phone
      ? `https://wa.me/${phone.replace(/\D/g, '')}?text=${msg}`
      : `https://wa.me/?text=${msg}`;
    window.open(url, '_blank');
    toast(`Напоминание отправлено для ${order.brand} ${order.model}`, 'success');
  }, []);

  const handleStartRoute = useCallback((area: string) => {
    toast(`Маршрут по ${area} начат`, 'info');
  }, []);

  const handlePullRefresh = () => {
    setRefreshKey((k) => k + 1);
    toast('Данные обновлены', 'success');
  };

  const userName = settings.publicManagerName || settings.userName || 'Руслан';
  const weeklyGoal = settings.weeklyGoalAed || 2000;
  const progressPct = weeklyGoal > 0 ? Math.min(100, Math.round((weeklyEarnings / weeklyGoal) * 100)) : 0;

  const displayedUrgent = showAllUrgent ? urgentOrders : urgentOrders.slice(0, 3);
  const displayedWaiting = showAllWaiting ? waitingOrders : waitingOrders.slice(0, 3);

  return (
    <div className="flex flex-col h-[100dvh] bg-[#121212] text-white overflow-hidden">
      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto no-scrollbar">
        <div className="px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-6 space-y-5">

          {/* ── Header ── */}
          <div className="flex items-start justify-between gap-2">
            <div>
              <h1 className="text-[22px] font-black leading-tight">Привет, {userName}! 👋</h1>
              <p className="text-sm text-gray-400 mt-0.5 capitalize">{formatCurrentDate()}</p>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                aria-label="Обновить"
                onClick={handlePullRefresh}
                className="w-9 h-9 rounded-xl bg-[#1E1E1E] flex items-center justify-center text-gray-400"
              >
                <RefreshCw size={16} />
              </button>
              <button
                type="button"
                aria-label="Настройки профиля"
                onClick={() => navigate('/settings')}
                className="w-9 h-9 rounded-xl bg-[#1E1E1E] flex items-center justify-center text-gray-400"
              >
                <User size={18} />
              </button>
            </div>
          </div>

          {/* ── Weekly goal block ── */}
          <div className="rounded-2xl bg-[#1E1E1E] p-4 space-y-3">
            <p className="text-[11px] font-black uppercase tracking-widest text-gray-400">Заработано за неделю</p>
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-black text-[#4CAF50]">{Math.round(weeklyEarnings).toLocaleString('ru-RU')}</span>
              <span className="text-base font-bold text-gray-400">/ {weeklyGoal.toLocaleString('ru-RU')} AED</span>
              <span className="ml-auto text-sm font-bold text-[#4CAF50]">{progressPct}%</span>
            </div>
            <ProgressBar value={weeklyEarnings} max={weeklyGoal} />
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-gray-300">
                План на сегодня:{' '}
                <span className="font-bold text-white">{activeTasks} задач</span>,{' '}
                выполнено{' '}
                <span className="font-bold text-[#4CAF50]">{completedTodayCount}</span>
              </p>
              <button
                type="button"
                onClick={() => {
                  const firstZone = routeZones[0];
                  if (firstZone) {
                    toast(`Маршрут по ${firstZone.area} начат`, 'info');
                  } else {
                    navigate('/orders');
                  }
                }}
                className="shrink-0 w-10 h-10 rounded-full bg-[#F44336] flex items-center justify-center shadow-lg"
                aria-label="Старт"
              >
                <Play size={16} className="text-white ml-0.5" />
              </button>
            </div>
          </div>

          {/* ── Urgent block ── */}
          {urgentOrders.length > 0 && (
            <div className="rounded-2xl bg-[#1E1E1E] p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-base">🚨</span>
                <p className="text-sm font-black text-[#F44336] uppercase tracking-wide">Срочное</p>
              </div>
              <div className="space-y-2">
                {displayedUrgent.map((order) => (
                  <UrgentCard
                    key={order.id}
                    order={order}
                    onClick={() => navigate(`/order/${order.id}`)}
                  />
                ))}
              </div>
              {urgentOrders.length > 3 && (
                <button
                  type="button"
                  onClick={() => setShowAllUrgent((v) => !v)}
                  className="text-xs text-[#2196F3] font-semibold flex items-center gap-1"
                >
                  {showAllUrgent ? 'Скрыть' : `Ещё ${urgentOrders.length - 3}`}
                  {showAllUrgent ? <ChevronUp size={12} /> : <ChevronRight size={12} />}
                </button>
              )}
            </div>
          )}

          {/* ── Route block ── */}
          <div className="rounded-2xl bg-[#1E1E1E] p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-base">🚲</span>
              <p className="text-sm font-black text-white">Маршрут на сегодня</p>
              <span className="ml-auto text-xs font-semibold text-gray-400">
                {routeOrders.length} задач
              </span>
            </div>
            {routeZones.length === 0 ? (
              <div className="py-6 flex flex-col items-center gap-3 text-center">
                <p className="text-sm text-gray-400">
                  На сегодня задач нет. Можно отдохнуть или добавить новые заявки.
                </p>
                <button
                  type="button"
                  onClick={() => navigate('/orders')}
                  className="px-4 py-2 rounded-xl bg-[#2196F3]/20 border border-[#2196F3]/40 text-[#2196F3] text-sm font-semibold"
                >
                  Перейти к заявкам
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {routeZones.map((zone, index) => (
                  <ZoneSection
                    key={zone.area}
                    zone={zone}
                    index={index}
                    checkedTasks={checkedTasks}
                    onCheckTask={handleCheckTask}
                    onOpenOrder={(id) => navigate(`/order/${id}`)}
                    onStartRoute={handleStartRoute}
                  />
                ))}
              </div>
            )}
          </div>

          {/* ── Waiting clients block ── */}
          {waitingOrders.length > 0 && (
            <div className="rounded-2xl bg-[#1E1E1E] p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-base">⏳</span>
                <p className="text-sm font-black text-white">Клиенты в ожидании</p>
                <span className="ml-1 text-xs font-semibold text-gray-400">({waitingOrders.length})</span>
              </div>
              <div className="space-y-2">
                {displayedWaiting.map((order) => (
                  <WaitingCard
                    key={order.id}
                    order={order}
                    onRemind={() => handleRemind(order)}
                  />
                ))}
              </div>
              {waitingOrders.length > 3 && (
                <button
                  type="button"
                  onClick={() => setShowAllWaiting((v) => !v)}
                  className="text-xs text-[#2196F3] font-semibold flex items-center gap-1"
                >
                  {showAllWaiting ? 'Скрыть' : `Ещё ${waitingOrders.length - 3}`}
                  {showAllWaiting ? <ChevronUp size={12} /> : <ChevronRight size={12} />}
                </button>
              )}
            </div>
          )}

          {/* ── New leads block ── */}
          {leadOrders.length > 0 ? (
            <button
              type="button"
              onClick={() => navigate('/orders')}
              className="w-full rounded-2xl bg-[#1E1E1E] border border-[#2196F3]/30 p-4 flex items-center gap-3"
            >
              <span className="text-xl">✉️</span>
              <div className="flex-1 text-left">
                <p className="text-sm font-bold text-white">
                  {pluralLead(leadOrders.length)} новых
                </p>
                <p className="text-xs text-gray-400">Требуют проверки</p>
              </div>
              <ChevronRight size={18} className="text-[#2196F3]" />
            </button>
          ) : (
            <div className="rounded-2xl bg-[#1E1E1E] p-4 flex items-center gap-3 opacity-50">
              <span className="text-xl">✉️</span>
              <p className="text-sm text-gray-400">Новых заявок нет</p>
            </div>
          )}

        </div>
      </div>

      {/* ── Snackbar ── */}
      {snackbar && (
        <div className="fixed bottom-20 left-4 right-4 z-50 flex items-center gap-3 rounded-xl bg-[#333] px-4 py-3 shadow-2xl border border-[#444]">
          <span className="flex-1 text-sm font-semibold text-white">{snackbar.message}</span>
          <button
            type="button"
            onClick={handleUndoCheck}
            className="text-[#2196F3] text-sm font-bold"
          >
            Отмена
          </button>
        </div>
      )}
    </div>
  );
};

export default TodayScreen;

