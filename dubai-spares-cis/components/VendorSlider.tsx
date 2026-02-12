import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronLeft, ChevronRight, Copy, X } from 'lucide-react';
import { loadAppSettings, saveAppSettings } from '../appSettings';
import { vibrate } from '../feedback';
import { ensureUuid } from '../id';
import { useStore } from '../store';
import { Priority, type Order, type Part } from '../types';

type VendorSlide = {
  orderId: string;
  partId: string;
  order: Order;
  part: Part;
  images: string[];
};

const priorityWeight = {
  [Priority.HIGH]: 3,
  [Priority.MEDIUM]: 2,
  [Priority.LOW]: 1,
};

const priorityLabel = (order: Order) => {
  if (order.isVip) return 'VIP';
  if (order.parts.some((part) => part.priority === 'urgent')) return 'Urgent';
  return 'Normal';
};

const priorityClass = (order: Order) => {
  if (order.isVip) return 'text-amber-300 border-amber-400/60 bg-amber-500/15';
  if (order.parts.some((part) => part.priority === 'urgent')) return 'text-rose-300 border-rose-400/60 bg-rose-500/15';
  return 'text-slate-300 border-slate-500/50 bg-slate-500/15';
};

const resolveTarget = (order: Order, part: Part) => {
  const base = order.isVip ? 1500 : order.priority === Priority.HIGH ? 1300 : order.priority === Priority.MEDIUM ? 1000 : 800;
  const mod = part.priority === 'urgent' ? 1.15 : 1;
  const target = Math.round(base * mod);
  return {
    target,
    marketLow: Math.round(target * 1.1),
    marketHigh: Math.round(target * 1.4),
  };
};

const getStatusBadge = (price?: number) => {
  if (!price) return { label: '🟢 Searching', tone: 'bg-emerald-500/15 text-emerald-200 border-emerald-400/50' };
  if (price <= 1800) return { label: '🟡 Quoted', tone: 'bg-amber-500/15 text-amber-200 border-amber-400/50' };
  return { label: '🔴 Expensive', tone: 'bg-rose-500/15 text-rose-200 border-rose-400/50' };
};

