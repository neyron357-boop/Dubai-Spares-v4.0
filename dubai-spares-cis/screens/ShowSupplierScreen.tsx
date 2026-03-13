import React, { useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { ArrowLeft, Copy, Share2, Package } from 'lucide-react';
import { normalizePartQuantity } from '../utils/groupItems';

const ShowSupplierScreen: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { orders } = useStore();
  const contentRef = useRef<HTMLDivElement>(null);

  const order = orders.find((o) => o.id === id);

  if (!order) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <p className="text-gray-500 text-sm">Заказ не найден.</p>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mt-4 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold"
        >
          Назад
        </button>
      </div>
    );
  }

  const carPhotos = order.carPhotos && order.carPhotos.length > 0
    ? order.carPhotos
    : order.carPhotoUrl
    ? [order.carPhotoUrl]
    : [];

  const buildTextList = () => {
    const header = `${order.brand} ${order.model} ${order.year}`.trim();
    const parts = (order.parts || []).map((part, i) => {
      const qty = normalizePartQuantity(part.quantity);
      const desc = part.comment?.trim();
      let line = `${i + 1}. ${part.name}`;
      if (qty && qty !== '1') line += ` × ${qty}`;
      if (desc) line += `\n   ${desc}`;
      return line;
    });
    return [header, '', ...parts].join('\n');
  };

  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(buildTextList());
      // Simple visual feedback via alert on mobile
      const btn = document.getElementById('copy-btn');
      if (btn) {
        const orig = btn.textContent;
        btn.textContent = '✓ Скопировано';
        setTimeout(() => { if (btn) btn.textContent = orig; }, 1500);
      }
    } catch {
      // ignore
    }
  };

  const handleShareText = async () => {
    const text = buildTextList();
    if (navigator.share) {
      try {
        await navigator.share({ text, title: `${order.brand} ${order.model} ${order.year}` });
      } catch {
        // user cancelled
      }
    } else {
      await navigator.clipboard.writeText(text);
    }
  };

  return (
    <div className="flex flex-col min-h-full bg-white text-[#1E1F23] pb-28">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-white border-b border-gray-100 flex items-center gap-3 px-4 py-3 shadow-sm">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="p-2 -ml-1 rounded-full text-gray-600 active:bg-gray-100"
        >
          <ArrowLeft size={22} />
        </button>
        <h1 className="font-bold text-base text-[#1E1F23] flex-1 truncate">Показать поставщику</h1>
      </div>

      {/* Car photo 16:9 */}
      {carPhotos.length > 0 && (
        <div className="w-full aspect-video bg-gray-100 overflow-hidden">
          <img
            src={carPhotos[0]}
            alt={`${order.brand} ${order.model}`}
            className="w-full h-full object-cover"
          />
        </div>
      )}

      {/* Main content */}
      <div ref={contentRef} className="px-5 pt-5 space-y-5">
        {/* Car title */}
        <div>
          <h2 className="text-[26px] font-bold text-[#1E1F23] leading-tight">
            {order.brand} {order.model}
          </h2>
          <p className="text-[20px] font-semibold text-gray-500 mt-0.5">{order.year}</p>
        </div>

        {/* Parts list */}
        <div className="space-y-3">
          {(order.parts || []).length === 0 ? (
            <p className="text-sm text-gray-400">Детали не добавлены.</p>
          ) : (
            (order.parts || []).map((part, index) => {
              const qty = normalizePartQuantity(part.quantity);
              const desc = part.comment?.trim();
              const hasPhoto = (part.photos && part.photos.length > 0) || !!part.photoUrl;
              const photoSrc = part.photos?.[0] || part.photoUrl;

              return (
                <div key={part.id} className="flex items-start gap-3 py-3 border-b border-gray-100 last:border-0">
                  {/* Index + photo */}
                  <div className="flex flex-col items-center gap-1 shrink-0">
                    <span className="text-[12px] font-bold text-gray-400 w-6 text-center">{index + 1}</span>
                    <div className="w-12 h-12 rounded-xl bg-gray-50 border border-gray-100 overflow-hidden flex items-center justify-center shrink-0">
                      {hasPhoto && photoSrc ? (
                        <img src={photoSrc} alt={part.name} className="w-full h-full object-cover" />
                      ) : (
                        <Package size={20} className="text-gray-200" />
                      )}
                    </div>
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-[18px] font-bold text-[#1E1F23] leading-snug break-words">{part.name}</p>
                    {qty && (
                      <p className="text-[16px] font-medium text-gray-500 mt-0.5">
                        × {qty}
                      </p>
                    )}
                    {desc && (
                      <p className="text-[14px] text-gray-600 mt-1 leading-relaxed">{desc}</p>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Bottom action buttons */}
      <div className="fixed bottom-0 left-0 right-0 flex justify-center pointer-events-none">
        <div className="w-full max-w-md pointer-events-auto px-4 pb-6 pt-4 bg-white border-t border-gray-100 shadow-[0_-6px_16px_rgba(0,0,0,0.08)] flex gap-3">
          <button
            id="copy-btn"
            type="button"
            onClick={() => void handleCopyText()}
            className="flex-1 h-12 rounded-[12px] bg-gray-100 text-gray-800 text-[14px] font-semibold inline-flex items-center justify-center gap-2 active:scale-[0.97] transition-transform"
          >
            <Copy size={17} />
            Скопировать текст
          </button>
          <button
            type="button"
            onClick={() => void handleShareText()}
            className="flex-1 h-12 rounded-[12px] bg-[#3B6AF7] text-white text-[14px] font-semibold inline-flex items-center justify-center gap-2 active:scale-[0.97] transition-transform shadow-[0_4px_12px_rgba(59,106,247,0.35)]"
          >
            <Share2 size={17} />
            Поделиться
          </button>
        </div>
      </div>
    </div>
  );
};

export default ShowSupplierScreen;
