/**
 * FoundPartModal — Digital Boss v1.0
 *
 * Opened when user taps "Нашел" on a part card.
 * Flow: Take/attach photo → Enter purchase price → Auto-calculate sell price → Send WhatsApp
 */
import React, { useRef, useState, useCallback } from 'react';
import {
  X,
  Camera,
  DollarSign,
  MessageCircle,
  CheckCircle2,
  Upload,
} from 'lucide-react';
import { Order, Part } from '../types';
import { vibrate } from '../feedback';
import { optimizeImageForUpload } from '../storage/photos';

interface FoundPartModalProps {
  order: Order;
  part: Part;
  /** Markup % override (falls back to order.markupPercent) */
  markupPercent?: number;
  /** Fixed AED markup added on top of % */
  markupFixedAed?: number;
  /** Called when user confirms found: receives purchase price, sell price, photo URL */
  onConfirm: (params: {
    purchasePriceAed: number;
    sellPriceAed: number;
    photoDataUrl?: string;
  }) => void;
  onClose: () => void;
}

const calcSellPrice = (
  purchaseAed: number,
  markupPct: number,
  markupFixed: number,
): number => {
  if (purchaseAed <= 0) return 0;
  return Math.ceil(purchaseAed * (1 + markupPct / 100) + markupFixed);
};

const FoundPartModal: React.FC<FoundPartModalProps> = ({
  order,
  part,
  markupPercent,
  markupFixedAed = 0,
  onConfirm,
  onClose,
}) => {
  const markupPct = markupPercent ?? order.markupPercent ?? 20;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | undefined>(undefined);
  const [purchaseRaw, setPurchaseRaw] = useState('');
  const [isSending, setIsSending] = useState(false);

  const purchaseAed = Number(purchaseRaw.replace(',', '.')) || 0;
  const sellAed = calcSellPrice(purchaseAed, markupPct, markupFixedAed);

  const handlePhoto = useCallback(async (file: File) => {
    try {
      const optimized = await optimizeImageForUpload(file);
      const reader = new FileReader();
      reader.onload = (e) => {
        setPhotoDataUrl(e.target?.result as string);
      };
      reader.readAsDataURL(optimized);
    } catch {
      // Fallback: read original
      const reader = new FileReader();
      reader.onload = (e) => {
        setPhotoDataUrl(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handlePhoto(file);
  };

  const buildWhatsAppMessage = (): string => {
    const carLabel = `${order.brand} ${order.model}${order.year ? ` ${order.year}` : ''}`.trim();
    const lines = [
      `✅ Нашел деталь!`,
      `🚗 ${carLabel}`,
      `🔩 ${part.name}`,
      `💰 Цена: *${sellAed.toLocaleString('ru-RU')} AED*`,
      order.vin ? `VIN: ${order.vin}` : '',
      '',
      'Для подтверждения заказа, пожалуйста, ответьте на это сообщение.',
    ]
      .filter((l) => l !== undefined)
      .join('\n');
    return lines;
  };

  const handleSendWhatsApp = () => {
    if (purchaseAed <= 0) return;
    vibrate([50, 50, 50]);
    const phone = order.contactLinks?.phone || order.customerContact || '';
    const msg = encodeURIComponent(buildWhatsAppMessage());
    const url = phone
      ? `https://wa.me/${phone.replace(/\D/g, '')}?text=${msg}`
      : `https://wa.me/?text=${msg}`;
    window.open(url, '_blank');
  };

  const handleConfirm = async () => {
    if (purchaseAed <= 0) return;
    setIsSending(true);
    vibrate([30, 30, 80]); // double-click haptic for success
    onConfirm({ purchasePriceAed: purchaseAed, sellPriceAed: sellAed, photoDataUrl });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-[#121212] rounded-t-3xl border-t border-[#2A2A2A] animate-slide-up">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-[#3A3A3A]" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-2 pb-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-[#4CAF50]">
              Нашел деталь
            </p>
            <h2 className="text-lg font-black text-white mt-0.5 leading-tight">{part.name}</h2>
            <p className="text-xs text-gray-400">
              {order.brand} {order.model}
              {order.year ? ` · ${order.year}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-[#1E1E1E] flex items-center justify-center"
            aria-label="Закрыть"
          >
            <X size={18} className="text-gray-400" />
          </button>
        </div>

        <div className="px-5 pb-8 space-y-4">
          {/* Photo section */}
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-gray-400 mb-2">
              Фото детали
            </p>
            {photoDataUrl ? (
              <div className="relative rounded-2xl overflow-hidden h-44">
                <img
                  src={photoDataUrl}
                  alt="Фото детали"
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => setPhotoDataUrl(undefined)}
                  className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center"
                >
                  <X size={14} className="text-white" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-32 rounded-2xl border-2 border-dashed border-[#3A3A3A] flex flex-col items-center justify-center gap-2 active:bg-[#1A1A1A] transition-colors"
              >
                <Camera size={28} className="text-[#4CAF50]" />
                <span className="text-sm font-semibold text-gray-400">Сделать фото</span>
                <span className="text-[11px] text-gray-600">или выбрать из галереи</span>
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

          {/* Price input */}
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-gray-400 mb-2">
              Цена закупа (AED)
            </p>
            <div className="flex items-center gap-3 rounded-2xl bg-[#1E1E1E] border border-[#2A2A2A] px-4 py-3">
              <DollarSign size={20} className="text-[#4CAF50] shrink-0" />
              <input
                type="text"
                inputMode="decimal"
                value={purchaseRaw}
                onChange={(e) => setPurchaseRaw(e.target.value)}
                placeholder="0"
                className="flex-1 bg-transparent text-2xl font-black text-white placeholder-gray-600 outline-none"
                autoFocus
              />
              <span className="text-base font-bold text-gray-400">AED</span>
            </div>
          </div>

          {/* Auto-calculated sell price */}
          {purchaseAed > 0 && (
            <div className="rounded-2xl bg-[#0D1F0D] border border-[#4CAF50]/30 px-4 py-3">
              <p className="text-[11px] font-black uppercase tracking-widest text-[#4CAF50]/70 mb-1">
                Цена для клиента (авто)
              </p>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-black text-[#4CAF50] animate-number-jump">
                  {sellAed.toLocaleString('ru-RU')}
                </span>
                <span className="text-base font-bold text-[#4CAF50]/70">AED</span>
              </div>
              <p className="text-[11px] text-gray-500 mt-1">
                {purchaseAed} × {markupPct}%{markupFixedAed > 0 ? ` + ${markupFixedAed} fix` : ''}
              </p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              disabled={purchaseAed <= 0}
              onClick={handleSendWhatsApp}
              className="flex-1 flex items-center justify-center gap-2 rounded-2xl bg-[#25D366]/15 border border-[#25D366]/40 py-3.5 text-[#25D366] text-sm font-bold disabled:opacity-30 disabled:cursor-not-allowed active:scale-95 transition-all"
            >
              <MessageCircle size={18} />
              WhatsApp
            </button>
            <button
              type="button"
              disabled={purchaseAed <= 0 || isSending}
              onClick={handleConfirm}
              className="flex-1 flex items-center justify-center gap-2 rounded-2xl bg-[#4CAF50] py-3.5 text-white text-sm font-black disabled:opacity-30 disabled:cursor-not-allowed active:scale-95 transition-all shadow-lg shadow-[#4CAF50]/20"
            >
              <CheckCircle2 size={18} />
              Подтвердить
            </button>
          </div>

          {!photoDataUrl && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 text-xs text-gray-500 py-1"
            >
              <Upload size={14} />
              Прикрепить фото из галереи
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default FoundPartModal;
