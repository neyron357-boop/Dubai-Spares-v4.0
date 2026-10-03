import type { Supplier } from '../types';

export type SupplierDirectorySort = 'smart' | 'name' | 'recent' | 'fast';

export function normalizeSupplierPhone(raw: string | undefined): string {
  const text = String(raw || '').trim();
  if (!/^[+\d\s().-]+$/.test(text) || (text.includes('+') && !/^\+[^+]+$/.test(text))) return '';
  let digits = text.replace(/\D/g, '');
  if (!digits) return '';
  if (text.startsWith('00')) digits = digits.slice(2);
  else if (!text.startsWith('+') && digits.startsWith('0')) digits = `971${digits.slice(1)}`;
  return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : '';
}

export function getSupplierContacts(supplier: Supplier) {
  const phone = normalizeSupplierPhone(supplier.phone) || null;
  const explicitWhatsapp = normalizeSupplierPhone(supplier.whatsapp) || null;
  return {
    phone,
    whatsapp: explicitWhatsapp || (supplier.hasWhatsapp !== false ? phone : null),
  };
}

export function getSupplierBrands(supplier: Supplier): string[] {
  const primary = (supplier.mainBrands || []).filter((brand) => brand.trim());
  const brands = primary.length ? primary : (supplier.brands || []).filter((brand) => brand.trim());
  return Array.from(
    new Set(brands.length ? brands : supplier.primaryBrand ? [supplier.primaryBrand] : []),
  );
}

export function getSupplierLocationLabel(supplier: Supplier): string | null {
  if (supplier.zone?.trim()) return supplier.zone.trim();
  const location = supplier.location?.trim();
  if (
    location &&
    !/^https?:\/\//i.test(location) &&
    !/^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(location)
  )
    return location;
  if (location || supplier.coordinates) return 'Точка на карте';
  return null;
}

const normalizeText = (text: string) =>
  text
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/ё/g, 'е');

export function matchesSupplierQuery(supplier: Supplier, query: string): boolean {
  const normalized = normalizeText(query.trim());
  if (!normalized) return true;
  const haystack = normalizeText(
    [
      supplier.name,
      supplier.zone || '',
      getSupplierLocationLabel(supplier) || '',
      ...getSupplierBrands(supplier),
      ...(supplier.models || []),
      ...(supplier.mainPartCategories || []),
      ...(supplier.years || []).map(String),
    ].join(' '),
  );
  const words = haystack.split(/[^\p{L}\p{N}]+/u);
  if (
    normalized
      .split(/\s+/)
      .every((token) => (/^\d+$/.test(token) ? words.includes(token) : haystack.includes(token)))
  )
    return true;
  const phoneQuery = normalized.replace(/\D/g, '');
  const contacts = getSupplierContacts(supplier);
  return (
    /^[+\d\s().-]+$/.test(normalized) &&
    phoneQuery.length >= 3 &&
    [supplier.phone, supplier.whatsapp, contacts.phone, contacts.whatsapp].some((phone) =>
      String(phone || '')
        .replace(/\D/g, '')
        .includes(phoneQuery),
    )
  );
}

export function sortSupplierDirectory<T extends Supplier>(
  suppliers: T[],
  sort: SupplierDirectorySort,
): T[] {
  const byName = (a: Supplier, b: Supplier) =>
    a.name.localeCompare(b.name, 'ru', { sensitivity: 'base', numeric: true }) ||
    a.id.localeCompare(b.id);
  return [...suppliers].sort((a, b) => {
    if (sort === 'name') return byName(a, b);
    if (sort === 'recent')
      return (
        Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0) ||
        byName(a, b)
      );
    if (sort === 'fast')
      return (
        Number(b.whatsappFast === true && !!getSupplierContacts(b).whatsapp) -
          Number(a.whatsappFast === true && !!getSupplierContacts(a).whatsapp) || byName(a, b)
      );
    return Number(b.isPinned === true) - Number(a.isPinned === true) || byName(a, b);
  });
}
