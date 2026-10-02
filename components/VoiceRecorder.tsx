import {
  ChevronLeft,
  ChevronUp,
  CircleAlert,
  LoaderCircle,
  LockKeyhole,
  Mic,
  Pause,
  Send,
  Trash2,
} from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import type { VoiceNoteAudio } from '../types';
import { formatVoiceTime, VOICE_MAX_SECONDS } from '../utils/voiceAudio';
import VoiceMessagePlayer from './VoiceMessagePlayer';
import '../styles/voice-recorder.css';

export default function VoiceRecorder({
  author,
  onSend,
  children,
  onActiveChange,
}: {
  author: string;
  onSend: (voice: VoiceNoteAudio) => Promise<boolean>;
  children: (microphone: ReactNode) => ReactNode;
  onActiveChange?: (active: boolean) => void;
}) {
  const voice = useVoiceRecorder(author, onSend);
  const helpId = useId();
  const [locked, setLocked] = useState(false);
  const [hint, setHint] = useState('');
  const [gesture, setGesture] = useState({ x: 0, y: 0 });
  const pointer = useRef<{ id: number; x: number; y: number; axis: 'x' | 'y' | null } | null>(null);
  const holdTimer = useRef<number>();
  const hintTimer = useRef<number>();
  const mic = useRef<HTMLButtonElement>(null);
  const current = useRef({ voice, locked });
  current.current = { voice, locked };
  const active = voice.phase !== 'idle';
  const busy = ['requesting', 'processing', 'sending'].includes(voice.phase);
  useEffect(() => {
    onActiveChange?.(active);
    return () => onActiveChange?.(false);
  }, [active, onActiveChange]);
  const vibrate = () => {
    try {
      navigator.vibrate?.(12);
    } catch {
      /* Optional feedback. */
    }
  };
  const showHint = (text: string) => {
    window.clearTimeout(hintTimer.current);
    setHint(text);
    hintTimer.current = window.setTimeout(() => setHint(''), 4000);
  };
  const discard = () => {
    pointer.current = null;
    window.clearTimeout(holdTimer.current);
    holdTimer.current = undefined;
    voice.cancel();
    setLocked(false);
    setGesture({ x: 0, y: 0 });
    showHint('Запись удалена');
    vibrate();
    window.setTimeout(() => mic.current?.focus(), 0);
  };
  const handlers = useRef({ discard, showHint });
  handlers.current = { discard, showHint };
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const start = pointer.current;
      if (!start || start.id !== event.pointerId || current.current.locked) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (!start.axis && Math.max(Math.abs(dx), Math.abs(dy)) > 12)
        start.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      const x = start.axis === 'x' ? Math.max(-100, Math.min(0, dx)) : 0;
      const y = start.axis === 'y' ? Math.max(-84, Math.min(0, dy)) : 0;
      setGesture({ x, y });
      if (x <= -90) {
        handlers.current.discard();
        return;
      }
      if (y <= -76 && current.current.voice.phase === 'recording') {
        current.current.locked = true;
        setLocked(true);
        pointer.current = null;
        setGesture({ x: 0, y: 0 });
        vibrate();
      }
    };
    const release = (event: PointerEvent) => {
      if (!pointer.current || pointer.current.id !== event.pointerId) return;
      pointer.current = null;
      setGesture({ x: 0, y: 0 });
      if (holdTimer.current) {
        window.clearTimeout(holdTimer.current);
        holdTimer.current = undefined;
        handlers.current.showHint('Удерживайте для записи · вверх — закрепить · влево — отменить');
        return;
      }
      const { voice: latest, locked: isLocked } = current.current;
      if (event.type === 'pointercancel') {
        handlers.current.discard();
        return;
      }
      if (latest.phase === 'requesting') {
        latest.cancel();
        handlers.current.showHint('После разрешения доступа снова удерживайте микрофон');
      } else if (latest.phase === 'recording' && !isLocked) latest.send();
    };
    const key = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest('dialog[open]')) return;
      if (
        event.key === 'Escape' &&
        current.current.voice.phase !== 'idle' &&
        current.current.voice.phase !== 'sending'
      ) {
        event.preventDefault();
        handlers.current.discard();
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    window.addEventListener('keydown', key);
    return () => {
      window.clearTimeout(holdTimer.current);
      window.clearTimeout(hintTimer.current);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      window.removeEventListener('keydown', key);
    };
  }, []);
  useEffect(() => {
    if (voice.phase === 'paused') setLocked(true);
    if (voice.phase === 'idle') setLocked(false);
  }, [voice.phase]);

  const microphone = (
    <button
      ref={mic}
      type="button"
      className="voice-microphone"
      aria-label="Записать голос"
      aria-describedby={helpId}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        if (event.button !== 0 || active || pointer.current) return;
        event.preventDefault();
        voice.prime();
        document.querySelectorAll('audio').forEach((audio) => audio.pause());
        pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, axis: null };
        setHint('');
        setLocked(false);
        holdTimer.current = window.setTimeout(() => {
          holdTimer.current = undefined;
          void current.current.voice.start();
        }, 150);
      }}
      onClick={(event) => {
        if (event.detail === 0 && !active) {
          setLocked(true);
          void voice.start();
        }
      }}
    >
      <Mic size={23} strokeWidth={2} />
      <span className="sr-only">
        Удерживайте; проведите вверх для фиксации, влево для отмены. С клавиатуры нажмите Enter.
      </span>
    </button>
  );

  return (
    <div className="voice-module" data-phase={voice.phase} data-locked={locked}>
      <span className="sr-only" id={helpId}>
        Удерживайте микрофон. Вверх — запись без удержания. Влево — удалить. Отпустите — отправить.
      </span>
      {active ? (
        <section
          className={`voice-recorder ${locked ? 'is-locked' : 'is-held'}`}
          aria-label="Голосовая запись"
        >
          {!locked && voice.phase === 'recording' && (
            <div
              className="voice-lock-guide"
              aria-hidden="true"
              style={{
                opacity: 0.7 + Math.abs(gesture.y) / 280,
                transform: `translateY(${gesture.y * 0.25}px)`,
              }}
            >
              <LockKeyhole size={17} />
              <ChevronUp size={21} />
            </div>
          )}
          <div className="voice-recorder-status" role="status" aria-live="polite">
            <span className={`voice-record-dot ${voice.phase === 'recording' ? 'is-live' : ''}`} />
            <span>
              {voice.phase === 'requesting'
                ? 'Доступ к микрофону…'
                : voice.phase === 'processing'
                  ? 'Подготовка записи…'
                  : voice.phase === 'sending'
                    ? 'Сохранение…'
                    : voice.phase === 'paused'
                      ? 'Запись на паузе'
                      : locked
                        ? 'Запись без удержания'
                        : 'Идёт запись'}
            </span>
            {locked && <LockKeyhole size={13} />}
            <span className="voice-limit">до 5 мин</span>
          </div>
          {voice.phase === 'paused' && voice.preview ? (
            <VoiceMessagePlayer voice={voice.preview} caption="Предпрослушивание" />
          ) : (
            <div className="voice-recording-row">
              <Mic size={20} className="voice-recording-icon" aria-hidden="true" />
              <span className="voice-timer">{formatVoiceTime(voice.elapsed)}</span>
              {locked ? (
                <div className="voice-wave voice-live-wave" aria-hidden="true">
                  {voice.bars.map((height, index) => (
                    <span key={index} style={{ height: `${height}%` }} />
                  ))}
                </div>
              ) : (
                <div
                  className="voice-cancel-guide"
                  style={{
                    opacity: 1 - Math.abs(gesture.x) / 140,
                    transform: `translateX(${gesture.x * 0.3}px)`,
                  }}
                >
                  <ChevronLeft size={17} />
                  <span>Влево — отмена</span>
                </div>
              )}
              {!locked && (
                <div
                  className="voice-held-mic"
                  style={{
                    transform: `translate(${gesture.x * 0.65}px, ${gesture.y * 0.5}px) scale(1.15)`,
                  }}
                >
                  <Mic size={26} />
                </div>
              )}
            </div>
          )}
          {(locked || busy) && (
            <div className="voice-recorder-actions">
              <button
                type="button"
                className="voice-control voice-delete"
                onClick={discard}
                disabled={voice.phase === 'sending'}
                aria-label="Удалить запись"
              >
                <Trash2 size={22} />
              </button>
              <div className="voice-action-center">
                {busy ? (
                  <LoaderCircle size={25} className="voice-spinner" aria-label="Подготовка аудио" />
                ) : voice.phase === 'recording' ? (
                  <button
                    type="button"
                    className="voice-control voice-pause"
                    onClick={voice.pause}
                    aria-label="Поставить запись на паузу"
                  >
                    <Pause size={25} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="voice-resume"
                    onClick={() => {
                      document.querySelectorAll('audio').forEach((audio) => audio.pause());
                      void voice.start();
                    }}
                    disabled={!voice.canResume}
                    aria-label="Продолжить запись"
                  >
                    <Mic size={21} />
                    <span>
                      {voice.elapsed >= VOICE_MAX_SECONDS ? 'Лимит 5 минут' : 'Продолжить'}
                    </span>
                  </button>
                )}
              </div>
              <button
                type="button"
                className="voice-microphone voice-send"
                disabled={busy || (voice.phase === 'recording' && voice.elapsed < 0.6)}
                onClick={voice.send}
                aria-label="Отправить голосовое сообщение"
              >
                <Send size={22} />
              </button>
            </div>
          )}
          {voice.phase === 'paused' && !voice.preview && (
            <button className="voice-retry" type="button" onClick={voice.retryProcessing}>
              Повторить обработку
            </button>
          )}
        </section>
      ) : (
        children(microphone)
      )}
      {voice.error && (
        <div className="voice-error" role="alert">
          <CircleAlert size={17} />
          <span>{voice.error}</span>
        </div>
      )}
      {hint && (
        <p className="voice-hint" role="status">
          {hint}
        </p>
      )}
    </div>
  );
}
