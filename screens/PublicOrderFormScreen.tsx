import {
  ArrowLeft,
  ArrowRight,
  CarFront,
  Check,
  CheckCircle2,
  ClipboardList,
  Download,
  Plus,
  Trash2,
  UserRound,
} from 'lucide-react';
import { useState } from 'react';
import { loadAppSettings } from '../appSettings';
import { Button, Field, IconButton, Panel } from '../components/ui';
import { BRANDS, DEFAULT_MARKUP, DEFAULT_RATE } from '../constants';
import { addOrderItem } from '../orderStore';
import { Order, Priority, Source } from '../types';
import { downloadJson } from '../utils/localBackup';

export default function PublicOrderFormScreen() {
  const [step, setStep] = useState(0),
    [brand, setBrand] = useState(''),
    [model, setModel] = useState(''),
    [year, setYear] = useState(''),
    [vin, setVin] = useState(''),
    [name, setName] = useState(''),
    [phone, setPhone] = useState('');
  const [parts, setParts] = useState(['']),
    [notes, setNotes] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [completed, setCompleted] = useState<Order | null>(null);
  const vehicleValid = Boolean(brand.trim() && model.trim() && year),
    contactValid = Boolean(name.trim() && phone.trim().length >= 5),
    partsValid = parts.some((part) => part.trim());
  const submit = async () => {
    if (!vehicleValid || !contactValid || !partsValid || busy) return;
    setBusy(true);
    setError('');
    const settings = loadAppSettings(),
      id = crypto.randomUUID();
    const order: Order = {
      id,
      brand,
      model: model.trim(),
      year,
      vin: vin.trim(),
      clientName: name.trim(),
      customerContact: phone.trim(),
      source: Source.OTHER,
      priority: Priority.MEDIUM,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'lead',
      isLead: true,
      leadSource: 'public_form',
      leadUnread: true,
      customerStatus: 'LEAD',
      searchDepositStatus: 'pending',
      salesStatus: 'Inquiry',
      isSold: false,
      isArchived: false,
      isVip: false,
      isPinned: false,
      markupPercent: DEFAULT_MARKUP,
      exchangeRate: settings.defaultExchangeRate || DEFAULT_RATE,
      carPhotos: [],
      carPhotoUrl: '',
      notes: notes.trim()
        ? [
            {
              id: crypto.randomUUID(),
              text: notes.trim(),
              createdAt: Date.now(),
              photos: [],
              visibility: 'internal',
            },
          ]
        : [],
      parts: parts
        .filter((part) => part.trim())
        .map((part) => ({
          id: crypto.randomUUID(),
          orderId: id,
          name: part.trim(),
          quantity: 1,
          comment: '',
          photos: [],
          photoUrl: '',
          variants: [],
          isFound: false,
          status: 'searching',
        })),
    };
    try {
      if (!(await addOrderItem(order)))
        throw new Error('Не удалось сохранить заявку. Проверьте свободное место на устройстве.');
      setCompleted(order);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : 'Не удалось сохранить заявку');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="public-form-page">
      <header className="public-brand">
        <span className="app-brand-icon">
          <CarFront size={25} />
        </span>
        <div>
          <strong>STARK MOTORS</strong>
          <p>Подбор автозапчастей · Дубай</p>
        </div>
        <span className="ui-badge">На устройстве</span>
      </header>
      {completed ? (
        <Panel className="text-center">
          <span className="ui-success-icon">
            <CheckCircle2 size={36} />
          </span>
          <h1 className="text-2xl font-bold">Заявка сохранена</h1>
          <p className="ui-description mt-3">
            Заявка находится на этом устройстве. Чтобы передать её менеджеру, скачайте файл и
            отправьте удобным способом.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button
              icon={Download}
              onClick={() =>
                downloadJson(
                  { orders: [completed], version: '2.0' },
                  `request-${completed.id}.json`,
                )
              }
            >
              Скачать заявку
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                window.location.href = new URL(
                  `${import.meta.env.BASE_URL}#/orders`,
                  window.location.origin,
                ).toString();
              }}
            >
              Открыть заказы
            </Button>
          </div>
        </Panel>
      ) : (
        <>
          <div className="public-form-intro">
            <p className="ui-eyebrow">Новая заявка</p>
            <h1>
              Найдём нужные
              <br />
              детали для вашего авто
            </h1>
            <p>Укажите автомобиль и список деталей. Всё можно уточнить позже.</p>
          </div>
          <ol className="ui-stepper" aria-label="Этапы заявки">
            {['Автомобиль', 'Детали', 'Контакты'].map((label, index) => (
              <li
                key={label}
                aria-current={step === index ? 'step' : undefined}
                className={step >= index ? 'is-active' : ''}
              >
                <span>{step > index ? <Check size={16} /> : index + 1}</span>
                {label}
              </li>
            ))}
          </ol>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (step < 2) setStep(step + 1);
              else void submit();
            }}
          >
            {step === 0 && (
              <Panel
                title="Введите данные автомобиля"
                icon={CarFront}
                description="Марка, модель и год помогут избежать ошибок при подборе."
              >
                <div className="ui-form-grid mt-6">
                  <Field label="Марка *">
                    <select
                      className="ui-input"
                      value={brand}
                      onChange={(event) => setBrand(event.target.value)}
                      required
                    >
                      <option value="">Выберите марку</option>
                      {BRANDS.map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Модель *">
                    <input
                      className="ui-input"
                      placeholder="Например, Camry"
                      value={model}
                      onChange={(event) => setModel(event.target.value)}
                      required
                    />
                  </Field>
                  <Field label="Год выпуска *">
                    <select
                      className="ui-input"
                      value={year}
                      onChange={(event) => setYear(event.target.value)}
                      required
                    >
                      <option value="">Выберите год</option>
                      {Array.from({ length: 51 }, (_, index) =>
                        String(new Date().getFullYear() + 1 - index),
                      ).map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="VIN" hint="Необязательно. Уточняет совместимость деталей.">
                    <input
                      className="ui-input"
                      value={vin}
                      onChange={(event) => setVin(event.target.value.toUpperCase())}
                      placeholder="17 символов"
                      maxLength={25}
                    />
                  </Field>
                </div>
                {!vehicleValid && (
                  <p className="ui-form-hint mt-5">
                    Заполните обязательные поля: марка, модель и год.
                  </p>
                )}
              </Panel>
            )}
            {step === 1 && (
              <Panel
                title="Какие детали нужны?"
                icon={ClipboardList}
                description={`${brand} ${model} · ${year}`}
              >
                <div className="space-y-3 mt-6">
                  {parts.map((part, index) => (
                    <div className="flex gap-2" key={index}>
                      <Field label={`Деталь ${index + 1}`} className="flex-1">
                        <input
                          className="ui-input"
                          autoFocus={index === 0}
                          value={part}
                          onChange={(event) =>
                            setParts(
                              parts.map((value, item) =>
                                item === index ? event.target.value : value,
                              ),
                            )
                          }
                          placeholder="Например, передний бампер"
                        />
                      </Field>
                      {parts.length > 1 && (
                        <IconButton
                          label={`Удалить деталь ${index + 1}`}
                          icon={Trash2}
                          className="self-end"
                          onClick={() => setParts(parts.filter((_, item) => item !== index))}
                        />
                      )}
                    </div>
                  ))}
                  <Button variant="ghost" icon={Plus} onClick={() => setParts([...parts, ''])}>
                    Ещё одна деталь
                  </Button>
                  <Field label="Комментарий" hint="Номер детали, цвет или другие пожелания">
                    <textarea
                      className="ui-input"
                      rows={3}
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                    />
                  </Field>
                </div>
              </Panel>
            )}
            {step === 2 && (
              <Panel title="Как с вами связаться?" icon={UserRound}>
                <div className="ui-form-grid mt-6">
                  <Field label="Имя *">
                    <input
                      className="ui-input"
                      autoComplete="name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      required
                    />
                  </Field>
                  <Field label="Телефон или WhatsApp *">
                    <input
                      className="ui-input"
                      type="tel"
                      autoComplete="tel"
                      placeholder="+971…"
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                      required
                    />
                  </Field>
                </div>
                <div className="ui-summary mt-6">
                  <strong>
                    {brand} {model} · {year}
                  </strong>
                  <p>{parts.filter(Boolean).join(' · ')}</p>
                  <small>
                    Сохранение на устройстве. Для передачи менеджеру скачайте заявку после
                    сохранения.
                  </small>
                </div>
              </Panel>
            )}
            {error && (
              <p role="alert" className="ui-error mt-4">
                {error}
              </p>
            )}
            <div className="public-form-actions">
              {step > 0 && (
                <Button variant="secondary" icon={ArrowLeft} onClick={() => setStep(step - 1)}>
                  Назад
                </Button>
              )}
              <Button
                type="submit"
                loading={busy}
                disabled={step === 0 ? !vehicleValid : step === 1 ? !partsValid : !contactValid}
                icon={step < 2 ? ArrowRight : Check}
              >
                {step < 2 ? 'Далее' : 'Сохранить заявку'}
              </Button>
            </div>
          </form>
          <p className="public-form-footer">Ваши данные сохраняются только в этом браузере.</p>
        </>
      )}
    </div>
  );
}
