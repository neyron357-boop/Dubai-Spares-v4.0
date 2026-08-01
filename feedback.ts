export type ToastTone = 'error' | 'success' | 'info';

export const vibrate = (pattern: number | number[]) => {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(pattern);
  }
};

export const toast = (message: string, tone: ToastTone = 'info') => {
  window.dispatchEvent(new CustomEvent('app-toast', { detail: { message, tone } }));
};
