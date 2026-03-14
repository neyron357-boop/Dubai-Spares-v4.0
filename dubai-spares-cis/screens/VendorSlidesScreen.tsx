import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Pencil, GripVertical } from 'lucide-react';
import { useStore } from '../store';
import { ensureUuid } from '../id';
import { Priority } from '../types';

type FilterField = 'brand' | 'model' | 'status' | 'tags' | 'hasSupplier' | 'country' | 'createdAt' | 'orderId' | 'vin';
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

const STORAGE_KEY = 'vendor_slides_custom_columns_v1';
const ORDER_STATUS_OPTIONS = ['Лиды', 'В работе', 'Ожидание клиента', 'Оплачено', 'Найден/Выкуплен', 'Отправлен/Завершён', 'Архив/Отказ'] as const;
const TAG_OPTIONS = ['Срочно', 'VIP', 'Лид'] as const;
const COLORS = ['#334155', '#1d4ed8', '#0f766e', '#7c3aed', '#be123c', '#c2410c'];

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

const VendorSlidesScreen: React.FC = () => {
  const { orders } = useStore();
  const [columns, setColumns] = useState<CustomColumn[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; color: string; filters: CustomColumnFilter[] }>({
    name: '', color: COLORS[0], filters: [emptyFilter()]
  });
  const [dragId, setDragId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) as CustomColumn[] : [];
      if (Array.isArray(parsed)) setColumns(parsed.sort((a, b) => a.order - b.order));
    } catch {
      setColumns([]);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(columns));
  }, [columns]);

  const brands = useMemo(() => Array.from(new Set(orders.map((o) => o.brand))).sort((a, b) => a.localeCompare(b)), [orders]);
  const models = useMemo(() => Array.from(new Set(orders.map((o) => o.model))).sort((a, b) => a.localeCompare(b)), [orders]);
  const countries = useMemo(() => Array.from(new Set(orders.map((o) => o.logistics?.cargoCountry || '').filter(Boolean))).sort((a, b) => a.localeCompare(b)), [orders]);

  const applyFilter = (order: typeof orders[number], filter: CustomColumnFilter) => {
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
    return true;
  };

  const stats = useMemo(() => columns.map((column) => {
    const matches = orders.filter((order) => column.filters.every((filter) => applyFilter(order, filter)));
    return { ...column, ordersCount: matches.length, partsCount: matches.reduce((sum, o) => sum + o.parts.length, 0) };
  }), [columns, orders]);

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

  return (
    <div className="fixed inset-0 overflow-y-auto bg-[#0B1220] text-white">
      <div className="mx-auto max-w-4xl px-4 py-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xl font-black">Vendor Slides</p>
            <p className="text-xs text-white/60">Кастомизируемые статусные колонки</p>
          </div>
          <button type="button" onClick={openCreate} className="inline-flex items-center gap-1 rounded-xl border border-blue-500/60 bg-blue-700/30 px-3 py-2 text-xs font-bold">
            <Plus size={14} /> Создать колонку
          </button>
        </div>

        {stats.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/30 px-4 py-6 text-center">
            <p className="text-sm text-slate-300">У вас пока нет созданных колонок. Создайте первую, чтобы отслеживать нужные заказы.</p>
            <button type="button" onClick={openCreate} className="mt-3 rounded-xl border border-blue-500/60 bg-blue-700/30 px-3 py-2 text-xs font-bold">Создать колонку</button>
          </div>
        ) : (
          <div className="space-y-2">
            {stats.map((column) => (
              <div
                key={column.id}
                draggable
                onDragStart={() => setDragId(column.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (!dragId || dragId === column.id) return;
                  setColumns((prev) => {
                    const arr = [...prev].sort((a, b) => a.order - b.order);
                    const from = arr.findIndex((x) => x.id === dragId);
                    const to = arr.findIndex((x) => x.id === column.id);
                    if (from < 0 || to < 0) return prev;
                    const [moved] = arr.splice(from, 1);
                    arr.splice(to, 0, moved);
                    return arr.map((item, idx) => ({ ...item, order: idx, updatedAt: Date.now() }));
                  });
                }}
                className="rounded-2xl border border-slate-700 bg-slate-900/60 px-4 py-3"
                style={{ borderLeftWidth: 4, borderLeftColor: column.color || '#334155' }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-black">{column.name}</p>
                    <p className="mt-1 text-3xl font-black leading-none">{column.ordersCount}</p>
                    <p className="text-xs text-white/70">заказов · {column.partsCount} деталей</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <GripVertical size={14} className="text-white/40" />
                    <button type="button" onClick={() => openEdit(column)} className="rounded-lg border border-slate-600 p-1.5"><Pencil size={13} /></button>
                    <button
                      type="button"
                      onClick={() => setColumns((prev) => prev.filter((item) => item.id !== column.id).map((item, idx) => ({ ...item, order: idx })))}
                      className="rounded-lg border border-rose-500/70 p-1.5 text-rose-200"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editorOpen && (
        <div className="fixed inset-0 z-20 bg-black/70 p-4" onClick={() => setEditorOpen(false)}>
          <div className="mx-auto mt-6 max-w-3xl rounded-3xl border border-slate-700 bg-[#111a2d] p-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-base font-black">{editingId ? 'Редактирование колонки' : 'Новая колонка'}</p>
            <div className="mt-3 space-y-3">
              <input value={draft.name} onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value.slice(0, 50) }))} placeholder="Название" className="w-full rounded-xl bg-slate-800 px-3 py-2 text-sm" />
              <div className="flex flex-wrap gap-2">
                {COLORS.map((color) => <button key={color} type="button" onClick={() => setDraft((p) => ({ ...p, color }))} className={`h-7 w-7 rounded-full border-2 ${draft.color === color ? 'border-white' : 'border-transparent'}`} style={{ backgroundColor: color }} />)}
              </div>

              {draft.filters.map((filter) => (
                <div key={filter.id} className="grid grid-cols-1 gap-2 rounded-xl border border-slate-700 bg-slate-900/40 p-2 md:grid-cols-12">
                  <select value={filter.field} onChange={(e) => setDraft((p) => ({ ...p, filters: p.filters.map((f) => f.id === filter.id ? { ...f, field: e.target.value as FilterField, operator: e.target.value === 'createdAt' ? 'between' : 'equals', value: e.target.value === 'tags' ? [] : '' } : f) }))} className="rounded-lg bg-slate-800 px-2 py-2 text-xs md:col-span-3">
                    <option value="brand">Марка автомобиля</option><option value="model">Модель автомобиля</option><option value="status">Статус заказа</option><option value="tags">Теги</option><option value="hasSupplier">Наличие поставщика</option><option value="country">Страна клиента</option><option value="createdAt">Дата создания</option><option value="orderId">Идентификатор заказа</option><option value="vin">VIN</option>
                  </select>
                  <select value={filter.operator} onChange={(e) => setDraft((p) => ({ ...p, filters: p.filters.map((f) => f.id === filter.id ? { ...f, operator: e.target.value as FilterOperator } : f) }))} className="rounded-lg bg-slate-800 px-2 py-2 text-xs md:col-span-2">
                    {filter.field === 'createdAt' ? <option value="between">между</option> : null}
                    {filter.field !== 'createdAt' ? <option value="equals">равно</option> : null}
                    {(filter.field === 'brand' || filter.field === 'model' || filter.field === 'orderId' || filter.field === 'vin' || filter.field === 'country') ? <option value="contains">содержит</option> : null}
                    {(filter.field === 'orderId' || filter.field === 'vin') ? <option value="not_equals">не равно</option> : null}
                  </select>
                  <div className="md:col-span-6">
                    {filter.field === 'createdAt' ? (
                      <div className="grid grid-cols-2 gap-2">
                        <input type="date" value={typeof filter.value === 'object' && filter.value ? filter.value.from || '' : ''} onChange={(e) => setDraft((p) => ({ ...p, filters: p.filters.map((f) => f.id === filter.id ? { ...f, value: { ...(typeof f.value === 'object' && f.value ? f.value : {}), from: e.target.value } } : f) }))} className="rounded-lg bg-slate-800 px-2 py-2 text-xs" />
                        <input type="date" value={typeof filter.value === 'object' && filter.value ? filter.value.to || '' : ''} onChange={(e) => setDraft((p) => ({ ...p, filters: p.filters.map((f) => f.id === filter.id ? { ...f, value: { ...(typeof f.value === 'object' && f.value ? f.value : {}), to: e.target.value } } : f) }))} className="rounded-lg bg-slate-800 px-2 py-2 text-xs" />
                      </div>
                    ) : filter.field === 'status' ? (
                      <select value={String(filter.value || '')} onChange={(e) => setDraft((p) => ({ ...p, filters: p.filters.map((f) => f.id === filter.id ? { ...f, value: e.target.value } : f) }))} className="w-full rounded-lg bg-slate-800 px-2 py-2 text-xs">
                        <option value="">Выберите</option>{ORDER_STATUS_OPTIONS.map((x) => <option key={x} value={x}>{x}</option>)}
                      </select>
                    ) : filter.field === 'hasSupplier' ? (
                      <select value={String(filter.value || 'yes')} onChange={(e) => setDraft((p) => ({ ...p, filters: p.filters.map((f) => f.id === filter.id ? { ...f, value: e.target.value } : f) }))} className="w-full rounded-lg bg-slate-800 px-2 py-2 text-xs"><option value="yes">Да</option><option value="no">Нет</option></select>
                    ) : filter.field === 'tags' ? (
                      <div className="flex flex-wrap gap-1">{TAG_OPTIONS.map((tag) => { const selected = Array.isArray(filter.value) && filter.value.includes(tag); return <button key={tag} type="button" onClick={() => setDraft((p) => ({ ...p, filters: p.filters.map((f) => { if (f.id !== filter.id) return f; const curr = Array.isArray(f.value) ? f.value : []; return { ...f, operator: 'in', value: selected ? curr.filter((v) => v !== tag) : [...curr, tag] }; }) }))} className={`rounded-lg border px-2 py-1 text-[10px] ${selected ? 'border-blue-500 bg-blue-700/30' : 'border-slate-600'}`}>{tag}</button>; })}</div>
                    ) : (
                      filter.field === 'brand' ? <select value={String(filter.value || '')} onChange={(e) => setDraft((p) => ({ ...p, filters: p.filters.map((f) => f.id === filter.id ? { ...f, value: e.target.value } : f) }))} className="w-full rounded-lg bg-slate-800 px-2 py-2 text-xs"><option value="">Выберите</option>{brands.map((x) => <option key={x} value={x}>{x}</option>)}</select>
                      : filter.field === 'model' ? <select value={String(filter.value || '')} onChange={(e) => setDraft((p) => ({ ...p, filters: p.filters.map((f) => f.id === filter.id ? { ...f, value: e.target.value } : f) }))} className="w-full rounded-lg bg-slate-800 px-2 py-2 text-xs"><option value="">Выберите</option>{models.map((x) => <option key={x} value={x}>{x}</option>)}</select>
                      : filter.field === 'country' ? <select value={String(filter.value || '')} onChange={(e) => setDraft((p) => ({ ...p, filters: p.filters.map((f) => f.id === filter.id ? { ...f, value: e.target.value } : f) }))} className="w-full rounded-lg bg-slate-800 px-2 py-2 text-xs"><option value="">Выберите</option>{countries.map((x) => <option key={x} value={x}>{x}</option>)}</select>
                      : <input value={String(filter.value || '')} onChange={(e) => setDraft((p) => ({ ...p, filters: p.filters.map((f) => f.id === filter.id ? { ...f, value: e.target.value } : f) }))} className="w-full rounded-lg bg-slate-800 px-2 py-2 text-xs" placeholder="Значение" />
                    )}
                  </div>
                  <button type="button" onClick={() => setDraft((p) => ({ ...p, filters: p.filters.filter((f) => f.id !== filter.id) }))} className="rounded-lg border border-rose-500/70 px-2 py-2 text-xs text-rose-200 md:col-span-1">✕</button>
                </div>
              ))}

              <button type="button" onClick={() => setDraft((p) => ({ ...p, filters: [...p.filters, emptyFilter()] }))} className="rounded-xl border border-slate-600 px-3 py-2 text-xs font-bold">+ Добавить фильтр</button>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setEditorOpen(false)} className="rounded-xl border border-slate-600 px-3 py-2 text-xs font-bold">Отмена</button>
                <button type="button" onClick={saveColumn} className="rounded-xl border border-blue-500/70 bg-blue-700/30 px-3 py-2 text-xs font-bold">Сохранить</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VendorSlidesScreen;
