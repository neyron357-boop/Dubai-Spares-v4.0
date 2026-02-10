import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LocateFixed, Radar, Navigation } from 'lucide-react';
import { useStore } from '../store';
import { Shop } from '../types';
import { buildShopMapLink, isShopCompatibleWithOrder } from '../shopMatching';
import { supabase } from '../supabase';

const toRad = (v: number) => (v * Math.PI) / 180;
const distanceMeters = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const calc = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(calc), Math.sqrt(1 - calc));
};

const RadarScreen: React.FC = () => {
  const { orders, suppliers } = useStore();
  const navigate = useNavigate();
  const [shops, setShops] = useState<Shop[]>([]);
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!supabase) {
        const fallback = suppliers
          .filter((s) => s.coordinates)
          .map((s) => ({ id: s.id, name: s.name, phone: s.phone, location: s.location, latitude: s.coordinates!.lat, longitude: s.coordinates!.lng, specialization: s.brands || [] }));
        setShops(fallback);
        return;
      }
      const { data } = await supabase.from('shops').select('id,name,phone,location,latitude,longitude,specialization,specialization_models,specialization_years');
      if (!active || !Array.isArray(data)) return;
      setShops(data.map((row: any) => ({
        id: String(row.id), name: row.name || 'Shop', phone: row.phone || '', location: row.location || '',
        latitude: Number(row.latitude), longitude: Number(row.longitude), specialization: Array.isArray(row.specialization) ? row.specialization : [],
        specializationModels: Array.isArray(row.specialization_models) ? row.specialization_models : [],
        specializationYears: Array.isArray(row.specialization_years) ? row.specialization_years.map((y: any) => Number(y)).filter((y: number) => Number.isFinite(y)) : []
      })));
    };
    void load();
    return () => { active = false; };
  }, [suppliers]);

  useEffect(() => {
    if (!navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition((pos) => setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude }));
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  const entries = useMemo(() => {
    const activeOrders = orders.filter((o) => o.status === 'new_inquiry' || o.status === 'in_progress');
    return activeOrders.flatMap((order) => shops
      .filter((shop) => isShopCompatibleWithOrder(shop, order) || (order.recommendedShopIds || []).includes(shop.id))
      .map((shop) => ({ order, shop, distance: position ? distanceMeters(position, { lat: shop.latitude, lng: shop.longitude }) : Number.MAX_SAFE_INTEGER })))
      .sort((a, b) => a.distance - b.distance);
  }, [orders, shops, position]);

  return (
    <div className="p-4 pb-20 space-y-3 bg-slate-950 min-h-full text-white">
      <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-3">
        <div className="flex items-center gap-2 text-emerald-300"><Radar size={18} className="animate-pulse" /><span className="text-sm font-black uppercase tracking-wider">Radar Live</span></div>
        <p className="mt-1 text-xs text-emerald-100/80">Отдельный экран радара: ближайшие релевантные магазины по активным заявкам.</p>
      </div>
      {entries.length === 0 ? <div className="rounded-2xl border border-slate-800 bg-slate-900 p-10 text-center text-xs text-slate-400">Релевантных магазинов рядом пока нет.</div> : entries.slice(0, 30).map(({ order, shop, distance }) => (
        <div key={`${order.id}-${shop.id}`} className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-black truncate">{shop.name}</p>
              <p className="text-[11px] text-slate-400 truncate">{order.brand} {order.model} • {order.year || '—'}</p>
            </div>
            <div className="text-[11px] font-black text-emerald-300">{Number.isFinite(distance) ? `${Math.round(distance)}m` : 'n/a'}</div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => window.open(buildShopMapLink(shop), '_blank')} className="inline-flex items-center gap-1 rounded-xl bg-emerald-500 px-3 py-2 text-[11px] font-black uppercase text-slate-950"><Navigation size={12} /> Маршрут</button>
            <button type="button" onClick={() => navigate(`/order/${order.id}`)} className="inline-flex items-center gap-1 rounded-xl border border-slate-700 px-3 py-2 text-[11px] font-black uppercase text-slate-200"><LocateFixed size={12} /> Карточка</button>
          </div>
        </div>
      ))}
    </div>
  );
};

export default RadarScreen;
