import { describe, expect, it } from 'vitest';
import {
  encodeVoiceWav,
  formatVoiceTime,
  VOICE_MAX_SECONDS,
  VOICE_SAMPLE_RATE,
  voiceFileExtension,
  voiceWaveform,
} from '../../utils/voiceAudio';

describe('portable voice audio', () => {
  it('joins actual samples in order and writes a playable PCM WAV header', async () => {
    const blob = encodeVoiceWav([new Float32Array([-1, 0, 1]), new Float32Array([0.5, -0.5])]);
    const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = reject;
      reader.readAsArrayBuffer(blob);
    });
    const view = new DataView(buffer);
    expect(String.fromCharCode(...new Uint8Array(buffer, 0, 4))).toBe('RIFF');
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(40, true)).toBe(10);
    expect(Array.from({ length: 5 }, (_, index) => view.getInt16(44 + index * 2, true))).toEqual([
      -32768, 0, 32767, 16384, -16384,
    ]);
  });
  it('fits a complete five minute recording below the existing 10 MB audio limit', () => {
    const blob = encodeVoiceWav([new Float32Array(VOICE_MAX_SECONDS * VOICE_SAMPLE_RATE)]);
    expect(blob.size).toBe(9600044);
    expect(blob.size).toBeLessThan(10 * 1024 * 1024);
  });
  it('uses measured audio energy and keeps silence neutral', () => {
    expect(voiceWaveform([new Float32Array(256)], 4)).toEqual([8, 8, 8, 8]);
    expect(voiceWaveform([new Float32Array(128), new Float32Array(128).fill(0.5)], 4)).toEqual([
      8, 8, 100, 100,
    ]);
  });
  it('exports correct extensions including Safari MP4 and formats invalid times safely', () => {
    expect(voiceFileExtension('data:audio/mp4;base64,AA')).toBe('m4a');
    expect(voiceFileExtension('data:audio/wav;base64,AA')).toBe('wav');
    expect(voiceFileExtension('data:audio/mpeg;base64,AA')).toBe('mp3');
    expect(voiceFileExtension('https://example.com/voice.mp3?download=1')).toBe('mp3');
    expect(voiceFileExtension('data:audio/aac;base64,AA')).toBe('aac');
    expect(formatVoiceTime(NaN)).toBe('0:00');
    expect(formatVoiceTime(300.9)).toBe('5:00');
  });
});
