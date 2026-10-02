import { Download, Mic, Pause, Play, Trash2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { VoiceNoteAudio } from '../types';
import { formatVoiceTime, voiceFileExtension } from '../utils/voiceAudio';
import '../styles/voice-recorder.css';

export default function VoiceMessagePlayer({
  voice,
  onDelete,
  downloadable = false,
  caption,
}: {
  voice: VoiceNoteAudio;
  onDelete?: () => void;
  downloadable?: boolean;
  caption?: string;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const playerId = useId();
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(voice.duration || 0);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState('');
  const [decodedBars, setDecodedBars] = useState<number[] | null>(null);
  const bars = voice.waveform?.length ? voice.waveform : decodedBars || Array(48).fill(8);
  const fraction = duration > 0 ? Math.min(1, position / duration) : 0;
  useEffect(() => {
    const pauseOthers = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== playerId) audio.current?.pause();
    };
    document.addEventListener('voice-playback-start', pauseOthers);
    return () => document.removeEventListener('voice-playback-start', pauseOthers);
  }, [playerId]);
  useEffect(() => {
    if (voice.waveform?.length || !voice.fileUrl.startsWith('data:')) return;
    let cancelled = false;
    const context = new AudioContext();
    void (async () => {
      try {
        const { voiceWaveform } = await import('../utils/voiceAudio');
        const data = await (await fetch(voice.fileUrl)).arrayBuffer();
        const buffer = await context.decodeAudioData(data);
        if (!cancelled) setDecodedBars(voiceWaveform([buffer.getChannelData(0)]));
      } catch {
        /* Legacy formats still play with a neutral progress track. */
      } finally {
        if (context.state !== 'closed') await context.close();
      }
    })();
    return () => {
      cancelled = true;
      if (context.state !== 'closed') void context.close().catch(() => {});
    };
  }, [voice.fileUrl, voice.waveform]);
  const play = async () => {
    if (!audio.current) return;
    if (playing) {
      audio.current.pause();
      return;
    }
    setError('');
    document.dispatchEvent(new CustomEvent('voice-playback-start', { detail: playerId }));
    // Also silence older audio controls elsewhere in the app.
    document.querySelectorAll('audio').forEach((element) => {
      if (element !== audio.current) element.pause();
    });
    try {
      await audio.current.play();
    } catch {
      setError('Не удалось воспроизвести. Попробуйте ещё раз.');
    }
  };
  return (
    <div className="voice-message" data-testid="voice-message">
      <div className="voice-message-row">
        <button
          type="button"
          className="voice-control voice-play"
          onClick={() => void play()}
          aria-label={playing ? 'Приостановить прослушивание' : 'Прослушать голосовое сообщение'}
        >
          {playing ? (
            <Pause size={22} fill="currentColor" />
          ) : (
            <Play size={22} fill="currentColor" />
          )}
        </button>
        <div className="voice-message-track">
          <div className="voice-wave-track">
            <div className="voice-wave" aria-hidden="true">
              {bars.map((height, index) => (
                <span
                  key={index}
                  style={{
                    height: `${Math.max(8, Math.min(100, height))}%`,
                    background:
                      index / bars.length <= fraction && position > 0
                        ? 'var(--voice-green)'
                        : undefined,
                  }}
                />
              ))}
            </div>
            <input
              type="range"
              min="0"
              max={duration || 1}
              step="0.01"
              value={Math.min(position, duration || 1)}
              disabled={!duration}
              aria-label="Позиция голосового сообщения"
              onChange={(event) => {
                const time = Number(event.target.value);
                if (audio.current) audio.current.currentTime = time;
                setPosition(time);
              }}
              style={{ '--voice-progress': `${fraction * 100}%` } as React.CSSProperties}
            />
          </div>
          <div className="voice-message-meta">
            <span>{formatVoiceTime(position > 0 ? position : duration)}</span>
            {caption !== '' && <span>{caption ?? 'Голосовое сообщение'}</span>}
          </div>
        </div>
        <button
          type="button"
          className="voice-speed"
          aria-label={`Скорость воспроизведения ${speed}×`}
          onClick={() => {
            const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
            setSpeed(next);
            if (audio.current) audio.current.playbackRate = next;
          }}
        >
          {speed}×
        </button>
        {onDelete ? (
          <button
            type="button"
            className="voice-control voice-delete"
            aria-label="Удалить голосовое сообщение"
            onClick={onDelete}
          >
            <Trash2 size={19} />
          </button>
        ) : (
          <Mic className="voice-message-mic" size={21} aria-hidden="true" />
        )}
      </div>
      {downloadable && (
        <a
          className="voice-download"
          href={voice.fileUrl}
          download={`voice-${voice.id}.${voiceFileExtension(voice.fileUrl)}`}
        >
          <Download size={14} /> Скачать запись
        </a>
      )}
      {error && (
        <p className="voice-error" role="alert">
          {error}
        </p>
      )}
      <audio
        ref={audio}
        src={voice.fileUrl}
        preload="metadata"
        playsInline
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setPosition(0);
          if (audio.current) audio.current.currentTime = 0;
        }}
        onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => {
          if (Number.isFinite(event.currentTarget.duration))
            setDuration(event.currentTarget.duration);
        }}
        onError={() => {
          setPlaying(false);
          setError('Аудио недоступно или его формат не поддерживается.');
        }}
      />
    </div>
  );
}
