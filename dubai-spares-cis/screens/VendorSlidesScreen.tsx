import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Eye, EyeOff, GripVertical, Layers, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { ensureUuid } from '../id';
import { Priority } from '../types';

type FilterField = 'brand' | 'model' | 'status' | 'tags' | 'hasSupplier' | 'country' | 'createdAt' | 'orderId' | 'vin' | 'partKeyword' | 'vendorArea';
type FilterOperator = 'equals' | 'contains' | 'not_equals' | 'between' | 'in';

type FilterValue = string | string[] | { from?: string; to?: string };

interface CustomColumnFilter {
  id: string;
  field: FilterField;
  operator: FilterOperator;
  value: FilterValue;
}

interface CustomColumn {
  id: string;
  name: string;
  filters: CustomColumnFilter[];
  color?: string;
  order: number;
  createdAt: number;
  updatedAt: number;
}

type ColumnStat = CustomColumn & { ordersCount: number; partsCount: number; isDefault?: boolean; brand?: string };

const STORAGE_KEY = 'vendor_slides_custom_columns_v1';
const HIDE_DEFAULTS_KEY = 'vendor_slides_hide_defaults_v1';
const ORDER_STATUS_OPTIONS = ['Лиды', 'В работе', 'Ожидание клиента', 'Оплачено', 'Найден/Выкуплен', 'Отправлен/Завершён', 'Архив/Отказ'] as const;
const TAG_OPTIONS = ['Срочно', 'VIP', 'Лид'] as const;
const COLORS = [
  '#334155', '#1d4ed8', '#0f766e', '#7c3aed', '#be123c', '#c2410c',
  '#0369a1', '#059669', '#d97706', '#9333ea', '#db2777', '#475569',
];

const emptyFilter = (): CustomColumnFilter => ({ id: ensureUuid(), field: 'brand', operator: 'equals', value: '' });

const getOrderTags = (order: { priority: Priority; isVip?: boolean; isLead?: boolean; customerStatus?: string; status?: string }) => {
  const tags: string[] = [];
  if (order.priority === Priority.HIGH) tags.push('Срочно');
  if (order.isVip || order.customerStatus === 'VIP') tags.push('VIP');
  if (order.isLead || order.customerStatus === 'LEAD' || order.status === 'lead') tags.push('Лид');
  return tags;
};

const toOrderStatus = (order: { isArchived: boolean; isSold: boolean; isLead?: boolean; customerStatus?: string; status?: string }) => {
  if (order.isArchived || order.status === 'archive') return 'Архив/Отказ';
  if (order.isSold) return 'Отправлен/Завершён';
  if (order.isLead || order.customerStatus === 'LEAD' || order.status === 'lead') return 'Лиды';
  if (order.status === 'in_progress') return 'В работе';
  if (order.status === 'vip' || order.customerStatus === 'VIP') return 'Ожидание клиента';
  if (order.status === 'new_inquiry') return 'Оплачено';
  return 'Найден/Выкуплен';
};

/* ─── tile entry animation ─── */
const TILE_ANIM = 'transition-all duration-200 ease-out';

