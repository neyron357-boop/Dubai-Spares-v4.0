import { useEffect, useRef, useState } from 'react';
import type { VoiceNoteAudio } from '../types';
import {
  decodeVoiceSegment,
  prepareVoice,
  VOICE_MAX_SECONDS,
  VOICE_SAMPLE_RATE,
} from '../utils/voiceAudio';

type Phase = 'idle' | 'requesting' | 'recording' | 'processing' | 'paused' | 'sending';
export function useVoiceRecorder(
  author: string,
  onSend: (voice: VoiceNoteAudio) => Promise<boolean>,
) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [bars, setBars] = useState<number[]>(Array(40).fill(8));
  const [preview, setPreview] = useState<VoiceNoteAudio | null>(null);
  const [error, setError] = useState('');
  const session = useRef(0);
  const phaseRef = useRef<Phase>('idle');
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const context = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const segments = useRef<Float32Array[]>([]);
  const pendingBlobs = useRef<Blob[]>([]);
  const elapsedMs = useRef(0);
  const started = useRef(0);
  const timer = useRef<number>();
  const id = useRef('');
  const previewRef = useRef<VoiceNoteAudio | null>(null);
  const sendRef = useRef(onSend);
  sendRef.current = onSend;
  const actions = useRef({ pause: () => {}, cancel: () => {} });

  const transition = (value: Phase) => {
    phaseRef.current = value;
    setPhase(value);
  };
  const stopTracks = () => {
    if (timer.current) window.clearInterval(timer.current);
    stream.current?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    stream.current = null;
    analyser.current = null;
  };
  const dispose = () => {
    stopTracks();
    if (recorder.current) {
      recorder.current.onstop = null;
      recorder.current.ondataavailable = null;
      if (recorder.current.state !== 'inactive') recorder.current.stop();
    }
    recorder.current = null;
    const audioContext = context.current;
    context.current = null;
    if (audioContext && audioContext.state !== 'closed') void audioContext.close().catch(() => {});
  };
  const cancel = () => {
    session.current++;
    dispose();
    segments.current = [];
    pendingBlobs.current = [];
    elapsedMs.current = 0;
    previewRef.current = null;
    setPreview(null);
    setElapsed(0);
    setBars(Array(40).fill(8));
    setError('');
    transition('idle');
  };

  const send = async (voice = previewRef.current) => {
    if (!voice || phaseRef.current === 'sending') return;
    const token = session.current;
    setError('');
    transition('sending');
    try {
      const saved = await sendRef.current(voice);
      if (token !== session.current) return;
      if (saved) cancel();
      else {
        setError(
          'Не удалось сохранить. Запись сохранена в этом окне — попробуйте отправить ещё раз.',
        );
        transition('paused');
      }
    } catch {
      if (token !== session.current) return;
      setError('Не удалось сохранить. Запись осталась здесь. Повторите отправку.');
      transition('paused');
    }
  };

  const process = async (autoSend: boolean, token: number) => {
    try {
      while (pendingBlobs.current.length) {
        const blob = pendingBlobs.current[0];
        const decoded = await decodeVoiceSegment(blob, context.current!);
        if (token !== session.current) return;
        const length = segments.current.reduce((sum, part) => sum + part.length, 0);
        segments.current.push(
          decoded.slice(0, Math.max(0, VOICE_MAX_SECONDS * VOICE_SAMPLE_RATE - length)),
        );
        pendingBlobs.current.shift();
      }
      const voice = await prepareVoice(segments.current, id.current, author);
      if (token !== session.current) return;
      if (voice.duration < 0.6) {
        cancel();
        setError('Запись слишком короткая. Удерживайте микрофон немного дольше.');
        return;
      }
      previewRef.current = voice;
      setPreview(voice);
      elapsedMs.current = voice.duration * 1000;
      setElapsed(voice.duration);
      transition('paused');
      if (autoSend) await send(voice);
    } catch {
      if (token !== session.current) return;
      setError('Не удалось обработать аудио. Исходная запись сохранена в этом окне.');
      transition('paused');
    }
  };

  const finish = (autoSend = false) => {
    if (phaseRef.current !== 'recording' || !recorder.current) return;
    elapsedMs.current += performance.now() - started.current;
    transition('processing');
    // Stop the encoder before releasing tracks: its final event completes the file.
    finishIntent.current = autoSend;
    if (recorder.current.state !== 'inactive') recorder.current.stop();
    stopTracks();
  };
  const finishIntent = useRef(false);

  const start = async () => {
    if (phaseRef.current !== 'idle' && phaseRef.current !== 'paused') return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder || !window.AudioContext) {
      setError(
        'Этот браузер не поддерживает запись. Откройте приложение в Safari или Chrome через HTTPS.',
      );
      return;
    }
    const resuming = phaseRef.current === 'paused';
    if (pendingBlobs.current.length) {
      setError('Сначала обработайте сохранённый фрагмент.');
      return;
    }
    const token = ++session.current;
    setError('');
    transition('requesting');
    if (!resuming) {
      id.current = crypto.randomUUID();
      segments.current = [];
      elapsedMs.current = 0;
      previewRef.current = null;
      setPreview(null);
      setBars(Array(40).fill(8));
    }
    try {
      // Construct synchronously from the user's gesture so iOS can activate audio.
      if (!context.current || context.current.state === 'closed')
        context.current = new AudioContext();
      void context.current.resume().catch(() => {});
      const acquired = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      if (token !== session.current) {
        acquired.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = acquired;
      const mime = [
        'audio/webm;codecs=opus',
        'audio/mp4',
        'audio/webm',
        'audio/ogg;codecs=opus',
      ].find((value) => MediaRecorder.isTypeSupported(value));
      const next = new MediaRecorder(acquired, mime ? { mimeType: mime } : undefined);
      recorder.current = next;
      const chunks: Blob[] = [];
      next.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      next.onstop = () => {
        if (token !== session.current) return;
        recorder.current = null;
        pendingBlobs.current.push(new Blob(chunks, { type: next.mimeType }));
        void process(finishIntent.current, token);
      };
      next.onerror = () => {
        if (token === session.current) {
          finish();
          setError('Микрофон прервал запись. Сохраняем доступный фрагмент.');
        }
      };
      acquired.getAudioTracks().forEach((track) => {
        track.onended = () => actions.current.pause();
      });
      const node = context.current.createAnalyser();
      node.fftSize = 512;
      context.current.createMediaStreamSource(acquired).connect(node);
      analyser.current = node;
      const data = new Uint8Array(node.fftSize);
      next.start(250);
      started.current = performance.now();
      finishIntent.current = false;
      transition('recording');
      timer.current = window.setInterval(() => {
        const seconds = (elapsedMs.current + performance.now() - started.current) / 1000;
        setElapsed(Math.min(VOICE_MAX_SECONDS, seconds));
        node.getByteTimeDomainData(data);
        let sum = 0;
        for (const value of data) sum += ((value - 128) / 128) ** 2;
        const amplitude = Math.max(
          8,
          Math.min(100, Math.round(Math.sqrt(sum / data.length) * 450)),
        );
        setBars((current) => [...current.slice(-39), amplitude]);
        if (seconds >= VOICE_MAX_SECONDS) actions.current.pause();
      }, 80);
    } catch (cause) {
      if (token !== session.current) return;
      dispose();
      transition(resuming ? 'paused' : 'idle');
      const name = cause instanceof DOMException ? cause.name : '';
      setError(
        name === 'NotAllowedError'
          ? 'Нет доступа к микрофону. Разрешите его в настройках сайта и повторите запись.'
          : name === 'NotFoundError'
            ? 'Микрофон не найден. Подключите его и попробуйте ещё раз.'
            : 'Микрофон недоступен. Закройте другие приложения, использующие его, и повторите запись.',
      );
    }
  };

  actions.current = { pause: () => finish(), cancel };
  useEffect(() => {
    const hide = () => {
      if (document.hidden) actions.current.pause();
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (phaseRef.current === 'idle') return;
      event.preventDefault();
      event.returnValue = '';
    };
    const leave = () => actions.current.cancel();
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('beforeunload', unload);
    window.addEventListener('pagehide', leave);
    return () => {
      session.current++;
      dispose();
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('beforeunload', unload);
      window.removeEventListener('pagehide', leave);
    };
  }, []);

  return {
    phase,
    elapsed,
    bars,
    preview,
    error,
    start,
    prime: () => {
      if (!window.AudioContext) return;
      if (!context.current || context.current.state === 'closed')
        context.current = new AudioContext();
      void context.current.resume().catch(() => {});
    },
    cancel,
    pause: () => finish(),
    send: () =>
      phaseRef.current === 'recording'
        ? finish(true)
        : pendingBlobs.current.length
          ? (transition('processing'), void process(true, session.current))
          : void send(),
    retryProcessing: () => {
      transition('processing');
      void process(false, session.current);
    },
    canResume: !pendingBlobs.current.length && elapsed < VOICE_MAX_SECONDS,
  };
}
