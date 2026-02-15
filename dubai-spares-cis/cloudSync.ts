let started = false;
let ready = true;

export async function startCloudSync() {
  started = true;
  ready = true;
  return;
}

export const isCloudSyncReady = () => ready;
export const isCloudSyncStarted = () => started;
