import { useEffect, useState } from 'react';

/** Keeps list filters while opening an item or returning with the browser Back action. */
export function useSessionState<T>(key: string, initial: T) {
  const storageKey = `dubai_spares_ui:${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw === null) return initial;
      const saved = JSON.parse(raw);
      if (Array.isArray(initial) ? Array.isArray(saved) : typeof saved === typeof initial)
        return saved as T;
    } catch {
      /* A denied session storage must not break navigation. */
    }
    return initial;
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      /* State still works in memory. */
    }
  }, [storageKey, value]);
  return [value, setValue] as const;
}
