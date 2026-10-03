import { APP_SETTINGS_KEY } from '../appSettings';
import { renderUiSound, UI_SOUND_DESIGN, type UiSound } from './uiSoundDesign';

export type { UiSound } from './uiSoundDesign';
export type SoundPreviewResult = 'played' | 'muted' | 'busy' | 'unavailable';

type Voice = {
  source: AudioBufferSourceNode;
  gain: GainNode;
  type: UiSound;
  endsAt: number;
};
type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };
const priority: Record<UiSound, number> = {
  tap: 0,
  navigate: 1,
  notification: 2,
  success: 3,
  delete: 3,
  error: 4,
};
const minimumGap: Record<UiSound, number> = {
  tap: 55,
  navigate: 100,
  notification: 240,
  success: 180,
  delete: 180,
  error: 220,
};
let context: AudioContext | null = null;
let resumePending: Promise<boolean> | null = null;
let active: Voice | null = null;
let revision = 0;
let owners = 0;
let removeListeners: (() => void) | null = null;
let pendingCue = 0;
let lastType: UiSound | null = null;
let lastStartedAt = -Infinity;
const voices = new Set<Voice>();
const buffers = new Map<UiSound, AudioBuffer>();
const holds = new Set<symbol>();

function preferences() {
  try {
    const raw = JSON.parse(localStorage.getItem(APP_SETTINGS_KEY) || '{}') as {
      soundsEnabled?: unknown;
      soundVolume?: unknown;
    };
    const volume =
      typeof raw.soundVolume === 'number' && Number.isFinite(raw.soundVolume)
        ? Math.max(0, Math.min(100, raw.soundVolume))
        : 55;
    return { enabled: raw.soundsEnabled === true, volume };
  } catch {
    return { enabled: false, volume: 55 };
  }
}

function mediaPlaying() {
  return Array.from(document.querySelectorAll<HTMLMediaElement>('audio, video')).some(
    (media) => !media.paused && !media.ended,
  );
}

function availability(): SoundPreviewResult | null {
  if (!owners) return 'unavailable';
  const pref = preferences();
  if (!pref.enabled || pref.volume === 0) return 'muted';
  if (document.visibilityState === 'hidden' || holds.size || mediaPlaying()) return 'busy';
  return null;
}

function obtainContext(): AudioContext | null {
  if (context && context.state !== 'closed') return context;
  try {
    const Constructor = window.AudioContext || (window as WebkitWindow).webkitAudioContext;
    if (!Constructor) return null;
    context = new Constructor({ latencyHint: 'interactive' });
    buffers.clear();
    return context;
  } catch {
    return null;
  }
}

function ensureRunning(current: AudioContext): Promise<boolean> {
  if (current.state === 'running') return Promise.resolve(true);
  if (current.state === 'closed') return Promise.resolve(false);
  if (resumePending) return resumePending;
  // A blocked browser must not queue an old confirmation until a future gesture.
  let timer: ReturnType<typeof setTimeout>;
  let resumed: Promise<boolean>;
  try {
    // Keep resume inside the initiating gesture, including Safari's activation window.
    resumed = current
      .resume()
      .then(() => current.state === 'running')
      .catch(() => false);
  } catch {
    return Promise.resolve(false);
  }
  const pending = Promise.race([
    resumed,
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), 180);
    }),
  ]).finally(() => {
    clearTimeout(timer);
    if (resumePending === pending) resumePending = null;
  });
  resumePending = pending;
  return pending;
}

function releaseVoice(voice: Voice) {
  voice.source.onended = null;
  voice.source.disconnect();
  voice.gain.disconnect();
  voices.delete(voice);
  if (active === voice) active = null;
}

function stopVoices(immediate: boolean) {
  const current = context;
  for (const voice of voices) {
    try {
      if (current && current.state === 'running' && !immediate) {
        const time = current.currentTime;
        voice.gain.gain.cancelScheduledValues(time);
        voice.gain.gain.setValueAtTime(voice.gain.gain.value, time);
        voice.gain.gain.linearRampToValueAtTime(0, time + 0.012);
        voice.source.stop(time + 0.014);
      } else {
        voice.source.stop();
        releaseVoice(voice);
      }
    } catch {
      releaseVoice(voice);
    }
  }
  active = null;
}

export function stopUiSounds() {
  revision++;
  pendingCue++;
  stopVoices(true);
}

/** The caller releases its own lease; one recorder cannot unmute another. */
export function holdUiSounds(): () => void {
  const lease = Symbol('microphone');
  holds.add(lease);
  stopUiSounds();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds.delete(lease);
  };
}