const VendorSlider: React.FC = () => {
  const navigate = useNavigate();
  const { orders, updateOrder } = useStore();

  const [index, setIndex] = useState(0);
  const [imgIndex, setImgIndex] = useState(0);
  const [priceInput, setPriceInput] = useState('');
  const [priceOpen, setPriceOpen] = useState(false);
  const [fieldFocusMode, setFieldFocusMode] = useState<boolean>(() => loadAppSettings().fieldFocusMode);
  const [superFieldMode, setSuperFieldMode] = useState(false);
  const [quotedPrices, setQuotedPrices] = useState<Record<string, number>>({});
  const pressTimer = useRef<number | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const slides = useMemo<VendorSlide[]>(() => {
    const active = orders.filter((o) => !o.isArchived && !o.isSold);
    return active
      .sort((a, b) => (priorityWeight[b.priority] - priorityWeight[a.priority]) || (b.createdAt - a.createdAt))
      .flatMap((order) => order.parts.map((part) => ({
        orderId: order.id,
        partId: part.id,
        order,
        part,
        images: (part.photos && part.photos.length > 0) ? part.photos : (part.photoUrl ? [part.photoUrl] : []),
      })));
  }, [orders]);

  useEffect(() => {
    if (index >= slides.length) setIndex(0);
  }, [index, slides.length]);

  useEffect(() => {
    setImgIndex(0);
    setPriceOpen(false);
    setPriceInput('');
  }, [index]);

  useEffect(() => {
    const unsubscribe = () => {
      window.removeEventListener('app-settings-updated', handler);
    };
    const handler = () => setFieldFocusMode(loadAppSettings().fieldFocusMode);
    window.addEventListener('app-settings-updated', handler);
    return unsubscribe;
  }, []);

  useEffect(() => {
    const urls = slides.flatMap((slide) => slide.images).slice(0, 20);
    urls.forEach((url) => {
      const img = new Image();
      img.src = url;
    });
  }, [slides]);

  const current = slides[index];

  const goTo = (next: number) => {
    const bounded = Math.max(0, Math.min(slides.length - 1, next));
    if (bounded === index) return;
    const atLast = bounded === slides.length - 1;
    vibrate(atLast ? [30, 40, 30] : 15);
    setIndex(bounded);
  };

  const handleTap = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const isRight = e.clientX > rect.left + rect.width / 2;
    goTo(index + (isRight ? 1 : -1));
  };

  const onTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    const touch = e.targetTouches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY };
  };

  const onTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!touchStart.current) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchStart.current.x;
    const dy = touch.clientY - touchStart.current.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) goTo(index + (dx > 0 ? -1 : 1));
    if (dy > 60) setPriceOpen(true);
    touchStart.current = null;
  };

  const copyVin = async () => {
    if (!current?.order.vin) return;
    await navigator.clipboard.writeText(current.order.vin);
    vibrate(10);
  };

  const savePrice = async () => {
    if (!current) return;
    const parsed = Number(priceInput);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    const key = `${current.orderId}:${current.partId}`;
    setQuotedPrices((prev) => ({ ...prev, [key]: parsed }));
    setPriceOpen(false);
    setPriceInput('');

    const noteText = `${current.part.name}: vendor quoted ${parsed} AED`;
    await updateOrder({
      ...current.order,
      notes: [
        {
          id: ensureUuid(`note-${Date.now()}`),
          text: noteText,
          createdAt: Date.now(),
        },
        ...(current.order.notes || []),
      ],
    });
  };

  const skip = () => goTo(index + 1);

  const onLongPressStart = () => {
    pressTimer.current = window.setTimeout(async () => {
      if (!current) return;
      const text = window.prompt('Добавить заметку:');
      if (!text) return;
      await updateOrder({
        ...current.order,
        notes: [
          {
            id: ensureUuid(`note-${Date.now()}`),
            text,
            createdAt: Date.now(),
          },
          ...(current.order.notes || []),
        ],
      });
      vibrate(20);
    }, 500);
  };

  const onLongPressEnd = () => {
    if (!pressTimer.current) return;
    window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };

  if (!current) {
    return (
      <div className="absolute inset-0 z-50 bg-gray-950 text-gray-300 flex flex-col items-center justify-center gap-4">
        <p>Нет деталей для просмотра</p>
        <button type="button" onClick={() => navigate(-1)} className="rounded-xl border border-gray-700 px-4 py-2">Назад</button>
      </div>
    );
  }

  const { order, part, images } = current;
  const priceKey = `${current.orderId}:${current.partId}`;
  const quoted = quotedPrices[priceKey];
  const target = resolveTarget(order, part);
  const statusBadge = getStatusBadge(quoted);
  const progressDone = index + 1;

  return (
    <div className={`absolute inset-0 z-50 flex flex-col h-full w-full ${fieldFocusMode ? 'bg-black' : 'bg-slate-950'}`}>
      <div className="px-3 py-2 border-b border-slate-800 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-black text-white truncate">{order.brand} {order.model} {order.year}</p>
          {!superFieldMode && <p className={`font-mono ${fieldFocusMode ? 'text-sm text-white' : 'text-xs text-slate-400'} truncate`}>VIN: {order.vin || '—'}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!superFieldMode && (
            <button type="button" onClick={() => void copyVin()} className="rounded-lg border border-slate-600 px-2 py-1 text-[11px] font-bold text-white">
              <Copy size={12} className="inline mr-1" />Copy
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              const next = !superFieldMode;
              setSuperFieldMode(next);
              vibrate(12);
            }}
            className={`rounded-lg px-2 py-1 text-[11px] font-black ${superFieldMode ? 'bg-blue-500 text-white' : 'bg-slate-800 text-slate-200'}`}
          >
            ⚡ Field Mode
          </button>
          <button type="button" onClick={() => navigate(-1)} className="rounded-full p-1.5 bg-slate-800 text-slate-300"><X size={16} /></button>
        </div>
      </div>

      <div
        className="flex-1 min-h-0 flex flex-col"
        onClick={handleTap}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onMouseDown={onLongPressStart}
        onMouseUp={onLongPressEnd}
        onMouseLeave={onLongPressEnd}
      >
        <div className={`${superFieldMode ? 'px-4 pt-4 pb-2' : 'px-4 pt-3 pb-3'} space-y-2`}>
          {!superFieldMode && <p className="text-[11px] tracking-[0.18em] font-black text-emerald-300">🟢 DASHBOARD</p>}
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`rounded-full border px-2 py-1 text-[11px] font-black uppercase ${priorityClass(order)}`}>Priority: {priorityLabel(order)}</span>
            {!superFieldMode && <span className="rounded-full border border-slate-700 px-2 py-1 text-[11px] font-bold text-slate-300">Qty: 1</span>}
            {!superFieldMode && <span className={`rounded-full border px-2 py-1 text-[11px] font-black ${statusBadge.tone}`}>{statusBadge.label}</span>}
          </div>
          <div>
            <p className={`font-black ${fieldFocusMode || superFieldMode ? 'text-4xl' : 'text-3xl'} text-white`}>💰 TARGET: {target.target} AED</p>
            {!superFieldMode && <p className="text-xs text-slate-400">Market {target.marketLow}–{target.marketHigh}</p>}
          </div>
          {!superFieldMode && (
            <div className="text-xs text-slate-300 font-semibold">
              {Array.from({ length: slides.length }).map((_, itemIdx) => (itemIdx < progressDone ? '█' : '░')).join('')} {progressDone}/{slides.length} done
            </div>
          )}
        </div>

        <div className={`px-4 ${superFieldMode ? 'h-[60vh]' : 'h-[44vh]'}`}>
          <div className="h-full rounded-3xl overflow-hidden bg-slate-900 border border-slate-800 relative">
            {images.length > 0 ? (
              <>
                <img src={images[imgIndex]} alt={part.name} className="w-full h-full object-cover" />
                {images.length > 1 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setImgIndex((prev) => (prev + 1) % images.length);
                    }}
                    className="absolute right-3 bottom-3 rounded-full bg-black/70 px-3 py-1 text-xs text-white"
                  >
                    {imgIndex + 1}/{images.length}
                  </button>
                )}
              </>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-slate-500 text-sm">No photo</div>
            )}
          </div>
        </div>

        {!superFieldMode && <div className="px-4 pt-2 text-lg font-bold text-white line-clamp-2">{part.name}</div>}
      </div>

      <div className="p-4 border-t border-slate-800 flex items-center gap-3">
        <button type="button" onClick={() => goTo(index - 1)} className="rounded-2xl border border-slate-700 px-4 py-3 text-white"><ChevronLeft size={20} /></button>
        <div className="text-white text-sm font-mono flex-1 text-center">{index + 1} / {slides.length}</div>
        <button type="button" onClick={() => goTo(index + 1)} className="rounded-2xl border border-slate-700 px-4 py-3 text-white"><ChevronRight size={20} /></button>
        <button type="button" onClick={() => setPriceOpen(true)} className="rounded-2xl bg-emerald-500 px-4 py-3 text-[12px] font-black text-black">PRICE</button>
        <button type="button" onClick={skip} className="rounded-2xl bg-slate-700 px-4 py-3 text-[12px] font-black text-white">SKIP</button>
      </div>

      {priceOpen && (
        <div className="absolute inset-x-0 bottom-0 p-4 bg-black/85 border-t border-slate-700 backdrop-blur-sm">
          <div className="max-w-md mx-auto space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-white font-bold">Enter vendor price:</p>
              <button type="button" onClick={() => setPriceOpen(false)} className="text-slate-400"><ChevronDown size={18} /></button>
            </div>
            <input
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              className="w-full rounded-xl bg-slate-900 border border-slate-600 px-3 py-3 text-white"
              type="number"
              placeholder="1600"
            />
            <div className="flex gap-2">
              <button type="button" onClick={() => void savePrice()} className="flex-1 rounded-xl bg-emerald-500 py-3 text-black font-black">Save</button>
              <button
                type="button"
                onClick={() => {
                  const next = !fieldFocusMode;
                  setFieldFocusMode(next);
                  saveAppSettings({ fieldFocusMode: next });
                }}
                className={`rounded-xl px-3 py-3 text-xs font-black ${fieldFocusMode ? 'bg-blue-500 text-white' : 'bg-slate-700 text-slate-100'}`}
              >
                Field Focus Mode
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VendorSlider;
