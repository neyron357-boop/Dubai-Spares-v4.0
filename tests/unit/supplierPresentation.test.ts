import { describe, expect, it } from 'vitest';
import type { Supplier } from '../../types';
import {
  getSupplierBrands,
  getSupplierContacts,
  getSupplierLocationLabel,
  matchesSupplierQuery,
  normalizeSupplierPhone,
  sortSupplierDirectory,
} from '../../utils/supplierPresentation';

const supplier = (patch: Partial<Supplier> = {}): Supplier => ({
  id: 'shop-1',
  name: 'Mahmud',
  phone: '+971 50 123 4567',
  location: '',
  brands: ['BMW'],
  ...patch,
});

describe('supplier directory facts', () => {
  it('normalizes UAE local numbers, formatted international numbers and the 00 prefix', () => {
    expect(normalizeSupplierPhone('050 123 4567')).toBe('+971501234567');
    expect(normalizeSupplierPhone('+971 (50) 123-4567')).toBe('+971501234567');
    expect(normalizeSupplierPhone('00 44 20 7946 0958')).toBe('+442079460958');
    expect(normalizeSupplierPhone('971501234567')).toBe('+971501234567');
  });

  it('rejects malformed or incomplete contacts before creating communication links', () => {
    for (const raw of [
      undefined,
      '',
      '+',
      '+971',
      '050',
      'Call 971501234567',
      '+971501234567 ext. 1',
      '++971501234567',
      '+971+501234567',
      '971+501234567',
      '+1234567890123456',
    ]) {
      expect(normalizeSupplierPhone(raw), `Contact ${raw}`).toBe('');
      expect(getSupplierContacts(supplier({ phone: raw || '', whatsapp: raw }))).toEqual({
        phone: null,
        whatsapp: null,
      });
    }
  });

  it('respects an explicit WhatsApp exclusion while preserving a separate valid WhatsApp contact', () => {
    expect(getSupplierContacts(supplier())).toEqual({
      phone: '+971501234567',
      whatsapp: '+971501234567',
    });
    expect(getSupplierContacts(supplier({ hasWhatsapp: false }))).toEqual({
      phone: '+971501234567',
      whatsapp: null,
    });
    expect(getSupplierContacts(supplier({ hasWhatsapp: false, whatsapp: '050 987 6543' }))).toEqual(
      { phone: '+971501234567', whatsapp: '+971509876543' },
    );
    expect(getSupplierContacts(supplier({ phone: '', whatsapp: '+44 20 7946 0958' }))).toEqual({
      phone: null,
      whatsapp: '+442079460958',
    });
    expect(
      getSupplierContacts(supplier({ hasWhatsapp: false, whatsapp: '+' })).whatsapp,
    ).toBeNull();
  });

  it('shows usable location descriptions without exposing raw coordinates or map URLs', () => {
    expect(getSupplierLocationLabel(supplier({ location: '25.32265, 55.37892' }))).toBe(
      'Точка на карте',
    );
    expect(getSupplierLocationLabel(supplier({ location: 'https://maps.app.goo.gl/shop' }))).toBe(
      'Точка на карте',
    );
    expect(getSupplierLocationLabel(supplier({ coordinates: { lat: 25.32, lng: 55.37 } }))).toBe(
      'Точка на карте',
    );
    expect(
      getSupplierLocationLabel(supplier({ zone: ' Sajaa ', location: '25.32265, 55.37892' })),
    ).toBe('Sajaa');
    expect(getSupplierLocationLabel(supplier({ location: ' Warehouse 18, Sharjah ' }))).toBe(
      'Warehouse 18, Sharjah',
    );
    expect(getSupplierLocationLabel(supplier())).toBeNull();
  });

  it('prefers specified main brands and falls back when main brands contain only empty values', () => {
    expect(getSupplierBrands(supplier({ mainBrands: ['Mercedes-Benz'], brands: ['BMW'] }))).toEqual(
      ['Mercedes-Benz'],
    );
    expect(getSupplierBrands(supplier({ mainBrands: ['', ' '], brands: ['BMW', 'BMW'] }))).toEqual([
      'BMW',
    ]);
    expect(getSupplierBrands(supplier({ brands: [], primaryBrand: 'Toyota' }))).toEqual(['Toyota']);
    expect(getSupplierBrands(supplier({ brands: [] }))).toEqual([]);
  });

  it('matches combined brand, model and zone tokens and unformatted phone digits', () => {
    const row = supplier({ zone: 'Sajaa', models: ['3 Series'], mainPartCategories: ['Оптика'] });
    expect(matchesSupplierQuery(row, 'bmw 3 series sajAA')).toBe(true);
    expect(matchesSupplierQuery(row, '50 (123)-4567')).toBe(true);
    expect(matchesSupplierQuery(row, 'Оптика Sajaa')).toBe(true);
    expect(matchesSupplierQuery(row, '   ')).toBe(true);
    expect(matchesSupplierQuery(row, 'BMW 5 Series')).toBe(false);
    expect(matchesSupplierQuery(row, 'Ras Al Khor')).toBe(false);
    expect(matchesSupplierQuery(row, '+971509999999')).toBe(false);
  });

  it('sorts pinned contacts, names and actual update dates deterministically without mutating input', () => {
    const rows = [
      supplier({ id: 'b', name: 'Bravo', createdAt: 30 }),
      supplier({ id: 'c', name: 'Alpha', isPinned: true, updatedAt: 10 }),
      supplier({ id: 'a', name: 'Alpha', isPinned: true, updatedAt: 20 }),
      supplier({ id: 'd', name: 'Delta', updatedAt: 40 }),
    ];
    const ids = (items: Supplier[]) => items.map((item) => item.id);
    expect(ids(sortSupplierDirectory(rows, 'smart'))).toEqual(['a', 'c', 'b', 'd']);
    expect(ids(sortSupplierDirectory(rows, 'name'))).toEqual(['a', 'c', 'b', 'd']);
    expect(ids(sortSupplierDirectory(rows, 'recent'))).toEqual(['d', 'b', 'a', 'c']);
    expect(ids(rows)).toEqual(['b', 'c', 'a', 'd']);
    expect(ids(sortSupplierDirectory([...rows].reverse(), 'smart'))).toEqual(['a', 'c', 'b', 'd']);
  });

  it('prioritizes quick WhatsApp only when a usable WhatsApp contact exists', () => {
    const rows = [
      supplier({ id: 'invalid', name: 'Alpha', phone: '+', whatsappFast: true }),
      supplier({ id: 'excluded', name: 'Bravo', hasWhatsapp: false, whatsappFast: true }),
      supplier({ id: 'normal', name: 'Charlie', whatsappFast: false }),
      supplier({
        id: 'fast',
        name: 'Zulu',
        phone: '',
        whatsapp: '+971509876543',
        whatsappFast: true,
      }),
    ];
    expect(sortSupplierDirectory(rows, 'fast').map((item) => item.id)).toEqual([
      'fast',
      'invalid',
      'excluded',
      'normal',
    ]);
  });
});
