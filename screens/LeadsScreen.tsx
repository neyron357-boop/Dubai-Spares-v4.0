import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, ArrowRight, CheckCircle2, CheckSquare, Clock3, MessageCircle, RefreshCw, Search, Sparkles, Square, Trash2, UserRound } from 'lucide-react';
import { useStore } from '../store';
import { Order } from '../types';
import { toast } from '../feedback';
import { useLeadsPolling } from '../hooks/useLeadsPolling';
import { buildLeadToOrderUpdate, isLeadOrder, isUnreadLeadOrder } from '../utils/orderClassification';
import ConfirmModal from '../components/ConfirmModal';

type LeadFilter = 'all' | 'unread' | 'public' | 'manual';
type LeadSort = 'newest' | 'oldest' | 'stale';

const formatLeadAge = (timestamp: number) => {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return 'только что';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} мин`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} ч`;
  return `${Math.floor(diff / 86_400_000)} д`;
};

const getLeadTitle = (order: Order) => {
  const vehicle = [order.brand, order.model, order.year].filter(Boolean).join(' ').trim();
  if (vehicle && vehicle !== 'Без марки Интерес клиента') return vehicle;
  return order.clientName?.trim() || order.customerContact?.trim() || 'Новый интерес клиента';
};

const getLeadInterest = (order: Order) => {
  const partText = (order.parts || [])
    .map((part) => [part.name, part.comment].filter(Boolean).join(' - '))
    .filter(Boolean)
    .join(', ');
  const noteText = (order.notes || []).map((note) => note.text || '').filter(Boolean).join(' ');
  return partText || noteText || 'Интерес пока без деталей';
};

const getContactAction = (order: Order) => {
  const source = String(order.source || '').toLowerCase();
  const social = String(order.socialNickname || '').trim();
  const contact = String(order.customerContact || '').trim();

  if (source.includes('instagram') && social) {
    const url = social.startsWith('http') ? social : `https://instagram.com/${social.replace(/^@/, '')}`;
    return { label: 'Instagram', url };
  }
  if (source.includes('tiktok') && social) {
    const url = social.startsWith('http') ? social : `https://www.tiktok.com/@${social.replace(/^@/, '')}`;
    return { label: 'TikTok', url };
  }
  if (source.includes('telegram') && (social || contact)) {
    const value = social || contact;
    const url = value.startsWith('http')
      ? value
      : value.startsWith('+')
        ? `https://t.me/${value.replace(/[^\d]/g, '')}`
        : `https://t.me/${value.replace(/^@/, '')}`;
    return { label: 'Telegram', url };
  }
  if (source.includes('facebook') && social) {
    return { label: 'Facebook', url: social.startsWith('http') ? social : '' };
  }
  if (contact) {
    const phone = contact.replace(/[^\d+]/g, '');
    if (phone) return { label: 'WhatsApp', url: `https://wa.me/${phone.replace(/^\+/, '')}` };
  }
  return { label: 'Контакт', url: '' };
};

