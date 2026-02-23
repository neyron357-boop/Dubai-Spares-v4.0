import React, { useState, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';

interface Props {
  images: string[];
  initialIndex?: number;
  onClose: () => void;
}

const ImagePreview: React.FC<Props> = ({ images, initialIndex = 0, onClose }) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [swipeDirection, setSwipeDirection] = useState<0 | 1 | -1>(0);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') nextImage();
      if (e.key === 'ArrowLeft') prevImage();
      if (e.key === '+') setZoom((z) => Math.min(3, Number((z + 0.2).toFixed(2))));
      if (e.key === '-') setZoom((z) => Math.max(1, Number((z - 0.2).toFixed(2))));
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex]);

  useEffect(() => {
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const direction = event.deltaY > 0 ? -0.15 : 0.15;
      setZoom((z) => Math.min(4, Math.max(1, Number((z + direction).toFixed(2)))));
    };

    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleWheel);
  }, []);

  const minSwipeDistance = 50;

  const onTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd || zoom > 1) return;
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;
    if (isLeftSwipe) {
      nextImage();
    } else if (isRightSwipe) {
      prevImage();
    }
  };

  const nextImage = () => {
    if (currentIndex < images.length - 1) {
      setSwipeDirection(1);
      setCurrentIndex((idx) => idx + 1);
      setZoom(1);
    }
  };

  const prevImage = () => {
    if (currentIndex > 0) {
      setSwipeDirection(-1);
      setCurrentIndex((idx) => idx - 1);
      setZoom(1);
    }
  };

  useEffect(() => {
    if (!swipeDirection) return;
    const timer = window.setTimeout(() => setSwipeDirection(0), 220);
    return () => window.clearTimeout(timer);
  }, [swipeDirection]);

  if (!images || images.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center p-0 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-6 right-6 p-2 bg-white/10 text-white rounded-full hover:bg-white/20 transition-colors z-50 backdrop-blur-md"
      >
        <X size={24} />
      </button>

      <div className="absolute top-6 left-6 z-50 flex items-center gap-2 rounded-full border border-white/20 bg-black/35 px-2 py-1">
        <button type="button" onClick={(e) => { e.stopPropagation(); setZoom((z) => Math.max(1, Number((z - 0.2).toFixed(2)))); }} className="p-1 text-white/90 disabled:opacity-40" disabled={zoom <= 1}><ZoomOut size={16} /></button>
        <span className="text-[11px] font-bold text-white min-w-[44px] text-center">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={(e) => { e.stopPropagation(); setZoom((z) => Math.min(3, Number((z + 0.2).toFixed(2)))); }} className="p-1 text-white/90 disabled:opacity-40" disabled={zoom >= 3}><ZoomIn size={16} /></button>
      </div>

      {images.length > 1 && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); prevImage(); }}
            className={`absolute left-4 p-3 rounded-full bg-white/10 text-white hover:bg-white/20 backdrop-blur-md transition-all ${currentIndex === 0 ? 'opacity-30 cursor-not-allowed' : 'opacity-100'}`}
            disabled={currentIndex === 0}
          >
            <ChevronLeft size={32} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); nextImage(); }}
            className={`absolute right-4 p-3 rounded-full bg-white/10 text-white hover:bg-white/20 backdrop-blur-md transition-all ${currentIndex === images.length - 1 ? 'opacity-30 cursor-not-allowed' : 'opacity-100'}`}
            disabled={currentIndex === images.length - 1}
          >
            <ChevronRight size={32} />
          </button>
        </>
      )}

      {images.length > 1 && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 px-3 py-1 bg-black/50 text-white rounded-full text-xs font-bold backdrop-blur-md border border-white/10">
          {currentIndex + 1} / {images.length}
        </div>
      )}

      <div
        className="w-full h-full flex items-center justify-center overflow-auto"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{ touchAction: zoom > 1 ? 'none' : 'pan-y' }}
      >
        <img
          src={images[currentIndex]}
          alt={`Preview ${currentIndex + 1}`}
          className={`max-w-full max-h-full object-contain transition-all duration-200 origin-center ${swipeDirection === 1 ? '-translate-x-3 opacity-90' : swipeDirection === -1 ? 'translate-x-3 opacity-90' : 'translate-x-0 opacity-100'}`}
          style={{ transform: `scale(${zoom})`, touchAction: 'none' }}
          onClick={(e) => {
            e.stopPropagation();
            setZoom((z) => (z > 1 ? 1 : 2));
          }}
        />
      </div>

      {images.length > 1 && (
        <div className="absolute bottom-8 left-0 right-0 flex justify-center gap-2">
          {images.map((_, idx) => (
            <div
              key={idx}
              className={`w-2 h-2 rounded-full transition-all ${idx === currentIndex ? 'bg-white scale-125' : 'bg-white/30'}`}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default ImagePreview;
