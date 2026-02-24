import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { findActiveRadarSession, getRadarTargetItems, getRadarTargets, getRadarSession } from '../radarSessionService';

const TodayScreen: React.FC = () => {
  const navigate = useNavigate();
  const { orders } = useStore();
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [targets, setTargets] = useState<any[]>([]);
  const [targetItems, setTargetItems] = useState<any[]>([]);
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const active = await findActiveRadarSession();
      setActiveSessionId(active?.id || null);
      setActiveOrderId(active?.order_id || null);
      if (!active?.id) return;
      const targetRows = await getRadarTargets(active.id);
      setTargets(targetRows);
      setTargetItems(await getRadarTargetItems(targetRows.map((item) => item.id)));
      const session = await getRadarSession(active.id);
      setActiveOrderId(session?.order_id || null);
    };
    void load();
  }, []);

  const kpi = useMemo(() => {
    const found = targetItems.filter((item) => item.item_status === 'found').length;
    const notFound = targetItems.filter((item) => item.item_status === 'not_found').length;
    const followUp = targetItems.filter((item) => item.item_status === 'partial').length;
    const visited = targets.filter((item) => item.status === 'done' || item.status === 'at_shop').length;
    const profitAed = targetItems.reduce((sum, item) => sum + (Number(item.price_aed) || 0), 0);
    const bySupplier: Record<string, number> = {};
    targetItems.forEach((item) => {
      if (item.item_status !== 'found') return;
      const target = targets.find((entry) => entry.id === item.radar_target_id);
      if (!target?.shop_id) return;
      bySupplier[target.shop_id] = (bySupplier[target.shop_id] || 0) + 1;
    });
    const bestSupplierId = Object.entries(bySupplier).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    return { visited, found, notFound, followUp, profitAed, bestSupplierId };
  }, [targetItems, targets]);

  const activeOrder = orders.find((order) => order.id === activeOrderId) || null;

  return (
    <div className="p-3 space-y-3">
      <div className="rounded-2xl border border-gray-200 bg-white p-3">
        <h1 className="text-lg font-black">Сегодня</h1>
        <p className="text-xs text-gray-500">Фокус дня без лишних экранов.</p>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-3 space-y-2">
        <p className="text-xs font-black uppercase text-gray-400">🧭 Активная сессия</p>
        <p className="text-sm font-bold">{activeSessionId ? `Radar ${activeSessionId.slice(0, 8)}` : 'Нет активной сессии'}</p>
        <p className="text-xs text-gray-500">🧾 {activeOrder ? `${activeOrder.brand} ${activeOrder.model}` : 'Активный заказ не выбран'}</p>
        <p className="text-xs text-gray-500">📌 План: закрыть приоритетные детали и сохранить цены.</p>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs font-bold">
        <div className="rounded-xl bg-white border border-gray-200 p-2">Посетил: {kpi.visited}</div>
        <div className="rounded-xl bg-white border border-gray-200 p-2">Found: {kpi.found}</div>
        <div className="rounded-xl bg-white border border-gray-200 p-2">Not found: {kpi.notFound}</div>
        <div className="rounded-xl bg-white border border-gray-200 p-2">Follow-up: {kpi.followUp}</div>
        <div className="rounded-xl bg-white border border-gray-200 p-2 col-span-2">Потенциал прибыли: AED {kpi.profitAed}</div>
        <div className="rounded-xl bg-white border border-gray-200 p-2 col-span-2">Лучший поставщик дня: {kpi.bestSupplierId || '—'}</div>
      </div>

      <div className="grid grid-cols-1 gap-2">
        {activeSessionId ? (
          <button type="button" onClick={() => navigate(`/radar/${activeSessionId}`)} className="h-11 rounded-xl bg-slate-900 text-white text-sm font-black">🚀 Continue Radar</button>
        ) : (
          <button type="button" onClick={() => navigate('/radar')} className="h-11 rounded-xl bg-emerald-600 text-white text-sm font-black">➕ Start New Radar</button>
        )}
        <button type="button" onClick={() => navigate('/database')} className="h-11 rounded-xl border border-gray-300 bg-white text-sm font-black">📦 Open Suppliers</button>
      </div>
    </div>
  );
};

export default TodayScreen;
