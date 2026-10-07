import { loadAppSettings } from '../appSettings';

/**
 * One physical response for every control: it sinks under the finger in proportion to
 * its size, follows the finger off and back on, and springs back on release.
 * Scrolling cancels the press so lists never flicker while they move.
 */

const PRESSABLE = [
  'button',
  'a[href]',
  'summary',
  '[role="button"]',
  '[role="tab"]',
  '[role="switch"]',
  '[role="option"]',
  '[role="menuitem"]',
  '[role="menuitemradio"]',
  '[role="radio"]',
  'label:has(> input[type="checkbox"])',
  'label:has(> input[type="radio"])',
  '.ds-press',
  '.ui-button',
  '.order-card',
  '.cursor-pointer',
  '[data-press]',
].join(', ');

/** Selection changes get a short tick, like native segmented controls and switches. */
const SELECTION = [
  '[role="tab"]',
  '[role="switch"]',
  '[role="option"]',
  '[role="radio"]',
  '[role="menuitemradio"]',
  '[aria-pressed]',
  '[aria-checked]',
  '.app-nav-item',
].join(', ');

type Haptic = 'selection' | 'light' | 'success' | 'warning' | 'error';
const HAPTIC_PATTERNS: Record<Haptic, number | number[]> = {
  selection: 6,
  light: 10,
  success: [10, 70, 16],
  warning: [16, 90, 16],
  error: [20, 60, 20, 60, 24],
};

/** Damped spring step response sampled into a CSS linear() easing. */
const springEasing = (damping: number, frequency: number, seconds: number, samples = 30) => {
  const damped = frequency * Math.sqrt(1 - damping * damping);
  const points: string[] = [];
  for (let index = 0; index <= samples; index++) {
    const time = (index / samples) * seconds;
    const value =
      1 -
      Math.exp(-damping * frequency * time) *
        (Math.cos(damped * time) + ((damping * frequency) / damped) * Math.sin(damped * time));
    points.push(index === samples ? '1' : value.toFixed(3));
  }
  return `linear(${points.join(', ')})`;
};

const supportsLinearEasing = () => {
  try {
    return CSS.supports('animation-timing-function', 'linear(0, 1)');
  } catch {
    return false;
  }
};

let releaseEasing = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
const PRESS_EASING = 'cubic-bezier(0.25, 0.1, 0.25, 1)';
const PRESS_DELAY_TOUCH = 45;
const MOVE_TOLERANCE = 12;

type PressState = {
  element: HTMLElement;
  pointerId: number;
  startX: number;
  startY: number;
  depth: number;
  visible: boolean;
  inside: boolean;
  timer: number;
};

const animations = new WeakMap<HTMLElement, Animation>();
let reducedMotion = false;
let current: PressState | null = null;

const hapticsEnabled = () => {
  try {
    return loadAppSettings().hapticsEnabled !== false;
  } catch {
    return true;
  }
};

export const haptic = (kind: Haptic) => {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  if (!hapticsEnabled()) return;
  try {
    navigator.vibrate(HAPTIC_PATTERNS[kind]);
  } catch {
    // Some browsers throw without a recent user gesture; feedback is optional.
  }
};

const isDisabled = (element: Element) =>
  element.matches(':disabled, [aria-disabled="true"]') ||
  Boolean(element.closest('fieldset:disabled, [inert]'));

const findPressable = (target: EventTarget | null): HTMLElement | null => {
  if (!(target instanceof Element)) return null;
  // Text entry and native pickers keep their own platform feedback.
  if (target.closest('input:not([type="checkbox"]):not([type="radio"]), textarea, select')) {
    return null;
  }
  const element = target.closest<HTMLElement>(PRESSABLE);
  if (!element || element.closest('[data-press="none"]') || isDisabled(element)) return null;
  return element;
};

/** Small icons sink further than wide cards so every size feels equally physical. */
const pressDepth = (element: HTMLElement) => {
  const custom = Number(element.dataset.pressScale);
  if (Number.isFinite(custom) && custom > 0 && custom <= 1) return custom;
  const { width, height } = element.getBoundingClientRect();
  const largest = Math.max(width, height);
  if (largest <= 52) return 0.88;
  if (largest <= 120) return 0.94;
  if (width >= 300 || height >= 140) return 0.985;
  return 0.965;
};

const currentScale = (element: HTMLElement) => {
  const value = getComputedStyle(element).scale;
  const parsed = Number.parseFloat(value);
  return value === 'none' || !Number.isFinite(parsed) ? 1 : parsed;
};

const animateTo = (
  element: HTMLElement,
  frames: Keyframe[],
  options: KeyframeAnimationOptions,
  keep: boolean,
) => {
  if (typeof element.animate !== 'function') return;
  const previous = animations.get(element);
  const animation = element.animate(frames, { fill: 'forwards', ...options });
  previous?.cancel();
  animations.set(element, animation);
  animation.finished
    .then(() => {
      if (keep || animations.get(element) !== animation) return;
      animation.cancel();
      animations.delete(element);
    })
    .catch(() => {});
};

