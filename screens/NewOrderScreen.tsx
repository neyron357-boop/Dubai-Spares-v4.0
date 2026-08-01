import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, CarFront, ChevronDown, UserRound } from 'lucide-react';
import { BRAND_MODELS, BRANDS, DEFAULT_MARKUP, DEFAULT_RATE } from '../constants';
import { CHASSIS_BODY_TYPES_BY_BRAND } from '../carDatabase';
import { useStore } from '../store';
import { Order, Priority, Source } from '../types';
import { logger } from '../logging';
import { toast } from '../feedback';
import { useAppSettings } from '../appSettings';

type CreationType = 'lead' | 'order';

type DropdownOption = {
  label: string;
  value: string;
};

const POPULAR_BRANDS = ['BMW', 'Mercedes-Benz', 'Toyota', 'Lexus', 'Nissan', 'Hyundai', 'Kia', 'Audi', 'Volkswagen'];
const BODY_TYPE_OPTIONS = ['Седан', 'Кроссовер', 'Купе', 'Хэтчбек', 'Универсал', 'SUV', 'Пикап', 'Минивэн', 'Кабриолет', 'Фургон'];

const createId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

const serializeError = (error: unknown) => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  return {
    message: String(error)
  };
};

const inputClass = 'h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-all duration-200 placeholder:text-slate-400 focus:border-slate-300 focus:ring-4 focus:ring-slate-100';
const cardClass = 'space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-200';

