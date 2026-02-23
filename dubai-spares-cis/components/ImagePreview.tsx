import React, { useEffect, useRef, useState } from 'react';
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Trash2 } from 'lucide-react';

interface Props {
  images: string[];
  initialIndex?: number;
  onClose: () => void;
  onDeleteCurrent?: (index: number) => void;
  deleteLabel?: string;
}

type Point = { x: number; y: number };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const pinchDistance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

const ImagePreview: React.FC<Props> = ({ images, initialIndex = 0, onClose, onDeleteCurrent, deleteLabel = 'Удалить' }) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [isInteracting, setIsInteracting] = useState(false);

  const touchStartX = useRef<number | null>(null);
  const touchEndX = useRef<number | null>(null);
  const dragStart = useRef<Point | null>(null);
  const dragPanStart = useRef<Point>({ x: 0, y: 0 });
  const pinchStartDistance = useRef<number | null>(null);
  const pinchZoomStart = useRef(1);

  const minSwipeDistance = 50;

  const resetTransform = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const nextImage = () => {
    if (currentIndex >= images.length - 1) return;
    setCurrentIndex((idx) => idx + 1);
    resetTransform();
  };

  const prevImage = () => {
    if (currentIndex <= 0) return;
    setCurrentIndex((idx) => idx - 1);
    resetTransform();
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') nextImage();
      if (e.key === 'ArrowLeft') prevImage();
      if (e.key === '+') setZoom((z) => clamp(Number((z + 0.2).toFixed(2)), 1, 4));
      if (e.key === '-') setZoom((z) => clamp(Number((z - 0.2).toFixed(2)), 1, 4));
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  useEffect(() => {
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const direction = event.deltaY > 0 ? -0.15 : 0.15;
      setZoom((z) => clamp(Number((z + direction).toFixed(2)), 1, 4));
    };

    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleWheel);
  }, []);

  useEffect(() => {
    if (zoom <= 1.02) setPan({ x: 0, y: 0 });
  }, [zoom]);

  if (!images || images.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center p-0" onClick={onClose}>
      <button onClick={onClose} className="absolute top-6 right-6 p-2 bg-white/10 text-white rounded-full z-50 backdrop-blur-md">
        <X size={24} />
      </button>

      <div className="absolute top-6 left-6 z-50 flex items-center gap-2 rounded-full border border-white/20 bg-black/35 px-2 py-1">
        <button type="button" onClick={(e) => { e.stopPropagation(); setZoom((z) => clamp(Number((z - 0.2).toFixed(2)), 1, 4)); }} className="p-1 text-white/90 disabled:opacity-40" disabled={zoom <= 1}><ZoomOut size={16} /></button>
        <span className="text-[11px] font-bold text-white min-w-[44px] text-center">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={(e) => { e.stopPropagation(); setZoom((z) => clamp(Number((z + 0.2).toFixed(2)), 1, 4)); }} className="p-1 text-white/90 disabled:opacity-40" disabled={zoom >= 4}><ZoomIn size={16} /></button>
      </div>

      {images.length > 1 && (
        <>
          <button onClick={(e) => { e.stopPropagation(); prevImage(); }} className={`absolute left-4 p-3 rounded-full bg-white/10 text-white backdrop-blur-md ${currentIndex === 0 ? 'opacity-30 cursor-not-allowed' : 'opacity-100'}`} disabled={currentIndex === 0}><ChevronLeft size={32} /></button>
          <button onClick={(e) => { e.stopPropagation(); nextImage(); }} className={`absolute right-4 p-3 rounded-full bg-white/10 text-white backdrop-blur-md ${currentIndex === images.length - 1 ? 'opacity-30 cursor-not-allowed' : 'opacity-100'}`} disabled={currentIndex === images.length - 1}><ChevronRight size={32} /></button>
        </>
      )}


      {onDeleteCurrent && (
        <div className="absolute inset-x-0 bottom-6 z-50 flex justify-center px-4">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteCurrent(currentIndex);
            }}
            className="inline-flex h-11 items-center gap-2 rounded-full border border-rose-300 bg-rose-500/90 px-5 text-sm font-bold text-white shadow-lg"
          >
            <Trash2 size={16} />
            {deleteLabel}
          </button>
        </div>
      )}

      <div
        className="w-full h-full overflow-hidden flex items-center justify-center"
        onTouchStart={(e) => {
          if (e.touches.length === 2) {
            const p1 = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            const p2 = { x: e.touches[1].clientX, y: e.touches[1].clientY };
            pinchStartDistance.current = pinchDistance(p1, p2);
            pinchZoomStart.current = zoom;
            dragStart.current = null;
            return;
          }

          touchEndX.current = null;
          touchStartX.current = e.targetTouches[0].clientX;
          dragStart.current = { x: e.targetTouches[0].clientX, y: e.targetTouches[0].clientY };
          dragPanStart.current = pan;
        }}
        onTouchMove={(e) => {
          if (e.touches.length === 2 && pinchStartDistance.current) {
            const p1 = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            const p2 = { x: e.touches[1].clientX, y: e.touches[1].clientY };
            const nextZoom = clamp(Number((pinchZoomStart.current * (pinchDistance(p1, p2) / pinchStartDistance.current)).toFixed(3)), 1, 4);
            setIsInteracting(true);
            setZoom(nextZoom);
            return;
          }

          touchEndX.current = e.targetTouches[0].clientX;
          if (zoom <= 1 || !dragStart.current) return;
          e.preventDefault();
          setIsInteracting(true);
          const dx = e.targetTouches[0].clientX - dragStart.current.x;
          const dy = e.targetTouches[0].clientY - dragStart.current.y;
          const maxOffset = (zoom - 1) * 220;
          setPan({ x: clamp(dragPanStart.current.x + dx, -maxOffset, maxOffset), y: clamp(dragPanStart.current.y + dy, -maxOffset, maxOffset) });
        }}
        onTouchEnd={() => {
          if (zoom <= 1 && touchStartX.current !== null && touchEndX.current !== null) {
            const distance = touchStartX.current - touchEndX.current;
            if (distance > minSwipeDistance) nextImage();
            if (distance < -minSwipeDistance) prevImage();
          }
          pinchStartDistance.current = null;
          dragStart.current = null;
          setIsInteracting(false);
        }}
        onMouseDown={(e) => {
          if (zoom <= 1) return;
          setIsInteracting(true);
          dragStart.current = { x: e.clientX, y: e.clientY };
          dragPanStart.current = pan;
        }}
        onMouseMove={(e) => {
          if (zoom <= 1 || !dragStart.current) return;
          const dx = e.clientX - dragStart.current.x;
          const dy = e.clientY - dragStart.current.y;
          const maxOffset = (zoom - 1) * 220;
          setPan({ x: clamp(dragPanStart.current.x + dx, -maxOffset, maxOffset), y: clamp(dragPanStart.current.y + dy, -maxOffset, maxOffset) });
        }}
        onMouseUp={() => {
          dragStart.current = null;
          setIsInteracting(false);
        }}
        style={{ touchAction: zoom > 1 ? 'none' : 'pan-y' }}
      >
        <img
          src={images[currentIndex]}
          alt={`Preview ${currentIndex + 1}`}
          className={`max-w-full max-h-full object-contain ${isInteracting ? '' : 'transition-transform duration-150'}`}
          style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`, willChange: 'transform' }}
          onClick={(e) => {
            e.stopPropagation();
            setZoom((z) => (z > 1 ? 1 : 2));
          }}
        />
      </div>
    </div>
  );
};

export default ImagePreview;
