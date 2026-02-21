import { useEffect, useRef } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { leadsSync } from '../serverApi';
import { logger } from '../logging';
import { syncLeadsToState } from '../orderStore';
import { supabase } from '../supabase';

// Poll as a background safety net only — realtime handles instant updates.
// orderStore already has its own 2-minute internal poll + visibility change handler.
const POLL_INTERVAL_MS = 90_000;
const DEBOUNCE_DELAY_MS = 2000;

export const useLeadsPolling = (enabled: boolean = true) => {
  const intervalRef = useRef<number | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const debounceTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const poll = async () => {
      // Skip when the page is not visible to avoid background server load.
      // Missed polls are acceptable here: the orderStore visibilitychange handler
      // in useOrderStore already calls refreshLeadsOnly() when the tab regains focus,
      // and the realtime subscription fires instantly for new INSERT events.
      if (document.visibilityState !== 'visible') return;
      try {
        const result = await leadsSync();
        if (result.ok) {
          const count = result.data?.length || 0;
          await logger.info('leads:poll', `Polled ${count} leads`);
          if (result.data && result.data.length > 0) {
            await syncLeadsToState(result.data);
          }
        } else {
          await logger.warn('leads:poll', 'Poll failed', { error: result.error, code: result.code });
        }
      } catch (error) {
        await logger.error('leads:poll', 'Poll exception', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    };

    const debouncedPoll = () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = window.setTimeout(() => {
        void poll();
        debounceTimerRef.current = null;
      }, DEBOUNCE_DELAY_MS);
    };

    // Do NOT poll immediately on mount — fetchOrders() already calls leadsSync
    // during initial hydration, so an instant poll here would double the request.
    intervalRef.current = window.setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);

    if (supabase) {
      channelRef.current = supabase
        .channel('client-leads-realtime')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'client_leads' }, () => {
          debouncedPoll();
        })
        .subscribe();
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (channelRef.current) {
        channelRef.current.unsubscribe();
        channelRef.current = null;
      }
    };
  }, [enabled]);
};
