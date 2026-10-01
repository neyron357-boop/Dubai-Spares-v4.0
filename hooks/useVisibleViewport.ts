import { useEffect, useState } from 'react';

/** Keep sheets within the visible area when the mobile keyboard overlays the layout viewport. */
export function useVisibleViewport() {
  const [viewport, setViewport] = useState({ height: window.innerHeight, bottomOffset: 0 });
  useEffect(() => {
    const update = () => {
      const visible = window.visualViewport;
      const height = visible?.height ?? window.innerHeight;
      setViewport({
        height,
        bottomOffset: Math.max(0, window.innerHeight - height - (visible?.offsetTop ?? 0)),
      });
    };
    update();
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  return viewport;
}
