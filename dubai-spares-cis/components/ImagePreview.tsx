import React, { useEffect, useRef, useState } from 'react';
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Trash2 } from 'lucide-react';
import SafeImage from './SafeImage';

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
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const panStartRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const pinchStateRef = useRef<{ distance: number; zoom: number } | null>(null);

  const resetTransform = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  const clampOffset = (nextZoom: number, x: number, y: number) => {
    if (nextZoom <= 1.01) return { x: 0, y: 0 };
    const limit = ((nextZoom - 1) * 100) / 2;
    return {
      x: clamp(x, -limit, limit),
      y: clamp(y, -limit, limit)
    };
  };

  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < images.length - 1;

  const goPrev = () => {
    if (!hasPrev) return;
    setCurrentIndex((prev) => prev - 1);
    resetTransform();
  };

  const goNext = () => {
    if (!hasNext) return;
    setCurrentIndex((prev) => prev + 1);
    resetTransform();
  };

  const updateZoom = (nextZoomValue: number) => {
    const nextZoom = clamp(Number(nextZoomValue.toFixed(3)), 1, 4);
    setZoom(nextZoom);
    setOffset((prev) => clampOffset(nextZoom, prev.x, prev.y));
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') goNext();
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === '+') updateZoom(zoom + 0.2);
      if (e.key === '-') updateZoom(zoom - 0.2);
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
        <button type="button" onClick={(e) => { e.stopPropagation(); updateZoom(zoom - 0.2); }} className="p-1 text-white/90 disabled:opacity-40" disabled={zoom <= 1}><ZoomOut size={16} /></button>
        <span className="text-[11px] font-bold text-white min-w-[44px] text-center">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={(e) => { e.stopPropagation(); updateZoom(zoom + 0.2); }} className="p-1 text-white/90 disabled:opacity-40" disabled={zoom >= 4}><ZoomIn size={16} /></button>
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
        className="max-h-full max-w-full flex items-center justify-center px-4"
        onClick={(e) => e.stopPropagation()}
        onWheel={(e) => {
          if (!e.ctrlKey) return;
          e.preventDefault();
          const direction = e.deltaY > 0 ? -0.15 : 0.15;
          updateZoom(zoom + direction);
        }}
        onTouchStart={(e) => {
          if (e.touches.length === 2) {
            const [first, second] = [e.touches[0], e.touches[1]];
            const distance = Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
            pinchStateRef.current = { distance, zoom };
            touchStartRef.current = null;
            panStartRef.current = null;
            return;
          }

          if (e.touches.length === 1) {
            const touch = e.touches[0];
            if (zoom > 1.01) {
              panStartRef.current = { x: touch.clientX, y: touch.clientY, offsetX: offset.x, offsetY: offset.y };
              touchStartRef.current = null;
            } else {
              touchStartRef.current = { x: touch.clientX, y: touch.clientY };
              panStartRef.current = null;
            }
          }
        }}
        onTouchMove={(e) => {
          if (e.touches.length === 2 && pinchStateRef.current) {
            e.preventDefault();
            const [first, second] = [e.touches[0], e.touches[1]];
            const distance = Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
            const ratio = distance / Math.max(1, pinchStateRef.current.distance);
            updateZoom(pinchStateRef.current.zoom * ratio);
            return;
          }

          if (e.touches.length === 1 && panStartRef.current && zoom > 1.01) {
            e.preventDefault();
            const touch = e.touches[0];
            const dx = touch.clientX - panStartRef.current.x;
            const dy = touch.clientY - panStartRef.current.y;
            setOffset(clampOffset(zoom, panStartRef.current.offsetX + dx / zoom, panStartRef.current.offsetY + dy / zoom));
          }
        }}
        onTouchEnd={(e) => {
          if (e.touches.length < 2) {
            pinchStateRef.current = null;
          }

          if (e.touches.length === 0) {
            panStartRef.current = null;
          }

          if (!touchStartRef.current || zoom > 1.01) return;
          const touch = e.changedTouches[0];
          if (!touch) return;
          const dx = touch.clientX - touchStartRef.current.x;
          const dy = touch.clientY - touchStartRef.current.y;
          touchStartRef.current = null;
          if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
          if (dx < 0) goNext();
          if (dx > 0) goPrev();
        }}
        style={{ touchAction: 'none' }}
      >
        <SafeImage
          src={images[currentIndex]}
          alt={`Preview ${currentIndex + 1}`}
          className="max-w-full max-h-full object-contain"
          style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom})` }}
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
