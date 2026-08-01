export type NormalizedGroupItem = {
  id: string;
  name: string;
  quantity: number;
};

const parseQuantity = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.max(1, Math.round(parsed));
};

export const normalizePartQuantity = (value: unknown): number => parseQuantity(value);

export const normalizeGroupItems = (raw: unknown): NormalizedGroupItem[] => {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((entry, index): NormalizedGroupItem | null => {
      if (typeof entry === 'string') {
        const name = entry.trim();
        if (!name) return null;
        return { id: `legacy-${index}`, name, quantity: 1 };
      }

      if (!entry || typeof entry !== 'object') return null;
      const src = entry as Record<string, unknown>;
      const name = String(src.name || src.title || '').trim();
      if (!name) return null;
      const id = String(src.id || `group-item-${index}`);
      const quantity = parseQuantity(src.quantity ?? src.qty ?? src.count);
      return { id, name, quantity };
    })
    .filter((item): item is NormalizedGroupItem => item !== null);
};

type PartDisplaySource = {
  name?: unknown;
  partKind?: unknown;
  groupItems?: unknown;
};

export const buildGroupItemsLabel = (raw: unknown, delimiter = ', '): string => {
  const items = normalizeGroupItems(raw);
  return items
    .map((item) => `${item.name} ×${item.quantity}`)
    .join(delimiter);
};

export const getPartDisplayName = (part: PartDisplaySource, fallback = 'Группа деталей'): string => {
  const explicitName = String(part?.name || '').trim();
  if (explicitName) return explicitName;

  if (part?.partKind === 'group') {
    const groupLabel = buildGroupItemsLabel(part.groupItems);
    if (groupLabel) return groupLabel;
    return fallback;
  }

  return 'Без названия';
};
