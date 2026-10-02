import {
  Check,
  Copy,
  Download,
  ExternalLink,
  FileText,
  MapPin,
  Play,
  Trash2,
  User,
  Video,
} from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatAttachment, OrderNote, VoiceNoteAudio } from '../types';
import {
  chatAttachmentHref,
  chatDayKey,
  chatDayLabel,
  chatDisplayText,
  chatFileExtension,
  chatTime,
  chronologicalNotes,
  safeChatHref,
} from '../utils/chatMessages';
import { voiceFileExtension } from '../utils/voiceAudio';
import MessagePressSurface from './MessagePressSurface';
import SafeImage from './SafeImage';
import VoiceMessagePlayer from './VoiceMessagePlayer';
import { Button, Dialog, ModalSurface } from './ui';
import '../styles/chat-messages.css';

const isVideo = (url: string) =>
  /^data:video\//i.test(url) || /\.(mp4|webm|mov|m4v|ogv|ogg)(?:[?#].*)?$/i.test(url);
const normalizeVoice = (voice: string | VoiceNoteAudio, index: number): VoiceNoteAudio =>
  typeof voice === 'string'
    ? { id: `legacy-${index}`, fileUrl: voice, duration: 0, createdAt: 0, author: '' }
    : voice;
type DownloadFile = { url: string; name: string; label: string };
function messageFiles(note: OrderNote) {
  const files: DownloadFile[] = [];
  (note.photos || []).forEach((url, index) => {
    if (safeChatHref(url, true))
      files.push({
        url,
        name: `media-${note.id}-${index + 1}.${chatFileExtension(url, isVideo(url) ? 'mp4' : 'jpg')}`,
        label: `${isVideo(url) ? 'Видео' : 'Фото'} ${index + 1}`,
      });
  });
  (note.audios || []).forEach((raw, index) => {
    const voice = normalizeVoice(raw, index);
    if (safeChatHref(voice.fileUrl, true))
      files.push({
        url: voice.fileUrl,
        name: `voice-${voice.id}.${voiceFileExtension(voice.fileUrl)}`,
        label: `Голосовая запись ${index + 1}`,
      });
  });
  (note.attachments || []).forEach((attachment) => {
    if (attachment.kind === 'file' && safeChatHref(attachment.fileUrl, true))
      files.push({
        url: attachment.fileUrl!,
        name: attachment.name || 'file',
        label: attachment.name || 'Файл',
      });
  });
  return files;
}

function MessageMedia({
  url,
  index,
  single,
  remaining,
  onOpen,
}: {
  url: string;
  index: number;
  single: boolean;
  remaining: number;
  onOpen: () => void;
}) {
  const [ratio, setRatio] = useState(4 / 3);
  const measure = (width: number, height: number) => {
    if (single && width > 0 && height > 0) setRatio(Math.max(0.7, Math.min(1.8, width / height)));
  };
  const video = isVideo(url);
  return (
    <button
      type="button"
      className="chat-media"
      data-chat-media={index}
      style={single ? { aspectRatio: ratio } : undefined}
      onClick={onOpen}
      aria-label={video ? 'Открыть видео' : 'Открыть фотографию'}
    >
      {video ? (
        <>
          <video
            src={url}
            preload="metadata"
            muted
            playsInline
            onLoadedMetadata={(event) =>
              measure(event.currentTarget.videoWidth, event.currentTarget.videoHeight)
            }
          />
          <span className="chat-video-play">
            <Play size={24} fill="currentColor" />
          </span>
          <span className="chat-video-label">
            <Video size={13} /> Видео
          </span>
        </>
      ) : (
        <SafeImage
          src={url}
          alt={`Фото ${index + 1}`}
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={(event) =>
            measure(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)
          }
        />
      )}
      {remaining > 0 && <span className="chat-media-more">+{remaining}</span>}
    </button>
  );
}

