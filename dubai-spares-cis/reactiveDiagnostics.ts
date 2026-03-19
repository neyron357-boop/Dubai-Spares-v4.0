import { DomainEventEnvelope, subscribeDomainEvent } from './domainEvents';

export interface ReactiveDiagnosticEntry {
  eventId: string;
  eventType: string;
  aggregateId: string;
  occurredAt: number;
  syncMode: string;
  realtimeConnected: boolean;
  projections: string[];
  subscribers: string[];
  queueTargets: string[];
  cloudTargets: string[];
  failedTargets: string[];
  reason?: string;
}

const MAX_ENTRIES = 100;
const entries: ReactiveDiagnosticEntry[] = [];
let syncMode = 'idle';
let realtimeConnected = false;

const pushEntry = (entry: ReactiveDiagnosticEntry) => {
  entries.unshift(entry);
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  window.dispatchEvent(new CustomEvent('reactive-diagnostics:changed'));
};

export const getReactiveDiagnostics = () => [...entries];

export const setReactiveSyncSnapshot = (patch: Partial<Pick<ReactiveDiagnosticEntry, 'syncMode' | 'realtimeConnected'>>) => {
  if (patch.syncMode) syncMode = patch.syncMode;
  if (typeof patch.realtimeConnected === 'boolean') realtimeConnected = patch.realtimeConnected;
};

export const recordReactiveEvent = (event: DomainEventEnvelope, patch?: Partial<Omit<ReactiveDiagnosticEntry, 'eventId' | 'eventType' | 'aggregateId' | 'occurredAt' | 'syncMode' | 'realtimeConnected'>>) => {
  pushEntry({
    eventId: event.id,
    eventType: event.type,
    aggregateId: event.aggregateId,
    occurredAt: event.occurredAt,
    syncMode,
    realtimeConnected,
    projections: patch?.projections || [],
    subscribers: patch?.subscribers || [],
    queueTargets: patch?.queueTargets || [],
    cloudTargets: patch?.cloudTargets || [],
    failedTargets: patch?.failedTargets || [],
    reason: patch?.reason
  });
};

let installed = false;
export const installReactiveDiagnostics = () => {
  if (installed) return;
  installed = true;
  subscribeDomainEvent('*', async (event) => {
    recordReactiveEvent(event, { subscribers: ['domain-event-bus'] });
  });
};