const LeadsScreen: React.FC = () => {
  const { orders, isLoading, syncOrders, updateOrder, bulkDeleteOrders } = useStore();
  const navigate = useNavigate();

  useLeadsPolling(true);

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [filter, setFilter] = useState<LeadFilter>('all');
  const [sortBy, setSortBy] = useState<LeadSort>('newest');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), 240);
    return () => window.clearTimeout(timer);
  }, [query]);

  const leads = useMemo(
    () => orders.filter((order) => !order.isArchived && !order.isSold && isLeadOrder(order)),
    [orders]
  );

  const stats = useMemo(() => {
    const unread = leads.filter(isUnreadLeadOrder).length;
    const publicCount = leads.filter((order) => order.leadSource === 'public_form').length;
    const noContact = leads.filter((order) => !order.customerContact?.trim() && !order.socialNickname?.trim()).length;
    return { unread, publicCount, noContact };
  }, [leads]);

  const filteredLeads = useMemo(() => {
    let list = leads;
    if (filter === 'unread') list = list.filter(isUnreadLeadOrder);
    if (filter === 'public') list = list.filter((order) => order.leadSource === 'public_form');
    if (filter === 'manual') list = list.filter((order) => order.leadSource !== 'public_form');

    if (debouncedQuery) {
      list = list.filter((order) => {
        const haystack = [
          order.brand,
          order.model,
          order.year,
          order.vin,
          order.clientName,
          order.customerContact,
          order.socialNickname,
          order.source,
          getLeadInterest(order)
        ].join(' ').toLowerCase();
        return haystack.includes(debouncedQuery);
      });
    }

    return [...list].sort((a, b) => {
      const unreadDiff = Number(isUnreadLeadOrder(b)) - Number(isUnreadLeadOrder(a));
      if (unreadDiff !== 0) return unreadDiff;
      if (sortBy === 'oldest' || sortBy === 'stale') return (a.updatedAt || a.createdAt) - (b.updatedAt || b.createdAt);
      return (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt);
    });
  }, [leads, filter, debouncedQuery, sortBy]);

  useEffect(() => {
    setSelectedLeadIds((current) => current.filter((id) => filteredLeads.some((lead) => lead.id === id)));
  }, [filteredLeads]);

  const refreshLeads = async () => {
    setIsRefreshing(true);
    try {
      await syncOrders();
    } finally {
      setIsRefreshing(false);
    }
  };

  const markSeen = (order: Order) => {
    if (!isUnreadLeadOrder(order)) return;
    void updateOrder({ ...order, leadUnread: false, leadReadAt: Date.now() });
  };

  const openLead = (order: Order) => {
    markSeen(order);
    navigate(`/order/${order.id}`);
  };

  const convertToOrder = async (order: Order) => {
    const ok = await updateOrder(buildLeadToOrderUpdate(order));
    if (ok) toast('Лид переведен в заказы', 'success');
  };

  const archiveLead = async (order: Order) => {
    const ok = await updateOrder({ ...order, isArchived: true, leadUnread: false, leadReadAt: Date.now() });
    if (ok) toast('Лид отправлен в архив', 'success');
  };

  const toggleSelectionMode = () => {
    setIsSelectionMode((current) => !current);
    setSelectedLeadIds([]);
  };

  const toggleLeadSelected = (leadId: string) => {
    setSelectedLeadIds((current) => current.includes(leadId) ? current.filter((id) => id !== leadId) : [...current, leadId]);
  };

  const selectAllVisibleLeads = () => {
    setSelectedLeadIds(filteredLeads.map((lead) => lead.id));
  };

  const deleteSelectedLeads = async () => {
    if (selectedLeadIds.length === 0) return;
    setIsBulkDeleting(true);
    const result = await bulkDeleteOrders(selectedLeadIds);
    setIsBulkDeleting(false);
    setDeleteConfirmOpen(false);
    setSelectedLeadIds([]);
    setIsSelectionMode(false);
    toast(result.failed > 0 ? `Удалено: ${result.deleted}, ошибок: ${result.failed}` : `Удалено лидов: ${result.deleted}`, result.deleted > 0 ? 'success' : 'error');
  };

  const openContact = (order: Order) => {
    const action = getContactAction(order);
    if (!action.url) {
      toast('Контакт не указан', 'error');
      return;
    }
    window.open(action.url, '_blank');
  };

  const showSkeleton = isLoading && orders.length === 0;

  return (
    <div className="min-h-full overflow-x-hidden bg-[#F7F8FC] px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-4">
      <header className="sticky top-0 z-20 -mx-4 space-y-3 bg-[#F7F8FC]/95 px-4 pb-3 pt-1 backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-blue-600">Pipeline</p>
            <h1 className="text-[30px] font-black leading-[34px] tracking-tight text-slate-950">Лиды</h1>
            <p className="mt-0.5 text-xs text-slate-500">Интересы клиентов до смены статуса</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleSelectionMode}
              className={`h-11 rounded-xl border px-3 text-xs font-black ${isSelectionMode ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-700'}`}
            >
              {isSelectionMode ? 'Готово' : 'Выбрать'}
            </button>
            <button
              type="button"
              onClick={() => navigate('/new?type=lead')}
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-blue-600 px-3 text-xs font-black text-white shadow-sm"
            >
              <Sparkles size={15} /> Новый
            </button>
            <button
              type="button"
              onClick={() => void refreshLeads()}
              disabled={isRefreshing}
              className="grid h-11 w-11 place-items-center rounded-xl border border-slate-200 bg-white text-slate-700 disabled:opacity-50"
              aria-label="Обновить лиды"
            >
              <RefreshCw size={17} className={isRefreshing ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-2xl border border-blue-100 bg-white px-3 py-2">
            <p className="text-[10px] font-black uppercase text-slate-400">Всего</p>
            <p className="text-xl font-black text-slate-950">{leads.length}</p>
          </div>
          <div className="rounded-2xl border border-amber-100 bg-amber-50 px-3 py-2">
            <p className="text-[10px] font-black uppercase text-amber-600">Новые</p>
            <p className="text-xl font-black text-amber-800">{stats.unread}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
            <p className="text-[10px] font-black uppercase text-slate-400">Без контакта</p>
            <p className="text-xl font-black text-slate-950">{stats.noContact}</p>
          </div>
        </div>

        <label className="flex h-11 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3">
          <Search size={14} className="text-slate-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Клиент, авто, контакт, деталь"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
          {query && <button type="button" onClick={() => { setQuery(''); setDebouncedQuery(''); }} className="text-xs font-bold text-slate-500">Очистить</button>}
        </label>

        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {([
            ['all', `Все ${leads.length}`],
            ['unread', `Новые ${stats.unread}`],
            ['public', `С формы ${stats.publicCount}`],
            ['manual', 'Ручные']
          ] as [LeadFilter, string][]).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={`shrink-0 rounded-2xl border px-3 py-2 text-[11px] font-black ${
                filter === id ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-600'
              }`}
            >
              {label}
            </button>
          ))}
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as LeadSort)}
            className="shrink-0 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-black text-slate-600 outline-none"
          >
            <option value="newest">Новые сверху</option>
            <option value="oldest">Старые сверху</option>
            <option value="stale">Давно без движения</option>
          </select>
        </div>

        {isSelectionMode && (
          <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            <button type="button" onClick={selectAllVisibleLeads} className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-black text-slate-700">
              Выбрать все ({filteredLeads.length})
            </button>
            <button type="button" onClick={() => setSelectedLeadIds([])} className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-black text-slate-700">
              Снять выбор
            </button>
            <span className="shrink-0 rounded-xl bg-blue-50 px-3 py-2 text-[11px] font-black text-blue-700">Выбрано: {selectedLeadIds.length}</span>
          </div>
        )}
      </header>

      <div className="space-y-3">
        {showSkeleton ? (
          Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="animate-pulse rounded-2xl border border-slate-200 bg-white p-4">
              <div className="h-5 w-40 rounded bg-slate-200" />
              <div className="mt-2 h-4 w-56 rounded bg-slate-100" />
              <div className="mt-4 h-10 rounded bg-slate-100" />
            </div>
          ))
        ) : filteredLeads.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-12 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-blue-50 text-blue-600">
              <UserRound size={22} />
            </div>
            <p className="mt-3 text-base font-black text-slate-900">Лидов пока нет</p>
            <p className="mx-auto mt-1 max-w-xs text-xs text-slate-500">Новый интерес клиента попадет сюда и останется здесь, пока вы не переведете его в заказ.</p>
            <button type="button" onClick={() => navigate('/new?type=lead')} className="mt-4 rounded-xl bg-blue-600 px-4 py-2 text-xs font-black uppercase text-white">
              Создать лид
            </button>
          </div>
        ) : (
          filteredLeads.map((lead) => {
            const unread = isUnreadLeadOrder(lead);
            const contact = getContactAction(lead);
            const age = formatLeadAge(lead.updatedAt || lead.createdAt);
            return (
              <article
                key={lead.id}
                className={`rounded-2xl border bg-white p-4 shadow-sm ${unread ? 'border-amber-300 ring-2 ring-amber-100' : 'border-slate-200'}`}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (isSelectionMode) {
                      toggleLeadSelected(lead.id);
                      return;
                    }
                    openLead(lead);
                  }}
                  className="w-full text-left"
                >
                  <div className="flex items-start justify-between gap-3">
                    {isSelectionMode && (
                      <span className={`mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${selectedLeadIds.includes(lead.id) ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-500'}`}>
                        {selectedLeadIds.includes(lead.id) ? <CheckSquare size={14} /> : <Square size={14} />}
                      </span>
                    )}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {unread && <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-black text-amber-800">Новый</span>}
                        <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-black text-blue-700">Лид</span>
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-600"><Clock3 size={10} /> {age}</span>
                      </div>
                      <h2 className="mt-2 text-base font-black leading-tight text-slate-950">{getLeadTitle(lead)}</h2>
                      <p className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-slate-600">{getLeadInterest(lead)}</p>
                    </div>
                    <ArrowRight size={18} className="mt-1 shrink-0 text-slate-400" />
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-left">
                    <div className="rounded-xl bg-slate-50 px-3 py-2">
                      <p className="text-[10px] font-black uppercase text-slate-400">Клиент</p>
                      <p className="truncate text-xs font-bold text-slate-800">{lead.clientName || lead.customerContact || lead.socialNickname || 'Не указан'}</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-3 py-2">
                      <p className="text-[10px] font-black uppercase text-slate-400">Источник</p>
                      <p className="truncate text-xs font-bold text-slate-800">{lead.leadSource === 'public_form' ? 'Публичная форма' : lead.source || 'Ручной'}</p>
                    </div>
                  </div>
                </button>

                <div className="mt-3 grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => openContact(lead)}
                    className="inline-flex h-10 items-center justify-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-2 text-[11px] font-black text-emerald-700"
                  >
                    <MessageCircle size={14} /> {contact.label}
                  </button>
                  <button
                    type="button"
                    onClick={() => void convertToOrder(lead)}
                    className="inline-flex h-10 items-center justify-center gap-1 rounded-xl bg-blue-600 px-2 text-[11px] font-black text-white"
                  >
                    <CheckCircle2 size={14} /> В заказ
                  </button>
                  <button
                    type="button"
                    onClick={() => isSelectionMode ? toggleLeadSelected(lead.id) : void archiveLead(lead)}
                    className="inline-flex h-10 items-center justify-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-2 text-[11px] font-black text-slate-700"
                  >
                    <Archive size={14} /> Архив
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>
      {isSelectionMode && (
        <div className="fixed inset-x-3 bottom-[max(70px,calc(env(safe-area-inset-bottom)+58px))] z-40 rounded-2xl border border-slate-200 bg-white/95 p-2 shadow-lg backdrop-blur">
          <button
            type="button"
            disabled={selectedLeadIds.length === 0 || isBulkDeleting}
            onClick={() => setDeleteConfirmOpen(true)}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-rose-600 text-xs font-black text-white disabled:opacity-50"
          >
            <Trash2 size={14} /> Удалить выбранные ({selectedLeadIds.length})
          </button>
        </div>
      )}
      <ConfirmModal
        isOpen={deleteConfirmOpen}
        message={isBulkDeleting ? 'Удаляем выбранные лиды…' : `Удалить выбранные лиды (${selectedLeadIds.length})?`}
        onConfirm={deleteSelectedLeads}
        onCancel={() => {
          if (!isBulkDeleting) setDeleteConfirmOpen(false);
        }}
      />
    </div>
  );
};

export default LeadsScreen;
