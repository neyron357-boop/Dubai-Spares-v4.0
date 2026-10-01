import {
  ArrowRight,
  CarFront,
  Check,
  CircleAlert,
  FileCheck2,
  Plus,
  RotateCcw,
  UserRound,
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppSettings } from '../appSettings';
import { CHASSIS_BODY_TYPES_BY_BRAND } from '../carDatabase';
import OrderVehiclePicker from '../components/OrderVehiclePicker';
import { Button, Dialog, Field, PageHeader } from '../components/ui';
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
  const [showReset, setShowReset] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [restoredDraft, setRestoredDraft] = useState(Boolean(initialDraft));
  const saveErrorRef = useRef<HTMLDivElement>(null);
  const busy = isSubmitting || isSyncing;
  const submitLockRef = useRef(false);
  const orderIdRef = useRef<string | null>(null);
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
    setSaveError('');
    setRestoredDraft(false);
    setShowReset(false);
  };
  const updateField = (field: keyof OrderDraft, value: string) => {
    const setters = {
      brand: setBrand,
      model: setModel,
      year: setYear,
      bodyType: setBodyType,
      clientName: setClientName,
    };
    setters[field](value);
    setErrors((previous) =>
      Object.fromEntries(Object.entries(previous).filter(([key]) => key !== field)),
    );
    setSaveError('');
  };
  useEffect(() => {
    if (saveError) saveErrorRef.current?.focus();
  }, [saveError]);

  useEffect(() => {
    const nextType = new URLSearchParams(location.search).get('type') === 'lead' ? 'lead' : 'order';
    setCreationType(nextType);
  }, [location.search]);

  const modelOptions = useMemo(() => {
    const base = brand
      ? BRAND_MODELS[brand] || []
      : Array.from(new Set(Object.values(BRAND_MODELS).flat()));
    return [...base]
      .sort((a, b) => a.localeCompare(b))
      .map((item) => ({ label: item, value: item }));
  }, [brand]);

  const brandOptions = useMemo(() => {
    const popularSet = new Set(POPULAR_BRANDS);
    const popular = POPULAR_BRANDS.filter((item) => BRANDS.includes(item)).map((item) => ({
      label: item,
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
    return [
      { label: 'Не указан', value: '' },
      ...Array.from(new Map([...fromDb, ...fallback].map((item) => [item.value, item])).values()),
    ];
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
      id: (orderIdRef.current ??= createId()),
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

    setSaveError('');
    setIsSubmitting(true);
    try {
      const ok = await addOrder(order);
      if (!ok) {
        await logger.warn('create-order', 'create_order_store_rejected', {
          orderId: order.id,
          creationType,
          mode: 'minimal',
        });
        setSaveError(
          'Не удалось сохранить. Данные остались в форме. Проверьте свободное место на устройстве и попробуйте ещё раз.',
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
      setSaveError('Не удалось сохранить. Данные остались в форме — попробуйте ещё раз.');
    } finally {
      setIsSubmitting(false);
      submitLockRef.current = false;
    }
  };

  const hasContent = Object.values(draftData).some((value) => value.trim());
  const validYear =
    /^\d{4}$/.test(year) && Number(year) >= 1980 && Number(year) <= new Date().getFullYear();
  const ready = Boolean(brand.trim() && model.trim() && validYear);
  const vehicleName = [brand, model, year].filter(Boolean).join(' ');

  return (
    <form id="new-order-form" onSubmit={submit} noValidate className="ui-page new-order-page">
      <PageHeader
        title={creationType === 'lead' ? 'Новая заявка' : 'Новый заказ'}
        description="Укажите автомобиль — затем добавьте запчасти."
        back={() => navigate('/orders')}
      />

      <div className="new-order-layout">
        <div className="new-order-fields">
          <fieldset disabled={busy} className="new-order-card">
            <legend className="sr-only">Автомобиль</legend>
            <div className="new-order-card-heading">
              <span className="new-order-section-icon">
                <CarFront size={22} aria-hidden="true" />
              </span>
              <div>
                <h2>Автомобиль</h2>
                <p>Марка, модель и год обязательны</p>
              </div>
            </div>
            <div className="new-order-vehicle-grid">
              <OrderVehiclePicker
                label="Марка"
                error={errors.brand}
                value={brand}
                placeholder="Выберите марку"
                options={brandOptions}
                featuredCount={POPULAR_BRANDS.filter((item) => BRANDS.includes(item)).length}
                required
                onChange={(value) => {
                  updateField('brand', value);
                  if (value !== brand) {
                    setModel('');
                    setBodyType('');
                  }
                }}
              />
              <OrderVehiclePicker
                required
                label="Модель"
                error={errors.model}
                value={model}
                placeholder="Выберите или введите"
                options={modelOptions}
                allowCustom
                onChange={(value) => updateField('model', value)}
              />
              <OrderVehiclePicker
                required
                label="Год"
                error={errors.year}
                value={year}
                placeholder="Год выпуска"
                options={yearOptions}
                grid
                onChange={(value) => updateField('year', value)}
              />
              <OrderVehiclePicker
                label="Кузов"
                value={bodyType}
                placeholder="Не указан"
                options={bodyTypeOptions}
                allowCustom
                onChange={(value) => updateField('bodyType', value)}
              />
            </div>
            <p className="new-order-field-note">Кузов можно указать позже.</p>
          </fieldset>

          <fieldset disabled={busy} className="new-order-card new-order-client-card">
            <legend className="sr-only">Клиент</legend>
            <div className="new-order-card-heading">
              <span className="new-order-section-icon is-neutral">
                <UserRound size={21} aria-hidden="true" />
              </span>
              <div>
                <h2>Клиент</h2>
                <p>Необязательно · можно добавить позже</p>
              </div>
            </div>
            <Field label="Имя клиента">
              <input
                type="text"
                name="clientName"
                autoComplete="name"
                maxLength={120}
                value={clientName}
                onChange={(event) => updateField('clientName', event.target.value)}
                placeholder="Например, Александр"
                className="ui-input"
              />
            </Field>
          </fieldset>

          <div className={`new-order-draft ${draft.status === 'unavailable' ? 'has-warning' : ''}`}>
            <span role="status">
              {draft.status === 'unavailable' ? (
                <CircleAlert size={16} aria-hidden="true" />
              ) : (
                <FileCheck2 size={16} aria-hidden="true" />
              )}
              {draft.status === 'unavailable'
                ? 'Черновик не сохранён. Не закрывайте форму.'
                : restoredDraft && hasContent
                  ? 'Черновик восстановлен'
                  : draft.status === 'saved'
                    ? 'Черновик сохранён на устройстве'
                    : 'Черновик сохраняется автоматически'}
            </span>
            {hasContent && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setShowReset(true)}
                aria-label="Очистить форму"
              >
                <RotateCcw size={16} aria-hidden="true" /> Очистить
              </button>
            )}
          </div>
        </div>

        <section className="new-order-summary" aria-labelledby="new-order-summary-title">
          <div className={`new-order-summary-icon ${ready ? 'is-ready' : ''}`}>
            {ready ? <Check size={24} aria-hidden="true" /> : <Plus size={24} aria-hidden="true" />}
          </div>
          <h2 id="new-order-summary-title">
            {ready ? 'Всё готово к созданию' : 'Начнём с автомобиля'}
          </h2>
          <p className={`new-order-vehicle-preview ${vehicleName ? 'has-value' : ''}`}>
            {vehicleName || 'Выберите марку, модель и год выпуска.'}
          </p>
          {clientName.trim() && (
            <p className="new-order-client-preview">
              <UserRound size={15} aria-hidden="true" />
              {clientName.trim()}
            </p>
          )}
          <div className="new-order-next">
            <span>
              <ArrowRight size={16} aria-hidden="true" /> После создания
            </span>
            <p>Добавьте нужные запчасти, фотографии и предложения поставщиков.</p>
          </div>
          {saveError && (
            <div ref={saveErrorRef} tabIndex={-1} role="alert" className="new-order-save-error">
              <CircleAlert size={18} aria-hidden="true" />
              <p>{saveError}</p>
            </div>
          )}
          <Button type="submit" loading={busy} icon={ArrowRight} className="new-order-submit">
            {busy ? 'Сохраняем…' : creationType === 'lead' ? 'Создать заявку' : 'Создать заказ'}
          </Button>
          <p className="new-order-submit-note">
            {creationType === 'lead' ? 'Заявку' : 'Заказ'} можно дополнить и изменить позже.
          </p>
        </section>
      </div>
      {showReset && (
        <Dialog
          title="Очистить черновик?"
          onClose={() => setShowReset(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setShowReset(false)}>
                Продолжить заполнение
              </Button>
              <Button variant="danger" onClick={resetDraft}>
                Очистить форму
              </Button>
            </>
          }
        >
          <p className="ui-description">
            Выбранный автомобиль и имя клиента будут удалены из этой формы.
          </p>
        </Dialog>
      )}
    </form>
  );
};

export default NewOrderScreen;
