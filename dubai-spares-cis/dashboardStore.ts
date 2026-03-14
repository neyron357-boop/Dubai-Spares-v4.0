/**
 * Dashboard Widget Store — Digital Boss v1.0
 *
 * Persists widget order and visibility to localStorage.
 * Widgets are reorderable and can be hidden individually.
 */

export type WidgetId = 'money_pulse' | 'smart_route' | 'vip_focus' | 'inbox_cleanup';

export interface WidgetConfig {
  id: WidgetId;
  visible: boolean;
}

const DASHBOARD_STORE_KEY = 'digital_boss_dashboard_v1';

const DEFAULT_WIDGETS: WidgetConfig[] = [
  { id: 'money_pulse', visible: true },
  { id: 'smart_route', visible: true },
  { id: 'vip_focus', visible: true },
  { id: 'inbox_cleanup', visible: true },
];

/** All known widget IDs in stable order (for merging saved configs) */
const KNOWN_IDS: WidgetId[] = ['money_pulse', 'smart_route', 'vip_focus', 'inbox_cleanup'];

/** Load widget config from localStorage, merging with defaults */
export const loadDashboardWidgets = (): WidgetConfig[] => {
  try {
    const raw = localStorage.getItem(DASHBOARD_STORE_KEY);
    if (!raw) return DEFAULT_WIDGETS;
    const saved: WidgetConfig[] = JSON.parse(raw);
    if (!Array.isArray(saved)) return DEFAULT_WIDGETS;

    // Merge saved order with any new widgets not yet in saved
    const savedIds = new Set(saved.map((w) => w.id));
    const merged: WidgetConfig[] = saved.filter((w) => KNOWN_IDS.includes(w.id));
    KNOWN_IDS.forEach((id) => {
      if (!savedIds.has(id)) {
        merged.push({ id, visible: true });
      }
    });
    return merged;
  } catch {
    return DEFAULT_WIDGETS;
  }
};

/** Persist widget config to localStorage */
export const saveDashboardWidgets = (widgets: WidgetConfig[]): void => {
  try {
    localStorage.setItem(DASHBOARD_STORE_KEY, JSON.stringify(widgets));
  } catch {
    // ignore storage errors
  }
};

/** Toggle visibility of a single widget */
export const toggleWidgetVisibility = (
  widgets: WidgetConfig[],
  id: WidgetId,
): WidgetConfig[] => widgets.map((w) => (w.id === id ? { ...w, visible: !w.visible } : w));

/** Reorder: move widget at fromIndex to toIndex */
export const reorderWidgets = (
  widgets: WidgetConfig[],
  fromIndex: number,
  toIndex: number,
): WidgetConfig[] => {
  if (fromIndex === toIndex) return widgets;
  const next = [...widgets];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
};