function schedule(current: AudioContext, type: UiSound) {
  const rate = Math.min(96000, Math.max(8000, current.sampleRate || 48000));
  let buffer = buffers.get(type);
  if (!buffer) {
    const samples = renderUiSound(type, rate);
    buffer = current.createBuffer(1, samples.length, rate);
    buffer.getChannelData(0).set(samples);
    buffers.set(type, buffer);
  }
  stopVoices(false);
  const source = current.createBufferSource();
  const gain = current.createGain();
  const start = current.currentTime + 0.004;
  source.buffer = buffer;
  gain.gain.setValueAtTime((preferences().volume / 100) ** 1.5, start);
  source.connect(gain);
  gain.connect(current.destination);
  const voice: Voice = {
    source,
    gain,
    type,
    endsAt: performance.now() + UI_SOUND_DESIGN[type].duration * 1000,
  };
  voices.add(voice);
  active = voice;
  source.onended = () => releaseVoice(voice);
  try {
    source.start(start);
  } catch {
    releaseVoice(voice);
    return false;
  }
  lastType = type;
  lastStartedAt = performance.now();
  return true;
}

async function deliver(type: UiSound, preview: boolean): Promise<SoundPreviewResult> {
  const blocked = availability();
  if (blocked) return blocked;
  if (!(type in UI_SOUND_DESIGN)) return 'unavailable';
  const now = performance.now();
  if (
    !preview &&
    ((lastType === type && now - lastStartedAt < minimumGap[type]) ||
      (active && active.endsAt > now && priority[active.type] > priority[type]))
  )
    return 'busy';
  const request = ++pendingCue;
  const generation = revision;
  const current = obtainContext();
  if (!current) return 'unavailable';
  if (!(await ensureRunning(current))) return 'unavailable';
  const changed = availability();
  if (changed) return changed;
  if (
    request !== pendingCue ||
    generation !== revision ||
    context !== current ||
    performance.now() - now > 180
  )
    return 'busy';
  try {
    return schedule(current, type) ? 'played' : 'unavailable';
  } catch {
    stopUiSounds();
    return 'unavailable';
  }
}

export function playSound(type: UiSound): void {
  void deliver(type, false).catch(() => {});
}

export function previewUiSound(type: UiSound): Promise<SoundPreviewResult> {
  return deliver(type, true).catch(() => 'unavailable');
}

/** Installed only in the private workspace; loading public pages stays silent. */
function attachUiSoundListeners(): () => void {
  const prime = (event: Event) => {
    if (!event.isTrusted || availability()) return;
    if (
      event instanceof KeyboardEvent &&
      (event.repeat || !['Enter', ' ', 'ArrowLeft', 'ArrowRight'].includes(event.key))
    )
      return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('button, a, input, select, [role="button"]')) return;
    if (target.closest('[data-ui-sound="none"]')) return;
    const current = obtainContext();
    if (current) void ensureRunning(current);
  };
  const changed = () => {
    revision++;
    pendingCue++;
    const pref = preferences();
    if (!pref.enabled || pref.volume === 0) stopVoices(true);
    else if (active && context?.state === 'running') {
      const time = context.currentTime;
      active.gain.gain.cancelScheduledValues(time);
      active.gain.gain.setValueAtTime(active.gain.gain.value, time);
      active.gain.gain.linearRampToValueAtTime((pref.volume / 100) ** 1.5, time + 0.02);
    }
  };
  const visibility = () => {
    if (document.visibilityState === 'hidden') stopUiSounds();
  };
  const toast = (event: Event) => {
    const detail = (event as CustomEvent<{ tone?: string; sound?: UiSound | false }>).detail;
    if (!detail || detail.sound === false) return;
    if (detail.sound && Object.prototype.hasOwnProperty.call(UI_SOUND_DESIGN, detail.sound))
      playSound(detail.sound);
    else if (detail.tone === 'success' || detail.tone === 'error') playSound(detail.tone);
  };
  const playback = () => stopUiSounds();
  document.addEventListener('pointerdown', prime, true);
  document.addEventListener('keydown', prime, true);
  document.addEventListener('visibilitychange', visibility);
  document.addEventListener('play', playback, true);
  window.addEventListener('pagehide', playback);
  window.addEventListener('app-settings-updated', changed);
  window.addEventListener('storage', changed);
  window.addEventListener('app-toast', toast);

  return () => {
    document.removeEventListener('pointerdown', prime, true);
    document.removeEventListener('keydown', prime, true);
    document.removeEventListener('visibilitychange', visibility);
    document.removeEventListener('play', playback, true);
    window.removeEventListener('pagehide', playback);
    window.removeEventListener('app-settings-updated', changed);
    window.removeEventListener('storage', changed);
    window.removeEventListener('app-toast', toast);
  };
}

export function installUiSounds(): () => void {
  if (owners++ === 0) removeListeners = attachUiSoundListeners();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--owners > 0) return;
    stopUiSounds();
    removeListeners?.();
    removeListeners = null;
    buffers.clear();
    lastType = null;
    lastStartedAt = -Infinity;
    resumePending = null;
    const previous = context;
    context = null;
    if (previous && previous.state !== 'closed') void previous.close().catch(() => {});
  };
}
