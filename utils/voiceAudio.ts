import type { VoiceNoteAudio } from '../types';

export const VOICE_MAX_SECONDS = 300;
export const VOICE_SAMPLE_RATE = 16000;

export function formatVoiceTime(seconds: number) {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

export function voiceFileExtension(url: string) {
  const mime = url.match(/^data:audio\/([^;,]+)/)?.[1];
  const extension = url
    .match(/\.(webm|mp3|m4a|mp4|wav|ogg|aac|opus)(?:[?#].*)?$/i)?.[1]
    ?.toLowerCase();
  return (
    (
      {
        mp4: 'm4a',
        'x-m4a': 'm4a',
        aac: 'aac',
        mpeg: 'mp3',
        wav: 'wav',
        'x-wav': 'wav',
        ogg: 'ogg',
      } as Record<string, string>
    )[mime || ''] ||
    (extension === 'mp4' ? 'm4a' : extension) ||
    'webm'
  );
}

// Every pause finalizes its native recording. Decode those complete files, then join
// PCM samples rather than concatenating containers (which breaks MP4 on Safari).
export async function decodeVoiceSegment(blob: Blob, context: AudioContext) {
  const decoded = await context.decodeAudioData(await blob.arrayBuffer());
  const offline = new OfflineAudioContext(
    1,
    Math.ceil(decoded.duration * VOICE_SAMPLE_RATE),
    VOICE_SAMPLE_RATE,
  );
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  return (await offline.startRendering()).getChannelData(0).slice();
}

export function encodeVoiceWav(segments: Float32Array[]) {
  const length = segments.reduce((sum, segment) => sum + segment.length, 0);
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);
  const writeText = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  writeText(0, 'RIFF');
  view.setUint32(4, 36 + length * 2, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, VOICE_SAMPLE_RATE, true);
  view.setUint32(28, VOICE_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, length * 2, true);
  let offset = 44;
  for (const segment of segments)
    for (const sample of segment) {
      const clamped = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, Math.round(clamped * (clamped < 0 ? 32768 : 32767)), true);
      offset += 2;
    }
  return new Blob([buffer], { type: 'audio/wav' });
}

export function voiceWaveform(segments: Float32Array[], count = 48) {
  const length = segments.reduce((sum, part) => sum + part.length, 0);
  if (!length) return Array(count).fill(8) as number[];
  const energy = new Float64Array(count);
  const samples = new Uint32Array(count);
  let offset = 0;
  for (const segment of segments) {
    for (let i = 0; i < segment.length; i += 8) {
      const bin = Math.min(count - 1, Math.floor(((offset + i) / length) * count));
      energy[bin] += segment[i] * segment[i];
      samples[bin]++;
    }
    offset += segment.length;
  }
  const rms = Array.from(energy, (sum, i) => Math.sqrt(sum / (samples[i] || 1)));
  const peak = Math.max(0.03, ...rms);
  return rms.map((value) => Math.max(8, Math.min(100, Math.round((value / peak) * 100))));
}

export async function prepareVoice(
  segments: Float32Array[],
  id: string,
  author: string,
): Promise<VoiceNoteAudio> {
  const blob = encodeVoiceWav(segments);
  const fileUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Не удалось подготовить аудио. Попробуйте ещё раз.'));
    reader.readAsDataURL(blob);
  });
  return {
    id,
    author,
    fileUrl,
    createdAt: Date.now(),
    duration: segments.reduce((sum, part) => sum + part.length, 0) / VOICE_SAMPLE_RATE,
    waveform: voiceWaveform(segments),
  };
}