const VendorSlidesScreen: React.FC = () => {
  const navigate = useNavigate();
  const { orders } = useStore();
  const [columns, setColumns] = useState<CustomColumn[]>([]);
  const [hideDefaults, setHideDefaults] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; color: string; filters: CustomColumnFilter[] }>({
    name: '', color: COLORS[0], filters: [emptyFilter()]
  });
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [openedColumnId, setOpenedColumnId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) as CustomColumn[] : [];
      if (Array.isArray(parsed)) setColumns(parsed.sort((a, b) => a.order - b.order));
    } catch {
      setColumns([]);
    }
    try {
      const hide = localStorage.getItem(HIDE_DEFAULTS_KEY);
      if (hide === 'true') setHideDefaults(true);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(columns));
  }, [columns]);

  useEffect(() => {
    localStorage.setItem(HIDE_DEFAULTS_KEY, String(hideDefaults));
  }, [hideDefaults]);

  const brands = useMemo(() => Array.from(new Set(orders.map((o) => o.brand))).sort((a, b) => a.localeCompare(b)), [orders]);
  const models = useMemo(() => Array.from(new Set(orders.map((o) => o.model))).sort((a, b) => a.localeCompare(b)), [orders]);
  const countries = useMemo(() => Array.from(new Set(orders.map((o) => o.logistics?.cargoCountry || '').filter(Boolean))).sort((a, b) => a.localeCompare(b)), [orders]);
  const vendorAreas = useMemo(() => {
    const areas = new Set<string>();
    orders.forEach((o) => {
      (o.vendorContacts || []).forEach((vc) => {
        const note = (vc.note || '').trim();
        if (note) note.split(/[,/]/g).map((s: string) => s.trim()).filter((a: string) => a).forEach((a: string) => areas.add(a));
      });
    });
    return Array.from(areas).sort((a, b) => a.localeCompare(b));
  }, [orders]);

  const applyFilter = (order: typeof orders[number], filter: CustomColumnFilter): boolean => {
    if (filter.field === 'brand') {
      const current = order.brand || '';
      return filter.operator === 'contains' ? current.toLowerCase().includes(String(filter.value).toLowerCase()) : current.toLowerCase() === String(filter.value).toLowerCase();
    }
    if (filter.field === 'model') {
      const current = order.model || '';
      return filter.operator === 'contains' ? current.toLowerCase().includes(String(filter.value).toLowerCase()) : current.toLowerCase() === String(filter.value).toLowerCase();
    }
    if (filter.field === 'status') return toOrderStatus(order) === String(filter.value);
    if (filter.field === 'tags') {
      const current = getOrderTags(order).map((tag) => tag.toLowerCase());
      const values = Array.isArray(filter.value) ? filter.value : [String(filter.value)];
      return values.every((tag) => current.includes(tag.toLowerCase()));
    }
    if (filter.field === 'hasSupplier') {
      const hasSupplier = (order.vendorContacts || []).length > 0;
      return String(filter.value) === 'yes' ? hasSupplier : !hasSupplier;
    }
    if (filter.field === 'country') {
      const country = (order.logistics?.cargoCountry || '').toLowerCase();
      return filter.operator === 'contains' ? country.includes(String(filter.value).toLowerCase()) : country === String(filter.value).toLowerCase();
    }
    if (filter.field === 'createdAt') {
      const range = typeof filter.value === 'object' && filter.value ? filter.value : {};
      const from = (range as { from?: string }).from ? new Date((range as { from?: string }).from as string).getTime() : Number.NEGATIVE_INFINITY;
      const to = (range as { to?: string }).to ? new Date(`${(range as { to?: string }).to}T23:59:59`).getTime() : Number.POSITIVE_INFINITY;
      return order.createdAt >= from && order.createdAt <= to;
    }
    if (filter.field === 'orderId') {
      const current = order.id || '';
      if (filter.operator === 'equals') return current === String(filter.value);
      if (filter.operator === 'not_equals') return current !== String(filter.value);
      return current.toLowerCase().includes(String(filter.value).toLowerCase());
    }
    if (filter.field === 'vin') {
      const current = order.vin || '';
      if (filter.operator === 'equals') return current.toLowerCase() === String(filter.value).toLowerCase();
      if (filter.operator === 'not_equals') return current.toLowerCase() !== String(filter.value).toLowerCase();
      return current.toLowerCase().includes(String(filter.value).toLowerCase());
    }
    if (filter.field === 'partKeyword') {
      const kw = String(filter.value || '').toLowerCase().trim();
      if (!kw) return true;
      return order.parts.some((p) => p.name.toLowerCase().includes(kw));
    }
    if (filter.field === 'vendorArea') {
      const kw = String(filter.value || '').toLowerCase().trim();
      if (!kw) return true;
      return (order.vendorContacts || []).some((vc) =>
        (vc.note || '').toLowerCase().includes(kw) ||
        (vc.name || '').toLowerCase().includes(kw)
      );
    }
    return true;
  };

  const stats = useMemo(() => columns.map((column) => {
    const matches = orders.filter((order) => column.filters.every((filter) => applyFilter(order, filter)));
    return { ...column, ordersCount: matches.length, partsCount: matches.reduce((sum, o) => sum + o.parts.length, 0) };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [columns, orders]);

  const defaultBrandStats = useMemo(() => {
    const grouped = new Map<string, { ordersCount: number; partsCount: number }>();
    orders.forEach((order) => {
      const brand = (order.brand || 'Без марки').trim() || 'Без марки';
      const current = grouped.get(brand) || { ordersCount: 0, partsCount: 0 };
      current.ordersCount += 1;
      current.partsCount += order.parts.length;
      grouped.set(brand, current);
    });
    return Array.from(grouped.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([brand, info], index) => ({
        id: `default-brand-${brand}`,
        name: brand,
        filters: [],
        order: index,
        createdAt: 0,
        updatedAt: 0,
        color: '#1d4ed8',
        isDefault: true,
        brand,
        ...info
      } as ColumnStat));
  }, [orders]);

  const allStats = useMemo(
    () => (hideDefaults ? [] : defaultBrandStats).concat(stats),
    [defaultBrandStats, stats, hideDefaults]
  );

  const openedColumn = useMemo(() => {
    if (!openedColumnId) return null;
    return allStats.find((column) => column.id === openedColumnId) || null;
  }, [openedColumnId, allStats]);

  const openedOrders = useMemo(() => {
    if (!openedColumn) return [];
    if (openedColumn.isDefault && openedColumn.brand) {
      return orders
        .filter((order) => (order.brand || 'Без марки').trim() === openedColumn.brand)
        .sort((a, b) => b.createdAt - a.createdAt);
    }
    return orders
      .filter((order) => openedColumn.filters.every((filter) => applyFilter(order, filter)))
      .sort((a, b) => b.createdAt - a.createdAt);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openedColumn, orders]);

  const moveColumn = (columnId: string, direction: -1 | 1) => {
    setColumns((prev) => {
      const arr = [...prev].sort((a, b) => a.order - b.order);
      const from = arr.findIndex((item) => item.id === columnId);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= arr.length) return prev;
      const [moved] = arr.splice(from, 1);
      arr.splice(to, 0, moved);
      return arr.map((item, idx) => ({ ...item, order: idx, updatedAt: Date.now() }));
    });
  };

  const openCreate = () => {
    setEditingId(null);
    setDraft({ name: '', color: COLORS[0], filters: [emptyFilter()] });
    setEditorOpen(true);
  };

  const openEdit = (column: CustomColumn) => {
    setEditingId(column.id);
    setDraft({ name: column.name, color: column.color || COLORS[0], filters: column.filters.length ? column.filters : [emptyFilter()] });
    setEditorOpen(true);
  };

  const saveColumn = () => {
    const name = draft.name.trim().slice(0, 50);
    if (!name || draft.filters.length === 0) return;
    const now = Date.now();
    setColumns((prev) => {
      if (editingId) return prev.map((item) => item.id === editingId ? { ...item, name, color: draft.color, filters: draft.filters, updatedAt: now } : item);
      return [...prev, { id: ensureUuid(), name, color: draft.color, filters: draft.filters, order: prev.length, createdAt: now, updatedAt: now }];
    });
    setEditorOpen(false);
  };

  const updateFilterField = (filterId: string, field: FilterField) => {
    const defaultOp: FilterOperator = field === 'createdAt' ? 'between'
      : (field === 'partKeyword' || field === 'vendorArea' || field === 'brand' || field === 'model') ? 'contains'
      : 'equals';
    setDraft((p) => ({ ...p, filters: p.filters.map((f) => f.id === filterId ? { ...f, field, operator: defaultOp, value: field === 'tags' ? [] : '' } : f) }));
  };

  const supportsContains = (field: FilterField) =>
    field === 'brand' || field === 'model' || field === 'orderId' || field === 'vin' || field === 'country' || field === 'partKeyword' || field === 'vendorArea';

  const updateFilterOperator = (filterId: string, operator: FilterOperator) =>
    setDraft((p) => ({ ...p, filters: p.filters.map((f) => f.id === filterId ? { ...f, operator } : f) }));

  const updateFilterValue = (filterId: string, value: FilterValue) =>
    setDraft((p) => ({ ...p, filters: p.filters.map((f) => f.id === filterId ? { ...f, value } : f) }));

  const removeFilter = (filterId: string) =>
    setDraft((p) => ({ ...p, filters: p.filters.filter((f) => f.id !== filterId) }));

  const toggleTag = (filterId: string, tag: string, currentValue: FilterValue) => {
    const curr = Array.isArray(currentValue) ? currentValue : [];
    const selected = curr.includes(tag);
    updateFilterValue(filterId, selected ? curr.filter((v) => v !== tag) : [...curr, tag]);
    setDraft((p) => ({ ...p, filters: p.filters.map((f) => f.id === filterId ? { ...f, operator: 'in' } : f) }));
  };

  const handleDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) { setDragId(null); setDragOverId(null); return; }
    setColumns((prev) => {
      const arr = [...prev].sort((a, b) => a.order - b.order);
      const from = arr.findIndex((x) => x.id === dragId);
      const to = arr.findIndex((x) => x.id === targetId);
      if (from < 0 || to < 0) return prev;
      const [moved] = arr.splice(from, 1);
      arr.splice(to, 0, moved);
      return arr.map((item, idx) => ({ ...item, order: idx, updatedAt: Date.now() }));
    });
    setDragId(null);
    setDragOverId(null);
  };

  const filterLabel = (field: FilterField) => {
    const map: Record<FilterField, string> = {
      brand: 'Марка', model: 'Модель', status: 'Статус', tags: 'Теги',
      hasSupplier: 'Поставщик', country: 'Страна', createdAt: 'Дата',
      orderId: 'ID заказа', vin: 'VIN', partKeyword: 'Деталь', vendorArea: 'Зона/Район',
    };
    return map[field] ?? field;
  };

  return (
    <div className="fixed inset-0 overflow-y-auto bg-[#080f1a] text-white">
      <div className="mx-auto max-w-5xl px-4 pb-10 pt-5">

        {/* ─── Header ─── */}
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <p className="text-2xl font-black tracking-tight">Vendor Slides</p>
            <p className="text-xs text-white/50">Кастомные плитки · Smart Folders</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setHideDefaults((v) => !v)}
              title={hideDefaults ? 'Показать марки' : 'Скрыть марки'}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-600 bg-slate-800/60 px-3 py-2 text-xs font-semibold text-white/70 transition hover:border-slate-400 hover:text-white"
            >
              {hideDefaults ? <Eye size={13} /> : <EyeOff size={13} />}
              {hideDefaults ? 'Марки скрыты' : 'Скрыть марки'}
            </button>
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 rounded-xl border border-blue-500/70 bg-blue-600/25 px-4 py-2 text-sm font-bold text-blue-300 transition hover:bg-blue-600/40 hover:text-white"
            >
              <Plus size={15} /> Добавить плитку
            </button>
          </div>
        </div>

        {/* ─── Tiles grid ─── */}
        {allStats.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 rounded-3xl border border-dashed border-slate-700 bg-slate-900/20 px-6 py-14 text-center">
            <Layers size={40} className="text-slate-600" />
            <p className="text-base font-semibold text-slate-400">Пока нет ни одной плитки</p>
            <p className="max-w-xs text-sm text-slate-500">Создайте свои Smart Folders, чтобы моментально видеть нужные заказы.</p>
            <button type="button" onClick={openCreate} className="mt-1 inline-flex items-center gap-2 rounded-xl border border-blue-500/70 bg-blue-600/25 px-5 py-2.5 text-sm font-bold text-blue-300 transition hover:bg-blue-600/40 hover:text-white">
              <Plus size={15} /> Создать первую плитку
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {allStats.map((column) => {
              const isBeingDragged = dragId === column.id;
              const isDragTarget = dragOverId === column.id && !column.isDefault;
              return (
                <div
                  key={column.id}
                  draggable={!column.isDefault}
                  onDragStart={(e) => {
                    if (column.isDefault) return;
                    setDragId(column.id);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', column.id);
                  }}
                  onDragEnd={() => { setDragId(null); setDragOverId(null); }}
                  onDragOver={(e) => { e.preventDefault(); if (!column.isDefault) setDragOverId(column.id); }}
                  onDragLeave={() => { if (dragOverId === column.id) setDragOverId(null); }}
                  onDrop={() => { if (!column.isDefault) handleDrop(column.id); }}
                  onClick={() => setOpenedColumnId(column.id)}
                  className={[
                    'group relative cursor-pointer select-none rounded-2xl border bg-[#111827] px-4 pb-4 pt-3',
                    TILE_ANIM,
                    isBeingDragged ? 'scale-95 opacity-40' : 'opacity-100',
                    isDragTarget ? 'border-blue-500 ring-2 ring-blue-500/40' : 'border-slate-700/80 hover:border-slate-500',
                  ].join(' ')}
                  style={{ borderTopWidth: 3, borderTopColor: column.color || '#334155' }}
                >
                  {/* name */}
                  <p className="truncate text-sm font-bold leading-tight text-white/90">{column.name}</p>

                  {/* big counter */}
                  <p className="mt-2 text-5xl font-black leading-none tracking-tight" style={{ color: column.color || '#93c5fd' }}>
                    {column.ordersCount}
                  </p>
                  <p className="mt-1 text-[11px] text-white/40">заказов · {column.partsCount} дет.</p>

                  {/* controls (custom tiles only) */}
                  {!column.isDefault && (
                    <div
                      className="absolute right-2 top-2 flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <GripVertical size={12} className="cursor-grab text-white/30" />
                      <button type="button" onClick={() => moveColumn(column.id, -1)} className="rounded-md border border-slate-700 p-1 text-white/50 hover:text-white"><ChevronUp size={11} /></button>
                      <button type="button" onClick={() => moveColumn(column.id, 1)} className="rounded-md border border-slate-700 p-1 text-white/50 hover:text-white"><ChevronDown size={11} /></button>
                      <button type="button" onClick={() => openEdit(column)} className="rounded-md border border-slate-700 p-1 text-white/50 hover:text-white"><Pencil size={11} /></button>
                      <button
                        type="button"
                        onClick={() => setColumns((prev) => prev.filter((item) => item.id !== column.id).map((item, idx) => ({ ...item, order: idx })))}
                        className="rounded-md border border-rose-500/60 p-1 text-rose-400 hover:border-rose-400"
                      ><Trash2 size={11} /></button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── Column preview modal ─── */}
      {openedColumn && (
        <div className="fixed inset-0 z-20 flex items-start justify-center bg-black/75 p-4 pt-10" onClick={() => setOpenedColumnId(null)}>
          <div
            className="w-full max-w-2xl rounded-3xl border border-slate-700 bg-[#0f1929] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-5 py-4" style={{ borderTopWidth: 3, borderTopColor: openedColumn.color || '#334155', borderRadius: '1.5rem 1.5rem 0 0' }}>
              <div>
                <p className="text-lg font-black">{openedColumn.name}</p>
                <p className="text-xs text-white/50">
                  {openedOrders.length} заказов · {openedOrders.reduce((s, o) => s + o.parts.length, 0)} деталей
                </p>
              </div>
              <button type="button" onClick={() => setOpenedColumnId(null)} className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-700 text-white/60 hover:text-white transition">
                <X size={16} />
              </button>
            </div>

            <div className="p-4">
              {openedOrders.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 px-4 py-6 text-center text-sm text-white/50">
                  Нет заказов, подходящих под фильтры этой плитки.
                </p>
              ) : (
                <div className="max-h-[62vh] space-y-2 overflow-y-auto pr-1">
                  {openedOrders.map((order) => (
                    <button
                      key={order.id}
                      type="button"
                      onClick={() => navigate(`/vendor/slider?slide=${encodeURIComponent(order.id)}`)}
                      className={`w-full rounded-2xl border border-slate-700 bg-slate-900/50 p-3 text-left ${TILE_ANIM} hover:border-blue-500/60 hover:bg-slate-800/60`}
                    >
                      <p className="text-sm font-black">{order.brand} {order.model} · {order.year || '—'}</p>
                      <p className="mt-0.5 text-xs text-white/50">Деталей: {order.parts.length}</p>
                      {order.parts.length > 0 && (
                        <p className="mt-0.5 truncate text-[11px] text-white/30">{order.parts.map((p) => p.name).slice(0, 3).join(' · ')}</p>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── Editor modal ─── */}
      {editorOpen && (
        <div className="fixed inset-0 z-20 flex items-start justify-center bg-black/80 p-4 pt-8" onClick={() => setEditorOpen(false)}>
          <div className="w-full max-w-2xl rounded-3xl border border-slate-700 bg-[#0f1929] shadow-2xl" onClick={(e) => e.stopPropagation()}>

            {/* modal header */}
            <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-5 py-4">
              <p className="text-base font-black">{editingId ? 'Редактирование плитки' : 'Новая плитка'}</p>
              <button type="button" onClick={() => setEditorOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-700 text-white/60 hover:text-white transition"><X size={14} /></button>
            </div>

            <div className="max-h-[80vh] overflow-y-auto px-5 py-4">
              <div className="space-y-5">

                {/* name */}
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-white/60">НАЗВАНИЕ</label>
                  <input
                    value={draft.name}
                    onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value.slice(0, 50) }))}
                    placeholder="Например: Моторы Area 6"
                    className="w-full rounded-xl border border-slate-700 bg-slate-800/80 px-3 py-2.5 text-sm text-white placeholder-white/25 outline-none focus:border-blue-500"
                  />
                </div>

                {/* color picker */}
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-white/60">ЦВЕТ ПЛИТКИ</label>
                  <div className="flex flex-wrap gap-2.5">
                    {COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setDraft((p) => ({ ...p, color }))}
                        className={`h-8 w-8 rounded-full border-2 ${TILE_ANIM} ${draft.color === color ? 'scale-110 border-white shadow-lg' : 'border-transparent opacity-70 hover:opacity-100'}`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>

                {/* filters */}
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-white/60">ФИЛЬТРЫ</label>
                  <div className="space-y-2">
                    {draft.filters.map((filter) => (
                      <div key={filter.id} className="rounded-xl border border-slate-700/80 bg-slate-900/50 p-3">
                        <div className="flex items-center gap-2">
                          <select
                            value={filter.field}
                            onChange={(e) => updateFilterField(filter.id, e.target.value as FilterField)}
                            className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-2 py-2 text-xs text-white outline-none focus:border-blue-500"
                          >
                            <option value="brand">Марка автомобиля</option>
                            <option value="model">Модель автомобиля</option>
                            <option value="status">Статус заказа</option>
                            <option value="tags">Теги (Срочно / VIP / Лид)</option>
                            <option value="partKeyword">Ключевое слово в детали</option>
                            <option value="vendorArea">Зона / Район поставщика</option>
                            <option value="hasSupplier">Наличие поставщика</option>
                            <option value="country">Страна клиента</option>
                            <option value="createdAt">Дата создания</option>
                            <option value="orderId">ID заказа</option>
                            <option value="vin">VIN</option>
                          </select>

                          {filter.field !== 'tags' && filter.field !== 'createdAt' && filter.field !== 'hasSupplier' && (
                            <select
                              value={filter.operator}
                              onChange={(e) => updateFilterOperator(filter.id, e.target.value as FilterOperator)}
                              className="w-28 rounded-lg border border-slate-700 bg-slate-800 px-2 py-2 text-xs text-white outline-none focus:border-blue-500"
                            >
                              <option value="equals">равно</option>
                              {supportsContains(filter.field) && <option value="contains">содержит</option>}
                              {(filter.field === 'orderId' || filter.field === 'vin') && <option value="not_equals">не равно</option>}
                            </select>
                          )}

                          <button
                            type="button"
                            onClick={() => removeFilter(filter.id)}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-rose-500/50 text-rose-400 hover:border-rose-400 hover:text-rose-300 transition"
                          ><X size={13} /></button>
                        </div>

                        {/* value input */}
                        <div className="mt-2">
                          {filter.field === 'createdAt' ? (
                            <div className="grid grid-cols-2 gap-2">
                              <input type="date" value={typeof filter.value === 'object' && filter.value ? (filter.value as { from?: string }).from || '' : ''} onChange={(e) => updateFilterValue(filter.id, { ...(typeof filter.value === 'object' && filter.value ? filter.value : {}), from: e.target.value })} className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-2 text-xs text-white outline-none focus:border-blue-500" />
                              <input type="date" value={typeof filter.value === 'object' && filter.value ? (filter.value as { to?: string }).to || '' : ''} onChange={(e) => updateFilterValue(filter.id, { ...(typeof filter.value === 'object' && filter.value ? filter.value : {}), to: e.target.value })} className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-2 text-xs text-white outline-none focus:border-blue-500" />
                            </div>
                          ) : filter.field === 'status' ? (
                            <select value={String(filter.value || '')} onChange={(e) => updateFilterValue(filter.id, e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-2 text-xs text-white outline-none focus:border-blue-500">
                              <option value="">— выберите статус —</option>
                              {ORDER_STATUS_OPTIONS.map((x) => <option key={x} value={x}>{x}</option>)}
                            </select>
                          ) : filter.field === 'hasSupplier' ? (
                            <select value={String(filter.value || 'yes')} onChange={(e) => updateFilterValue(filter.id, e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-2 text-xs text-white outline-none focus:border-blue-500">
                              <option value="yes">Есть поставщик</option>
                              <option value="no">Нет поставщика</option>
                            </select>
                          ) : filter.field === 'tags' ? (
                            <div className="flex flex-wrap gap-1.5">
                              {TAG_OPTIONS.map((tag) => {
                                const selected = Array.isArray(filter.value) && filter.value.includes(tag);
                                return (
                                  <button key={tag} type="button" onClick={() => toggleTag(filter.id, tag, filter.value)} className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${TILE_ANIM} ${selected ? 'border-blue-500 bg-blue-600/30 text-blue-300' : 'border-slate-600 text-white/60 hover:border-slate-400'}`}>{tag}</button>
                                );
                              })}
                            </div>
                          ) : filter.field === 'brand' ? (
                            <select value={String(filter.value || '')} onChange={(e) => updateFilterValue(filter.id, e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-2 text-xs text-white outline-none focus:border-blue-500">
                              <option value="">— выберите марку —</option>
                              {brands.map((x) => <option key={x} value={x}>{x}</option>)}
                            </select>
                          ) : filter.field === 'model' ? (
                            <select value={String(filter.value || '')} onChange={(e) => updateFilterValue(filter.id, e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-2 text-xs text-white outline-none focus:border-blue-500">
                              <option value="">— выберите модель —</option>
                              {models.map((x) => <option key={x} value={x}>{x}</option>)}
                            </select>
                          ) : filter.field === 'country' ? (
                            <select value={String(filter.value || '')} onChange={(e) => updateFilterValue(filter.id, e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-2 text-xs text-white outline-none focus:border-blue-500">
                              <option value="">— выберите страну —</option>
                              {countries.map((x) => <option key={x} value={x}>{x}</option>)}
                            </select>
                          ) : filter.field === 'vendorArea' ? (
                            vendorAreas.length > 0 ? (
                              <select value={String(filter.value || '')} onChange={(e) => updateFilterValue(filter.id, e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-2 text-xs text-white outline-none focus:border-blue-500">
                                <option value="">— выберите район —</option>
                                {vendorAreas.map((x) => <option key={x} value={x}>{x}</option>)}
                              </select>
                            ) : (
                              <input value={String(filter.value || '')} onChange={(e) => updateFilterValue(filter.id, e.target.value)} placeholder="Район / локация (напр. Al Quoz)" className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-2 text-xs text-white placeholder-white/25 outline-none focus:border-blue-500" />
                            )
                          ) : (
                            <input value={String(filter.value || '')} onChange={(e) => updateFilterValue(filter.id, e.target.value)} placeholder={filter.field === 'partKeyword' ? 'Ключевое слово в названии детали' : 'Значение'} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-2 text-xs text-white placeholder-white/25 outline-none focus:border-blue-500" />
                          )}
                        </div>

                        {/* inline label */}
                        <p className="mt-1.5 text-[10px] text-white/30">{filterLabel(filter.field)}</p>
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={() => setDraft((p) => ({ ...p, filters: [...p.filters, emptyFilter()] }))} className={`mt-2 w-full rounded-xl border border-dashed border-slate-600 py-2 text-xs text-white/50 ${TILE_ANIM} hover:border-slate-400 hover:text-white`}>
                    + Добавить условие
                  </button>
                </div>
              </div>
            </div>

            {/* modal footer */}
            <div className="flex items-center justify-end gap-2 border-t border-slate-800 px-5 py-4">
              <button type="button" onClick={() => setEditorOpen(false)} className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-semibold text-white/70 hover:text-white transition">Отмена</button>
              <button
                type="button"
                onClick={saveColumn}
                disabled={!draft.name.trim() || draft.filters.length === 0}
                className="rounded-xl border border-blue-500/70 bg-blue-600/30 px-5 py-2 text-sm font-bold text-blue-300 transition hover:bg-blue-600/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >Сохранить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VendorSlidesScreen;
