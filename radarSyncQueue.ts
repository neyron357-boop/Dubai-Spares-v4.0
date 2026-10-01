import { applyRadarEventAtomic, RadarApplyEventPayload } from './radarSessionService';
export const enqueueRadarSyncEvent = (payload: RadarApplyEventPayload) =>
  applyRadarEventAtomic(payload);
export const startRadarSyncQueue = () => undefined;
