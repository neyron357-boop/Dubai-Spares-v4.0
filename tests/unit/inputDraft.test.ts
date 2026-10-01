import { describe, expect, it } from 'vitest';
import { sanitizeMoneyInput } from '../../utils/moneyInput';
import { readFormDraft } from '../../hooks/useFormDraft';

describe('price input and local draft recovery', () => {
  it('keeps decimal prices and pasted amounts at their real value', () => {
    expect(Number(sanitizeMoneyInput('450,50'))).toBe(450.5);
    expect(Number(sanitizeMoneyInput('AED 1,500.50'))).toBe(1500.5);
    expect(Number(sanitizeMoneyInput('1 500,50'))).toBe(1500.5);
    expect(sanitizeMoneyInput('450.')).toBe('450.');
    expect(sanitizeMoneyInput('')).toBe('');
  });
  it('rejects malformed and expired drafts without throwing', () => {
    const key = 'test-draft';
    const validate = (value: unknown): value is { name: string } =>
      Boolean(value && typeof (value as { name?: unknown }).name === 'string');
    localStorage.setItem(
      key,
      JSON.stringify({ savedAt: 'invalid', data: { name: 'Bad timestamp' } }),
    );
    expect(readFormDraft(key, validate)).toBeNull();
    localStorage.setItem(key, '{broken');
    expect(readFormDraft(key, validate)).toBeNull();
    localStorage.setItem(
      key,
      JSON.stringify({ savedAt: Date.now() - 8 * 86400000, data: { name: 'Old' } }),
    );
    expect(readFormDraft(key, validate)).toBeNull();
    localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data: { name: 'Saved' } }));
    expect(readFormDraft(key, validate)).toEqual({ name: 'Saved' });
  });
});
