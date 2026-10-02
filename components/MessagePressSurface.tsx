import { useEffect, useRef, type ReactNode } from 'react';

/** Long press never takes pointer capture or prevents the native scroll gesture. */
export default function MessagePressSurface({
  children,
  className,
  label,
  onActions,
  messageId,
  as = 'article',
}: {
  children: ReactNode;
  className?: string;
  label: string;
  onActions: (target: Element | null) => void;
  messageId?: string;
  as?: 'article' | 'div';
}) {
  const timer = useRef<number>();
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const suppressClickUntil = useRef(0);
  const actions = useRef(onActions);
  actions.current = onActions;
  const clear = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    pointer.current = null;
  };
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const start = pointer.current;
      if (
        start?.id === event.pointerId &&
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10
      )
        clear();
    };
    const release = (event: PointerEvent) => {
      if (pointer.current?.id === event.pointerId) clear();
    };
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerup', release, { passive: true });
    window.addEventListener('pointercancel', release, { passive: true });
    window.addEventListener('scroll', clear, { capture: true, passive: true });
    window.addEventListener('blur', clear);
    return () => {
      clear();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      window.removeEventListener('scroll', clear, true);
      window.removeEventListener('blur', clear);
    };
  }, []);
  const Surface = as;
  return (
    <Surface
      className={className}
      aria-label={label}
      tabIndex={0}
      aria-haspopup="dialog"
      aria-keyshortcuts="Shift+F10"
      data-chat-message-id={messageId}
      onPointerDown={(event) => {
        clear();
        if (event.button !== 0 || !event.isPrimary) return;
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest('input, textarea, select')) return;
        pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        const surface = event.currentTarget;
        timer.current = window.setTimeout(() => {
          suppressClickUntil.current = performance.now() + 1000;
          surface.focus({ preventScroll: true });
          actions.current(target);
          try {
            navigator.vibrate?.(12);
          } catch {
            /* Optional haptic feedback. */
          }
          clear();
        }, 550);
      }}
      onClickCapture={(event) => {
        if (performance.now() < suppressClickUntil.current) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        clear();
        event.currentTarget.focus({ preventScroll: true });
        actions.current(event.target instanceof Element ? event.target : null);
      }}
      onKeyDown={(event) => {
        if (
          (event.shiftKey && event.key === 'F10') ||
          event.key === 'ContextMenu' ||
          (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' '))
        ) {
          event.preventDefault();
          clear();
          actions.current(null);
        }
      }}
    >
      {children}
    </Surface>
  );
}
