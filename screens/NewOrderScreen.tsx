import { CarFront, UserRound } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppSettings } from '../appSettings';
import { CHASSIS_BODY_TYPES_BY_BRAND } from '../carDatabase';
import SearchableSelect from '../components/SearchableSelect';
import { Button, PageHeader } from '../components/ui';
import { readFormDraft, useFormDraft } from '../hooks/useFormDraft';
import { BRAND_MODELS, BRANDS, DEFAULT_MARKUP, DEFAULT_RATE } from '../constants';
import { toast } from '../feedback';
import { logger } from '../logging';
import { useStore } from '../store';
import { Order, Priority, Source } from '../types';

const DRAFT_KEY = 'dubai_spares_draft_new_order_v1';
type OrderDraft = {
  brand: string;
  model: string;
  year: string;
  bodyType: string;
  clientName: string;
};
const validateDraft = (value: unknown): value is OrderDraft =>
  Boolean(
    value &&
    typeof value === 'object' &&
    ['brand', 'model', 'year', 'bodyType', 'clientName'].every(
      (key) => typeof (value as Record<string, unknown>)[key] === 'string',
    ),
  );

type CreationType = 'lead' | 'order';

const POPULAR_BRANDS = [
  'BMW',
  'Mercedes-Benz',
  'Toyota',
  'Lexus',
  'Nissan',
  'Hyundai',
  'Kia',
  'Audi',
  'Volkswagen',
];
const BODY_TYPE_OPTIONS = [
  'Седан',
  'Кроссовер',
  'Купе',
  'Хэтчбек',
  'Универсал',
  'SUV',
  'Пикап',
  'Минивэн',
  'Кабриолет',
  'Фургон',
];

const createId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const serializeError = (error: unknown) => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: String(error),
  };
};

const inputClass = 'ui-input';
const cardClass = 'ui-panel space-y-5';

