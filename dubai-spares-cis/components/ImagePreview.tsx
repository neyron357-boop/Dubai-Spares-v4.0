import React, { useEffect, useRef, useState } from 'react';
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Trash2 } from 'lucide-react';

interface Props {
  images: string[];
  initialIndex?: number;
  onClose: () => void;
  onDeleteCurrent?: (index: number) => void;
  deleteLabel?: string;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const ImagePreview: React.FC<Props> = ({ images, initialIndex = 0, onClose, onDeleteCurrent, deleteLabel = 'Удалить' }) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < images.length - 1;

  const goPrev = () => {
    if (!hasPrev) return;
    setCurrentIndex((prev) => prev - 1);
    setZoom(1);
  };

  const goNext = () => {
    if (!hasNext) return;
    setCurrentIndex((prev) => prev + 1);
    setZoom(1);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') goNext();
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === '+') setZoom((value) => clamp(Number((value + 0.2).toFixed(2)), 1, 4));
      if (e.key === '-') setZoom((value) => clamp(Number((value - 0.2).toFixed(2)), 1, 4));
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  if (!images || images.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center p-0" onClick={onClose}>
      <button type="button" onClick={onClose} className="absolute top-6 right-6 p-2 bg-white/10 text-white rounded-full z-50 backdrop-blur-md">
        <X size={24} />
      </button>

      <div className="absolute top-6 left-6 z-50 flex items-center gap-2 rounded-full border border-white/20 bg-black/35 px-2 py-1">
        <button type="button" onClick={(e) => { e.stopPropagation(); setZoom((value) => clamp(Number((value - 0.2).toFixed(2)), 1, 4)); }} className="p-1 text-white/90 disabled:opacity-40" disabled={zoom <= 1}><ZoomOut size={16} /></button>
        <span className="text-[11px] font-bold text-white min-w-[44px] text-center">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={(e) => { e.stopPropagation(); setZoom((value) => clamp(Number((value + 0.2).toFixed(2)), 1, 4)); }} className="p-1 text-white/90 disabled:opacity-40" disabled={zoom >= 4}><ZoomIn size={16} /></button>
      </div>

      {typeof onDeleteCurrent === 'function' && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDeleteCurrent(currentIndex);
            if (currentIndex >= images.length - 1 && currentIndex > 0) {
              setCurrentIndex((prev) => prev - 1);
            }
          }}
          className="absolute top-6 left-28 z-50 inline-flex items-center gap-2 rounded-full border border-rose-300/70 bg-rose-500/80 px-3 py-1.5 text-xs font-black text-white"
        >
          <Trash2 size={14} />
          {deleteLabel}
        </button>
      )}

      {images.length > 1 && (
        <>
          <button type="button" onClick={(e) => { e.stopPropagation(); goPrev(); }} className="absolute left-4 top-1/2 -translate-y-1/2 p-2 bg-white/10 text-white rounded-full disabled:opacity-40" disabled={!hasPrev}><ChevronLeft size={26} /></button>
          <button type="button" onClick={(e) => { e.stopPropagation(); goNext(); }} className="absolute right-4 top-1/2 -translate-y-1/2 p-2 bg-white/10 text-white rounded-full disabled:opacity-40" disabled={!hasNext}><ChevronRight size={26} /></button>
        </>
      )}

      <div
        className="h-full w-full flex items-center justify-center px-4"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => {
          const touch = e.changedTouches[0];
          if (!touch) return;
          touchStartRef.current = { x: touch.clientX, y: touch.clientY };
        }}
        onTouchEnd={(e) => {
          if (!touchStartRef.current) return;
          const touch = e.changedTouches[0];
          if (!touch) return;
          const dx = touch.clientX - touchStartRef.current.x;
          const dy = touch.clientY - touchStartRef.current.y;
          touchStartRef.current = null;
          if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
          if (dx < 0) goNext();
          if (dx > 0) goPrev();
        }}
      >
        <img
          src={images[currentIndex]}
          alt={`Preview ${currentIndex + 1}`}
          className="max-w-full max-h-full object-contain transition-transform duration-150"
          style={{ transform: `scale(${zoom})` }}
          draggable={false}
        />
      </div>

      {images.length > 1 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full border border-white/20 bg-black/35 px-3 py-1 text-xs font-semibold text-white">
          {currentIndex + 1} / {images.length}
        </div>
      )}
    </div>
  );
};

export default ImagePreview;
