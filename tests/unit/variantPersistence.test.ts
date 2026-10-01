import { expect, it, vi } from 'vitest';
import {
  deleteStandaloneVariant,
  getStandaloneVariants,
  loadStandaloneVariants,
  upsertStandaloneVariant,
} from '../../variantLibraryStore';

it('a full local storage cannot publish an unsaved variant or remove a saved one', () => {
  const original = {
    id: 'saved',
    origin: 'standalone' as const,
    priceAed: 10,
    shopName: 'Real Parts',
    phone: '',
    location: '',
    createdAt: 1,
  };
  localStorage.setItem('dubai_spares_standalone_variants', JSON.stringify([original]));
  loadStandaloneVariants();
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Full', 'QuotaExceededError');
  });
  expect(() => upsertStandaloneVariant({ ...original, id: 'unsaved' })).toThrow('Full');
  expect(getStandaloneVariants().map((item) => item.id)).toEqual(['saved']);
  expect(() => deleteStandaloneVariant('saved')).toThrow('Full');
  expect(getStandaloneVariants().map((item) => item.id)).toEqual(['saved']);
});
