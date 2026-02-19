import { useEffect, useRef } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { leadsSync } from '../serverApi';
import { logger } from '../logging';
import { syncLeadsToState } from '../orderStore';
import { supabase } from '../supabase';

const POLL_INTERVAL_MS = 30_000;
const DEBOUNCE_DELAY_MS = 2000; // Debounce realtime polls to prevent rapid successive calls

export const useLeadsPolling = (enabled: boolean = true) => {
  const intervalRef = useRef<number | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const debounceTimerRef = useRef<number | null>(null);

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

    const debouncedPoll = () => {
      // Clear existing debounce timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      
      // Schedule a new poll after debounce delay
      debounceTimerRef.current = window.setTimeout(() => {
        void poll();
        debounceTimerRef.current = null;
      }, DEBOUNCE_DELAY_MS);
    };

    // Initial poll
    void poll();

    // Set up periodic polling
    intervalRef.current = window.setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);

    // Set up realtime subscription for instant updates (only if supabase is configured)
    if (supabase) {
      console.log('[useLeadsPolling] Setting up realtime subscription for client_leads');
      channelRef.current = supabase
        .channel('client-leads-realtime')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'client_leads' }, () => {
          console.log('[useLeadsPolling] Realtime INSERT event received');
          // Use debounced poll to prevent rapid successive calls
          debouncedPoll();
        })
        .subscribe((status) => {
          console.log('[useLeadsPolling] Realtime subscription status:', status);
        });
    }

    return () => {
      if (intervalRef.current) {
        console.log('[useLeadsPolling] Stopping polling');
        clearInterval(intervalRef.current);
      }
      
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      
      if (channelRef.current) {
        console.log('[useLeadsPolling] Removing realtime subscription');
        channelRef.current.unsubscribe();
        channelRef.current = null;
      }
    };
  }, [enabled]);
};
