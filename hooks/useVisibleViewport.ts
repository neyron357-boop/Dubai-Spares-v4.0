import { useEffect, useState } from 'react';

/** Keep sheets within the visible area when the mobile keyboard overlays the layout viewport. */
export function useVisibleViewport() {
  const [viewport, setViewport] = useState({
    height: window.innerHeight,
    bottomOffset: 0,
    offsetTop: 0,
  });
  useEffect(() => {
    let frame = 0;
    const update = () => {
      const visible = window.visualViewport;
      // Pinch zoom is a browser camera movement, not a keyboard/layout resize.
      if (visible && Math.abs(visible.scale - 1) > 0.01) return;
      const height = visible?.height ?? window.innerHeight;
      const offsetTop = Math.max(0, visible?.offsetTop ?? 0);
      const next = {
        height,
        offsetTop,
        bottomOffset: Math.max(0, window.innerHeight - height - offsetTop),
      };
      setViewport((previous) =>
        previous.height === next.height &&
        previous.offsetTop === next.offsetTop &&
        previous.bottomOffset === next.bottomOffset
          ? previous
          : next,
      );
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    update();
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, []);
  return viewport;
}
