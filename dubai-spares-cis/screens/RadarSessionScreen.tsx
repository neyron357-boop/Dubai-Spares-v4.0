import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useStore } from '../store';
import { fetchRadarShops } from '../radarShops';
import {
  closeRadarSession,
  ensureRadarTargetItems,
  getRadarEvents,
  getOrderItemsByOrder,
  getRadarSession,
  getRadarTargetItems,
  getRadarTargets,
  OrderItemRow,
  regenerateRadarTargets,
  RadarTargetRow,
  RadarTargetItemRow
} from '../radarSessionService';
import { createUuid } from '../id';
import { enqueueRadarSyncEvent, startRadarSyncQueue } from '../radarSyncQueue';
import RadarCard from '../components/RadarCard';
import QuickActionsBar from '../components/QuickActionsBar';
import { toast, vibrate } from '../feedback';

const RadarSessionScreen: React.FC = () => {
  const { sessionId = '' } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { suppliers, orders } = useStore();
  const [session, setSession] = useState<any>(null);
  const [targets, setTargets] = useState<RadarTargetRow[]>([]);
  const [shopsMap, setShopsMap] = useState<Record<string, any>>({});
  const [events, setEvents] = useState<any[]>([]);
  const [orderItems, setOrderItems] = useState<OrderItemRow[]>([]);
  const [targetItems, setTargetItems] = useState<RadarTargetItemRow[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [highlightedTargetId, setHighlightedTargetId] = useState<string | null>(null);
  const [undoAction, setUndoAction] = useState<{ label: string; run: () => Promise<void> } | null>(null);
  const undoTimerRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    if (!sessionId) return;
    setIsLoading(true);
    try {
      const [sessionRow, targetRows, shops, eventRows] = await Promise.all([
        getRadarSession(sessionId),
        getRadarTargets(sessionId),
        fetchRadarShops(suppliers),
        getRadarEvents(sessionId)
      ]);

      const orderRows = sessionRow?.order_id ? await getOrderItemsByOrder(sessionRow.order_id) : [];
      await ensureRadarTargetItems(targetRows, orderRows);
      const targetItemRows = await getRadarTargetItems(targetRows.map((target) => target.id));

      setSession(sessionRow);
      setTargets(targetRows);
      setOrderItems(orderRows);
      setTargetItems(targetItemRows);
      setShopsMap(shops.reduce<Record<string, any>>((acc, shop) => {
        acc[shop.id] = shop;
        return acc;
      }, {}));
      setEvents(eventRows);
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, suppliers]);

  useEffect(() => {
    startRadarSyncQueue();
    void load();
  }, [load]);

  const queueUndo = (label: string, run: () => Promise<void>) => {
    setUndoAction({ label, run });
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
    undoTimerRef.current = window.setTimeout(() => setUndoAction(null), 10_000);
  };

  const changeStatus = async (target: RadarTargetRow, next: 'in_route' | 'at_shop' | 'done') => {
    const previous = target.status;
    const geoPayload = next === 'at_shop' && navigator.geolocation
      ? await new Promise<Record<string, unknown>>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
            () => resolve({}),
            { timeout: 2000 }
          );
        })
      : {};

    const apply = async (status: 'planned' | 'in_route' | 'at_shop' | 'done') => {
      await enqueueRadarSyncEvent({
        radar_session_id: sessionId,
        event_type: 'status_change',
        client_event_id: createUuid(),
        target_id: target.id,
        shop_id: target.shop_id,
        status,
        payload: {
          from: target.status,
          to: status,
          at: new Date().toISOString(),
          ...geoPayload
        }
      });
      await load();
    };

    await apply(next);
    toast(`${next === 'done' ? 'Done ✅' : 'Saved 💾'}`, 'success');
    vibrate(40);
    if (next === 'done') queueUndo('Done', () => apply(previous));
  };

  const openTel = async (target: RadarTargetRow) => {
    const phone = shopsMap[target.shop_id]?.phone;
    if (!phone) return;
    window.open(`tel:${phone}`, '_blank');
    await enqueueRadarSyncEvent({ radar_session_id: sessionId, event_type: 'call', client_event_id: createUuid(), target_id: target.id, shop_id: target.shop_id, payload: { targetId: target.id, shopId: target.shop_id } });
    await load();
  };

  const openWa = async (target: RadarTargetRow) => {
    const phone = (shopsMap[target.shop_id]?.phone || '').replace(/[^\d]/g, '');
    if (!phone) return;
    window.open(`https://wa.me/${phone}`, '_blank');
    await enqueueRadarSyncEvent({ radar_session_id: sessionId, event_type: 'whatsapp', client_event_id: createUuid(), target_id: target.id, shop_id: target.shop_id, payload: { targetId: target.id, shopId: target.shop_id } });
    await load();
  };

  const handleCloseSession = async () => {
    await closeRadarSession(sessionId);
    await load();
  };

  const handleRecalculateTargets = async () => {
    if (!sessionId || isRecalculating) return;
    setIsRecalculating(true);
    try {
      await regenerateRadarTargets(sessionId, 30);
      await load();
    } finally {
      setIsRecalculating(false);
    }
  };

  const sortedTargets = useMemo(() => targets, [targets]);

  const targetItemsByTargetId = useMemo(() => targetItems.reduce<Record<string, RadarTargetItemRow[]>>((acc, row) => {
    if (!acc[row.radar_target_id]) acc[row.radar_target_id] = [];
    acc[row.radar_target_id].push(row);
    return acc;
  }, {}), [targetItems]);

  const orderItemsById = useMemo(() => orderItems.reduce<Record<string, OrderItemRow>>((acc, item) => {
    acc[item.id] = item;
    return acc;
  }, {}), [orderItems]);

  const setItemStatus = async (targetItem: RadarTargetItemRow, nextStatus: 'found' | 'not_found' | 'partial' | 'follow_up') => {
    const previous = targetItem.item_status;
    const payload = nextStatus === 'follow_up' ? { reminder: true } : undefined;
    const normalizedStatus = nextStatus === 'follow_up' ? 'partial' : nextStatus;

    const apply = async (status: 'found' | 'not_found' | 'partial') => {
      await enqueueRadarSyncEvent({
        radar_session_id: sessionId,
        event_type: status === 'found' ? 'item_found' : status === 'not_found' ? 'item_not_found' : 'item_partial',
        client_event_id: createUuid(),
        target_item_id: targetItem.id,
        item_status: status,
        payload
      });
      await load();
    };

    await apply(normalizedStatus);
    toast(nextStatus === 'found' ? 'Found ✅' : nextStatus === 'not_found' ? 'Not found ❌' : 'Saved 💾', 'success');
    vibrate(35);
    if (nextStatus === 'not_found') queueUndo('Not found', () => apply(previous === 'pending' ? 'partial' : previous));
  };

  const saveItemPrice = async (targetItem: RadarTargetItemRow, price: number | null) => {
    await enqueueRadarSyncEvent({
      radar_session_id: sessionId,
      event_type: 'item_found',
      client_event_id: createUuid(),
      target_item_id: targetItem.id,
      item_status: 'found',
      payload: { price_aed: price }
    });
    toast('Saved 💾', 'success');
    vibrate(25);
    await load();
  };

  const searchSupplier = () => {
    const term = window.prompt('Search supplier');
    if (!term) return;
    const hit = sortedTargets.find((item) => (shopsMap[item.shop_id]?.name || '').toLowerCase().includes(term.toLowerCase()));
    if (!hit) return toast('No supplier found', 'info');
    setHighlightedTargetId(hit.id);
    document.getElementById(`target-${hit.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const nextBest = () => {
    if (!sortedTargets.length) return;
    const currentIndex = Math.max(0, sortedTargets.findIndex((item) => item.id === highlightedTargetId));
    const next = sortedTargets[(currentIndex + 1) % sortedTargets.length];
    setHighlightedTargetId(next.id);
    document.getElementById(`target-${next.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast('Next best 🎯', 'info');
  };

  const activeOrder = useMemo(() => orders.find((item) => item.id === session?.order_id) || null, [orders, session?.order_id]);

  const smartPrompt = useMemo(() => {
    const recentNotFound = events.filter((item) => item.event_type === 'item_not_found').slice(0, 3);
    if (recentNotFound.length >= 3) return '3x Not found подряд: расширить радиус до 20 км или сменить тип на used_parts.';
    const recentWrongInfo = events.filter((item) => item.event_type === 'wrong_info').slice(0, 2);
    if (recentWrongInfo.length >= 2) return '2x Wrong info: пометить поставщика как проблемного?';
    return null;
  }, [events]);

  return (
    <div className="p-3 space-y-3 pb-24">
      <div className="rounded-2xl bg-white border border-gray-100 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => navigate('/radar')} className="inline-flex items-center gap-1 text-xs font-black text-gray-700"><ArrowLeft size={14} /> Назад</button>
          <span className="text-[10px] uppercase tracking-widest text-gray-400">Radar Session</span>
        </div>
        <h1 className="text-base font-black">Сессия {sessionId.slice(0, 8)}</h1>
        <p className="text-xs text-gray-500">Целей: {targets.length}. Статус: {session?.is_active ? 'active' : 'closed'}</p>
        {activeOrder && <button type="button" onClick={() => navigate(`/order/${activeOrder.id}`)} className="rounded-xl bg-amber-50 px-2 py-1 text-[11px] font-black text-amber-700">🧾 Активный заказ: {activeOrder.brand} {activeOrder.model}</button>}
        <div className="flex gap-2">
          <button type="button" onClick={() => void handleCloseSession()} className="flex-1 rounded-xl bg-gray-900 text-white text-xs font-black py-2">Завершить Radar</button>
          <button type="button" onClick={() => void handleRecalculateTargets()} className="rounded-xl border border-blue-200 bg-blue-50 px-3 text-xs font-black text-blue-700 disabled:opacity-60" disabled={isRecalculating}>{isRecalculating ? 'Пересчёт…' : <span className="inline-flex items-center gap-1"><RefreshCw size={12} /> Пересчитать</span>}</button>
          <button type="button" onClick={() => setShowHistory((v) => !v)} className="rounded-xl border border-gray-200 bg-white px-3 text-xs font-black">🕘 История</button>
        </div>
      </div>

      {smartPrompt && (
        <div className="sticky top-2 z-20 rounded-2xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-bold text-violet-800">
          💡 {smartPrompt}
        </div>
      )}

      {undoAction && (
        <div className="sticky top-14 z-20 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 inline-flex items-center gap-2">
          {undoAction.label} сохранено.
          <button type="button" onClick={() => { void undoAction.run(); setUndoAction(null); }} className="rounded-lg bg-white border border-slate-300 px-2 py-1">Undo</button>
        </div>
      )}

      {showHistory && (
        <div className="rounded-2xl border border-gray-200 bg-white p-3 space-y-2">
          {events.map((event) => (
            <div key={event.id} className="text-xs border-b border-gray-100 pb-1">
              <p className="font-bold">{event.event_type}</p>
              <p className="text-gray-500">{event.created_at ? new Date(event.created_at).toLocaleString() : '—'}</p>
            </div>
          ))}
          {!events.length && <p className="text-xs text-gray-500">Нет событий.</p>}
        </div>
      )}

      {isLoading && <p className="text-xs text-gray-500">Загрузка...</p>}

      <div className="space-y-2">
        {sortedTargets.map((target) => (
          <RadarCard
            key={target.id}
            target={target}
            shop={shopsMap[target.shop_id]}
            targetItems={targetItemsByTargetId[target.id] || []}
            orderItemsById={orderItemsById}
            highlighted={highlightedTargetId === target.id}
            onChangeStatus={(next) => void changeStatus(target, next)}
            onTel={() => void openTel(target)}
            onWa={() => void openWa(target)}
            onMap={() => window.open(`https://maps.google.com/?q=${encodeURIComponent(shopsMap[target.shop_id]?.name || '')}`, '_blank')}
            onHistory={() => setShowHistory((v) => !v)}
            onItemStatus={(item, status) => void setItemStatus(item, status)}
            onSavePrice={(item, price) => void saveItemPrice(item, price)}
            expandedHistory={showHistory}
          />
        ))}
      </div>

      <QuickActionsBar
        onSearch={searchSupplier}
        onNextBest={nextBest}
        onRecalculate={() => void handleRecalculateTargets()}
        onActiveOrder={() => activeOrder ? navigate(`/order/${activeOrder.id}`) : toast('Нет активного заказа', 'info')}
        onEndSession={() => void handleCloseSession()}
        disabled={isLoading}
      />
    </div>
  );
};

export default RadarSessionScreen;
