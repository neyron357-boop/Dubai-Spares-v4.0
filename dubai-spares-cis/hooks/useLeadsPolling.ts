import { useEffect, useRef } from 'react';
import { leadsSync } from '../serverApi';
import { logger } from '../logging';

const POLL_INTERVAL_MS = 60_000;

export const useLeadsPolling = (enabled: boolean = true) => {
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const poll = async () => {
      console.log('[useLeadsPolling] Polling for new leads...');
      const result = await leadsSync();

      if (result.ok) {
        await logger.info('leads:poll', `Polled ${result.data?.length || 0} leads`);
      } else {
        await logger.warn('leads:poll', 'Poll failed', { error: result.error });
      }
    };

    void poll();
    intervalRef.current = window.setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [enabled]);
};
