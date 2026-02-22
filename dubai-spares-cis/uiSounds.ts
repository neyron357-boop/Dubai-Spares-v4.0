let audioContext: AudioContext | null = null;

const getAudioContext = (): AudioContext | null => {
  if (typeof window === 'undefined') return null;
  const Context = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return null;
  if (!audioContext) audioContext = new Context();
  if (audioContext.state === 'suspended') {
    void audioContext.resume().catch(() => undefined);
  }
  return audioContext;
};

const playTone = ({
  type,
  frequency,
  gainPeak,
  duration,
  glideTo,
}: {
  type: OscillatorType;
  frequency: number;
  gainPeak: number;
  duration: number;
  glideTo?: number;
}) => {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(gainPeak, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, now);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, now + duration * 0.8);
  osc.connect(gain);
  osc.start(now);
  osc.stop(now + duration);
};

export const playTouchSound = () => {
  playTone({ type: 'triangle', frequency: 520, gainPeak: 0.028, duration: 0.07, glideTo: 620 });
};

export const playButtonSound = () => {
  playTone({ type: 'square', frequency: 680, gainPeak: 0.04, duration: 0.1, glideTo: 760 });
};

export const playTransitionSound = () => {
  playTone({ type: 'sine', frequency: 360, gainPeak: 0.03, duration: 0.14, glideTo: 520 });
};

export const isInteractiveElement = (target: EventTarget | null): boolean => {
  const element = target instanceof Element ? target : null;
  if (!element) return false;
  return !!element.closest('button, a, input, select, textarea, [role="button"], [data-sound="button"]');
};