function MessageText({ text }: { text: string }) {
  return (
    <p className="chat-message-text">
      {text.split(/(https?:\/\/[^\s<>]+)/g).map((chunk, index) => {
        const href = /^https?:\/\//.test(chunk) ? safeChatHref(chunk) : undefined;
        return href ? (
          <a key={index} href={href} target="_blank" rel="noopener noreferrer">
            {chunk}
          </a>
        ) : (
          <Fragment key={index}>{chunk}</Fragment>
        );
      })}
    </p>
  );
}

export function ChatFileAttachment({ attachment }: { attachment: ChatAttachment }) {
  const Icon =
    attachment.kind === 'location' ? MapPin : attachment.kind === 'contact' ? User : FileText;
  const href = chatAttachmentHref(attachment);
  const subtitle =
    attachment.kind === 'location'
      ? attachment.address || 'Открыть на карте'
      : attachment.kind === 'contact'
        ? attachment.phone || 'Контакт'
        : [
            attachment.mimeType?.split('/')[1]?.toUpperCase(),
            attachment.size ? `${Math.max(1, Math.round(attachment.size / 1024))} КБ` : '',
          ]
            .filter(Boolean)
            .join(' · ');
  const content = (
    <>
      <span className="chat-file-icon">
        <Icon size={25} />
      </span>
      <span className="chat-file-info">
        <strong>{attachment.name || 'Вложение'}</strong>
        <span>{subtitle}</span>
      </span>
      {href && <ExternalLink size={17} className="chat-file-open" />}
    </>
  );
  return href ? (
    <a
      href={href}
      className="chat-file"
      target={attachment.kind === 'contact' ? undefined : '_blank'}
      rel="noopener noreferrer"
      download={attachment.kind === 'file' ? attachment.name : undefined}
    >
      {content}
    </a>
  ) : (
    <div className="chat-file">{content}</div>
  );
}