const SearchableDropdown: React.FC<{
  value: string;
  placeholder: string;
  disabled?: boolean;
  options: DropdownOption[];
  loading?: boolean;
  required?: boolean;
  noOptionsText?: string;
  allowCustom?: boolean;
  onChange: (value: string) => void;
}> = ({ value, placeholder, disabled, options, loading, required, noOptionsText = 'Нет доступных вариантов', allowCustom, onChange }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return options;
    return options.filter((option) => option.label.toLowerCase().includes(normalized));
  }, [options, query]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setHighlighted(0);
    }
  }, [open]);

  useEffect(() => {
    setHighlighted(0);
  }, [query]);

  useEffect(() => {
    if (open) {
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    const onOutside = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  const trimmedQuery = query.trim();
  const exactQueryMatch = filteredOptions.some((option) => option.value.toLowerCase() === trimmedQuery.toLowerCase() || option.label.toLowerCase() === trimmedQuery.toLowerCase());
  const showCustomOption = Boolean(allowCustom && trimmedQuery && !exactQueryMatch);
  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((prev) => Math.min(prev + 1, Math.max(filteredOptions.length - 1, 0)));
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((prev) => Math.max(prev - 1, 0));
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (allowCustom && trimmedQuery) {
        onChange(trimmedQuery);
      } else if (filteredOptions[highlighted]) {
        onChange(filteredOptions[highlighted].value);
      }
      setOpen(false);
    }
    if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapperRef} className="relative">
      {allowCustom ? (
        <div className={`${inputClass} relative flex items-center gap-2 disabled:cursor-not-allowed disabled:bg-slate-100`}>
          <input
            ref={inputRef}
            value={open ? query : value}
            disabled={disabled}
            aria-expanded={open}
            aria-required={required}
            onFocus={() => {
              setQuery(value);
              setOpen(true);
            }}
            onChange={(event) => {
              const nextValue = event.target.value;
              setQuery(nextValue);
              onChange(nextValue);
              setOpen(true);
            }}
            onKeyDown={handleSearchKeyDown}
            placeholder={placeholder}
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setQuery(value);
              setOpen((prev) => !prev);
            }}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400"
            aria-label="Открыть список"
          >
            <ChevronDown size={16} className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          aria-expanded={open}
          aria-required={required}
          onClick={() => setOpen((prev) => !prev)}
          className={`${inputClass} relative flex items-center justify-between text-left disabled:cursor-not-allowed disabled:bg-slate-100`}
        >
          <span className={value ? 'text-slate-900' : 'text-slate-400'}>{value || placeholder}</span>
          <ChevronDown size={16} className={`text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </button>
      )}
      {open && (
        <div className="absolute z-[60] mt-2 w-full rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
          {!allowCustom && (
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Поиск..."
              className="mb-2 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm outline-none focus:border-slate-300"
            />
          )}
          {loading ? (
            <div className="space-y-2 p-1">
              <div className="h-8 animate-pulse rounded-lg bg-slate-100" />
              <div className="h-8 animate-pulse rounded-lg bg-slate-100" />
            </div>
          ) : (
            <div className="max-h-52 overflow-y-auto">
              {showCustomOption && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setOpen(false);
                    onChange(trimmedQuery);
                  }}
                  className="mb-1 flex w-full items-center rounded-lg bg-blue-50 px-2 py-2 text-left text-sm font-bold text-blue-700"
                >
                  Указать вручную: "{trimmedQuery}"
                </button>
              )}
              {filteredOptions.map((option, index) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setOpen(false);
                    onChange(option.value);
                  }}
                  className={`flex w-full items-center rounded-lg px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 ${highlighted === index ? 'bg-slate-100' : ''}`}
                >
                  {option.label}
                </button>
              ))}
              {filteredOptions.length === 0 && !showCustomOption && <p className="px-2 py-2 text-xs text-slate-500">{noOptionsText}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const NewOrderScreen: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { addOrder, isSyncing } = useStore();
  const { settings } = useAppSettings();

  const [creationType, setCreationType] = useState<CreationType>(() => (
    new URLSearchParams(location.search).get('type') === 'lead' ? 'lead' : 'order'
  ));
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [bodyType, setBodyType] = useState('');
  const [clientName, setClientName] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [brandLoading, setBrandLoading] = useState(true);
  const submitLockRef = useRef(false);

  useEffect(() => {
    const nextType = new URLSearchParams(location.search).get('type') === 'lead' ? 'lead' : 'order';
    setCreationType(nextType);
  }, [location.search]);

  useEffect(() => {
    const timer = window.setTimeout(() => setBrandLoading(false), 220);
    return () => window.clearTimeout(timer);
  }, []);

  const modelOptions = useMemo(() => {
    const base = brand ? BRAND_MODELS[brand] || [] : Array.from(new Set(Object.values(BRAND_MODELS).flat()));
    return base.sort((a, b) => a.localeCompare(b)).map((item) => ({ label: item, value: item }));
  }, [brand]);

  const brandOptions = useMemo(() => {
    const popularSet = new Set(POPULAR_BRANDS);
    const popular = POPULAR_BRANDS.filter((item) => BRANDS.includes(item)).map((item) => ({ label: `⭐ ${item}`, value: item }));
    const rest = BRANDS.filter((item) => !popularSet.has(item)).map((item) => ({ label: item, value: item }));
    return [...popular, ...rest];
  }, []);

  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: currentYear - 1980 + 1 }, (_, index) => {
      const item = String(currentYear - index);
      return { label: item, value: item };
    });
  }, []);

  const bodyTypeOptions = useMemo(() => {
    const fromDb = (CHASSIS_BODY_TYPES_BY_BRAND[brand] || []).map((item) => ({ label: item, value: item }));
    const fallback = BODY_TYPE_OPTIONS.map((item) => ({ label: item, value: item }));
    return Array.from(new Map([...fromDb, ...fallback].map((item) => [item.value, item])).values());
  }, [brand]);

  const validate = () => {
    const next: Record<string, string> = {};
    const currentYear = new Date().getFullYear();
    const parsedYear = Number(year.trim());

    if (!brand.trim()) next.brand = 'Марка обязательна';
    if (!model.trim()) next.model = 'Модель обязательна';
    if (!year.trim() || !/^\d{4}$/.test(year.trim()) || parsedYear < 1980 || parsedYear > currentYear) next.year = `Год должен быть в диапазоне 1980-${currentYear}`;

    setErrors(next);
    if (Object.keys(next).length > 0) {
      void logger.warn('create-order', 'create_order_validation_error', { errors: next });
    }
    return next;
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSubmitting || submitLockRef.current || isSyncing) return;

    submitLockRef.current = true;
    void logger.info('create-order', 'create_order_start', { source: 'manual', creationType, mode: 'minimal' });

    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      const missing = Object.values(validationErrors).slice(0, 3).join('; ');
      toast(missing || 'Заполните обязательные поля', 'error');
      submitLockRef.current = false;
      return;
    }

    if ('vibrate' in navigator) {
      navigator.vibrate(20);
    }

    const now = Date.now();
    const params = new URLSearchParams(location.search);
    const fromLead = params.get('from') === 'lead' || params.get('source') === 'public_form';
    const shouldCreateLead = creationType === 'lead' || fromLead;

    const order: Order = {
      id: createId(),
      brand: brand.trim(),
      model: model.trim(),
      year: year.trim(),
      bodyType: bodyType.trim(),
      vin: '',
      status: shouldCreateLead ? 'lead' : 'waiting_deposit',
      paymentStatus: 'none',
      priority: Priority.MEDIUM,
      clientName: clientName.trim(),
      source: Source.WHATSAPP,
      customerContact: '',
      carPhotos: [],
      carPhotoUrl: '',
      parts: [],
      markupPercent: DEFAULT_MARKUP,
      exchangeRate: Number(settings.defaultExchangeRate || DEFAULT_RATE),
      clientCurrency: 'AED',
      createdAt: now,
      isArchived: false,
      isSold: false,
      isLead: shouldCreateLead,
      leadUnread: shouldCreateLead,
      leadSource: fromLead ? 'public_form' : 'manual',
      customerStatus: shouldCreateLead ? 'LEAD' : 'INQUIRY',
      notes: [],
      socialNickname: undefined,
      whatsappTemplateLanguage: 'ru'
    };

    setIsSubmitting(true);
    try {
      const ok = await addOrder(order);
      if (!ok) {
        await logger.warn('create-order', 'create_order_store_rejected', { orderId: order.id, creationType, mode: 'minimal' });
        toast(`Не удалось создать ${shouldCreateLead ? 'лид' : 'заказ'}. Проверьте соединение и попробуйте снова.`, 'error');
        return;
      }

      void logger.info('create-order', 'create_order_success', { orderId: order.id, creationType, mode: 'minimal' });
      toast(`${shouldCreateLead ? 'Лид' : 'Заказ'} создан: #${order.id.slice(0, 8)}`, 'success');
      navigate(shouldCreateLead ? '/orders' : `/order/${order.id}`);
    } catch (error) {
      await logger.error('create-order', 'create_order_unexpected_failure', { error: serializeError(error) });
      toast(`Не удалось создать ${shouldCreateLead ? 'лид' : 'заказ'}. Попробуйте ещё раз.`, 'error');
    } finally {
      setIsSubmitting(false);
      submitLockRef.current = false;
    }
  };

  return (
    <form id="new-order-form" onSubmit={submit} className="mx-auto max-w-2xl space-y-4 p-4 pb-[calc(12rem+env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex h-10 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700"
          >
            <ArrowLeft size={14} /> Назад
          </button>
          <h1 className="text-xl font-black text-slate-900">{creationType === 'lead' ? 'Создать лид' : 'Создать заказ'}</h1>
        </div>
      </div>

      <section className={cardClass}>
        <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-slate-600"><CarFront size={16} /> Автомобиль</h2>

        <label className="space-y-1">
          <span className="text-xs font-semibold text-slate-500">Марка</span>
          <SearchableDropdown
            value={brand}
            placeholder="Выберите марку"
            options={brandOptions}
            loading={brandLoading}
            required
            onChange={(value) => {
              setBrand(value);
              setModel('');
            }}
          />
          {errors.brand && <p className="text-xs text-rose-600">{errors.brand}</p>}
        </label>

        <label className="space-y-1">
          <span className="text-xs font-semibold text-slate-500">Модель</span>
          <SearchableDropdown
            value={model}
            placeholder="Введите модель"
            options={modelOptions}
            allowCustom
            noOptionsText="Начните вводить модель"
            onChange={setModel}
          />
          {errors.model && <p className="text-xs text-rose-600">{errors.model}</p>}
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-xs font-semibold text-slate-500">Год</span>
            <SearchableDropdown
              value={year}
              placeholder="Выберите год"
              options={yearOptions}
              noOptionsText="Год не найден"
              onChange={setYear}
            />
            {errors.year && <p className="text-xs text-rose-600">{errors.year}</p>}
          </label>

          <label className="space-y-1">
            <span className="text-xs font-semibold text-slate-500">Кузов <span className="font-medium text-slate-400">необязательно</span></span>
            <input
              type="text"
              value={bodyType}
              list="new-order-body-type-options"
              onChange={(event) => setBodyType(event.target.value)}
              placeholder="Напишите тип кузова"
              className={inputClass}
            />
            <datalist id="new-order-body-type-options">
              {bodyTypeOptions.map((option) => (
                <option key={option.value} value={option.value} />
              ))}
            </datalist>
          </label>
        </div>
      </section>

      <section className={cardClass}>
        <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-slate-600"><UserRound size={16} /> Клиент</h2>
        <label className="space-y-1">
          <span className="text-xs font-semibold text-slate-500">Имя клиента <span className="font-medium text-slate-400">необязательно</span></span>
          <input
            type="text"
            name="clientName"
            autoComplete="name"
            value={clientName}
            onChange={(event) => setClientName(event.target.value)}
            placeholder="Имя клиента"
            className={inputClass}
          />
        </label>
      </section>

      <div className="fixed bottom-[calc(86px+env(safe-area-inset-bottom))] left-1/2 z-40 w-[calc(100%-24px)] max-w-[408px] -translate-x-1/2 rounded-[24px] border border-white/80 bg-[#f6f8fb]/92 p-2 shadow-[0_18px_46px_rgba(15,23,42,0.14)] backdrop-blur-xl">
        <button
          type="submit"
          disabled={isSubmitting || isSyncing}
          className="inline-flex h-12 w-full items-center justify-center rounded-2xl bg-blue-600 px-4 text-sm font-black text-white shadow-[0_14px_30px_rgba(37,99,235,0.24)] transition active:scale-[0.99] disabled:opacity-50"
        >
          {isSubmitting || isSyncing ? 'Сохраняем...' : creationType === 'lead' ? 'Создать лид' : 'Создать заказ'}
        </button>
      </div>
    </form>
  );
};

export default NewOrderScreen;
