import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APP_SETTINGS_KEY,
  DEFAULT_APP_SETTINGS,
  loadAppSettings,
  saveAppSettings,
} from '../../appSettings';

beforeEach(() => localStorage.clear());

describe('sound preferences', () => {
  it('keeps existing installations silent and provides a moderate default volume', () => {
    expect(loadAppSettings().soundsEnabled).toBe(false);
    expect(loadAppSettings().soundVolume).toBe(55);
    localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify({ userName: 'Ahmad' }));
    expect(loadAppSettings()).toMatchObject({
      userName: 'Ahmad',
      soundsEnabled: false,
      soundVolume: 55,
    });
  });

  it('requires an explicit boolean opt-in and rejects malformed volume values', () => {
    for (const raw of [null, 'true', 1, {}, []]) {
      localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify({ soundsEnabled: raw }));
      expect(loadAppSettings().soundsEnabled).toBe(false);
      expect(loadAppSettings().soundVolume).toBe(55);
    }
    for (const raw of [null, '20', {}, []]) {
      localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify({ soundVolume: raw }));
      expect(loadAppSettings().soundVolume).toBe(55);
    }
    localStorage.setItem(
      APP_SETTINGS_KEY,
      JSON.stringify({ soundsEnabled: true, soundVolume: '20' }),
    );
    expect(loadAppSettings()).toMatchObject({ soundsEnabled: true, soundVolume: 55 });
  });

  it('clamps finite volume levels and preserves zero as an explicit mute', () => {
    for (const [raw, expected] of [
      [-20, 0],
      [0, 0],
      [43.5, 43.5],
      [150, 100],
    ]) {
      expect(saveAppSettings({ soundVolume: raw }).soundVolume).toBe(expected);
    }
    for (const raw of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(saveAppSettings({ soundVolume: raw }).soundVolume).toBe(
        DEFAULT_APP_SETTINGS.soundVolume,
      );
    }
  });

  it('does not announce or persist audio changes when storage rejects the write', () => {
    const original = saveAppSettings({ userName: 'Ahmad', soundVolume: 35 });
    const events = vi.fn();
    window.addEventListener('app-settings-updated', events);
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage full', 'QuotaExceededError');
    });
    try {
      expect(() => saveAppSettings({ soundsEnabled: true, soundVolume: 80 })).toThrow();
      expect(loadAppSettings()).toEqual(original);
      expect(events).not.toHaveBeenCalled();
    } finally {
      setItem.mockRestore();
      window.removeEventListener('app-settings-updated', events);
    }
  });
});
