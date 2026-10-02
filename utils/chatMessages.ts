import type { ChatAttachment, OrderNote } from '../types';

const validDate = (value: number) =>
  Number.isFinite(value) && value > 0 && Number.isFinite(new Date(value).getTime());
export function chatDayKey(value: number) {
  if (!validDate(value)) return 'unknown';
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}
export function chatDayLabel(value: number, now = Date.now()) {
  if (!validDate(value)) return 'Без даты';
  if (chatDayKey(value) === chatDayKey(now)) return 'Сегодня';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (chatDayKey(value) === chatDayKey(yesterday.getTime())) return 'Вчера';
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    ...(new Date(value).getFullYear() === new Date(now).getFullYear() ? {} : { year: 'numeric' }),
  }).format(value);
}
export function chatTime(value: number) {
  return validDate(value)
    ? new Intl.DateTimeFormat('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(value)
    : '—';
}
export function chronologicalNotes(notes: OrderNote[]) {
  return [...notes].sort(
    (a, b) =>
      (validDate(a.createdAt) ? a.createdAt : 0) - (validDate(b.createdAt) ? b.createdAt : 0),
  );
}
export function chatDisplayText(note: OrderNote) {
  const text = String(note.text || '').trim();
  const hasMedia =
    note.photos?.length ||
    note.audios?.length ||
    note.videoUrls?.length ||
    note.attachments?.length;
  return hasMedia &&
    [
      'фото-пруф',
      'видео-пруф',
      'голосовой пруф',
      'пруф заказа',
      'фото',
      'видео',
      'attachment',
    ].includes(text.toLowerCase())
    ? ''
    : text;
}
export function safeChatHref(value: string | undefined, file = false) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (['https:', 'http:'].includes(url.protocol)) return url.href;
    if (
      file &&
      (url.protocol === 'blob:' ||
        (url.protocol === 'data:' &&
          !/^data:(text\/html|application\/(xhtml\+xml|javascript))/i.test(value)))
    )
      return value;
  } catch {
    /* Invalid imported URLs are displayed without an active link. */
  }
  return undefined;
}
export function chatAttachmentHref(attachment: ChatAttachment) {
  return attachment.kind === 'contact' && attachment.phone
    ? `tel:${attachment.phone.replace(/[^\d+]/g, '')}`
    : safeChatHref(
        attachment.kind === 'file' ? attachment.fileUrl : attachment.value,
        attachment.kind === 'file',
      );
}
export function chatFileExtension(url: string, fallback = 'jpg') {
  const mime = url.match(/^data:([^;,]+)/)?.[1];
  return (
    (
      {
        'image/jpeg': 'jpg',
        'image/svg+xml': 'svg',
        'image/avif': 'avif',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/gif': 'gif',
        'image/heic': 'heic',
        'video/mp4': 'mp4',
        'video/webm': 'webm',
        'video/quicktime': 'mov',
      } as Record<string, string>
    )[mime || ''] ||
    url.match(/\.(\w{2,5})(?:[?#].*)?$/)?.[1] ||
    fallback
  );
}
