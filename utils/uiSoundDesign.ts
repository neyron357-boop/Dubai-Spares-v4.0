/**
 * A small, offline sound palette for the interface.
 *
 * Fixed-pitch, damped resonances give the effects a shared material character;
 * a quiet, filtered transient keeps short sounds audible on small speakers.
 * Rendering has no browser or audio-device dependencies.
 */

export type UiSound = 'tap' | 'navigate' | 'success' | 'error' | 'notification' | 'delete';

type SoundDescription = {
  label: string;
  description: string;
  /** Complete duration, including the release, in seconds. */
  duration: number;
};

export const UI_SOUND_DESIGN: Readonly<Record<UiSound, SoundDescription>> = {
  tap: {
    label: 'Нажатие',
    description: 'Короткий мягкий отклик',
    duration: 0.048,
  },
  navigate: {
    label: 'Переход',
    description: 'Лёгкий звук перехода',
    duration: 0.092,
  },
  success: {
    label: 'Готово',
    description: 'Тёплый сигнал завершения',
    duration: 0.3,
  },
  error: {
    label: 'Внимание',
    description: 'Спокойный сигнал внимания',
    duration: 0.2,
  },
  notification: {
    label: 'Уведомление',
    description: 'Два лёгких тона',
    duration: 0.36,
  },
  delete: {
    label: 'Удаление',
    description: 'Приглушённый отклик',
    duration: 0.112,
  },
};

type Partial = readonly [frequencyRatio: number, amplitude: number, decayRatio: number];

type Resonance = {
  start: number;
  duration: number;
  frequency: number;
  amplitude: number;
  attack: number;
  decay: number;
  partials: readonly Partial[];
};

type Texture = {
  start: number;
  duration: number;
  amplitude: number;
  attack: number;
  decay: number;
  frequency: number;
  seed: number;
};

type SoundRecipe = {
  resonances: readonly Resonance[];
  texture: Texture;
  rms: number;
  peak: number;
  reflections?: boolean;
};

const TAU = Math.PI * 2;

// The upper modes are quieter and decay faster than the fundamental. Slight
// inharmonicity gives a soft ceramic/glass character without a metallic ring.
const CERAMIC: readonly Partial[] = [
  [1, 1, 1],
  [1.982, 0.19, 0.61],
  [2.756, 0.055, 0.38],
];
const GLASS: readonly Partial[] = [
  [1, 1, 1],
  [2.011, 0.12, 0.58],
  [3.173, 0.032, 0.3],
];
const MUTED: readonly Partial[] = [
  [1, 1, 1],
  [2, 0.25, 0.65],
  [3.012, 0.045, 0.35],
];
const BODY: readonly Partial[] = [[1, 1, 1]];

