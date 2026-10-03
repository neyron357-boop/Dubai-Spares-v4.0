import type { UiSound } from './utils/sounds';
export type ToastTone = 'error' | 'success' | 'info';

export const vibrate = (pattern: number | number[]) => {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(pattern);
  }
};

export const toast = (
  message: string,
  tone: ToastTone = 'info',
  options?: { sound?: UiSound | false },
) => {
  window.dispatchEvent(
    new CustomEvent('app-toast', {
      detail: { message, tone, ...(options?.sound !== undefined ? { sound: options.sound } : {}) },
    }),
  );
};
