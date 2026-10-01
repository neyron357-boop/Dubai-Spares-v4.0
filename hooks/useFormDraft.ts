import { useCallback, useEffect, useRef, useState } from 'react';

const MAX_AGE = 7 * 24 * 60 * 60 * 1000;

export function readFormDraft<T>(key: string, validate: (value: unknown) => value is T): T | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    if (
      !value ||
      !Number.isFinite(Number(value.savedAt)) ||
      Date.now() - Number(value.savedAt) > MAX_AGE ||
      !validate(value.data)
    )
      return null;
    return value.data;
  } catch {
    return null;
  }
}

/** Saves on change, navigation, tab hiding and reload. Never asks for network access. */
export function useFormDraft<T>({
  key,
  data,
  hasContent,
  enabled = true,
}: {
  key: string;
  data: T;
  hasContent: boolean;
  enabled?: boolean;
}) {
  const latest = useRef({ data, hasContent, enabled });
  const completed = useRef(false);
  latest.current = { data, hasContent, enabled };
  const [status, setStatus] = useState<'empty' | 'saved' | 'unavailable'>('empty');
  const persist = useCallback(() => {
    const current = latest.current;
    if (!current.enabled || completed.current) return;
    try {
      if (current.hasContent)
        localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data: current.data }));
      else localStorage.removeItem(key);
      setStatus(current.hasContent ? 'saved' : 'empty');
    } catch {
      setStatus('unavailable');
    }
  }, [key]);
  useEffect(() => {
    const timer = window.setTimeout(persist, 350);
    return () => window.clearTimeout(timer);
  }, [data, persist]);
  useEffect(() => {
    const saveOnHide = () => {
      if (document.visibilityState === 'hidden') persist();
    };
    window.addEventListener('pagehide', persist);
    document.addEventListener('visibilitychange', saveOnHide);
    return () => {
      persist();
      window.removeEventListener('pagehide', persist);
      document.removeEventListener('visibilitychange', saveOnHide);
    };
  }, [persist]);
  const clear = useCallback(() => {
    completed.current = true;
    latest.current.enabled = false;
    try {
      localStorage.removeItem(key);
    } catch {
      /* The completed order has its own durable storage. */
    }
    setStatus('empty');
  }, [key]);
  return { status, clear };
}
