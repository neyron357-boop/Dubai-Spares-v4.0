import { useEffect, useRef } from 'react';
import { leadsSync } from '../serverApi';
import { logger } from '../logging';
import { syncLeadsToState } from '../orderStore';

const POLL_INTERVAL_MS = 60_000;

export const useLeadsPolling = (enabled: boolean = true) => {
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      console.log('[useLeadsPolling] Polling disabled');
      return;
    }

    const poll = async () => {
      console.log('[useLeadsPolling] Polling for new leads...');
      try {
        const result = await leadsSync();

        if (result.ok) {
          const count = result.data?.length || 0;
          console.log('[useLeadsPolling] Polled', count, 'leads');
          await logger.info('leads:poll', `Polled ${count} leads`);
          
          // Merge the fetched leads into the application state
          if (result.data && result.data.length > 0) {
            await syncLeadsToState(result.data);
          }
        } else {
          console.warn('[useLeadsPolling] Poll failed:', result.error);
          await logger.warn('leads:poll', 'Poll failed', {
            error: result.error,
            code: result.code
          });
        }
      } catch (error) {
        console.error('[useLeadsPolling] Poll exception:', error);
        await logger.error('leads:poll', 'Poll exception', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    };

    void poll();

    intervalRef.current = window.setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        console.log('[useLeadsPolling] Stopping polling');
        clearInterval(intervalRef.current);
      }
    };
  }, [enabled]);
};
