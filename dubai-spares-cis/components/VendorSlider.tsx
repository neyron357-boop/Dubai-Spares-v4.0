import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckSquare, ChevronDown, Clock, ExternalLink, Filter, ImageOff, MapPin, MessageCircle, Phone, Plus, Search, Users, X, Zap } from 'lucide-react';
import { useStore } from '../store';
import { Priority, type OrderVendorContact, type Part, type Supplier, type VendorChecklistItem } from '../types';
import { vibrate } from '../feedback';
import ImagePreview from './ImagePreview';
import SafeImage from './SafeImage';
import { SupplierSlidesErrorBoundary } from './SupplierSlidesErrorBoundary';
import { ensureUuid } from '../id';
import { getShopOrderMatchScore, isBrandMatch } from '../shopMatching';
import { useAppSettings } from '../appSettings';

const priorityWeight = {
  [Priority.HIGH]: 3,
  [Priority.MEDIUM]: 2,
  [Priority.LOW]: 1
};

const LEAD_SLIDES_KEY = '__lead';
const FOUND_SLIDES_KEY = '__found_with_prices';
const NOT_FOUND_SLIDES_KEY = '__without_prices';
const SUPPLIER_SEARCH_KEY = '__supplier_search';
const SUPPLIER_READY_KEY = '__supplier_ready';
const URGENT_KEY = '__urgent';
const NEED_SEND_KEY = '__need_send';
const RECENT_CARS_KEY = 'vs_recent';
const MAX_RECENT_CARS = 10;
const MAX_SEARCH_RESULTS = 10;

const sanitizeImages = (values: Array<unknown>) => {
  const seen = new Set<string>();
  return values
    .map((value) => (typeof value === 'string' ? value : '').trim())
    .filter((value) => value && value !== 'null' && value !== 'undefined')
    .filter((value) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
};

const phoneDigits = (value?: string) => (value || '').replace(/\D/g, '');
const contactIdentityKey = (contact: Pick<OrderVendorContact, 'name' | 'phone' | 'whatsapp'>) => {
  const normalizedName = contact.name.trim().toLowerCase();
  const normalizedPhone = phoneDigits(contact.phone || contact.whatsapp || '');
  return [normalizedName, normalizedPhone].join('|');
};

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value.trim());

