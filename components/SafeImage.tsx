import React, { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { getBrokenImagePlaceholder, isBrokenImageUrl, markBrokenImageUrl, removeBrokenImageUrl } from '../storage/brokenImageBlacklist';

type Props = React.ImgHTMLAttributes<HTMLImageElement> & {
  src?: string | null;
};

const SafeImage = forwardRef<HTMLImageElement, Props>(({ src, onError, onLoad, ...rest }, ref) => {
  const originalSrc = String(src || '').trim();
  const blacklisted = useMemo(() => (originalSrc ? isBrokenImageUrl(originalSrc) : false), [originalSrc]);
  const [failed, setFailed] = useState(blacklisted);
  const retryRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    setFailed(blacklisted);
  }, [blacklisted, originalSrc]);

  // When the URL is blacklisted, silently probe it in the background.
  // If it loads successfully, clear the blacklist entry and show the real image.
  useEffect(() => {
    if (!blacklisted || !originalSrc) return;
    const probe = new Image();
    retryRef.current = probe;
    probe.onload = () => {
      if (retryRef.current !== probe) return;
      removeBrokenImageUrl(originalSrc);
      setFailed(false);
    };
    probe.onerror = () => {
      // Still unavailable; keep showing the placeholder.
    };
    probe.src = originalSrc;
    return () => {
      retryRef.current = null;
    };
  }, [blacklisted, originalSrc]);

  const safeSrc = !originalSrc || failed ? getBrokenImagePlaceholder() : originalSrc;

  return (
    <img
      ref={ref}
      {...rest}
      src={safeSrc}
      onLoad={(event) => {
        if (originalSrc && safeSrc === originalSrc) {
          removeBrokenImageUrl(originalSrc);
        }
        onLoad?.(event);
      }}
      onError={(event) => {
        if (!failed && originalSrc) {
          markBrokenImageUrl(originalSrc);
          setFailed(true);
        }
        onError?.(event);
      }}
    />
  );
});

SafeImage.displayName = 'SafeImage';

export default SafeImage;
