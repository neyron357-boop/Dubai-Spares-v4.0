export interface RadarManualSelection {
  supplierId: string;
  orderId: string;
  partId: string;
  createdAt: number;
}

const RADAR_MANUAL_SELECTIONS_KEY = 'radar_manual_supplier_parts';

const normalizeSelections = (value: unknown): RadarManualSelection[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Partial<RadarManualSelection>;
      if (!row.supplierId || !row.orderId || !row.partId) return null;
      return {
        supplierId: String(row.supplierId),
        orderId: String(row.orderId),
        partId: String(row.partId),
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
  items.forEach((item) => unique.set(`${item.supplierId}:${item.orderId}:${item.partId}`, item));
  localStorage.setItem(RADAR_MANUAL_SELECTIONS_KEY, JSON.stringify(Array.from(unique.values())));
};

export const addRadarManualSelection = (selection: Omit<RadarManualSelection, 'createdAt'>) => {
  const current = getRadarManualSelections();
  current.push({ ...selection, createdAt: Date.now() });
  saveRadarManualSelections(current);
};
