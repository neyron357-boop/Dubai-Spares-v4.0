import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, ChevronRight, Circle, Package, Send, Sparkles } from 'lucide-react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../store';
import type { Part } from '../types';
import { getPartDisplayName, normalizeGroupItems, normalizePartQuantity } from '../utils/groupItems';
import { generatePartPriceCard, generatePartsPriceSheet, resolveBestVariant, shareGeneratedPriceImage } from '../utils/partPriceShare';
import SafeImage from '../components/SafeImage';

const getOrderPartsScrollStorageKey = (orderId: string) => `dubai_spares:order_parts_scroll:${orderId}`;


const getPartPreviewPhotos = (part: Part): string[] => {
  const variant = resolveBestVariant(part);
  const variantPhotos = [variant?.photoUrl || '', ...(variant?.photos || [])].filter(Boolean);
  const partPhotos = [part.photoUrl || '', ...(part.photos || [])].filter(Boolean);
  return Array.from(new Set([...(variantPhotos as string[]), ...(partPhotos as string[])]));
};

const OrderPartsScreen: React.FC = () => {
  const { orderId = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { orders } = useStore();
  const [selectedPartIds, setSelectedPartIds] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const scrollStorageKey = useMemo(() => getOrderPartsScrollStorageKey(orderId), [orderId]);

  useEffect(() => {
    const restoreScrollTop = (location.state as { restoreScrollTop?: unknown } | null)?.restoreScrollTop;
    const mainScroller = document.querySelector('main');
    if (!(mainScroller instanceof HTMLElement)) return;
    const savedScrollTop = Number(window.sessionStorage.getItem(scrollStorageKey));
    const nextScrollTop = typeof restoreScrollTop === 'number' && restoreScrollTop >= 0
      ? restoreScrollTop
      : Number.isFinite(savedScrollTop) && savedScrollTop >= 0
        ? savedScrollTop
        : null;
    if (nextScrollTop === null) return;
    window.requestAnimationFrame(() => {
      mainScroller.scrollTop = nextScrollTop;
    });
  }, [location.state, scrollStorageKey]);

  useEffect(() => {
    const mainScroller = document.querySelector('main');
    if (!(mainScroller instanceof HTMLElement)) return undefined;

    const persistScrollTop = () => {
      window.sessionStorage.setItem(scrollStorageKey, String(mainScroller.scrollTop));
    };

    persistScrollTop();
    mainScroller.addEventListener('scroll', persistScrollTop, { passive: true });
    return () => {
      persistScrollTop();
      mainScroller.removeEventListener('scroll', persistScrollTop);
    };
  }, [scrollStorageKey]);

  const order = orders.find((item) => item.id === orderId);
  const shareableParts = useMemo(() => (
    (order?.parts || []).filter((part) => !!resolveBestVariant(part))
  ), [order]);

  if (!order) {
    return <div className="p-4 text-sm text-slate-500">Заказ не найден.</div>;
  }

  const toggleSelected = (partId: string) => {
    setSelectedPartIds((prev) => prev.includes(partId) ? prev.filter((id) => id !== partId) : [...prev, partId]);
  };

  const handleShareSingle = async (partId: string) => {
    const part = order.parts.find((item) => item.id === partId);
    const variant = part ? resolveBestVariant(part) : null;
    if (!part || !variant) return;
    setIsGenerating(true);
    try {
      const blob = await generatePartPriceCard(order, part, variant);
      const result = await shareGeneratedPriceImage(blob, `part-${part.id}.png`, 'Цена по детали', `${part.name} — ${variant.salePriceAed ?? variant.priceAed} AED`);
      if (result === 'downloaded') window.alert('Картинка сохранена. Теперь её можно отправить клиенту.');
    } catch (error) {
      console.error(error);
      window.alert('Не удалось сформировать картинку по детали.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleShareSelected = async () => {
    const entries = selectedPartIds
      .map((partId) => {
        const part = order.parts.find((item) => item.id === partId);
        const variant = part ? resolveBestVariant(part) : null;
        return part && variant ? { part, variant } : null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => !!entry);
    if (entries.length === 0) {
      window.alert('Выберите хотя бы одну деталь с вариантом.');
      return;
    }

    setIsGenerating(true);
    try {
      const blob = await generatePartsPriceSheet(order, entries);
      const result = await shareGeneratedPriceImage(blob, `order-${order.id}-parts.png`, 'Цены по деталям', `${order.brand} ${order.model} — ${entries.length} позиций`);
      if (result === 'downloaded') window.alert('Общая картинка сохранена. Можно отправить клиенту.');
    } catch (error) {
      console.error(error);
      window.alert('Не удалось сформировать общую картинку.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="min-h-full bg-slate-50 pb-28">
      <div className="sticky top-0 z-20 border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              const mainScroller = document.querySelector('main');
              const restoreScrollTop = mainScroller instanceof HTMLElement ? mainScroller.scrollTop : undefined;
              navigate(`/order/${order.id}`, { state: typeof restoreScrollTop === 'number' ? { restoreScrollTop } : undefined });
            }}
            className="rounded-full p-3 text-slate-600 hover:bg-slate-100"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-black text-slate-900">Подбор деталей</p>
            <p className="text-xs font-semibold text-slate-500">{order.brand} {order.model} · {order.parts.length} позиций</p>
          </div>
        </div>
      </div>

      <div className="space-y-3 p-4">
        <div className="rounded-3xl border border-blue-100 bg-blue-50 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-black text-blue-900">Экран деталей заказа</p>
              <p className="mt-1 text-xs font-semibold text-blue-700">Здесь можно выбрать несколько деталей, собрать общий прайс-картинку и отправить клиенту.</p>
            </div>
            <div className="rounded-2xl bg-white/80 px-3 py-2 text-right text-xs font-black text-blue-700">
              С вариантами: {shareableParts.length}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleShareSelected()}
            disabled={isGenerating || selectedPartIds.length === 0}
            className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 text-sm font-black text-white disabled:opacity-50"
          >
            <Sparkles size={16} /> Сгенерировать одну картинку ({selectedPartIds.length})
          </button>
        </div>

        {order.parts.map((part) => {
          const displayName = getPartDisplayName(part);
          const groupItems = normalizeGroupItems(part.groupItems);
          const quantity = normalizePartQuantity(part.quantity);
          const variant = resolveBestVariant(part);
          const isSelected = selectedPartIds.includes(part.id);
          return (
            <div key={part.id} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  disabled={!variant}
                  onClick={() => toggleSelected(part.id)}
                  className={`mt-0.5 rounded-full p-1 ${variant ? 'text-blue-600' : 'text-slate-300'}`}
                >
                  {isSelected ? <CheckCircle2 size={22} /> : <Circle size={22} />}
                </button>
                <div className="relative h-12 w-12 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                  {getPartPreviewPhotos(part)[0] ? (
                    <SafeImage src={getPartPreviewPhotos(part)[0]} alt={displayName} className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full w-full place-items-center">
                      <Package size={18} className="text-slate-400" />
                    </div>
                  )}
                  {getPartPreviewPhotos(part).length > 1 && (
                    <span className="absolute bottom-0.5 right-0.5 rounded bg-slate-900/70 px-1 text-[8px] font-bold text-white">{getPartPreviewPhotos(part).length}</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => {
                      const mainScroller = document.querySelector('main');
                      const restoreScrollTop = mainScroller instanceof HTMLElement ? mainScroller.scrollTop : undefined;
                      navigate(`/order/${order.id}/part/${part.id}`, {
                        state: {
                          backTo: `/order/${order.id}/parts`,
                          ...(typeof restoreScrollTop === 'number' ? { orderScrollTop: restoreScrollTop } : {}),
                        },
                      });
                    }}
                    className="flex w-full items-start justify-between gap-2 text-left"
                  >
                    <div>
                      <p className="text-sm font-black text-slate-900">{displayName}</p>
                      <p className="mt-1 text-xs font-semibold text-slate-500">Кол-во: {quantity}</p>
                      {groupItems.length > 0 && <p className="mt-1 text-xs font-semibold text-violet-700">Состав: {groupItems.map((item) => `${item.name} ×${item.quantity}`).join(', ')}</p>}
                    </div>
                    <ChevronRight size={18} className="shrink-0 text-slate-300" />
                  </button>
                  <div className="mt-3 rounded-2xl bg-slate-50 p-3">
                    {variant ? (
                      <>
                        <p className="text-lg font-black text-emerald-700">{variant.salePriceAed ?? variant.priceAed} AED</p>
                        <p className="text-xs font-semibold text-slate-600">{variant.shopName || 'Поставщик не указан'}</p>
                        <button
                          type="button"
                          onClick={() => void handleShareSingle(part.id)}
                          disabled={isGenerating}
                          className="mt-3 inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-emerald-50 px-3 text-xs font-black text-emerald-700 disabled:opacity-50"
                        >
                          <Send size={14} /> Отправить ценник
                        </button>
                      </>
                    ) : (
                      <p className="text-xs font-semibold text-slate-400">Сначала добавьте вариант, потом можно будет сгенерировать картинку.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default OrderPartsScreen;