const RECIPES: Record<UiSound, SoundRecipe> = {
  tap: {
    resonances: [
      {
        start: 0,
        duration: 0.048,
        frequency: 660,
        amplitude: 0.64,
        attack: 0.0018,
        decay: 0.0108,
        partials: CERAMIC,
      },
      {
        start: 0,
        duration: 0.042,
        frequency: 330,
        amplitude: 0.12,
        attack: 0.0028,
        decay: 0.013,
        partials: BODY,
      },
    ],
    texture: {
      start: 0,
      duration: 0.018,
      amplitude: 0.12,
      attack: 0.0014,
      decay: 0.0048,
      frequency: 1750,
      seed: 0x6d2b79f5,
    },
    rms: 0.092,
    peak: 0.38,
  },
  navigate: {
    resonances: [
      {
        start: 0.007,
        duration: 0.085,
        frequency: 440,
        amplitude: 0.27,
        attack: 0.008,
        decay: 0.025,
        partials: MUTED,
      },
      {
        start: 0.002,
        duration: 0.079,
        frequency: 740,
        amplitude: 0.08,
        attack: 0.005,
        decay: 0.02,
        partials: BODY,
      },
    ],
    texture: {
      start: 0,
      duration: 0.092,
      amplitude: 0.24,
      attack: 0.009,
      decay: 0.025,
      frequency: 1450,
      seed: 0x1b873593,
    },
    rms: 0.064,
    peak: 0.31,
  },
  success: {
    resonances: [
      {
        start: 0,
        duration: 0.205,
        frequency: 554.37,
        amplitude: 0.58,
        attack: 0.006,
        decay: 0.047,
        partials: CERAMIC,
      },
      {
        start: 0.072,
        duration: 0.228,
        frequency: 739.99,
        amplitude: 0.5,
        attack: 0.008,
        decay: 0.059,
        partials: CERAMIC,
      },
      {
        start: 0,
        duration: 0.13,
        frequency: 277.185,
        amplitude: 0.08,
        attack: 0.008,
        decay: 0.032,
        partials: BODY,
      },
    ],
    texture: {
      start: 0,
      duration: 0.024,
      amplitude: 0.045,
      attack: 0.002,
      decay: 0.006,
      frequency: 1550,
      seed: 0x85ebca6b,
    },
    rms: 0.077,
    peak: 0.38,
    reflections: true,
  },
  error: {
    resonances: [
      {
        start: 0,
        duration: 0.2,
        frequency: 329.63,
        amplitude: 0.64,
        attack: 0.008,
        decay: 0.043,
        partials: MUTED,
      },
      {
        start: 0,
        duration: 0.135,
        frequency: 164.815,
        amplitude: 0.09,
        attack: 0.009,
        decay: 0.028,
        partials: BODY,
      },
    ],
    texture: {
      start: 0,
      duration: 0.034,
      amplitude: 0.07,
      attack: 0.004,
      decay: 0.009,
      frequency: 1080,
      seed: 0xc2b2ae35,
    },
    rms: 0.074,
    peak: 0.35,
  },
  notification: {
    resonances: [
      {
        start: 0,
        duration: 0.235,
        frequency: 783.99,
        amplitude: 0.51,
        attack: 0.007,
        decay: 0.056,
        partials: GLASS,
      },
      {
        start: 0.103,
        duration: 0.257,
        frequency: 659.25,
        amplitude: 0.47,
        attack: 0.009,
        decay: 0.064,
        partials: GLASS,
      },
      {
        start: 0,
        duration: 0.125,
        frequency: 391.995,
        amplitude: 0.055,
        attack: 0.01,
        decay: 0.033,
        partials: BODY,
      },
    ],
    texture: {
      start: 0,
      duration: 0.026,
      amplitude: 0.035,
      attack: 0.0025,
      decay: 0.007,
      frequency: 1900,
      seed: 0x27d4eb2f,
    },
    rms: 0.069,
    peak: 0.36,
    reflections: true,
  },
  delete: {
    resonances: [
      {
        start: 0,
        duration: 0.112,
        frequency: 220,
        amplitude: 0.57,
        attack: 0.0035,
        decay: 0.02,
        partials: MUTED,
      },
      {
        start: 0,
        duration: 0.075,
        frequency: 660,
        amplitude: 0.055,
        attack: 0.003,
        decay: 0.011,
        partials: BODY,
      },
    ],
    texture: {
      start: 0,
      duration: 0.03,
      amplitude: 0.07,
      attack: 0.002,
      decay: 0.007,
      frequency: 1180,
      seed: 0x165667b1,
    },
    rms: 0.081,
    peak: 0.35,
  },
};

function smoothStep(value: number): number {
  const bounded = Math.max(0, Math.min(1, value));
  return bounded * bounded * (3 - 2 * bounded);
}

function envelope(time: number, duration: number, attack: number, decay: number): number {
  // A real release avoids truncation clicks even for the shortest effect.
  const release = Math.min(duration * 0.32, 0.028);
  return (
    smoothStep(time / attack) * Math.exp(-time / decay) * smoothStep((duration - time) / release)
  );
}

function addResonance(output: Float64Array, sampleRate: number, resonance: Resonance): void {
  const first = Math.round(resonance.start * sampleRate);
  const end = Math.min(
    output.length,
    Math.ceil((resonance.start + resonance.duration) * sampleRate),
  );

  for (const [ratio, amplitude, decayRatio] of resonance.partials) {
    const frequency = resonance.frequency * ratio;
    // Fade any mode close to Nyquist rather than folding it into a false tone.
    const bandLimit = 1 - smoothStep((frequency / sampleRate - 0.4) / 0.08);
    if (bandLimit === 0) continue;
    const level = resonance.amplitude * amplitude * bandLimit;
    const angularFrequency = TAU * frequency;
    for (let frame = first; frame < end; frame += 1) {
      const time = frame / sampleRate - resonance.start;
      if (time <= 0) continue;
      output[frame] +=
        Math.sin(angularFrequency * time) *
        level *
        envelope(time, resonance.duration, resonance.attack, resonance.decay * decayRatio);
    }
  }
}

