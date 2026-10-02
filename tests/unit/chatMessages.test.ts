import { describe, expect, it } from 'vitest';
import type { OrderNote } from '../../types';
import {
  chatAttachmentHref,
  chatDayKey,
  chatDayLabel,
  chatDisplayText,
  chatFileExtension,
  chatTime,
  chronologicalNotes,
  safeChatHref,
} from '../../utils/chatMessages';

describe('chat messages', () => {
  it('orders existing notes chronologically without mutating saved data', () => {
    const notes: OrderNote[] = [
      { id: 'new', text: 'new', createdAt: 200 },
      { id: 'old', text: 'old', createdAt: 100 },
    ];
    expect(chronologicalNotes(notes).map((note) => note.id)).toEqual(['old', 'new']);
    expect(notes[0].id).toBe('new');
  });
  it('groups local calendar days and uses Russian labels and 24 hour time', () => {
    const now = new Date(2026, 9, 2, 10, 49).getTime();
    expect(chatDayLabel(now, now)).toBe('Сегодня');
    expect(chatTime(now)).toBe('10:49');
    const yesterday = new Date(2026, 9, 1, 23, 59).getTime();
    expect(chatDayLabel(yesterday, now)).toBe('Вчера');
    expect(chatDayKey(yesterday)).not.toBe(chatDayKey(now));
    expect(chatDayLabel(NaN)).toBe('Без даты');
    expect(chatTime(1e20)).toBe('—');
  });
  it('hides generated media labels and preserves genuine captions and multiline text', () => {
    expect(chatDisplayText({ id: 'x', text: 'Фото-пруф', photos: ['image'], createdAt: 1 })).toBe(
      '',
    );
    expect(
      chatDisplayText({
        id: 'x',
        text: 'Образец\nдля клиента 🙂',
        photos: ['image'],
        createdAt: 1,
      }),
    ).toBe('Образец\nдля клиента 🙂');
    expect(chatDisplayText({ id: 'x', text: 'Фото', createdAt: 1 })).toBe('Фото');
  });
  it('allows normal links and local media downloads without activating unsafe imported URLs', () => {
    expect(safeChatHref('https://example.com/price.pdf')).toBe('https://example.com/price.pdf');
    expect(safeChatHref('data:audio/wav;base64,AA', true)).toBe('data:audio/wav;base64,AA');
    expect(safeChatHref('javascript:alert(1)')).toBeUndefined();
    expect(safeChatHref('data:text/html,script', true)).toBeUndefined();
    expect(safeChatHref('file:///private/file')).toBeUndefined();
    expect(chatFileExtension('data:video/mp4;base64,AA')).toBe('mp4');
    expect(
      chatAttachmentHref({
        id: 'c',
        kind: 'contact',
        name: 'Supplier',
        phone: '+971 (50) 123-45-67',
        createdAt: 1,
      }),
    ).toBe('tel:+971501234567');
  });
});
