export type RadarSelectionSource = 'manual' | 'recommendation';

export interface RadarManualSelection {
  supplierId: string;
  orderId: string;
  partId: string;
  source?: RadarSelectionSource;
  createdAt: number;
}

const RADAR_MANUAL_SELECTIONS_KEY = 'radar_manual_supplier_parts';
const RADAR_MANUAL_SELECTIONS_EVENT = 'radar-manual-selections-updated';

const notifyManualSelectionsUpdated = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(RADAR_MANUAL_SELECTIONS_EVENT));
};

const normalizeSelections = (value: unknown): RadarManualSelection[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Partial<RadarManualSelection>;
      if (!row.supplierId || !row.orderId || !row.partId) return null;
      const source = row.source === 'recommendation' ? 'recommendation' : 'manual';
      return {
        supplierId: String(row.supplierId),
        orderId: String(row.orderId),
        partId: String(row.partId),
        source,
        createdAt: Number.isFinite(Number(row.createdAt)) ? Number(row.createdAt) : Date.now()
      };
    })
    .filter((item): item is RadarManualSelection => !!item);
};

export const getRadarManualSelections = (): RadarManualSelection[] => {
  try {
    const raw = localStorage.getItem(RADAR_MANUAL_SELECTIONS_KEY);
    if (!raw) return [];
    return normalizeSelections(JSON.parse(raw));
  } catch {
    return [];
  }
};

export const saveRadarManualSelections = (items: RadarManualSelection[]) => {
  const unique = new Map<string, RadarManualSelection>();
  items.forEach((item) => {
    const source = item.source === 'recommendation' ? 'recommendation' : 'manual';
    unique.set(`${item.supplierId}:${item.orderId}:${item.partId}:${source}`, { ...item, source });
  });
  localStorage.setItem(RADAR_MANUAL_SELECTIONS_KEY, JSON.stringify(Array.from(unique.values())));
  notifyManualSelectionsUpdated();
};

export const addRadarManualSelection = (selection: Omit<RadarManualSelection, 'createdAt'>) => {
  const current = getRadarManualSelections();
  current.push({ ...selection, source: selection.source === 'recommendation' ? 'recommendation' : 'manual', createdAt: Date.now() });
  saveRadarManualSelections(current);
};

export const removeRadarManualSelection = (selection: Pick<RadarManualSelection, 'supplierId' | 'orderId' | 'partId'>) => {
  const next = getRadarManualSelections().filter((item) => !(item.supplierId === selection.supplierId && item.orderId === selection.orderId && item.partId === selection.partId));
  saveRadarManualSelections(next);
};

export const removeRadarManualSelectionsForPair = (supplierId: string, orderId: string) => {
  const next = getRadarManualSelections().filter((item) => !(item.supplierId === supplierId && item.orderId === orderId));
  saveRadarManualSelections(next);
};

export { RADAR_MANUAL_SELECTIONS_EVENT };