export default function ChatThread({
  notes,
  onOpenMedia,
  onDelete,
  onCopy,
  context = 'notes',
}: {
  notes: OrderNote[];
  onOpenMedia: (media: string[], index: number) => void;
  onDelete: (id: string) => Promise<boolean>;
  onCopy: (text: string) => Promise<void>;
  context?: 'notes' | 'proof';
}) {
  const ordered = useMemo(() => chronologicalNotes(notes), [notes]);
  const [action, setAction] = useState<{
    note: OrderNote;
    file?: DownloadFile;
    downloads?: boolean;
  } | null>(null);
  const [deleting, setDeleting] = useState<OrderNote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const thread = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLElement | null>(null);
  const knownIds = useRef<Set<string> | null>(null);
  const pinned = useRef(true);
  useEffect(() => {
    const container = thread.current?.closest<HTMLElement>('[data-chat-scroll]');
    if (!container) return;
    scroller.current = container;
    const update = () => {
      pinned.current = container.scrollHeight - container.scrollTop - container.clientHeight < 90;
    };
    let frame = 0;
    const resize = () => {
      if (!pinned.current) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        container.scrollTo({ top: container.scrollHeight, behavior: 'instant' }),
      );
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    if (thread.current) observer.observe(thread.current);
    container.addEventListener('scroll', update, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      container.removeEventListener('scroll', update);
      scroller.current = null;
    };
  }, []);
  useEffect(() => {
    const latest = ordered[ordered.length - 1];
    const added = latest && (!knownIds.current || !knownIds.current.has(latest.id));
    const initial = !knownIds.current;
    knownIds.current = new Set(ordered.map((note) => note.id));
    if (!added) return;
    pinned.current = true;
    const frame = requestAnimationFrame(() =>
      scroller.current?.scrollTo({
        top: scroller.current.scrollHeight,
        behavior:
          initial || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      }),
    );
    return () => cancelAnimationFrame(frame);
  }, [ordered]);
  const openActions = (note: OrderNote, target: Element | null) => {
    const mediaIndex = target?.closest<HTMLElement>('[data-chat-media]')?.dataset.chatMedia;
    const audioIndex = target?.closest<HTMLElement>('[data-chat-audio]')?.dataset.chatAudio;
    const attachmentIndex =
      target?.closest<HTMLElement>('[data-chat-attachment]')?.dataset.chatAttachment;
    const files = messageFiles(note);
    const url =
      mediaIndex !== undefined
        ? note.photos?.[Number(mediaIndex)]
        : audioIndex !== undefined
          ? normalizeVoice(note.audios![Number(audioIndex)], Number(audioIndex)).fileUrl
          : attachmentIndex !== undefined
            ? note.attachments?.[Number(attachmentIndex)]?.fileUrl
            : undefined;
    setAction({
      note,
      file: url
        ? files.find((file) => file.url === url)
        : files.length === 1
          ? files[0]
          : undefined,
    });
    setError('');
  };
  const confirmDelete = async () => {
    if (!deleting || busy) return;
    setBusy(true);
    setError('');
    try {
      if (await onDelete(deleting.id)) setDeleting(null);
      else setError('Не удалось удалить. Сообщение осталось в истории. Попробуйте ещё раз.');
    } catch {
      setError('Не удалось удалить. Сообщение осталось в истории.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      ref={thread}
      className="chat-thread"
      aria-label={context === 'proof' ? 'Сообщения для клиента' : 'История заметок'}
    >
      <p className="chat-thread-hint">
        {context === 'proof'
          ? 'Материалы для клиента · доступны в смете'
          : 'Внутренние заметки · сохраняются на устройстве'}
      </p>
      {ordered.map((note, position) => {
        const text = chatDisplayText(note);
        const photos = note.photos || [];
        const showDay =
          position === 0 ||
          chatDayKey(ordered[position - 1].createdAt) !== chatDayKey(note.createdAt);
        const grouped =
          position > 0 && !showDay && note.createdAt - ordered[position - 1].createdAt < 120000;
        return (
          <Fragment key={note.id}>
            {showDay && (
              <div className="chat-day">
                <span>{chatDayLabel(note.createdAt)}</span>
              </div>
            )}
            <MessagePressSurface
              className={`chat-bubble ${grouped ? 'is-grouped' : ''} ${photos.length ? 'has-media' : ''} ${action?.note.id === note.id || deleting?.id === note.id ? 'is-selected' : ''}`}
              label={`Сообщение ${chatTime(note.createdAt)}`}
              messageId={note.id}
              onActions={(target) => openActions(note, target)}
            >
              {context === 'notes' && (note.visibility === 'client' || note.kind === 'proof') && (
                <span className="chat-visibility">Для клиента</span>
              )}
              {photos.length > 0 && (
                <div
                  className={`chat-media-grid ${photos.length === 1 ? 'is-single' : ''} ${photos.length === 3 ? 'is-three' : ''}`}
                >
                  {photos.slice(0, 4).map((url, index) => (
                    <MessageMedia
                      key={url}
                      url={url}
                      index={index}
                      single={photos.length === 1}
                      remaining={index === 3 ? Math.max(0, photos.length - 4) : 0}
                      onOpen={() => onOpenMedia(photos, index)}
                    />
                  ))}
                </div>
              )}
              {(note.videoUrls || []).map((url, index) => {
                const href = safeChatHref(url);
                return href ? (
                  <a
                    key={`video-${index}`}
                    href={href}
                    className="chat-video-link"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className="chat-file-icon">
                      <Video size={24} />
                    </span>
                    <span>
                      <strong>Видео</strong>
                      <span>{new URL(href).hostname}</span>
                    </span>
                    <ExternalLink size={17} />
                  </a>
                ) : (
                  <p key={`video-${index}`} className="chat-message-text">
                    {url}
                  </p>
                );
              })}
              {(note.attachments || []).map((attachment, index) => (
                <div key={attachment.id || index} data-chat-attachment={index}>
                  <ChatFileAttachment attachment={attachment} />
                </div>
              ))}
              {(note.audios || []).map((voice, index) => (
                <div key={typeof voice === 'string' ? index : voice.id} data-chat-audio={index}>
                  <VoiceMessagePlayer voice={normalizeVoice(voice, index)} caption="" />
                </div>
              ))}
              {text && <MessageText text={text} />}
              <div className="chat-message-meta">
                <time
                  dateTime={
                    chatDayKey(note.createdAt) !== 'unknown'
                      ? new Date(note.createdAt).toISOString()
                      : undefined
                  }
                >
                  {chatTime(note.createdAt)}
                </time>
                <Check size={13} aria-label="Сохранено на устройстве" />
              </div>
            </MessagePressSurface>
          </Fragment>
        );
      })}
      <div className="chat-thread-end" />
      {action && (
        <ModalSurface
          label={action.downloads ? 'Сохранить вложение' : 'Действия с сообщением'}
          onClose={() => setAction(null)}
          className="chat-actions-layer"
        >
          <div className="chat-actions-panel">
            <span className="chat-actions-handle" aria-hidden="true" />
            <div className="chat-actions-heading">
              <strong>
                {action.downloads
                  ? 'Сохранить вложение'
                  : action.note.audios?.length
                    ? 'Голосовое сообщение'
                    : action.note.photos?.length
                      ? action.note.photos.length === 1
                        ? 'Фотография'
                        : `Альбом · ${action.note.photos.length} фото`
                      : action.note.attachments?.length
                        ? 'Вложение'
                        : 'Сообщение'}
              </strong>
              <time>{chatTime(action.note.createdAt)}</time>
            </div>
            {!action.downloads && chatDisplayText(action.note) && (
              <p className="chat-actions-preview">{chatDisplayText(action.note)}</p>
            )}
            {action.downloads ? (
              <div className="chat-download-list">
                {messageFiles(action.note).map((file, index) => (
                  <a
                    key={index}
                    href={file.url}
                    download={file.name}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="chat-action"
                    onClick={() => setAction(null)}
                  >
                    <Download size={21} />
                    <span>{file.label}</span>
                  </a>
                ))}
              </div>
            ) : (
              <>
                {chatDisplayText(action.note) && (
                  <button
                    type="button"
                    className="chat-action"
                    onClick={() => {
                      void onCopy(chatDisplayText(action.note));
                      setAction(null);
                    }}
                  >
                    <Copy size={21} />
                    <span>Копировать текст</span>
                  </button>
                )}
                {action.file ? (
                  <a
                    className="chat-action"
                    href={action.file.url}
                    download={action.file.name}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setAction(null)}
                  >
                    <Download size={21} />
                    <span>Сохранить файл</span>
                  </a>
                ) : (
                  messageFiles(action.note).length > 0 && (
                    <button
                      type="button"
                      className="chat-action"
                      onClick={() => setAction({ ...action, downloads: true })}
                    >
                      <Download size={21} />
                      <span>Сохранить вложение</span>
                    </button>
                  )
                )}
                <button
                  type="button"
                  className="chat-action is-danger"
                  onClick={() => {
                    setDeleting(action.note);
                    setAction(null);
                    setError('');
                  }}
                >
                  <Trash2 size={21} />
                  <span>Удалить сообщение</span>
                </button>
              </>
            )}
            <button
              type="button"
              className="chat-action chat-action-cancel"
              onClick={() => setAction(null)}
            >
              Отмена
            </button>
          </div>
        </ModalSurface>
      )}
      {deleting && (
        <Dialog
          title="Удалить сообщение?"
          onClose={() => {
            if (!busy) {
              setDeleting(null);
              setError('');
            }
          }}
          footer={
            <>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setDeleting(null);
                  setError('');
                }}
              >
                Отмена
              </Button>
              <Button variant="danger" loading={busy} onClick={() => void confirmDelete()}>
                Удалить
              </Button>
            </>
          }
        >
          <p className="text-sm leading-relaxed text-slate-600">
            Сообщение и все вложения будут удалены из истории этого заказа.
          </p>
          {error && (
            <p className="voice-error" role="alert">
              {error}
            </p>
          )}
        </Dialog>
      )}
    </section>
  );
}
