import {
  AudioLines,
  Bell,
  Check,
  ChevronRight,
  CircleAlert,
  Hand,
  Play,
  Trash2,
  Volume2,
} from 'lucide-react';
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { useAppSettings } from '../appSettings';
import { previewUiSound, type UiSound } from '../utils/sounds';
import { UI_SOUND_DESIGN } from '../utils/uiSoundDesign';
import '../styles/sound-settings.css';

const soundChoices = [
  { type: 'tap', icon: Hand },
  { type: 'navigate', icon: ChevronRight },
  { type: 'success', icon: Check },
  { type: 'error', icon: CircleAlert },
  { type: 'notification', icon: Bell },
  { type: 'delete', icon: Trash2 },
] as const;

type SoundPreferences = { enabled: boolean; volume: number };

export default function SoundSettingsPanel() {
  const { settings, updateSettings } = useAppSettings();
  const [draft, setDraft] = useState<SoundPreferences>({
    enabled: settings.soundsEnabled,
    volume: settings.soundVolume,
  });
  const [saveError, setSaveError] = useState(false);
  const [previewNotice, setPreviewNotice] = useState('');
  const [playing, setPlaying] = useState<UiSound | null>(null);
  const draftRef = useRef(draft);
  const storedRef = useRef<SoundPreferences>(draft);
  const pendingRef = useRef(false);
  const previewGeneration = useRef(0);
  const previewTimer = useRef<number | null>(null);
  const headingId = useId();
  const volumeId = useId();
  const volumeHintId = useId();

  useEffect(() => {
    const next = { enabled: settings.soundsEnabled, volume: settings.soundVolume };
    storedRef.current = next;
    if (!pendingRef.current) {
      draftRef.current = next;
      setDraft(next);
    }
  }, [settings.soundsEnabled, settings.soundVolume]);

  useEffect(
    () => () => {
      previewGeneration.current += 1;
      if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);
    },
    [],
  );

  const changeDraft = (next: SoundPreferences) => {
    draftRef.current = next;
    pendingRef.current = true;
    setDraft(next);
    setPreviewNotice('');
  };

  const commit = () => {
    const next = draftRef.current;
    if (next.enabled === storedRef.current.enabled && next.volume === storedRef.current.volume) {
      pendingRef.current = false;
      setSaveError(false);
      return true;
    }
    try {
      const saved = updateSettings({ soundsEnabled: next.enabled, soundVolume: next.volume });
      storedRef.current = { enabled: saved.soundsEnabled, volume: saved.soundVolume };
      pendingRef.current = false;
      setSaveError(false);
      return true;
    } catch {
      pendingRef.current = true;
      setSaveError(true);
      return false;
    }
  };

  const clearPreview = () => {
    previewGeneration.current += 1;
    if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);
    previewTimer.current = null;
    setPlaying(null);
  };

  const preview = async (type: UiSound) => {
    if (!draftRef.current.enabled || draftRef.current.volume === 0 || !commit()) return;
    clearPreview();
    const generation = previewGeneration.current;
    setPreviewNotice('');
    setPlaying(type);
    // Keep the visual state bounded even if an audio device stops responding.
    previewTimer.current = window.setTimeout(() => {
      if (generation === previewGeneration.current) setPlaying(null);
    }, 2500);
    let result: Awaited<ReturnType<typeof previewUiSound>>;
    try {
      result = await previewUiSound(type);
    } catch {
      result = 'unavailable';
    }
    if (generation !== previewGeneration.current) return;
    if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);
    previewTimer.current = null;
    if (result === 'played') {
      previewTimer.current = window.setTimeout(
        () => {
          if (generation === previewGeneration.current) setPlaying(null);
        },
        UI_SOUND_DESIGN[type].duration * 1000 + 80,
      );
      return;
    }
    setPlaying(null);
    if (result === 'busy') {
      setPreviewNotice('Прослушивание будет доступно после завершения записи или воспроизведения.');
    } else if (result === 'unavailable') {
      setPreviewNotice(
        'Не удалось воспроизвести звук. Повторите попытку или проверьте звук устройства.',
      );
    }
  };

  const previewDisabled = !draft.enabled || draft.volume === 0;

  return (
    <section className="ui-panel sound-settings-panel" aria-labelledby={headingId}>
      <div className="sound-settings-heading">
        <span className="sound-settings-heading-icon" aria-hidden="true">
          <Volume2 size={20} strokeWidth={1.8} />
        </span>
        <div>
          <h2 id={headingId}>Звук</h2>
          <p>Мягкие отклики для действий и уведомлений.</p>
        </div>
      </div>

      <label className="sound-settings-toggle">
        <span>
          <strong>Звуки интерфейса</strong>
          <small>{draft.enabled ? 'Включены' : 'Выключены'}</small>
        </span>
        <input
          type="checkbox"
          role="switch"
          aria-label="Звуки интерфейса"
          checked={draft.enabled}
          data-ui-sound="none"
          onChange={(event) => {
            const enabled = event.target.checked;
            changeDraft({ ...draftRef.current, enabled });
            if (!enabled) clearPreview();
            commit();
          }}
        />
      </label>

      <div className="sound-settings-volume">
        <div className="sound-settings-volume-heading">
          <label htmlFor={volumeId}>Громкость</label>
          <output htmlFor={volumeId}>{draft.volume}%</output>
        </div>
        <input
          id={volumeId}
          className="sound-settings-range"
          type="range"
          min={0}
          max={100}
          step={1}
          value={draft.volume}
          aria-label="Громкость звуков"
          aria-valuetext={`${draft.volume}%`}
          aria-describedby={volumeHintId}
          style={{ '--sound-volume': `${draft.volume}%` } as CSSProperties}
          data-ui-sound="none"
          onChange={(event) =>
            changeDraft({ ...draftRef.current, volume: Number(event.target.value) })
          }
          onPointerUp={() => commit()}
          onKeyUp={(event) => {
            if (
              [
                'ArrowLeft',
                'ArrowRight',
                'ArrowUp',
                'ArrowDown',
                'Home',
                'End',
                'PageUp',
                'PageDown',
              ].includes(event.key)
            )
              commit();
          }}
          onBlur={() => commit()}
        />
        <p id={volumeHintId}>
          {draft.volume === 0
            ? 'На нуле звуки не воспроизводятся.'
            : 'Уровень звуков интерфейса. Громкость записей не меняется.'}
        </p>
      </div>

      <div className="sound-settings-preview-heading">
        <h3>Прослушать эффекты</h3>
        <p>
          {!draft.enabled
            ? 'Включите звуки, чтобы прослушать.'
            : draft.volume === 0
              ? 'Увеличьте громкость, чтобы прослушать.'
              : 'Нажмите на эффект.'}
        </p>
      </div>
      <div className="sound-settings-samples">
        {soundChoices.map(({ type, icon: Icon }) => (
          <button
            key={type}
            type="button"
            className={`sound-settings-sample${playing === type ? ' is-playing' : ''}`}
            aria-label={`Прослушать: ${UI_SOUND_DESIGN[type].label}`}
            aria-busy={playing === type}
            disabled={previewDisabled}
            data-ui-sound="none"
            onClick={() => void preview(type)}
          >
            <span className="sound-settings-sample-icon" aria-hidden="true">
              <Icon size={18} strokeWidth={1.8} />
            </span>
            <span className="sound-settings-sample-text">
              <strong>{UI_SOUND_DESIGN[type].label}</strong>
              <small>{UI_SOUND_DESIGN[type].description}</small>
            </span>
            {playing === type ? (
              <AudioLines className="sound-settings-play-icon" size={15} aria-hidden="true" />
            ) : (
              <Play className="sound-settings-play-icon" size={15} aria-hidden="true" />
            )}
          </button>
        ))}
      </div>

      {saveError && (
        <div className="sound-settings-save-error" role="alert">
          <p>Не удалось сохранить настройки звука. Изменения ещё не сохранены.</p>
          <button type="button" data-ui-sound="none" onClick={() => commit()}>
            Повторить сохранение
          </button>
        </div>
      )}
      {previewNotice && (
        <p className="sound-settings-notice" role="status">
          {previewNotice}
        </p>
      )}
    </section>
  );
}