const resolveMapValue = (value?: string) => {
  const normalized = (value || '').trim();
  if (!normalized) return 'https://www.google.com/maps';
  if (isHttpUrl(normalized)) return normalized;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(normalized)}`;
};

const SUPPLIER_STATUS_OPTIONS: Array<{ value: NonNullable<OrderVendorContact['orderStatus']>; label: string }> = [
  { value: 'searching', label: 'Поиск' },
  { value: 'found', label: 'Нашел' },
  { value: 'not_found', label: 'Не нашел' },
  { value: 'visit_required', label: 'Надо посетить' },
  { value: 'awaiting_reply', label: 'Ждем ответ' },
  { value: 'ordered', label: 'Заказан' },
  { value: 'other', label: 'Другое' }
];

const VendorSliderContent: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { orders, updateOrder, suppliers, addSupplier } = useStore();
  const { settings } = useAppSettings();

  const initialBrand = searchParams.get('brand');
  const initialSlideId = searchParams.get('slide');

  const [transientDragIndex, setTransientDragIndex] = useState(0);
  const [committedIndex, setCommittedIndex] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [brandFilter, setBrandFilter] = useState<string>(initialBrand || 'all');
  const [selectedBrand, setSelectedBrand] = useState<string | null>(initialBrand || null);
  const [priorityFilter, setPriorityFilter] = useState<'all' | Priority>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | NonNullable<Part['status']>>('all');
  const [sortBy, setSortBy] = useState<'priority' | 'year_asc' | 'year_desc'>('priority');
  const [gallery, setGallery] = useState<{ images: string[]; index: number } | null>(null);
  const [partsSheetOpen, setPartsSheetOpen] = useState(false);
  const [vehicleDetailsOpen, setVehicleDetailsOpen] = useState(false);
  const [statusSlidesExpanded, setStatusSlidesExpanded] = useState(true);
  const [suppliersOpen, setSuppliersOpen] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [newChecklistTask, setNewChecklistTask] = useState('');
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [suppliersTab, setSuppliersTab] = useState<'active' | 'recommendations'>('active');
  const [sharingSupplierKey, setSharingSupplierKey] = useState<string | null>(null);
  const [supplierForm, setSupplierForm] = useState({ name: '', phone: '', whatsapp: '', mapUrl: '', note: '' });
  const [supplierToDeleteId, setSupplierToDeleteId] = useState<string | null>(null);
  const [brokenImages, setBrokenImages] = useState<Record<string, true>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [brandSortBy, setBrandSortBy] = useState<'orders' | 'urgent' | 'updated'>('orders');
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const [pendingNavigateId, setPendingNavigateId] = useState<string | null>(null);
  const [recentCarIds, setRecentCarIds] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(RECENT_CARS_KEY);
      const parsed = stored ? (JSON.parse(stored) as string[]) : [];
      // Deduplicate on load to clean up any previously stored duplicates
      return Array.from(new Set(Array.isArray(parsed) ? parsed : []));
    } catch { return []; }
  });

  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const syncTimerRef = useRef<number | null>(null);
  const supplierDeletePressTimerRef = useRef<number | null>(null);
  const lastUrlSyncAtRef = useRef(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const clearPendingUrlSync = () => {
    if (!syncTimerRef.current) return;
    window.clearTimeout(syncTimerRef.current);
    syncTimerRef.current = null;
  };

  const hasPricedPart = (order: typeof orders[number]) => order.parts.some((part) => part.variants.length > 0);
  const hasOrderSuppliers = (order: typeof orders[number]) => (order.vendorContacts || []).length > 0;

  const orderSlides = useMemo(() => {
    const effectiveBrand = selectedBrand || brandFilter;
    return orders
      .filter((o) => !o.isArchived && !o.isSold)
      .filter((o) => {
        if (effectiveBrand === 'all') return true;
        if (effectiveBrand === LEAD_SLIDES_KEY) return o.isLead || o.customerStatus === 'LEAD' || o.status === 'lead';
        if (effectiveBrand === FOUND_SLIDES_KEY) return hasPricedPart(o);
        if (effectiveBrand === NOT_FOUND_SLIDES_KEY) return !hasPricedPart(o);
        if (effectiveBrand === SUPPLIER_SEARCH_KEY) return !hasOrderSuppliers(o);
        if (effectiveBrand === SUPPLIER_READY_KEY) return hasOrderSuppliers(o);
        if (effectiveBrand === URGENT_KEY) return o.priority === Priority.HIGH;
        if (effectiveBrand === NEED_SEND_KEY) {
          const contacts = o.vendorContacts || [];
          return contacts.length > 0 && contacts.some((c) => !c.lastWhatsappAt);
        }
        return o.brand === effectiveBrand;
      })
      .filter((o) => priorityFilter === 'all' || o.priority === priorityFilter)
      .map((order) => ({
        ...order,
        visibleParts: order.parts.filter((part) => statusFilter === 'all' || part.status === statusFilter)
      }))
      .filter((order) => order.visibleParts.length > 0)
      .sort((a, b) => {
        if (sortBy === 'year_asc') {
          const ya = Number(a.year) || 0;
          const yb = Number(b.year) || 0;
          if (!ya && !yb) return 0;
          if (!ya) return 1;
          if (!yb) return -1;
          return ya - yb;
        }
        if (sortBy === 'year_desc') {
          const ya = Number(a.year) || 0;
          const yb = Number(b.year) || 0;
          if (!ya && !yb) return 0;
          if (!ya) return 1;
          if (!yb) return -1;
          return yb - ya;
        }
        return (priorityWeight[b.priority] - priorityWeight[a.priority]) || (b.createdAt - a.createdAt);
      });
  }, [orders, brandFilter, selectedBrand, priorityFilter, statusFilter, sortBy]);

  const current = orderSlides[transientDragIndex];
  const committedSlide = orderSlides[committedIndex];

  const goTo = (nextIndex: number) => {
    if (orderSlides.length === 0) return;
    const normalized = (nextIndex + orderSlides.length) % orderSlides.length;
    setTransientDragIndex(normalized);
    setCommittedIndex(normalized);
    vibrate(8);
  };

  useEffect(() => {
    if (transientDragIndex >= orderSlides.length) setTransientDragIndex(0);
    if (committedIndex >= orderSlides.length) setCommittedIndex(0);
  }, [transientDragIndex, committedIndex, orderSlides.length]);

  useEffect(() => {
    if (!initialSlideId || orderSlides.length === 0) return;
    const nextIndex = orderSlides.findIndex((slide) => slide.id === initialSlideId);
    if (nextIndex >= 0) {
      setTransientDragIndex(nextIndex);
      setCommittedIndex(nextIndex);
    }
  }, [initialSlideId, orderSlides]);

  useEffect(() => {
    const currentQuery = location.search.startsWith('?') ? location.search.slice(1) : location.search;
    const nextBrand = selectedBrand || '';
    const nextSlide = committedSlide?.id || '';
    const next = new URLSearchParams(searchParams);

    if (nextBrand) next.set('brand', nextBrand);
    else next.delete('brand');

    if (nextSlide) next.set('slide', nextSlide);
    else next.delete('slide');

    const nextQuery = next.toString();
    if (nextQuery === currentQuery) return;

    clearPendingUrlSync();

    syncTimerRef.current = window.setTimeout(() => {
      const now = Date.now();
      if (now - lastUrlSyncAtRef.current < 200) return;
      const liveQuery = window.location.search.startsWith('?') ? window.location.search.slice(1) : window.location.search;
      if (liveQuery === nextQuery) return;
      lastUrlSyncAtRef.current = now;
      setSearchParams(next, { replace: true });
    }, 300);

    return () => {
      clearPendingUrlSync();
    };
  }, [selectedBrand, committedSlide?.id, location.search, searchParams, setSearchParams]);

  useEffect(() => () => {
    clearPendingUrlSync();
  }, []);

  useEffect(() => {
    setSupplierForm({ name: '', phone: '', whatsapp: '', mapUrl: '', note: '' });
    setAddingSupplier(false);
    setSuppliersTab('active');
    setSharingSupplierKey(null);
    setNewChecklistTask('');
  }, [current?.id]);

  useEffect(() => {
    if (!committedSlide?.id || !selectedBrand) return;
    setRecentCarIds((prev) => {
      const updated = [committedSlide.id, ...prev.filter((id) => id !== committedSlide.id)].slice(0, MAX_RECENT_CARS);
      localStorage.setItem(RECENT_CARS_KEY, JSON.stringify(updated));
      return updated;
    });
  }, [committedSlide?.id, selectedBrand]);

  useEffect(() => {
    if (!pendingNavigateId || orderSlides.length === 0) return;
    const idx = orderSlides.findIndex((s) => s.id === pendingNavigateId);
    if (idx >= 0) {
      setTransientDragIndex(idx);
      setCommittedIndex(idx);
      setPendingNavigateId(null);
    }
  }, [pendingNavigateId, orderSlides]);

  const brandOptions = useMemo(() => Array.from(new Set(orders.map((o) => o.brand))).sort((a, b) => a.localeCompare(b)), [orders]);

  const leadActiveNeedCount = useMemo(
    () => orders
      .filter((order) => !order.isArchived && !order.isSold && (order.isLead || order.customerStatus === 'LEAD' || order.status === 'lead'))
      .reduce((sum, order) => sum + order.parts.filter((part) => !part.isFound && part.status !== 'found').length, 0),
    [orders]
  );

  const brandActiveNeedCounts = useMemo(() => {
    const counts = new Map<string, number>();
    orders.forEach((order) => {
      if (order.isArchived || order.isSold) return;
      const unresolved = order.parts.filter((part) => !part.isFound && part.status !== 'found').length;
      if (unresolved <= 0) return;
      counts.set(order.brand, (counts.get(order.brand) || 0) + unresolved);
    });
    return counts;
  }, [orders]);

  const statusCardData = useMemo(() => {
    const active = orders.filter((o) => !o.isArchived && !o.isSold);
    const countParts = (list: typeof active) => list.reduce((s, o) => s + o.parts.length, 0);
    const urgentList = active.filter((o) => o.priority === Priority.HIGH);
    const foundList = active.filter(hasPricedPart);
    const notFoundList = active.filter((o) => !hasPricedPart(o));
    const noSupplierList = active.filter((o) => !hasOrderSuppliers(o));
    const needSendList = active.filter((o) => {
      const contacts = o.vendorContacts || [];
      return contacts.length > 0 && contacts.some((c) => !c.lastWhatsappAt);
    });
    return [
      { key: URGENT_KEY, title: '🔥 Срочные', orders: urgentList.length, parts: countParts(urgentList), className: 'border-rose-500 bg-rose-900/45 shadow-[0_0_0_1px_rgba(251,113,133,0.18)]' },
      { key: FOUND_SLIDES_KEY, title: '🟢 Есть варианты', orders: foundList.length, parts: countParts(foundList), className: 'border-emerald-600 bg-emerald-900/35' },
      { key: NOT_FOUND_SLIDES_KEY, title: '🟡 Нет вариантов', orders: notFoundList.length, parts: countParts(notFoundList), className: 'border-amber-500 bg-amber-900/30' },
      { key: SUPPLIER_SEARCH_KEY, title: '👥 Нет поставщиков', orders: noSupplierList.length, parts: countParts(noSupplierList), className: 'border-fuchsia-600 bg-fuchsia-900/35' },
      { key: NEED_SEND_KEY, title: '📤 Нужно отправить', orders: needSendList.length, parts: countParts(needSendList), className: 'border-cyan-500 bg-cyan-900/35' }
    ];
  }, [orders]);

  const brandData = useMemo(() => {
    const map = new Map<string, { orders: number; urgent: number; lastUpdated: number }>();
    orders.forEach((o) => {
      if (o.isArchived || o.isSold) return;
      const prev = map.get(o.brand) || { orders: 0, urgent: 0, lastUpdated: 0 };
      map.set(o.brand, {
        orders: prev.orders + 1,
        urgent: prev.urgent + (o.priority === Priority.HIGH ? 1 : 0),
        lastUpdated: Math.max(prev.lastUpdated, o.updatedAt || o.createdAt || 0)
      });
    });
    return Array.from(map.entries()).map(([brand, stats]) => ({ brand, ...stats }));
  }, [orders]);

  const sortedBrands = useMemo(() => [...brandData].sort((a, b) => {
    if (brandSortBy === 'orders') return b.orders - a.orders;
    if (brandSortBy === 'urgent') return b.urgent - a.urgent;
    return b.lastUpdated - a.lastUpdated;
  }), [brandData, brandSortBy]);

  const recentCars = useMemo(() => {
    const orderMap = new Map(orders.map((o) => [o.id, o]));
    return recentCarIds.map((id) => orderMap.get(id)).filter(Boolean) as typeof orders;
  }, [recentCarIds, orders]);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [] as typeof orders;
    return orders
      .filter((o) => !o.isArchived && !o.isSold && (
        o.brand.toLowerCase().includes(q)
        || o.model.toLowerCase().includes(q)
        || (o.vin || '').toLowerCase().includes(q)
        || (o.clientName || '').toLowerCase().includes(q)
        || o.parts.some((p) => p.name.toLowerCase().includes(q))
      ))
      .slice(0, MAX_SEARCH_RESULTS);
  }, [searchQuery, orders]);

  const variantSupplierContacts = useMemo(() => {
    if (!current) return [] as OrderVendorContact[];

    const deduped = new Map<string, OrderVendorContact>();
    current.parts.forEach((part) => {
      part.variants.forEach((variant) => {
        const variantShopName = (variant.shopNameManual || variant.shopName || '').trim();
        if (!variantShopName) return;
        const supplierById = variant.shopId ? suppliers.find((item) => item.id === variant.shopId) : null;
        const supplierByName = suppliers.find((item) => item.name.trim().toLowerCase() === variantShopName.toLowerCase());
        const baseSupplier = supplierById || supplierByName;

        const phone = variant.phone || baseSupplier?.phone || '';
        const whatsapp = baseSupplier?.whatsapp || phone;
        const mapUrl = variant.mapsUrl || variant.locationText || variant.location || baseSupplier?.location || '';
        const dedupeKey = [variant.shopId || baseSupplier?.id || variantShopName.toLowerCase(), phoneDigits(phone || whatsapp)].join('|');
        deduped.set(dedupeKey, {
          id: `variant-${part.id}-${variant.id}`,
          name: baseSupplier?.name || variantShopName,
          phone,
          whatsapp,
          mapUrl,
          note: `Из варианта: ${part.name}`,
          createdAt: variant.createdAt || Date.now(),
          updatedAt: variant.updatedAt || variant.createdAt || Date.now()
        });
      });
    });

    return Array.from(deduped.values());
  }, [current, suppliers]);

  const supplierContacts = useMemo(() => {
    const manual = current?.vendorContacts || [];
    const deduped = new Map<string, OrderVendorContact>();
    [...manual, ...variantSupplierContacts].forEach((contact) => {
      const key = [contact.name.trim().toLowerCase(), phoneDigits(contact.phone || contact.whatsapp || '')].join('|');
      if (!deduped.has(key)) deduped.set(key, contact);
    });
    return Array.from(deduped.values());
  }, [current?.vendorContacts, variantSupplierContacts]);

  const contactedSupplierMeta = useMemo(() => {
    const byId = new Map<string, Pick<OrderVendorContact, 'lastWhatsappAt' | 'whatsappMessageCount'>>();
    const byNamePhone = new Map<string, Pick<OrderVendorContact, 'lastWhatsappAt' | 'whatsappMessageCount'>>();
    const byPhone = new Map<string, Pick<OrderVendorContact, 'lastWhatsappAt' | 'whatsappMessageCount'>>();

    (current?.vendorContacts || []).forEach((contact) => {
      if (!contact.lastWhatsappAt) return;
      const meta = {
        lastWhatsappAt: contact.lastWhatsappAt,
        whatsappMessageCount: contact.whatsappMessageCount || 0
      };
      const normalizedPhone = phoneDigits(contact.phone || contact.whatsapp || '');
      const normalizedName = contact.name.trim().toLowerCase();
      if (contact.id) byId.set(contact.id, meta);
      if (normalizedPhone) byPhone.set(normalizedPhone, meta);
      byNamePhone.set([normalizedName, normalizedPhone].join('|'), meta);
    });

    return { byId, byNamePhone, byPhone };
  }, [current?.vendorContacts]);

  const getWhatsappMeta = (contact: OrderVendorContact) => {
    const normalizedPhone = phoneDigits(contact.phone || contact.whatsapp || '');
    const normalizedName = contact.name.trim().toLowerCase();
    return contactedSupplierMeta.byId.get(contact.id)
      || contactedSupplierMeta.byNamePhone.get([normalizedName, normalizedPhone].join('|'))
      || (normalizedPhone ? contactedSupplierMeta.byPhone.get(normalizedPhone) : undefined);
  };

  const mergedChecklistItems = useMemo(() => {
    if (!current) return [] as VendorChecklistItem[];
    const defaults = Array.isArray(settings.defaultVendorChecklist) ? settings.defaultVendorChecklist : [];
    const byKey = new Map<string, VendorChecklistItem>();

    defaults.forEach((task) => {
      const text = String(task || '').trim();
      if (!text) return;
      byKey.set(text.toLowerCase(), {
        id: `default-${text.toLowerCase().replace(/\s+/g, '-')}`,
        text,
        completed: false,
        source: 'default',
        updatedAt: 0
      });
    });

    (current.vendorChecklist || []).forEach((item) => {
      const text = String(item.text || '').trim();
      if (!text) return;
      const key = text.toLowerCase();
      const existing = byKey.get(key);
      const source = item.source === 'order' ? 'order' : 'default';

      if (source === 'default' && !existing) {
        return;
      }

      byKey.set(key, {
        id: item.id || existing?.id || ensureUuid(),
        text,
        completed: item.completed === true,
        source,
        updatedAt: Number(item.updatedAt || existing?.updatedAt || Date.now())
      });
    });

    return Array.from(byKey.values()).sort((a, b) => Number(a.completed) - Number(b.completed));
  }, [current, settings.defaultVendorChecklist]);

  const updateSupplierContactStatus = async (contact: OrderVendorContact, status: NonNullable<OrderVendorContact['orderStatus']>) => {
    if (!current) return;
    const now = Date.now();
    const nextVendorContacts = [...(current.vendorContacts || [])];
    const normalizedPhone = phoneDigits(contact.phone || contact.whatsapp || '');
    const existingIndex = nextVendorContacts.findIndex((item) => {
      if (item.id === contact.id) return true;
      const itemPhone = phoneDigits(item.phone || item.whatsapp || '');
      if (normalizedPhone && itemPhone && normalizedPhone === itemPhone) return true;
      return item.name.trim().toLowerCase() === contact.name.trim().toLowerCase();
    });

    if (existingIndex >= 0) {
      const existing = nextVendorContacts[existingIndex];
      nextVendorContacts[existingIndex] = { ...existing, orderStatus: status, statusUpdatedAt: now, updatedAt: now };
    } else {
      nextVendorContacts.unshift({
        ...contact,
        id: ensureUuid(),
        createdAt: contact.createdAt || now,
        orderStatus: status,
        statusUpdatedAt: now,
        updatedAt: now
      });
    }

    await updateOrder({
      ...current,
      vendorContacts: nextVendorContacts,
      updatedAt: now
    });
  };

  const persistChecklist = async (nextChecklist: VendorChecklistItem[]) => {
    if (!current) return;
    const now = Date.now();
    await updateOrder({
      ...current,
      vendorChecklist: nextChecklist,
      updatedAt: now
    });
  };

  const toggleChecklistItem = async (item: VendorChecklistItem) => {
    if (!current) return;
    const now = Date.now();
    const next = mergedChecklistItems.map((entry) => entry.text.toLowerCase() === item.text.toLowerCase()
      ? { ...entry, completed: !entry.completed, updatedAt: now }
      : entry);
    await persistChecklist(next);
  };

  const addOrderChecklistTask = async () => {
    if (!current) return;
    const text = newChecklistTask.trim();
    if (!text) return;
    const now = Date.now();
    const exists = mergedChecklistItems.some((entry) => entry.text.trim().toLowerCase() === text.toLowerCase());
    if (exists) {
      setNewChecklistTask('');
      return;
    }
    await persistChecklist([
      ...mergedChecklistItems,
      { id: ensureUuid(), text, completed: false, source: 'order', updatedAt: now }
    ]);
    setNewChecklistTask('');
  };

  const recommendedSuppliers = useMemo(() => {
    if (!current) return [] as Supplier[];
    const activeNames = new Set(supplierContacts.map((contact) => contact.name.trim().toLowerCase()));
    const activePhones = new Set(supplierContacts.map((contact) => phoneDigits(contact.phone || contact.whatsapp || '')).filter(Boolean));

    return suppliers
      .filter((supplier) => {
        const nameKey = supplier.name.trim().toLowerCase();
        const phoneKey = phoneDigits(supplier.phone || supplier.whatsapp || '');
        return !activeNames.has(nameKey) && (!phoneKey || !activePhones.has(phoneKey));
      })
      .map((supplier) => {
        const score = getShopOrderMatchScore({
          id: supplier.id,
          name: supplier.name,
          phone: supplier.phone,
          location: supplier.location,
          latitude: supplier.coordinates?.lat || 0,
          longitude: supplier.coordinates?.lng || 0,
          specialization: supplier.brands || [],
          mainBrands: supplier.mainBrands || [],
          specializationModels: supplier.models || [],
          specializationYears: supplier.years || [],
          specializationBodyTypes: supplier.bodyTypes || []
        }, current);
        const strictBrand = [...(supplier.brands || []), ...(supplier.mainBrands || [])].some((brand) => isBrandMatch(current.brand, brand));
        return { supplier, score, strictBrand };
      })
      .filter((entry) => entry.strictBrand || entry.score >= 2)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.supplier);
  }, [current, supplierContacts, suppliers]);

  const buildWhatsappCaption = () => {
    if (!current) return '';
    const carLine = `${current.brand} ${current.model} ${current.year}`.trim();
    const neededParts = current.visibleParts
      .map((part, idx) => `${idx + 1}. ${part.name}`)
      .join('\n');

    return [
      'Hello!',
      '',
      `Car: ${carLine}`,
      `VIN: ${current.vin || '—'}`,
      '',
      'Required parts (EN):',
      neededParts || '-'
    ].join('\n');
  };

  const openSupplierWhatsapp = (contact: OrderVendorContact) => {
    const phone = phoneDigits(contact.whatsapp || contact.phone);
    if (!phone || !current) return;

    const now = Date.now();
    const contactPhone = phoneDigits(contact.phone || contact.whatsapp || '');
    const nextVendorContacts = [...(current.vendorContacts || [])];
    const existingIndex = nextVendorContacts.findIndex((item) => {
      if (item.id === contact.id) return true;
      const itemPhone = phoneDigits(item.phone || item.whatsapp || '');
      if (contactPhone && itemPhone && contactPhone === itemPhone) return true;
      return item.name.trim().toLowerCase() === contact.name.trim().toLowerCase();
    });

    if (existingIndex >= 0) {
      const existing = nextVendorContacts[existingIndex];
      nextVendorContacts[existingIndex] = {
        ...existing,
        lastWhatsappAt: now,
        whatsappMessageCount: (existing.whatsappMessageCount || 0) + 1,
        updatedAt: now
      };
    } else {
      nextVendorContacts.unshift({
        ...contact,
        id: ensureUuid(),
        createdAt: contact.createdAt || now,
        lastWhatsappAt: now,
        whatsappMessageCount: 1,
        updatedAt: now
      });
    }

    void updateOrder({
      ...current,
      vendorContacts: nextVendorContacts,
      updatedAt: now
    });

    const caption = buildWhatsappCaption();
    const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(caption)}`;
    const sharingKey = contactIdentityKey(contact);
    setSharingSupplierKey(sharingKey);
    window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
    window.setTimeout(() => setSharingSupplierKey(null), 400);
  };

  const linkExistingSupplier = async (supplier: Supplier) => {
    if (!current) return;
    const normalizedPhone = phoneDigits(supplier.whatsapp || supplier.phone || '');
    const alreadyLinked = (current.vendorContacts || []).some((item) => {
      const itemPhone = phoneDigits(item.whatsapp || item.phone || '');
      return item.id === supplier.id || (normalizedPhone.length > 0 && normalizedPhone === itemPhone);
    });
    if (alreadyLinked) return;

    const now = Date.now();
    const nextContact: OrderVendorContact = {
      id: ensureUuid(),
      name: supplier.name,
      phone: supplier.phone,
      whatsapp: supplier.whatsapp || supplier.phone,
      mapUrl: supplier.location,
      note: supplier.comment || '',
      createdAt: now,
      updatedAt: now
    };

    await updateOrder({
      ...current,
      vendorContacts: [nextContact, ...(current.vendorContacts || [])],
      updatedAt: now
    });
  };

  const removeSupplierContact = async (contactId: string) => {
    if (!current) return;
    const now = Date.now();
    await updateOrder({
      ...current,
      vendorContacts: (current.vendorContacts || []).filter((item) => item.id !== contactId),
      updatedAt: now
    });
    setSupplierToDeleteId(null);
  };

  const saveSupplier = async () => {
    if (!current) return;
    const name = supplierForm.name.trim();
    if (!name) return;

    const now = Date.now();
    const nextContact: OrderVendorContact = {
      id: ensureUuid(),
      name,
      phone: supplierForm.phone.trim(),
      whatsapp: supplierForm.whatsapp.trim(),
      mapUrl: supplierForm.mapUrl.trim(),
      note: supplierForm.note.trim(),
      createdAt: now,
      updatedAt: now
    };

    const normalizedName = name.toLowerCase();
    const normalizedPhone = phoneDigits(nextContact.phone || nextContact.whatsapp);
    const existsInBase = suppliers.some((item) => {
      const byName = item.name.trim().toLowerCase() === normalizedName;
      const itemPhone = phoneDigits(item.phone || item.whatsapp || '');
      const byPhone = normalizedPhone.length > 0 && itemPhone === normalizedPhone;
      return byName || byPhone;
    });

    if (!existsInBase) {
      const baseSupplier: Supplier = {
        id: ensureUuid(),
        name,
        phone: nextContact.phone || nextContact.whatsapp || '',
        whatsapp: nextContact.whatsapp || nextContact.phone || '',
        hasWhatsapp: Boolean(nextContact.whatsapp || nextContact.phone),
        location: nextContact.mapUrl || '',
        brands: current.brand ? [current.brand] : [],
        mainBrands: current.brand ? [current.brand] : [],
        primaryBrand: current.brand || '',
        models: current.model ? [current.model] : [],
        years: Number.isFinite(Number(current.year)) ? [Number(current.year)] : [],
        bodyTypes: current.bodyType ? [current.bodyType] : [],
        type: 'mixed',
        activeOrderIds: [current.id],
        linkedParts: current.visibleParts.slice(0, 6).map((part) => ({
          id: ensureUuid(),
          orderId: current.id,
          orderLabel: `${current.brand} ${current.model} • ${current.vin || '—'}`,
          partId: part.id,
          partName: part.name,
          status: part.status === 'found' || part.isFound ? 'found' : 'searching',
          source: 'manual',
          updatedAt: now
        })),
        comment: nextContact.note || '',
        createdAt: now,
        updatedAt: now
      };
      addSupplier(baseSupplier);
    }

    await updateOrder({
      ...current,
      vendorContacts: [nextContact, ...(current.vendorContacts || [])],
      updatedAt: now
    });

    setSupplierForm({ name: '', phone: '', whatsapp: '', mapUrl: '', note: '' });
    setAddingSupplier(false);
  };

  if (!selectedBrand) {
    return (
      <div className="fixed inset-0 z-50 flex min-h-screen flex-col overflow-hidden bg-[#0B1220] text-white">
        {/* HEADER */}
        <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-white/80"
              aria-label="Назад в главное меню"
            >
              <ArrowLeft size={16} />
            </button>
            <div>
              <p className="text-xl font-black">Vendor Slides</p>
              <p className="text-[11px] text-white/50">Управление поставщиками</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { searchInputRef.current?.focus(); }}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-white/70"
              aria-label="Поиск"
            >
              <Search size={16} />
            </button>
            <button
              type="button"
              onClick={() => setQuickActionsOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-amber-300"
              aria-label="Быстрые действия"
            >
              <Zap size={16} />
            </button>
          </div>
        </div>

        {/* SEARCH BAR */}
        <div className="shrink-0 px-4 pb-2">
          <div className="flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-900/80 px-3 py-2">
            <Search size={14} className="shrink-0 text-white/35" />
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Поиск по марке, модели, VIN, детали или клиенту..."
              className="flex-1 bg-transparent text-sm text-white placeholder-white/35 outline-none"
            />
            {searchQuery && (
              <button type="button" onClick={() => setSearchQuery('')} className="shrink-0 text-white/40">
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* QUICK FILTER BAR */}
        <div className="flex shrink-0 gap-2 overflow-x-auto px-4 pb-3 [scrollbar-width:none]">
          {([
            { key: 'all', label: 'Все' },
            { key: URGENT_KEY, label: '🔥 Срочно' },
            { key: FOUND_SLIDES_KEY, label: '🟢 Найдено' },
            { key: NOT_FOUND_SLIDES_KEY, label: '🔴 Нет вариантов' },
            { key: SUPPLIER_SEARCH_KEY, label: '👥 Без поставщиков' },
            { key: NEED_SEND_KEY, label: '📤 Нужно отправить' }
          ] as const).map((filter) => (
            <button
              key={filter.key}
              type="button"
              onClick={() => {
                setSelectedBrand(filter.key);
                setBrandFilter(filter.key);
              }}
              className="shrink-0 whitespace-nowrap rounded-full border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-[11px] font-bold text-white/80 hover:border-blue-500 hover:text-white"
            >
              {filter.label}
            </button>
          ))}
        </div>

        {/* MAIN CONTENT */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-20">

          {/* SEARCH RESULTS */}
          {searchQuery.trim() && (
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-white/60">Результаты поиска</p>
              {searchResults.length === 0 ? (
                <p className="rounded-xl border border-slate-700 bg-slate-900/40 px-3 py-3 text-xs text-slate-400">Ничего не найдено</p>
              ) : (
                <div className="space-y-2">
                  {searchResults.map((order) => (
                    <button
                      key={order.id}
                      type="button"
                      onClick={() => {
                        setSelectedBrand(order.brand);
                        setBrandFilter(order.brand);
                        setPendingNavigateId(order.id);
                      }}
                      className="flex w-full items-center justify-between rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2.5 text-left"
                    >
                      <div>
                        <p className="text-sm font-black">{order.brand} {order.model} {order.year}</p>
                        <p className="text-[11px] text-white/50">{order.parts.length} дет. · VIN: {order.vin || '—'}</p>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${order.priority === Priority.HIGH ? 'bg-rose-700 text-white' : order.priority === Priority.MEDIUM ? 'bg-amber-700 text-white' : 'bg-slate-700 text-white/70'}`}>
                        {order.priority}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {!searchQuery.trim() && (
            <>
              {/* RECENT CARS */}
              {recentCars.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <Clock size={12} className="text-white/40" />
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/60">Недавние машины</p>
                  </div>
                  <div className="space-y-2">
                    {recentCars.map((car) => (
                      <button
                        key={car.id}
                        type="button"
                        onClick={() => {
                          setSelectedBrand(car.brand);
                          setBrandFilter(car.brand);
                          setPendingNavigateId(car.id);
                        }}
                        className="flex w-full items-center gap-3 rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-left hover:border-slate-500"
                      >
                        <Clock size={14} className="shrink-0 text-white/25" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold">{car.brand} {car.model}</p>
                          <p className="text-[11px] text-white/50">{car.year} · {car.parts.length} дет.</p>
                        </div>
                        {car.priority === Priority.HIGH && <span className="shrink-0 text-xs text-rose-400">🔥</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* STATUS BLOCK */}
              <div>
                <button
                  type="button"
                  onClick={() => setStatusSlidesExpanded((prev) => !prev)}
                  className="mb-2 flex w-full items-center justify-between rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-white/75"
                >
                  <span>STATUS</span>
                  <ChevronDown size={14} className={`transition-transform ${statusSlidesExpanded ? 'rotate-180' : ''}`} />
                </button>
                {statusSlidesExpanded && (
                  <div className="grid grid-cols-2 gap-2">
                    {statusCardData.map((card) => (
                      <button
                        key={card.key}
                        type="button"
                        onClick={() => {
                          setSelectedBrand(card.key);
                          setBrandFilter(card.key);
                        }}
                        className={`rounded-xl border px-3 py-3 text-left ${card.className}`}
                      >
                        <p className="text-sm font-black leading-tight">{card.title}</p>
                        <p className="mt-1.5 text-[11px] font-semibold text-white/80">{card.orders} заказов</p>
                        <p className="text-[10px] text-white/60">{card.parts} деталей</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* BRANDS BLOCK */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/60">МАРКИ</p>
                  <div className="flex gap-0.5 rounded-lg border border-slate-700 bg-slate-900/60 p-0.5">
                    {([['orders', 'заказы'], ['urgent', 'срочность'], ['updated', 'обновление']] as const).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setBrandSortBy(key)}
                        className={`rounded px-2 py-1 text-[10px] font-bold ${brandSortBy === key ? 'bg-[#2563EB] text-white' : 'text-white/55'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {sortedBrands.map(({ brand, orders: brandOrders, urgent }) => (
                    <button
                      key={brand}
                      type="button"
                      onClick={() => {
                        setSelectedBrand(brand);
                        setBrandFilter(brand);
                      }}
                      className="rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-4 text-left hover:border-[#2563EB]"
                    >
                      <p className="text-lg font-black">{brand}</p>
                      <p className="mt-1 text-xs font-semibold text-white/65">{brandOrders} заказов</p>
                      {urgent > 0 && <p className="mt-0.5 text-[11px] font-bold text-rose-400">{urgent} срочных</p>}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* QUICK ACTIONS MENU */}
        {quickActionsOpen && (
          <div className="absolute inset-0 z-20 bg-black/70 p-4" onClick={() => setQuickActionsOpen(false)}>
            <div className="mt-16 rounded-3xl border border-amber-700/40 bg-[#1a1510] p-4" onClick={(e) => e.stopPropagation()}>
              <div className="mb-3 flex items-center gap-2">
                <Zap size={14} className="text-amber-300" />
                <p className="text-sm font-bold uppercase tracking-[0.2em] text-amber-100">Быстрые действия</p>
              </div>
              <div className="space-y-2">
                {[
                  {
                    label: 'Открыть последний заказ',
                    action: () => {
                      const lastId = recentCarIds[0];
                      if (lastId) {
                        const order = orders.find((o) => o.id === lastId);
                        if (order) {
                          setSelectedBrand(order.brand);
                          setBrandFilter(order.brand);
                          setPendingNavigateId(lastId);
                        }
                      }
                      setQuickActionsOpen(false);
                    }
                  },
                  {
                    label: 'Показать машины без вариантов',
                    action: () => { setSelectedBrand(NOT_FOUND_SLIDES_KEY); setBrandFilter(NOT_FOUND_SLIDES_KEY); setQuickActionsOpen(false); }
                  },
                  {
                    label: 'Показать машины без поставщиков',
                    action: () => { setSelectedBrand(SUPPLIER_SEARCH_KEY); setBrandFilter(SUPPLIER_SEARCH_KEY); setQuickActionsOpen(false); }
                  },
                  {
                    label: 'Показать срочные',
                    action: () => { setSelectedBrand(URGENT_KEY); setBrandFilter(URGENT_KEY); setQuickActionsOpen(false); }
                  }
                ].map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    onClick={action.action}
                    className="flex w-full rounded-xl border border-slate-700 bg-slate-900/60 px-4 py-3 text-left text-sm font-semibold text-white hover:border-amber-500/60 hover:bg-amber-900/20"
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (!current) {
    return (
      <div className="fixed inset-0 z-50 flex min-h-screen flex-col items-center justify-center gap-4 bg-[#0B1220] text-gray-300">
        <p>Нет данных</p>
        <button type="button" onClick={() => { clearPendingUrlSync(); navigate(-1); }} className="rounded-xl border border-gray-700 px-4 py-2">Назад</button>
      </div>
    );
  }

  const carImages = sanitizeImages([...(Array.isArray(current.carPhotos) ? current.carPhotos : []), current.carPhotoUrl]);
  const availableCarImages = carImages.filter((image) => !brokenImages[image]);

  return (
    <div className="fixed inset-0 z-50 flex min-h-screen w-full flex-col overflow-hidden bg-[#0B1220] text-white">
      <div className="relative h-[32vh] min-h-[210px] max-h-[300px] overflow-hidden border-b border-slate-800">
        {availableCarImages[0] ? (
          <button type="button" onClick={() => setGallery({ images: availableCarImages, index: 0 })} className="h-full w-full">
            <SafeImage
              src={availableCarImages[0]}
              alt="car"
              className="h-full w-full object-cover"
              onError={() => setBrokenImages((prev) => ({ ...prev, [availableCarImages[0]]: true }))}
            />
          </button>
        ) : (
          <div className="h-full w-full bg-slate-900" />
        )}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/80 via-black/45 to-transparent px-3 pb-3 pt-8">
          <div className="inline-block rounded-xl bg-black/45 px-3 py-2 backdrop-blur-[2px]">
            <p className="truncate text-2xl font-black leading-tight">{current.brand} {current.model}</p>
            <p className="mt-1 text-lg font-black text-amber-200">{current.year} · {current.bodyType || '—'}</p>
          </div>
          {(selectedBrand || brandFilter) === LEAD_SLIDES_KEY && <p className="mt-1 text-xs font-black uppercase tracking-[0.2em] text-rose-200">Режим: ЛИД</p>}

          <div className="pointer-events-auto mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                clearPendingUrlSync();
                navigate(`/order/${current.id}`);
              }}
              className="rounded-xl border border-slate-500/90 bg-black/40 px-3 py-1 text-xs font-bold text-white"
            >
              Открыть заказ
            </button>
            <button
              type="button"
              onClick={() => setSuppliersOpen(true)}
              className="inline-flex items-center gap-1 rounded-xl border border-cyan-400/70 bg-cyan-900/30 px-3 py-1 text-xs font-bold text-cyan-100"
            >
              <Users size={13} /> Поставщики ({supplierContacts.length})
            </button>
            <button
              type="button"
              onClick={() => setChecklistOpen(true)}
              className="inline-flex items-center gap-1 rounded-xl border border-violet-400/70 bg-violet-900/30 px-3 py-1 text-xs font-bold text-violet-100"
            >
              <CheckSquare size={13} /> Чек лист
            </button>
            <button
              type="button"
              onClick={() => setVehicleDetailsOpen(true)}
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-amber-300/70 bg-amber-900/30 px-2 py-1 text-[11px] font-bold text-amber-100"
            >
              Авто
            </button>
          </div>
        </div>

        <div className="absolute right-3 top-3 z-10 flex gap-2">
          <button type="button" onClick={() => setFiltersOpen(true)} className="flex h-11 w-11 items-center justify-center rounded-full bg-black/45"><Filter size={18} /></button>
          <button type="button" onClick={() => setSelectedBrand(null)} className="rounded-full bg-black/45 px-3 text-[11px] font-bold">Марки</button>
          <button type="button" onClick={() => setSelectedBrand(null)} className="flex h-11 w-11 items-center justify-center rounded-full bg-black/45"><X size={20} /></button>
        </div>
      </div>

      <div
        className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3"
        onTouchStart={(e) => {
          const t = e.targetTouches[0];
          touchStart.current = { x: t.clientX, y: t.clientY };
        }}
        onTouchEnd={(e) => {
          if (!touchStart.current) return;
          const t = e.changedTouches[0];
          const dx = t.clientX - touchStart.current.x;
          const dy = t.clientY - touchStart.current.y;
          if (Math.abs(dx) > 28 && Math.abs(dx) > Math.abs(dy) * 1.15) goTo(committedIndex + (dx > 0 ? -1 : 1));
          touchStart.current = null;
        }}
      >
        {current.visibleParts.map((part) => {
          const images = sanitizeImages([...(Array.isArray(part.photos) ? part.photos : []), part.photoUrl]);
          const availableImages = images.filter((image) => !brokenImages[image]);
          const isFound = part.isFound || part.status === 'found' || part.variants.some((variant) => Number(variant.priceAed) > 0);

          return (
            <div
              key={part.id}
              className={`flex items-center gap-2 rounded-2xl border p-1.5 transition ${isFound ? 'border-emerald-700/80 bg-emerald-900/15 opacity-65' : 'border-slate-700 bg-[#111a2d]'}`}
            >
              <button type="button" className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-slate-900" onClick={() => availableImages[0] && setGallery({ images: availableImages, index: 0 })}>
                {availableImages[0] ? (
                  <SafeImage
                    src={availableImages[0]}
                    alt={part.name}
                    className="h-full w-full object-cover"
                    onError={() => setBrokenImages((prev) => ({ ...prev, [availableImages[0]]: true }))}
                  />
                ) : (
                  <div className="grid h-full w-full place-items-center text-slate-500"><ImageOff size={18} /></div>
                )}
              </button>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black">{part.name}</p>
                <p className="text-[11px] text-white/70">Вариантов: {part.variants.length}</p>
                {part.comment?.trim() && <p className="mt-0.5 line-clamp-2 text-[10px] text-white/55">Описание: {part.comment.trim()}</p>}
              </div>

              <button
                type="button"
                onClick={() => {
                  clearPendingUrlSync();
                  navigate(`/order/${current.id}/part/${part.id}`, { replace: false, state: { backTo: '/vendor' } });
                }}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-600 text-white/90"
                title="Открыть карточку детали"
              >
                <ExternalLink size={12} />
              </button>
            </div>
          );
        })}
      </div>

      <div className="absolute inset-x-0 bottom-3 flex items-center justify-between px-4">
        <button type="button" onClick={() => goTo(committedIndex - 1)} className="rounded-xl border border-slate-600 px-3 py-2 text-xs">Назад</button>
        <button type="button" onClick={() => setPartsSheetOpen(true)} className="rounded-xl border border-slate-600 px-3 py-2 text-xs">Авто список</button>
        <button type="button" onClick={() => goTo(committedIndex + 1)} className="rounded-xl border border-slate-600 px-3 py-2 text-xs">Далее</button>
      </div>

      {filtersOpen && (
        <div className="absolute inset-0 z-20 bg-black/70 p-4" onClick={() => setFiltersOpen(false)}>
          <div className="mt-20 rounded-3xl border border-slate-700 bg-[#111a2d] p-4" onClick={(e) => e.stopPropagation()}>
            <p className="mb-3 text-sm font-bold uppercase tracking-[0.2em] text-white/70">Фильтры</p>
            <div className="space-y-3 text-sm">
              <div>
                <p className="mb-1 text-xs text-white/70">Марки</p>
                <select
                  value={brandFilter}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === '__choose') {
                      setSelectedBrand(null);
                      return;
                    }
                    setBrandFilter(value);
                    setSelectedBrand(value === 'all' ? null : value);
                  }}
                  className="w-full rounded-xl bg-slate-800 px-3 py-2"
                >
                  <option value="all">Все марки</option>
                  <option value={URGENT_KEY}>🔥 Срочные (HIGH приоритет)</option>
                  <option value={LEAD_SLIDES_KEY}>Только ЛИД</option>
                  <option value={FOUND_SLIDES_KEY}>🟢 Найденные (есть цена)</option>
                  <option value={NOT_FOUND_SLIDES_KEY}>🟡 Ненайденные (без цен)</option>
                  <option value={SUPPLIER_SEARCH_KEY}>👥 Нет поставщиков (0 контактов)</option>
                  <option value={SUPPLIER_READY_KEY}>С поставщиками (1+ контакт)</option>
                  <option value={NEED_SEND_KEY}>📤 Нужно отправить запрос</option>
                  <option value="__choose">Выбрать экран марок</option>
                  {brandOptions.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
                </select>
              </div>

              <div>
                <p className="mb-1 text-xs text-white/70">Приоритет</p>
                <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as 'all' | Priority)} className="w-full rounded-xl bg-slate-800 px-3 py-2">
                  <option value="all">Любой</option>
                  <option value={Priority.HIGH}>High</option>
                  <option value={Priority.MEDIUM}>Medium</option>
                  <option value={Priority.LOW}>Low</option>
                </select>
              </div>

              <div>
                <p className="mb-1 text-xs text-white/70">Статус</p>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | NonNullable<Part['status']>)} className="w-full rounded-xl bg-slate-800 px-3 py-2">
                  <option value="all">Любой</option>
                  <option value="searching">Searching</option>
                  <option value="found">Found</option>
                  <option value="ordered">Ordered</option>
                  <option value="not_found">Not found</option>
                </select>
              </div>

              <div>
                <p className="mb-1 text-xs text-white/70">Сортировка</p>
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value as 'priority' | 'year_asc' | 'year_desc')} className="w-full rounded-xl bg-slate-800 px-3 py-2">
                  <option value="priority">По приоритету</option>
                  <option value="year_asc">По году (старые сначала)</option>
                  <option value="year_desc">По году (новые сначала)</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      )}

      {partsSheetOpen && (
        <div className="absolute inset-0 z-20 bg-black/70 p-4" onClick={() => setPartsSheetOpen(false)}>
          <div className="mt-16 rounded-3xl border border-slate-700 bg-[#111a2d] p-4" onClick={(e) => e.stopPropagation()}>
            <p className="mb-3 text-sm font-bold uppercase tracking-[0.2em] text-white/70">Автомобили</p>
            <div className="max-h-[60vh] space-y-2 overflow-y-auto">
              {orderSlides.map((slide, idx) => (
                <button
                  key={slide.id}
                  type="button"
                  onClick={() => {
                    setTransientDragIndex(idx);
                    setCommittedIndex(idx);
                    setPartsSheetOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-3 text-left ${idx === committedIndex ? 'bg-[#2563EB]/25 text-white' : 'bg-slate-800 text-slate-200'}`}
                >
                  <span className="font-semibold">{slide.brand} {slide.model}</span>
                  <span className="text-xs opacity-70">{slide.visibleParts.length} деталей</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {suppliersOpen && (
        <div className="absolute inset-0 z-20 bg-black/70 p-4" onClick={() => setSuppliersOpen(false)}>
          <div className="mt-12 rounded-3xl border border-cyan-700/50 bg-[#0f1f35] p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-cyan-100">Поставщики заказа</p>
              <button
                type="button"
                onClick={() => setAddingSupplier((prev) => !prev)}
                className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/80 px-2 py-1 text-[11px] font-bold text-cyan-100"
              >
                <Plus size={12} /> Добавить
              </button>
            </div>

            <div className="mb-3 grid grid-cols-2 gap-2 rounded-xl border border-slate-700 bg-slate-900/40 p-1">
              <button type="button" onClick={() => setSuppliersTab('active')} className={`rounded-lg px-2 py-1.5 text-[11px] font-bold ${suppliersTab === 'active' ? 'bg-cyan-700 text-white' : 'text-cyan-100/80'}`}>Активные</button>
              <button type="button" onClick={() => setSuppliersTab('recommendations')} className={`rounded-lg px-2 py-1.5 text-[11px] font-bold ${suppliersTab === 'recommendations' ? 'bg-cyan-700 text-white' : 'text-cyan-100/80'}`}>Рекомендации</button>
            </div>

            {addingSupplier && (
              <div className="mb-3 space-y-2 rounded-xl border border-slate-700 bg-slate-900/60 p-3">
                <input value={supplierForm.name} onChange={(e) => setSupplierForm((prev) => ({ ...prev, name: e.target.value }))} className="h-10 w-full rounded-lg bg-slate-800 px-3 text-sm" placeholder="Название поставщика" />
                <div className="grid grid-cols-2 gap-2">
                  <input value={supplierForm.phone} onChange={(e) => setSupplierForm((prev) => ({ ...prev, phone: e.target.value }))} className="h-10 w-full rounded-lg bg-slate-800 px-3 text-xs" placeholder="Телефон" />
                  <input value={supplierForm.whatsapp} onChange={(e) => setSupplierForm((prev) => ({ ...prev, whatsapp: e.target.value }))} className="h-10 w-full rounded-lg bg-slate-800 px-3 text-xs" placeholder="WhatsApp" />
                </div>
                <input value={supplierForm.mapUrl} onChange={(e) => setSupplierForm((prev) => ({ ...prev, mapUrl: e.target.value }))} className="h-10 w-full rounded-lg bg-slate-800 px-3 text-xs" placeholder="Ссылка карты" />
                <input value={supplierForm.note} onChange={(e) => setSupplierForm((prev) => ({ ...prev, note: e.target.value }))} className="h-10 w-full rounded-lg bg-slate-800 px-3 text-xs" placeholder="Описание" />
                <button type="button" onClick={() => void saveSupplier()} className="h-10 w-full rounded-lg bg-cyan-700 text-xs font-bold">Сохранить поставщика</button>

                <div className="space-y-2 border-t border-slate-700 pt-2">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-100/80">Добавить из базы поставщиков</p>
                  <div className="max-h-36 space-y-1 overflow-y-auto">
                    {suppliers.map((supplier) => (
                      <button
                        key={supplier.id}
                        type="button"
                        onClick={() => void linkExistingSupplier(supplier)}
                        className="flex w-full items-center justify-between rounded-lg border border-slate-700 bg-slate-800/80 px-2 py-1.5 text-left"
                      >
                        <span className="truncate text-xs">{supplier.name}</span>
                        <span className="text-[10px] text-cyan-200">Прикрепить</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="max-h-[48vh] space-y-2 overflow-y-auto">
              {suppliersTab === 'active' && supplierContacts.length === 0 && <p className="rounded-xl border border-slate-700 bg-slate-900/40 px-3 py-4 text-xs text-slate-300">Пока нет добавленных поставщиков для этого заказа.</p>}

              {suppliersTab === 'active' && supplierContacts.map((contact) => {
                const whatsappMeta = getWhatsappMeta(contact);
                const wasContacted = Boolean(whatsappMeta?.lastWhatsappAt);
                const contactKey = contactIdentityKey(contact);
                const isSharing = sharingSupplierKey === contactKey;

                return (
                <div
                  key={contact.id}
                  className={`rounded-xl border p-3 ${wasContacted ? 'border-emerald-500/70 bg-emerald-900/10' : 'border-cyan-900/60 bg-slate-900/60'}`}
                  onPointerDown={() => {
                    supplierDeletePressTimerRef.current = window.setTimeout(() => {
                      setSupplierToDeleteId(contact.id);
                    }, 650);
                  }}
                  onPointerUp={() => {
                    if (supplierDeletePressTimerRef.current) {
                      window.clearTimeout(supplierDeletePressTimerRef.current);
                      supplierDeletePressTimerRef.current = null;
                    }
                  }}
                  onPointerLeave={() => {
                    if (supplierDeletePressTimerRef.current) {
                      window.clearTimeout(supplierDeletePressTimerRef.current);
                      supplierDeletePressTimerRef.current = null;
                    }
                  }}
                >
                  <p className="text-sm font-black text-white">{contact.name}</p>
                  {wasContacted && (
                    <span className="mt-1 inline-flex rounded-full border border-emerald-300/80 bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-emerald-100">
                      WhatsApp отправлен
                    </span>
                  )}
                  {contact.note && <p className="mt-1 text-[11px] text-slate-300">{contact.note}</p>}

                  <div className="mt-2 flex flex-wrap gap-1">
                    {SUPPLIER_STATUS_OPTIONS.map((statusOption) => {
                      const isActiveStatus = (contact.orderStatus || 'searching') === statusOption.value;
                      return (
                        <button
                          key={statusOption.value}
                          type="button"
                          onClick={() => void updateSupplierContactStatus(contact, statusOption.value)}
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${isActiveStatus ? 'border-cyan-200 bg-cyan-500/80 text-slate-950' : 'border-slate-600 text-slate-200'}`}
                        >
                          {statusOption.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        window.open(resolveMapValue(contact.mapUrl), '_blank');
                      }}
                      className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-slate-600 text-[10px] font-bold"
                    >
                      <MapPin size={12} /> Карта
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const phone = contact.phone || contact.whatsapp;
                        if (phone) window.open(`tel:${phone}`, '_self');
                      }}
                      className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-slate-600 text-[10px] font-bold"
                    >
                      <Phone size={12} /> Звонок
                    </button>

                    <button
                      type="button"
                      onClick={() => void openSupplierWhatsapp(contact)}
                      disabled={isSharing}
                      className={`inline-flex h-8 items-center justify-center gap-1 rounded-lg text-[10px] font-bold text-white disabled:opacity-60 ${wasContacted ? 'border border-emerald-100 bg-emerald-400 text-emerald-950 shadow-[0_0_0_2px_rgba(16,185,129,0.45)]' : 'bg-emerald-700'}`}
                      title={wasContacted ? `Последний контакт в WhatsApp: ${new Date(whatsappMeta?.lastWhatsappAt || 0).toLocaleString()}` : 'Отправить сообщение в WhatsApp'}
                    >
                      <MessageCircle size={12} /> {isSharing ? 'Открываю...' : wasContacted ? 'Написали ✓' : 'WhatsApp'}
                    </button>
                  </div>

                  {wasContacted && (
                    <p className="mt-2 text-[10px] text-emerald-200/90">
                      Уже писали: {new Date(whatsappMeta?.lastWhatsappAt || 0).toLocaleString()} {whatsappMeta?.whatsappMessageCount ? `(${whatsappMeta.whatsappMessageCount})` : ''}
                    </p>
                  )}
                </div>
              )})}

              {suppliersTab === 'recommendations' && (
                <>
                  {recommendedSuppliers.length === 0 && <p className="rounded-xl border border-slate-700 bg-slate-900/40 px-3 py-4 text-xs text-slate-300">Нет новых рекомендаций — все подходящие поставщики уже активны.</p>}
                  {recommendedSuppliers.map((supplier) => (
                    <div key={supplier.id} className="rounded-xl border border-cyan-900/60 bg-slate-900/60 p-3">
                      <p className="text-sm font-black text-white">{supplier.name}</p>
                      <p className="mt-1 truncate text-[11px] text-slate-300">{supplier.location || 'Локация не указана'}</p>
                      <div className="mt-2 flex gap-2">
                        <button type="button" onClick={() => void linkExistingSupplier(supplier)} className="inline-flex h-8 items-center justify-center rounded-lg bg-emerald-700 px-3 text-[10px] font-bold text-white">Добавить в активные</button>
                        <button type="button" onClick={() => window.open(resolveMapValue(supplier.location), '_blank')} className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-600 px-3 text-[10px] font-bold">Карта</button>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>

            {supplierToDeleteId && (
              <div className="mt-3 rounded-xl border border-rose-700/70 bg-rose-900/25 p-3">
                <p className="text-xs text-rose-100">Удалить поставщика из этого заказа?</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={() => setSupplierToDeleteId(null)} className="h-8 rounded-lg border border-slate-600 px-3 text-xs">Отмена</button>
                  <button type="button" onClick={() => void removeSupplierContact(supplierToDeleteId)} className="h-8 rounded-lg bg-rose-700 px-3 text-xs font-bold">Удалить</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {checklistOpen && (
        <div className="absolute inset-0 z-20 bg-black/70 p-4" onClick={() => setChecklistOpen(false)}>
          <div className="mt-12 rounded-3xl border border-violet-700/50 bg-[#1a1733] p-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-violet-100">Чек лист поиска</p>
            <p className="mt-1 text-[11px] text-violet-100/80">Задачи сохраняются для этого заказа и не теряются после перезагрузки.</p>

            <div className="mt-3 space-y-2">
              {mergedChecklistItems.length === 0 && <p className="rounded-xl border border-slate-700 bg-slate-900/40 px-3 py-3 text-xs text-slate-300">Нет задач. Добавьте первую задачу ниже.</p>}
              <div className="max-h-[44vh] space-y-2 overflow-y-auto">
                {mergedChecklistItems.map((item) => (
                  <label key={item.id} className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/50 px-3 py-2">
                    <input type="checkbox" checked={item.completed} onChange={() => void toggleChecklistItem(item)} className="h-4 w-4" />
                    <span className={`flex-1 text-sm ${item.completed ? 'line-through text-slate-400' : 'text-white'}`}>{item.text}</span>
                    <span className="text-[10px] uppercase text-violet-200/80">{item.source === 'order' ? 'заказ' : 'общий'}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="mt-3 flex gap-2">
              <input
                value={newChecklistTask}
                onChange={(e) => setNewChecklistTask(e.target.value)}
                placeholder="Добавить задачу для этого заказа"
                className="h-10 flex-1 rounded-lg bg-slate-800 px-3 text-xs"
              />
              <button type="button" onClick={() => void addOrderChecklistTask()} className="rounded-lg bg-violet-700 px-3 text-xs font-bold">Добавить</button>
            </div>
          </div>
        </div>
      )}

      {vehicleDetailsOpen && (
        <div className="absolute inset-0 z-20 bg-black/70 p-4" onClick={() => setVehicleDetailsOpen(false)}>
          <div className="mt-12 rounded-3xl border border-amber-700/40 bg-[#1f1a12] p-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-amber-100">Подробности автомобиля</p>
            <div className="mt-3 space-y-2 text-sm text-amber-50/90">
              <p><span className="text-amber-200/70">Марка/модель:</span> {current.brand} {current.model}</p>
              <p><span className="text-amber-200/70">Год:</span> {current.year || '—'}</p>
              <p><span className="text-amber-200/70">Тип кузова:</span> {current.bodyType || '—'}</p>
              <p><span className="text-amber-200/70">VIN:</span> {current.vin || '—'}</p>
              <p><span className="text-amber-200/70">Клиент:</span> {current.clientName || '—'}</p>
              <p><span className="text-amber-200/70">Контакт:</span> {current.customerContact || '—'}</p>
              <p><span className="text-amber-200/70">Тип двигателя:</span> {current.vehicleDetails?.engineType || '—'}</p>
              <p><span className="text-amber-200/70">Топливо:</span> {current.vehicleDetails?.fuelType || '—'}</p>
              <p><span className="text-amber-200/70">Привод:</span> {current.vehicleDetails?.drivetrain || '—'}</p>
              <p><span className="text-amber-200/70">Коробка:</span> {current.vehicleDetails?.transmission || '—'} {current.vehicleDetails?.transmissionCode ? `(${current.vehicleDetails.transmissionCode})` : ''}</p>
              <p><span className="text-amber-200/70">Объём / код двигателя:</span> {current.vehicleDetails?.engineDisplacement || '—'} {current.vehicleDetails?.engineCode ? `· ${current.vehicleDetails.engineCode}` : ''}</p>
              <p><span className="text-amber-200/70">Комплектация:</span> {current.vehicleDetails?.trimLevel || '—'}</p>
              <p><span className="text-amber-200/70">Спецификация / рынок:</span> {current.vehicleDetails?.marketRegion || '—'}</p>
              <p><span className="text-amber-200/70">Руль:</span> {current.vehicleDetails?.steeringSide || '—'}</p>
              <p><span className="text-amber-200/70">Дверей / цвет:</span> {current.vehicleDetails?.doors || '—'} / {current.vehicleDetails?.color || '—'}</p>
              {current.vehicleDetails?.additionalNotes && <p><span className="text-amber-200/70">Примечания:</span> {current.vehicleDetails.additionalNotes}</p>}
            </div>
          </div>
        </div>
      )}

      {gallery && <ImagePreview images={gallery.images} initialIndex={gallery.index} onClose={() => setGallery(null)} />}
    </div>
  );
};

const VendorSlider: React.FC = () => (
  <SupplierSlidesErrorBoundary>
    <VendorSliderContent />
  </SupplierSlidesErrorBoundary>
);

export default VendorSlider;
