import React, { forwardRef, useMemo, useState } from 'react';
import { getBrokenImagePlaceholder, isBrokenImageUrl, markBrokenImageUrl } from '../storage/brokenImageBlacklist';

type Props = React.ImgHTMLAttributes<HTMLImageElement> & {
  src?: string | null;
};

const SafeImage = forwardRef<HTMLImageElement, Props>(({ src, onError, ...rest }, ref) => {
  const originalSrc = String(src || '').trim();
  const blacklisted = useMemo(() => (originalSrc ? isBrokenImageUrl(originalSrc) : false), [originalSrc]);
  const [failed, setFailed] = useState(blacklisted);

  const safeSrc = !originalSrc || failed ? getBrokenImagePlaceholder() : originalSrc;

  return (
    <img
      ref={ref}
      {...rest}
      src={safeSrc}
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
