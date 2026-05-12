import { setReactiveSyncSnapshot } from './reactiveDiagnostics';

export type SyncMode = 'idle' | 'realtime' | 'polling' | 'local_fallback' | 'pending_flush';
export interface SyncCoordinatorSnapshot {
  mode: SyncMode;
  realtimeConnected: boolean;
  visibility: DocumentVisibilityState;
  online: boolean;
  pendingQueue: boolean;
  lastDecisionAt: number;
}

let snapshot: SyncCoordinatorSnapshot = {
  mode: 'idle',
  realtimeConnected: false,
  visibility: typeof document !== 'undefined' ? document.visibilityState : 'visible',
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  pendingQueue: false,
  lastDecisionAt: Date.now()
};

const emitSnapshot = () => {
  snapshot = { ...snapshot, lastDecisionAt: Date.now() };
  setReactiveSyncSnapshot({ syncMode: snapshot.mode, realtimeConnected: snapshot.realtimeConnected });
  window.dispatchEvent(new CustomEvent('reactive-sync:changed', { detail: snapshot }));
};

export const getSyncCoordinatorSnapshot = () => snapshot;

export const updateSyncCoordinator = (patch: Partial<SyncCoordinatorSnapshot>) => {
  const next = { ...snapshot, ...patch };
  if (
    next.mode === snapshot.mode
    && next.realtimeConnected === snapshot.realtimeConnected
    && next.visibility === snapshot.visibility
    && next.online === snapshot.online
    && next.pendingQueue === snapshot.pendingQueue
  ) {
    return snapshot;
  }
  snapshot = next;
  emitSnapshot();
  return snapshot;
};

export const decideSyncMode = (input?: { realtimeConnected?: boolean; pendingQueue?: boolean }) => {
  const online = typeof navigator !== 'undefined' ? navigator.onLine : true;
  const visibility = typeof document !== 'undefined' ? document.visibilityState : 'visible';
  const realtimeConnected = input?.realtimeConnected ?? snapshot.realtimeConnected;
  const pendingQueue = input?.pendingQueue ?? snapshot.pendingQueue;
  let mode: SyncMode = 'idle';
  if (!online) mode = pendingQueue ? 'pending_flush' : 'local_fallback';
  else if (realtimeConnected) mode = 'realtime';
  else if (visibility === 'visible') mode = 'polling';
  else mode = pendingQueue ? 'pending_flush' : 'idle';
  return updateSyncCoordinator({ mode, online, visibility, realtimeConnected, pendingQueue });
};
