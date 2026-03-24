import { Order } from './types';

const PART_CATEGORIES_KEY = 'dubai_spares_part_categories_v1';

export const DEFAULT_PART_CATEGORIES = [
  'Двигатель',
  'Трансмиссия',
  'Кузов',
  'Подвеска',
  'Электрика',
  'Оптика',
  'Салон',
  'Тормозная система'
];

const normalizeCategory = (value: string) => value.replace(/\s+/g, ' ').trim();

const dedupeCategories = (items: string[]) => {
  const seen = new Set<string>();
  const result: string[] = [];

  items.forEach((item) => {
    const normalized = normalizeCategory(item);
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(normalized);
  });

  return result;
};

export const getStoredPartCategories = () => {
  try {
    const raw = localStorage.getItem(PART_CATEGORIES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return dedupeCategories(parsed.filter((item): item is string => typeof item === 'string'));
  } catch {
    return [];
  }
};

export const saveCustomPartCategory = (category: string) => {
  const normalized = normalizeCategory(category);
  if (!normalized) return false;

  const existing = getStoredPartCategories();
  if (existing.some((item) => item.toLowerCase() === normalized.toLowerCase())) return false;

  const next = [...existing, normalized];
  localStorage.setItem(PART_CATEGORIES_KEY, JSON.stringify(next));
  return true;
};

const collectPartCategoriesFromOrders = (orders: Order[]) => {
  const dynamic = orders.flatMap((order) =>
    (order.parts || [])
      .map((part) => (typeof part.partType === 'string' ? part.partType : ''))
      .filter(Boolean)
  );
  return dedupeCategories(dynamic);
};

export const getUnifiedPartCategories = (orders: Order[] = []) => {
  const base = dedupeCategories(DEFAULT_PART_CATEGORIES);
  const stored = getStoredPartCategories();
  const fromOrders = collectPartCategoriesFromOrders(orders);
  const merged = dedupeCategories([...base, ...stored, ...fromOrders]);
  const pinned = merged.filter((item) => base.some((baseItem) => baseItem.toLowerCase() === item.toLowerCase()));
  const extra = merged
    .filter((item) => !base.some((baseItem) => baseItem.toLowerCase() === item.toLowerCase()))
    .sort((a, b) => a.localeCompare(b, 'ru'));

  return [...pinned, ...extra];
};

export const normalizePartCategory = (value: string) => normalizeCategory(value);