function addTexture(output: Float64Array, sampleRate: number, texture: Texture): void {
  // A deterministic noise source passed through a gentle bandpass. The filter
  // keeps texture out of the bass and avoids the brittle white-noise hiss of a
  // raw digital click. No random state is shared between renders.
  const frequency = Math.min(texture.frequency, sampleRate * 0.22);
  const omega = (TAU * frequency) / sampleRate;
  const alpha = Math.sin(omega) / (2 * 0.64);
  const inverseA0 = 1 / (1 + alpha);
  const b0 = alpha * inverseA0;
  const b2 = -b0;
  const a1 = -2 * Math.cos(omega) * inverseA0;
  const a2 = (1 - alpha) * inverseA0;
  let previousInput = 0;
  let olderInput = 0;
  let previousOutput = 0;
  let olderOutput = 0;
  let seed = texture.seed | 0;
  const first = Math.round(texture.start * sampleRate);
  const end = Math.min(output.length, Math.ceil((texture.start + texture.duration) * sampleRate));

  for (let frame = first; frame < end; frame += 1) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    const input = (seed >>> 0) / 0x80000000 - 1;
    const filtered = b0 * input + b2 * olderInput - a1 * previousOutput - a2 * olderOutput;
    olderInput = previousInput;
    previousInput = input;
    olderOutput = previousOutput;
    previousOutput = filtered;
    const time = frame / sampleRate - texture.start;
    if (time <= 0) continue;
    output[frame] +=
      filtered *
      texture.amplitude *
      envelope(time, texture.duration, texture.attack, texture.decay);
  }
}

function addReflections(output: Float64Array, sampleRate: number): void {
  // Quiet early reflections provide space, without an audible echo or a long
  // reverb tail that could mask the next action.
  const direct = output.slice();
  for (const [seconds, gain] of [
    [0.0103, 0.055],
    [0.0217, 0.028],
    [0.0359, 0.012],
  ]) {
    const delay = Math.round(seconds * sampleRate);
    for (let frame = delay; frame < output.length; frame += 1) {
      output[frame] += direct[frame - delay] * gain;
    }
  }
}

/**
 * Render a complete mono UI effect. The engine can cache the result as an
 * AudioBuffer, so synthesising an effect never allocates live audio nodes.
 */
export function renderUiSound(type: UiSound, sampleRate: number): Float32Array {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 96000) {
    throw new RangeError('UI sounds require a sample rate between 8000 and 96000 Hz.');
  }

  const recipe = RECIPES[type];
  const frames = Math.round(UI_SOUND_DESIGN[type].duration * sampleRate);
  const output = new Float64Array(frames);
  for (const resonance of recipe.resonances) addResonance(output, sampleRate, resonance);
  addTexture(output, sampleRate, recipe.texture);
  if (recipe.reflections) addReflections(output, sampleRate);

  // Removing DC through a smooth window preserves a silent first/last sample.
  // A second release also tapers the deliberately short early reflections.
  const window = new Float64Array(frames);
  const attackFrames = Math.max(1, Math.round(sampleRate * 0.0007));
  const releaseFrames = Math.max(1, Math.round(sampleRate * 0.004));
  let sum = 0;
  let windowSum = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    const weight =
      smoothStep(frame / attackFrames) * smoothStep((frames - 1 - frame) / releaseFrames);
    window[frame] = weight;
    output[frame] *= weight;
    sum += output[frame];
    windowSum += weight;
  }

  const dc = sum / windowSum;
  let energy = 0;
  let peak = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    output[frame] -= dc * window[frame];
    energy += output[frame] * output[frame];
    peak = Math.max(peak, Math.abs(output[frame]));
  }

  // Match perceived weight between effects while reserving generous headroom.
  // Gain scaling never clips or introduces extra distortion harmonics.
  const rms = Math.sqrt(energy / frames);
  const gain = Math.min(recipe.rms / Math.max(rms, 1e-12), recipe.peak / Math.max(peak, 1e-12));
  return Float32Array.from(output, (sample) => sample * gain);
}
