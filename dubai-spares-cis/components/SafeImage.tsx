import React, { useMemo, useState } from 'react';
import { getBrokenImagePlaceholder, isBrokenImageUrl, markBrokenImageUrl } from '../storage/brokenImageBlacklist';

type Props = React.ImgHTMLAttributes<HTMLImageElement> & {
  src?: string | null;
};

const SafeImage: React.FC<Props> = ({ src, onError, ...rest }) => {
  const originalSrc = String(src || '').trim();
  const blacklisted = useMemo(() => (originalSrc ? isBrokenImageUrl(originalSrc) : false), [originalSrc]);
  const [failed, setFailed] = useState(blacklisted);

  const safeSrc = !originalSrc || failed ? getBrokenImagePlaceholder() : originalSrc;

  return (
    <img
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
};

export default SafeImage;
