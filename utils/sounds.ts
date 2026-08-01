/**
 * UI Sound Engine — uses Web Audio API to synthesise all sounds programmatically.
 * No external files needed; works fully offline.
 */

import { APP_SETTINGS_KEY } from '../appSettings';

export type UiSound = 'tap' | 'navigate' | 'success' | 'error' | 'notification' | 'delete';

let _ctx: AudioContext | null = null;

type WindowWithWebkit = Window & { webkitAudioContext?: typeof AudioContext };

function getCtx(): AudioContext | null {
  if (_ctx) return _ctx;
  try {
    const win = window as WindowWithWebkit;
    const Ctor = window.AudioContext || win.webkitAudioContext;
    if (Ctor) _ctx = new Ctor();
  } catch {
    return null;
  }
  return _ctx;
}

function isSoundsEnabled(): boolean {
  try {
    const raw = localStorage.getItem(APP_SETTINGS_KEY);
    if (!raw) return true;
    const parsed = JSON.parse(raw) as { soundsEnabled?: boolean };
    return parsed.soundsEnabled !== false;
  } catch {
    return true;
  }
}

function schedule(ctx: AudioContext, type: UiSound): void {
  const t = ctx.currentTime;

  switch (type) {
    case 'tap': {
      // Short, soft sine click — like a light keyboard tap
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1100, t);
      osc.frequency.exponentialRampToValueAtTime(550, t + 0.045);
      gain.gain.setValueAtTime(0.13, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
      osc.start(t);
      osc.stop(t + 0.05);
      break;
    }

    case 'navigate': {
      // Subtle rising tick for tab/screen navigation
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(700, t);
      osc.frequency.exponentialRampToValueAtTime(1100, t + 0.07);
      gain.gain.setValueAtTime(0.10, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
      osc.start(t);
      osc.stop(t + 0.08);
      break;
    }

    case 'success': {
      // Two ascending notes — pleasant success chime (C6 → E6)
      const notes = [1046.5, 1318.5];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        const start = t + i * 0.10;
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.001, start);
        gain.gain.linearRampToValueAtTime(0.15, start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.18);
        osc.start(start);
        osc.stop(start + 0.20);
      });
      break;
    }

    case 'error': {
      // Descending warble — short, unmistakable error tone
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(440, t);
      osc.frequency.exponentialRampToValueAtTime(220, t + 0.15);
      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      osc.start(t);
      osc.stop(t + 0.17);
      break;
    }

    case 'notification': {
      // Soft double-bell chime — attention-getting but pleasant
      const notes = [880, 1108];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        const start = t + i * 0.12;
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.001, start);
        gain.gain.linearRampToValueAtTime(0.14, start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.25);
        osc.start(start);
        osc.stop(start + 0.26);
      });
      break;
    }

    case 'delete': {
      // Low thud — indicates a destructive / warning action
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(180, t);
      osc.frequency.exponentialRampToValueAtTime(80, t + 0.12);
      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
      osc.start(t);
      osc.stop(t + 0.14);
      break;
    }

    default:
      break;
  }
}

export function playSound(type: UiSound): void {
  if (!isSoundsEnabled()) return;
  const ctx = getCtx();
  if (!ctx) return;

  if (ctx.state === 'suspended') {
    void ctx.resume().then(() => schedule(ctx, type));
    return;
  }

  schedule(ctx, type);
}
