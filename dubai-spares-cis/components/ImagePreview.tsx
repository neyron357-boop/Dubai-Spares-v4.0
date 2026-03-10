import React, { useEffect, useRef, useState } from 'react';
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Trash2, Share2, Download } from 'lucide-react';
import SafeImage from './SafeImage';

interface Props {
  images: string[];
  initialIndex?: number;
  onClose: () => void;
  onDeleteCurrent?: (index: number) => void;
  deleteLabel?: string;
  shareTitle?: string;
  shareText?: string;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const isUnavailablePlaceholder = (value: string) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return true;
  return normalized.includes('photo-unavailable')
    || normalized.includes('no-photo')
    || normalized.includes('no_image')
    || normalized.includes('placeholder')
    || normalized.includes('%d1%84%d0%be%d1%82%d0%be%20%d0%bd%d0%b5%d0%b4%d0%be%d1%81%d1%82%d1%83%d0%bf%d0%bd%d0%be')
    || normalized.includes('фото недоступно');
};

const ImagePreview: React.FC<Props> = ({
  images,
  initialIndex = 0,
  onClose,
  onDeleteCurrent,
  deleteLabel = 'Удалить',
  shareTitle = 'Vehicle photos',
  shareText = 'Vehicle photos'
}) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const panStartRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const pinchStateRef = useRef<{ distance: number; zoom: number } | null>(null);

  const resetTransform = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  const clampOffset = (nextZoom: number, x: number, y: number) => {
    if (nextZoom <= 1.01) return { x: 0, y: 0 };

    const viewportRect = viewportRef.current?.getBoundingClientRect();
    const imageRect = imageRef.current?.getBoundingClientRect();
    if (!viewportRect || !imageRect || viewportRect.width <= 0 || viewportRect.height <= 0) {
      return { x: 0, y: 0 };
    }

    const baseWidth = imageRect.width / Math.max(zoom, 1);
    const baseHeight = imageRect.height / Math.max(zoom, 1);
    const scaledWidth = baseWidth * nextZoom;
    const scaledHeight = baseHeight * nextZoom;

    const limitX = Math.max(0, (scaledWidth - viewportRect.width) / 2);
    const limitY = Math.max(0, (scaledHeight - viewportRect.height) / 2);

    return {
      x: clamp(x, -limitX, limitX),
      y: clamp(y, -limitY, limitY)
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

  const currentImageUrl = images[currentIndex];
  const actionableImages = images.filter((image) => !isUnavailablePlaceholder(image));
  const canShareOrSave = actionableImages.length > 0;

  const toImageFile = async (url: string, index: number) => {
    const response = await fetch(url, { mode: 'cors' });
    const blob = await response.blob();
    const ext = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg';
    return new File([blob], `photo-${index + 1}.${ext}`, { type: blob.type || 'image/jpeg' });
  };

  const handleShare = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (!canShareOrSave || !navigator.share) return;
    try {
      const preparedFiles = await Promise.allSettled(actionableImages.map((image, index) => toImageFile(image, index)));
      const files = preparedFiles
        .filter((item): item is PromiseFulfilledResult<File> => item.status === 'fulfilled')
        .map((item) => item.value);

      if (files.length > 0 && navigator.canShare?.({ files })) {
        await navigator.share({ title: shareTitle, text: shareText, files });
        return;
      }

      await navigator.share({
        title: shareTitle,
        text: `${shareText}\n${actionableImages.join('\n')}`.trim()
      });
    } catch {
      // user cancelled share sheet
    }
  };

  const handleSave = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (!canShareOrSave) return;
    actionableImages.forEach((url, index) => {
      const link = document.createElement('a');
      link.href = url;
      link.download = `image-${index + 1}.jpg`;
      link.rel = 'noopener';
      link.click();
    });
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

      {canShareOrSave && (
        <div className="absolute top-20 right-6 z-50 flex flex-col gap-2">
          <button
            type="button"
            onClick={handleShare}
            className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-black/50 px-3 py-1.5 text-xs font-bold text-white"
          >
            <Share2 size={14} />
            Поделиться
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-black/50 px-3 py-1.5 text-xs font-bold text-white"
          >
            <Download size={14} />
            Сохранить
          </button>
        </div>
      )}

      {images.length > 1 && (
        <>
          <button type="button" onClick={(e) => { e.stopPropagation(); goPrev(); }} className="absolute left-4 top-1/2 -translate-y-1/2 p-2 bg-white/10 text-white rounded-full disabled:opacity-40" disabled={!hasPrev}><ChevronLeft size={26} /></button>
          <button type="button" onClick={(e) => { e.stopPropagation(); goNext(); }} className="absolute right-4 top-1/2 -translate-y-1/2 p-2 bg-white/10 text-white rounded-full disabled:opacity-40" disabled={!hasNext}><ChevronRight size={26} /></button>
        </>
      )}

      <div
        ref={viewportRef}
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
            setOffset(clampOffset(zoom, panStartRef.current.offsetX + dx, panStartRef.current.offsetY + dy));
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
          ref={imageRef}
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