const sink = (state: PressState) => {
  state.visible = true;
  state.element.dataset.pressed = '';
  if (reducedMotion) return;
  animateTo(
    state.element,
    [
      { scale: String(currentScale(state.element)) },
      { scale: String(state.depth), filter: 'brightness(0.96)' },
    ],
    { duration: 110, easing: PRESS_EASING },
    true,
  );
};

const rise = (element: HTMLElement, from?: number) => {
  delete element.dataset.pressed;
  if (reducedMotion) return;
  animateTo(
    element,
    [{ scale: String(from ?? currentScale(element)) }, { scale: '1', filter: 'none' }],
    { duration: 520, easing: releaseEasing },
    false,
  );
};

/** A tap shorter than the press delay still visibly lands and springs back. */
const pulse = (element: HTMLElement, depth: number) => {
  if (reducedMotion) return;
  animateTo(
    element,
    [
      { scale: '1', offset: 0, easing: PRESS_EASING },
      { scale: String(depth), filter: 'brightness(0.96)', offset: 0.17, easing: releaseEasing },
      { scale: '1', filter: 'none', offset: 1 },
    ],
    { duration: 600 },
    false,
  );
};

const end = (commit: boolean) => {
  const state = current;
  if (!state) return;
  current = null;
  window.clearTimeout(state.timer);
  if (state.visible) rise(state.element);
  else if (commit) pulse(state.element, state.depth);
};

const onPointerDown = (event: PointerEvent) => {
  if (!event.isPrimary || event.button !== 0) return;
  end(false);
  const element = findPressable(event.target);
  if (!element) return;
  const state: PressState = {
    element,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    depth: pressDepth(element),
    visible: false,
    inside: true,
    timer: 0,
  };
  current = state;
  if (event.pointerType === 'mouse') sink(state);
  else state.timer = window.setTimeout(() => current === state && sink(state), PRESS_DELAY_TOUCH);
};

const onPointerMove = (event: PointerEvent) => {
  const state = current;
  if (!state || event.pointerId !== state.pointerId) return;
  const moved = Math.hypot(event.clientX - state.startX, event.clientY - state.startY);
  if (event.pointerType !== 'mouse' && moved > MOVE_TOLERANCE && !state.visible) {
    // The finger is scrolling, not pressing.
    current = null;
    window.clearTimeout(state.timer);
    return;
  }
  if (!state.visible) return;
  const rect = state.element.getBoundingClientRect();
  const slop = 24;
  const inside =
    event.clientX >= rect.left - slop &&
    event.clientX <= rect.right + slop &&
    event.clientY >= rect.top - slop &&
    event.clientY <= rect.bottom + slop;
  if (inside === state.inside) return;
  state.inside = inside;
  // Dragging off a control lifts it, as on iOS, and dragging back presses it again.
  if (inside) sink(state);
  else rise(state.element);
};

const onPointerUp = (event: PointerEvent) => {
  if (current && event.pointerId === current.pointerId) end(current.inside);
};
const onPointerCancel = (event: PointerEvent) => {
  if (current && event.pointerId === current.pointerId) end(false);
};

const onKeyDown = (event: KeyboardEvent) => {
  if (event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
  const element = findPressable(event.target);
  if (element && element === document.activeElement) pulse(element, pressDepth(element));
};

const onClick = (event: MouseEvent) => {
  if (!event.isTrusted || !(event.target instanceof Element)) return;
  const element = findPressable(event.target);
  if (!element) return;
  if (element.matches(SELECTION) || element.closest('[role="tablist"], [role="radiogroup"]')) {
    haptic('selection');
  } else if (element.matches('.ui-button-primary, .app-nav-create, [data-haptic="light"]')) {
    haptic('light');
  }
};

const onChange = (event: Event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement && (target.type === 'checkbox' || target.type === 'radio'))
    haptic('selection');
};

const onToast = (event: Event) => {
  const tone = (event as CustomEvent<{ tone?: string }>).detail?.tone;
  if (tone === 'success') haptic('success');
  else if (tone === 'error') haptic('error');
};

let owners = 0;
let detach: (() => void) | null = null;

export function installTouchFeedback(): () => void {
  if (owners++ === 0 && typeof window !== 'undefined') {
    if (supportsLinearEasing()) releaseEasing = springEasing(0.5, 21, 0.6);
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    reducedMotion = Boolean(motion?.matches);
    const motionChanged = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches;
    };
    const visibility = () => {
      if (document.visibilityState === 'hidden') end(false);
    };
    const scroll = () => {
      if (current && !current.visible) end(false);
    };
    motion?.addEventListener?.('change', motionChanged);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointermove', onPointerMove, { capture: true, passive: true });
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerCancel, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('change', onChange, true);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('scroll', scroll, { capture: true, passive: true });
    window.addEventListener('app-toast', onToast);
    detach = () => {
      end(false);
      motion?.removeEventListener?.('change', motionChanged);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', onPointerCancel, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('change', onChange, true);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('app-toast', onToast);
    };
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--owners > 0) return;
    detach?.();
    detach = null;
  };
}
