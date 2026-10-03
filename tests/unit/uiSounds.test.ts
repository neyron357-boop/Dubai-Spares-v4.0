import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderUiSound, UI_SOUND_DESIGN, type UiSound } from '../../utils/uiSoundDesign';

const settingsKey = 'dubai_spares_app_settings_v1';
const sounds = Object.keys(UI_SOUND_DESIGN) as UiSound[];

function measure(samples: Float32Array) {
  let peak = 0;
  let sum = 0;
  let energy = 0;
  let finite = true;
  for (const sample of samples) {
    finite &&= Number.isFinite(sample);
    peak = Math.max(peak, Math.abs(sample));
    sum += sample;
    energy += sample * sample;
  }
  expect(finite).toBe(true);
  return { peak, mean: sum / samples.length, rms: Math.sqrt(energy / samples.length) };
}

class FakeAudioParam {
  value = 1;
  setValueAtTime(value: number) {
    this.value = value;
    return this;
  }
  linearRampToValueAtTime(value: number) {
    this.value = value;
    return this;
  }
  exponentialRampToValueAtTime(value: number) {
    this.value = value;
    return this;
  }
  setTargetAtTime(value: number) {
    this.value = value;
    return this;
  }
  cancelScheduledValues() {
    return this;
  }
  cancelAndHoldAtTime() {
    return this;
  }
}
class FakeAudioNode extends EventTarget {
  connect = vi.fn();
  disconnect = vi.fn();
}
class FakeSource extends FakeAudioNode {
  buffer: FakeBuffer | null = null;
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  start = vi.fn(() => {
    this.started = true;
  });
  stop = vi.fn(() => {
    this.stopped = true;
  });
  finish() {
    this.stopped = true;
    this.onended?.();
    this.dispatchEvent(new Event('ended'));
  }
}
class FakeBuffer {
  duration: number;
  channel: Float32Array;
  constructor(
    public numberOfChannels: number,
    public length: number,
    public sampleRate: number,
  ) {
    this.channel = new Float32Array(length);
    this.duration = length / sampleRate;
  }
  getChannelData() {
    return this.channel;
  }
  copyToChannel(samples: Float32Array) {
    this.channel.set(samples);
  }
}
class FakeContext extends EventTarget {
  static instances: FakeContext[] = [];
  static initialState: AudioContextState = 'running';
  static resumeOperation: (() => Promise<void>) | null = null;
  state: AudioContextState = FakeContext.initialState;
  currentTime = 1;
  sampleRate = 48000;
  destination = new FakeAudioNode();
  sources: FakeSource[] = [];
  gains: FakeAudioParam[] = [];
  buffers: FakeBuffer[] = [];
  constructor() {
    super();
    FakeContext.instances.push(this);
  }
  createGain() {
    const node = new FakeAudioNode() as FakeAudioNode & { gain: FakeAudioParam };
    node.gain = new FakeAudioParam();
    this.gains.push(node.gain);
    return node;
  }
  createBuffer(channels: number, frames: number, rate: number) {
    const buffer = new FakeBuffer(channels, frames, rate);
    this.buffers.push(buffer);
    return buffer;
  }
  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  resume = vi.fn(async () => {
    await FakeContext.resumeOperation?.();
    this.state = 'running';
  });
  suspend = vi.fn(async () => {
    this.state = 'suspended';
  });
  close = vi.fn(async () => {
    this.state = 'closed';
  });
}
let uninstall: (() => void) | null = null;
function setPreferences(enabled = true, volume = 55) {
  localStorage.setItem(
    settingsKey,
    JSON.stringify({ soundsEnabled: enabled, soundVolume: volume }),
  );
  window.dispatchEvent(new Event('app-settings-updated'));
}
function sources() {
  return FakeContext.instances
    .flatMap((context) => context.sources)
    .filter((source) => source.started);
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function engine() {
  const module = await import('../../utils/sounds');
  uninstall = module.installUiSounds();
  return module;
}
async function settle() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  FakeContext.instances = [];
  FakeContext.initialState = 'running';
  FakeContext.resumeOperation = null;
  vi.stubGlobal('AudioContext', FakeContext);
  vi.stubGlobal('webkitAudioContext', undefined);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
});
afterEach(async () => {
  uninstall?.();
  uninstall = null;
  await settle();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('offline sound design', () => {
  it('renders all six effects with silence at the edges, no DC or clipping on supported audio devices', () => {
    for (const rate of [8000, 16000, 44100, 48000, 96000]) {
      for (const sound of sounds) {
        const samples = renderUiSound(sound, rate);
        expect(samples).toBeInstanceOf(Float32Array);
        expect(samples.length).toBe(Math.round(UI_SOUND_DESIGN[sound].duration * rate));
        expect(samples[0]).toBe(0);
        expect(samples[samples.length - 1]).toBe(0);
        const measured = measure(samples);
        expect(measured.peak).toBeLessThanOrEqual(0.4);
        expect(measured.rms).toBeGreaterThan(0.025);
        expect(Math.abs(measured.mean)).toBeLessThan(1e-7);
      }
    }
  });

  it('produces reproducible effects with distinct audible attacks and no shared random state', () => {
    const rendered = sounds.map((sound) => renderUiSound(sound, 48000));
    sounds.forEach((sound, index) => {
      expect(renderUiSound(sound, 48000)).toEqual(rendered[index]);
    });
    for (let left = 0; left < rendered.length; left += 1) {
      for (let right = left + 1; right < rendered.length; right += 1) {
        let difference = 0;
        for (let sample = 0; sample < 1536; sample += 1) {
          difference += (rendered[left][sample] - rendered[right][sample]) ** 2;
        }
        expect(Math.sqrt(difference / 1536)).toBeGreaterThan(0.015);
      }
    }
  });

  it('rejects invalid sample rates rather than allocating malformed audio', () => {
    for (const sampleRate of [0, 7999, 96001, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => renderUiSound('tap', sampleRate)).toThrow(RangeError);
    }
  });
});

describe('sound delivery', () => {
  it('remains silent without an explicit opt-in, at volume zero, and when preferences cannot be read', async () => {
    const module = await engine();
    expect(await module.previewUiSound('tap')).toBe('muted');
    module.playSound('success');
    setPreferences(true, 0);
    expect(await module.previewUiSound('tap')).toBe('muted');
    module.playSound('notification');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Unavailable', 'SecurityError');
    });
    expect(await module.previewUiSound('tap')).toBe('muted');
    await settle();
    expect(FakeContext.instances).toHaveLength(0);
    expect(sources()).toHaveLength(0);
  });

  it('fails quietly when audio is unavailable or the browser rejects activation', async () => {
    setPreferences();
    vi.stubGlobal('AudioContext', undefined);
    const module = await engine();
    expect(await module.previewUiSound('success')).toBe('unavailable');
    module.playSound('error');
    await settle();
    expect(sources()).toHaveLength(0);
    vi.stubGlobal('AudioContext', FakeContext);
    FakeContext.initialState = 'suspended';
    FakeContext.resumeOperation = () =>
      Promise.reject(new DOMException('Blocked', 'NotAllowedError'));
    expect(await module.previewUiSound('success')).toBe('unavailable');
    module.playSound('error');
    await settle();
    expect(sources()).toHaveLength(0);
  });

  it.each(['mute', 'hide', 'recording', 'dispose'] as const)(
    'does not play an old activation after %s invalidates the request',
    async (reason) => {
      setPreferences();
      FakeContext.initialState = 'suspended';
      const activation = deferred();
      FakeContext.resumeOperation = () => activation.promise;
      const module = await engine();
      const pending = module.previewUiSound('success');
      await settle();
      expect(FakeContext.instances[0]?.resume).toHaveBeenCalled();
      let release: (() => void) | undefined;
      if (reason === 'mute') {
        setPreferences(false);
        setPreferences(true);
      }
      if (reason === 'hide') {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          value: 'visible',
        });
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        document.dispatchEvent(new Event('visibilitychange'));
      }
      if (reason === 'recording') {
        release = module.holdUiSounds();
        release();
      }
      if (reason === 'dispose') {
        uninstall?.();
        uninstall = null;
      }
      activation.resolve();
      await pending;
      await settle();
      expect(sources()).toHaveLength(0);
      release?.();
    },
  );

  it('expires delayed activation and never replays stale feedback after the user has moved on', async () => {
    vi.useFakeTimers();
    setPreferences();
    FakeContext.initialState = 'suspended';
    const activation = deferred();
    FakeContext.resumeOperation = () => activation.promise;
    const module = await engine();
    const pending = module.previewUiSound('notification');
    await settle();
    await vi.advanceTimersByTimeAsync(6000);
    activation.resolve();
    await pending;
    await settle();
    expect(sources()).toHaveLength(0);
  });

  it('plays only the latest request after shared activation resolves', async () => {
    setPreferences();
    FakeContext.initialState = 'suspended';
    const activation = deferred();
    FakeContext.resumeOperation = () => activation.promise;
    const module = await engine();
    const oldRequest = module.previewUiSound('success');
    const latestRequest = module.previewUiSound('error');
    await settle();
    activation.resolve();
    expect(await oldRequest).toBe('busy');
    expect(await latestRequest).toBe('played');
    expect(sources()).toHaveLength(1);
    expect(sources()[0].buffer?.duration).toBe(UI_SOUND_DESIGN.error.duration);
  });

  it('keeps one toast listener across concurrent owners and removes audio when the last owner leaves', async () => {
    setPreferences();
    const module = await engine();
    const secondOwner = module.installUiSounds();
    const emit = (detail: { tone: string; sound?: UiSound | false }) =>
      window.dispatchEvent(new CustomEvent('app-toast', { detail }));
    emit({ tone: 'info' });
    await settle();
    expect(sources()).toHaveLength(0);
    emit({ tone: 'success' });
    await settle();
    expect(sources()).toHaveLength(1);
    uninstall?.();
    uninstall?.();
    uninstall = null;
    emit({ tone: 'error' });
    await settle();
    expect(sources()).toHaveLength(2);
    for (const source of sources()) source.finish();
    emit({ tone: 'success', sound: false });
    await settle();
    expect(sources()).toHaveLength(2);
    emit({ tone: 'info', sound: 'delete' });
    await settle();
    expect(sources()).toHaveLength(3);
    expect(sources()[2].buffer?.duration).toBe(UI_SOUND_DESIGN.delete.duration);
    secondOwner();
    secondOwner();
    emit({ tone: 'error' });
    module.playSound('error');
    expect(await module.previewUiSound('error')).toBe('unavailable');
    await settle();
    expect(sources()).toHaveLength(3);
    expect(FakeContext.instances[0].close).toHaveBeenCalledTimes(1);
  });

  it('keeps one active voice, bounds repeated cues, and reuses completed sound buffers', async () => {
    setPreferences();
    const module = await engine();
    expect(await module.previewUiSound('notification')).toBe('played');
    const initial = sources()[0];
    expect(await module.previewUiSound('tap')).toBe('played');
    for (let index = 0; index < 30; index += 1) module.playSound('tap');
    await settle();
    expect(sources().length).toBeLessThanOrEqual(3);
    expect(sources().filter((source) => !source.stopped)).toHaveLength(1);
    expect(initial.stopped).toBe(true);
    for (const source of sources()) source.finish();
    const buffersBefore = FakeContext.instances[0].buffers.length;
    expect(await module.previewUiSound('notification')).toBe('played');
    expect(FakeContext.instances[0].buffers).toHaveLength(buffersBefore);
  });

  it('holds all cues for overlapping recordings and releases each lease only once', async () => {
    setPreferences();
    const module = await engine();
    expect(await module.previewUiSound('tap')).toBe('played');
    const first = module.holdUiSounds();
    const second = module.holdUiSounds();
    expect(sources().every((source) => source.stopped)).toBe(true);
    expect(await module.previewUiSound('success')).toBe('busy');
    first();
    first();
    module.playSound('notification');
    expect(await module.previewUiSound('success')).toBe('busy');
    expect(sources()).toHaveLength(1);
    second();
    expect(await module.previewUiSound('success')).toBe('played');
    expect(sources()).toHaveLength(2);
  });

  it('cancels UI effects while real media plays and allows them after playback stops', async () => {
    setPreferences();
    const module = await engine();
    expect(await module.previewUiSound('success')).toBe('played');
    const audio = document.createElement('audio');
    let paused = false;
    Object.defineProperty(audio, 'paused', { configurable: true, get: () => paused });
    Object.defineProperty(audio, 'ended', { configurable: true, value: false });
    document.body.append(audio);
    audio.dispatchEvent(new Event('play', { bubbles: true }));
    expect(sources().every((source) => source.stopped)).toBe(true);
    expect(await module.previewUiSound('tap')).toBe('busy');
    paused = true;
    audio.dispatchEvent(new Event('pause', { bubbles: true }));
    expect(await module.previewUiSound('tap')).toBe('played');
  });
});
