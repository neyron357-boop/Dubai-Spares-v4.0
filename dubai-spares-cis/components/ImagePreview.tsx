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
const SWIPE_TRANSITION = 'transform 300ms cubic-bezier(0.22, 0.61, 0.36, 1)';

const ImagePreview: React.FC<Props> = ({ images, initialIndex = 0, onClose, onDeleteCurrent, deleteLabel = 'Удалить' }) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [isInteracting, setIsInteracting] = useState(false);
  const [isSliding, setIsSliding] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const activeTouchId = useRef<number | null>(null);
  const startX = useRef(0);
  const startY = useRef(0);
  const startTime = useRef(0);
  const moveX = useRef(0);
  const moveY = useRef(0);
  const lastTap = useRef(0);
  const rafId = useRef<number | null>(null);
  const dragStart = useRef<Point | null>(null);
  const dragPanStart = useRef<Point>({ x: 0, y: 0 });
  const pinchStartDistance = useRef<number | null>(null);
  const pinchZoomStart = useRef(1);

  const minSwipeDistance = 40;
  const velocityThreshold = 0.45;

  const resetTransform = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const nextImage = () => {
    if (currentIndex >= images.length - 1) return;
    setIsSliding(true);
    setDragOffset(0);
    setCurrentIndex((idx) => idx + 1);
    resetTransform();
  };

  const prevImage = () => {
    if (currentIndex <= 0) return;
    setIsSliding(true);
    setDragOffset(0);
    setCurrentIndex((idx) => idx - 1);
    resetTransform();
  };

  const updateDragOffset = (nextOffset: number) => {
    if (rafId.current) cancelAnimationFrame(rafId.current);
    rafId.current = requestAnimationFrame(() => {
      setDragOffset(nextOffset);
      rafId.current = null;
    });
  };

  const handleSlideEnd = (touchX: number, touchY: number) => {
    const width = containerRef.current?.clientWidth || window.innerWidth;
    const dx = touchX - startX.current;
    const dy = touchY - startY.current;
    const elapsed = Math.max(performance.now() - startTime.current, 1);
    const velocity = dx / elapsed;
    const horizontalIntent = Math.abs(dx) > Math.abs(dy);
    let targetIndex = currentIndex;

    if (horizontalIntent) {
      if (dx < 0 && (Math.abs(dx) > width * 0.24 || velocity < -velocityThreshold) && currentIndex < images.length - 1) {
        targetIndex = currentIndex + 1;
      }
      if (dx > 0 && (dx > width * 0.24 || velocity > velocityThreshold) && currentIndex > 0) {
        targetIndex = currentIndex - 1;
      }
    }

    setIsSliding(true);
    setDragOffset(0);
    if (targetIndex !== currentIndex) {
      setCurrentIndex(targetIndex);
      resetTransform();
    }
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

  useEffect(() => {
    setIsSliding(true);
    setDragOffset(0);
  }, [currentIndex]);

  useEffect(() => {
    const preload = (index: number) => {
      if (index < 0 || index >= images.length) return;
      const img = new Image();
      img.src = images[index];
    };
    preload(currentIndex - 1);
    preload(currentIndex + 1);
  }, [currentIndex, images]);

  useEffect(() => () => {
    if (rafId.current) cancelAnimationFrame(rafId.current);
  }, []);

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
        <div className="absolute inset-x-0 z-50 flex justify-center px-4" style={{ bottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}>
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
        ref={containerRef}
        className="w-full h-full overflow-hidden"
        onTouchStart={(e) => {
          if (e.touches.length === 2) {
            const p1 = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            const p2 = { x: e.touches[1].clientX, y: e.touches[1].clientY };
            pinchStartDistance.current = pinchDistance(p1, p2);
            pinchZoomStart.current = zoom;
            dragStart.current = null;
            activeTouchId.current = null;
            return;
          }

          const touch = e.changedTouches[0];
          activeTouchId.current = touch.identifier;
          startX.current = touch.clientX;
          startY.current = touch.clientY;
          startTime.current = performance.now();
          moveX.current = touch.clientX;
          moveY.current = touch.clientY;
          dragStart.current = { x: touch.clientX, y: touch.clientY };
          dragPanStart.current = pan;
          setIsSliding(false);
        }}
        onTouchMove={(e) => {
          if (e.touches.length === 2 && pinchStartDistance.current) {
            const p1 = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            const p2 = { x: e.touches[1].clientX, y: e.touches[1].clientY };
            const nextZoom = clamp(Number((pinchZoomStart.current * (pinchDistance(p1, p2) / pinchStartDistance.current)).toFixed(3)), 1, 4);
            setIsInteracting(true);
            setZoom(nextZoom);
            setIsSliding(false);
            return;
          }

          const touch = Array.from(e.changedTouches).find((t) => t.identifier === activeTouchId.current) || e.changedTouches[0];
          moveX.current = touch.clientX;
          moveY.current = touch.clientY;

          if (zoom > 1 && dragStart.current) {
            e.preventDefault();
            setIsInteracting(true);
            const dx = touch.clientX - dragStart.current.x;
            const dy = touch.clientY - dragStart.current.y;
            const maxOffset = (zoom - 1) * 220;
            setPan({ x: clamp(dragPanStart.current.x + dx, -maxOffset, maxOffset), y: clamp(dragPanStart.current.y + dy, -maxOffset, maxOffset) });
            return;
          }

          if (zoom <= 1) {
            const width = containerRef.current?.clientWidth || window.innerWidth;
            const rawDx = touch.clientX - startX.current;
            const atEdge = (currentIndex === 0 && rawDx > 0) || (currentIndex === images.length - 1 && rawDx < 0);
            const adjustedDx = atEdge ? rawDx * 0.32 : rawDx;
            updateDragOffset((adjustedDx / width) * 100);
          }
        }}
        onTouchEnd={(e) => {
          const touch = Array.from(e.changedTouches).find((t) => t.identifier === activeTouchId.current) || e.changedTouches[0];
          const tapWindow = 240;
          if (zoom <= 1 && touch) {
            handleSlideEnd(touch.clientX, touch.clientY);
            const traveled = Math.abs(touch.clientX - startX.current) + Math.abs(touch.clientY - startY.current);
            const now = performance.now();
            if (traveled < minSwipeDistance && now - lastTap.current < tapWindow) {
              setZoom((z) => (z > 1 ? 1 : 2.5));
              lastTap.current = 0;
            } else {
              lastTap.current = now;
            }
          } else if (zoom > 1 && touch) {
            const traveled = Math.abs(touch.clientX - startX.current) + Math.abs(touch.clientY - startY.current);
            const now = performance.now();
            if (traveled < minSwipeDistance && now - lastTap.current < tapWindow) {
              setZoom((z) => (z > 1 ? 1 : 2.5));
              lastTap.current = 0;
            } else {
              lastTap.current = now;
            }
          }
          pinchStartDistance.current = null;
          dragStart.current = null;
          activeTouchId.current = null;
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
        <div
          className="h-full flex"
          style={{
            width: '300%',
            transform: `translate3d(calc(-33.3333% + ${dragOffset}%), 0, 0)`,
            transition: isSliding ? SWIPE_TRANSITION : 'none',
            willChange: 'transform',
          }}
          onTransitionEnd={() => setIsSliding(false)}
        >
          {[currentIndex - 1, currentIndex, currentIndex + 1].map((imageIndex, slideIdx) => {
            const src = images[imageIndex];
            const isActive = slideIdx === 1;
            if (!src) {
              return <div key={`empty-${slideIdx}`} className="h-full w-full shrink-0" />;
            }
            return (
              <div key={`${imageIndex}-${src}`} className="h-full w-full shrink-0 flex items-center justify-center">
                <img
                  src={src}
                  alt={`Preview ${imageIndex + 1}`}
                  className={`max-w-full max-h-full object-contain ${isInteracting && isActive ? '' : 'transition-transform duration-150'}`}
                  style={{
                    transform: isActive ? `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})` : 'scale(1)',
                    willChange: 'transform',
                  }}
                  draggable={false}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            );
          })}
        </div>
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