const NewOrderScreen: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { addOrder, isSyncing } = useStore();
  const { settings } = useAppSettings();

  const [creationType, setCreationType] = useState<CreationType>(() =>
    new URLSearchParams(location.search).get('type') === 'lead' ? 'lead' : 'order',
  );
  const [initialDraft] = useState(() => readFormDraft(DRAFT_KEY, validateDraft));
  const [brand, setBrand] = useState(initialDraft?.brand || '');
  const [model, setModel] = useState(initialDraft?.model || '');
  const [year, setYear] = useState(initialDraft?.year || '');
  const [bodyType, setBodyType] = useState(initialDraft?.bodyType || '');
  const [clientName, setClientName] = useState(initialDraft?.clientName || '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitLockRef = useRef(false);
  const draftData = useMemo(
    () => ({ brand, model, year, bodyType, clientName }),
    [brand, model, year, bodyType, clientName],
  );
  const draft = useFormDraft({
    key: DRAFT_KEY,
    data: draftData,
    hasContent: Object.values(draftData).some((value) => value.trim()),
  });
  const resetDraft = () => {
    setBrand('');
    setModel('');
    setYear('');
    setBodyType('');
    setClientName('');
    setErrors({});
  };

  useEffect(() => {
    const nextType = new URLSearchParams(location.search).get('type') === 'lead' ? 'lead' : 'order';
    setCreationType(nextType);
  }, [location.search]);

  const modelOptions = useMemo(() => {
    const base = brand
      ? BRAND_MODELS[brand] || []
      : Array.from(new Set(Object.values(BRAND_MODELS).flat()));
    return base.sort((a, b) => a.localeCompare(b)).map((item) => ({ label: item, value: item }));
  }, [brand]);

  const brandOptions = useMemo(() => {
    const popularSet = new Set(POPULAR_BRANDS);
    const popular = POPULAR_BRANDS.filter((item) => BRANDS.includes(item)).map((item) => ({
      label: `⭐ ${item}`,
      value: item,
    }));
    const rest = BRANDS.filter((item) => !popularSet.has(item)).map((item) => ({
      label: item,
      value: item,
    }));
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
    const fromDb = (CHASSIS_BODY_TYPES_BY_BRAND[brand] || []).map((item) => ({
      label: item,
      value: item,
    }));
    const fallback = BODY_TYPE_OPTIONS.map((item) => ({ label: item, value: item }));
    return Array.from(new Map([...fromDb, ...fallback].map((item) => [item.value, item])).values());
  }, [brand]);

  const validate = () => {
    const next: Record<string, string> = {};
    const currentYear = new Date().getFullYear();
    const parsedYear = Number(year.trim());

    if (!brand.trim()) next.brand = 'Марка обязательна';
    if (!model.trim()) next.model = 'Модель обязательна';
    if (
      !year.trim() ||
      !/^\d{4}$/.test(year.trim()) ||
      parsedYear < 1980 ||
      parsedYear > currentYear
    )
      next.year = `Год должен быть в диапазоне 1980-${currentYear}`;

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
    void logger.info('create-order', 'create_order_start', {
      source: 'manual',
      creationType,
      mode: 'minimal',
    });

    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      const first = validationErrors.brand ? 'Марка' : validationErrors.model ? 'Модель' : 'Год';
      document.querySelector<HTMLElement>(`#new-order-form [aria-label="${first}"]`)?.focus();
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
      whatsappTemplateLanguage: 'ru',
    };

    setIsSubmitting(true);
    try {
      const ok = await addOrder(order);
      if (!ok) {
        await logger.warn('create-order', 'create_order_store_rejected', {
          orderId: order.id,
          creationType,
          mode: 'minimal',
        });
        toast(
          `Не удалось создать ${shouldCreateLead ? 'лид' : 'заказ'}. Проверьте свободное место в браузере и попробуйте снова.`,
          'error',
        );
        return;
      }

      void logger.info('create-order', 'create_order_success', {
        orderId: order.id,
        creationType,
        mode: 'minimal',
      });
      toast(`${shouldCreateLead ? 'Лид' : 'Заказ'} создан: #${order.id.slice(0, 8)}`, 'success');
      draft.clear();
      navigate(shouldCreateLead ? '/orders' : `/order/${order.id}`);
    } catch (error) {
      await logger.error('create-order', 'create_order_unexpected_failure', {
        error: serializeError(error),
      });
      toast(
        `Не удалось создать ${shouldCreateLead ? 'лид' : 'заказ'}. Попробуйте ещё раз.`,
        'error',
      );
    } finally {
      setIsSubmitting(false);
      submitLockRef.current = false;
    }
  };

  return (
    <form id="new-order-form" onSubmit={submit} className="ui-page max-w-3xl space-y-5">
      <PageHeader
        title={creationType === 'lead' ? 'Новая заявка' : 'Новый заказ'}
        eyebrow="Автозапчасти · Дубай"
        description="Начните с автомобиля. Детали и фотографии можно добавить в заказе."
        back={() => navigate('/orders')}
      />
      {Object.values(draftData).some((value) => value.trim()) && (
        <div className="ui-draft-note">
          <span role="status">
            {draft.status === 'unavailable'
              ? 'Черновик не сохранён: хранилище браузера недоступно.'
              : initialDraft
                ? 'Черновик восстановлен. Продолжите заполнение.'
                : 'Черновик сохраняется на этом устройстве.'}
          </span>
          <Button variant="ghost" onClick={resetDraft}>
            Очистить форму
          </Button>
        </div>
      )}
      <section className={cardClass}>
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-600">
          <CarFront size={16} /> Автомобиль
        </h2>

        <label className="space-y-1">
          <span className="text-xs font-semibold text-slate-500">Марка</span>
          <SearchableSelect
            label="Марка"
            error={errors.brand}
            value={brand}
            placeholder="Выберите марку"
            options={brandOptions}
            required
            onChange={(value) => {
              setBrand(value);
              setModel('');
            }}
          />
        </label>

        <label className="space-y-1">
          <span className="text-xs font-semibold text-slate-500">Модель</span>
          <SearchableSelect
            required
            label="Модель"
            error={errors.model}
            value={model}
            placeholder="Введите модель"
            options={modelOptions}
            allowCustom
            noOptionsText="Начните вводить модель"
            onChange={setModel}
          />
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-xs font-semibold text-slate-500">Год</span>
            <SearchableSelect
              required
              label="Год"
              error={errors.year}
              value={year}
              placeholder="Выберите год"
              options={yearOptions}
              noOptionsText="Год не найден"
              onChange={setYear}
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs font-semibold text-slate-500">
              Кузов <span className="font-medium text-slate-400">необязательно</span>
            </span>
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
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-600">
          <UserRound size={16} /> Клиент
        </h2>
        <label className="space-y-1">
          <span className="text-xs font-semibold text-slate-500">
            Имя клиента <span className="font-medium text-slate-400">необязательно</span>
          </span>
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

      <div className="screen-action-dock">
        <Button type="submit" loading={isSubmitting || isSyncing} className="w-full">
          {isSubmitting || isSyncing
            ? 'Сохраняем...'
            : creationType === 'lead'
              ? 'Создать лид'
              : 'Создать заказ'}
        </Button>
      </div>
    </form>
  );
};

export default NewOrderScreen;
