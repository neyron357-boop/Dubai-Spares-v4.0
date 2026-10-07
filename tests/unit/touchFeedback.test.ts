import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_SETTINGS_KEY, loadAppSettings, saveAppSettings } from '../../appSettings';
import { haptic, installTouchFeedback } from '../../utils/touchFeedback';

beforeEach(() => localStorage.clear());

describe('haptic feedback', () => {
  it('is on by default and only an explicit false turns it off', () => {
    expect(loadAppSettings().hapticsEnabled).toBe(true);
    for (const raw of [null, 'false', 0, {}]) {
      localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify({ hapticsEnabled: raw }));
      expect(loadAppSettings().hapticsEnabled).toBe(true);
    }
    saveAppSettings({ hapticsEnabled: false });
    expect(loadAppSettings().hapticsEnabled).toBe(false);
  });

  it('vibrates with distinct patterns and respects the setting', () => {
    const vibrate = vi.fn(() => true);
    vi.stubGlobal('navigator', { ...navigator, vibrate });
    haptic('selection');
    haptic('error');
    expect(vibrate).toHaveBeenNthCalledWith(1, 6);
    expect(vibrate).toHaveBeenNthCalledWith(2, [20, 60, 20, 60, 24]);
    saveAppSettings({ hapticsEnabled: false });
    haptic('success');
    expect(vibrate).toHaveBeenCalledTimes(2);
  });

  it('stays silent where the browser has no vibration', () => {
    vi.stubGlobal('navigator', { ...navigator, vibrate: undefined });
    expect(() => haptic('success')).not.toThrow();
  });

  it('ticks on toggles and confirms results from toasts', () => {
    const vibrate = vi.fn(() => true);
    vi.stubGlobal('navigator', { ...navigator, vibrate });
    const uninstall = installTouchFeedback();
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    document.body.append(checkbox);
    checkbox.click();
    window.dispatchEvent(new CustomEvent('app-toast', { detail: { tone: 'success' } }));
    uninstall();
    checkbox.click();
    expect(vibrate.mock.calls).toEqual([[6], [[10, 70, 16]]]);
    checkbox.remove();
  });
});
