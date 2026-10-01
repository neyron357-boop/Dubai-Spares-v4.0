import { Camera, Check, ClipboardPaste, MapPin, Navigation, Star, Trash2, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { sanitizeMoneyInput } from '../utils/moneyInput';
import { OfferAvailability, OfferCondition, Supplier } from '../types';
import { Button, Field, IconButton, ModalSurface } from './ui';
import { useVisibleViewport } from '../hooks/useVisibleViewport';

export interface OfferFormState {
  purchasePriceAed: string;
  salePriceAed: string;
  shopName: string;
  supplierId?: string;
  phone: string;
  locationText: string;
  mapsUrl: string;
  photos: string[];
  condition: OfferCondition;
  availability: OfferAvailability;
  deliveryEta: 'today' | 'tomorrow' | '2_3_days' | 'week';
  isBest: boolean;
  note: string;
}
export const DEFAULT_OFFER: OfferFormState = {
  purchasePriceAed: '',
  salePriceAed: '',
  shopName: '',
  phone: '',
  locationText: '',
  mapsUrl: '',
  photos: [],
  condition: 'used',
  availability: 'in_stock',
  deliveryEta: 'today',
  isBest: false,
  note: '',
};
export const conditionLabels: Record<OfferCondition, string> = {
  new: 'Новая',
  used: 'Б/у',
  scrapyard: 'Разбор',
};
export const availabilityLabels: Record<OfferAvailability, string> = {
  in_stock: 'В наличии',
  '1d': 'Через день',
  '2_3d': 'Через 2–3 дня',
  by_order: 'Под заказ',
};
const etaLabels = {
  today: 'Сегодня',
  tomorrow: 'Завтра',
  '2_3_days': 'Через 2–3 дня',
  week: 'В течение недели',
};

export default function PartOfferEditor({
  form,
  patch,
  suppliers,
  editing,
  busy,
  error,
  fieldErrors,
  partName,
  onSave,
  onClose,
  onSelectSupplier,
  onPhotos,
  onPastePhotos,
  onRemovePhoto,
  onPreview,
  onLocate,
  locating,
}: {
  form: OfferFormState;
  patch: <K extends keyof OfferFormState>(key: K, value: OfferFormState[K]) => void;
  suppliers: Supplier[];
  editing: boolean;
  busy: boolean;
  error: string;
  fieldErrors: Record<string, string>;
  partName: string;
  onSave: () => Promise<void>;
  onClose: () => void;
  onSelectSupplier: (supplier: Supplier) => void;
  onPhotos: (files: File[]) => Promise<void>;
  onPastePhotos: () => Promise<void>;
  onRemovePhoto: (index: number) => void;
  onPreview: (index: number) => void;
  onLocate: () => void;
  locating: boolean;
}) {
  const file = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) {
      errorRef.current?.focus();
      errorRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [error]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const id = useId();
  const viewport = useVisibleViewport();
  const matches = suppliers
    .filter((s) => s.name.toLocaleLowerCase().includes(form.shopName.trim().toLocaleLowerCase()))
    .slice(0, 6);
  const hasSuggestions = suggestionsOpen && matches.length > 0;
  const choose = (supplier: Supplier) => {
    onSelectSupplier(supplier);
    setSuggestionsOpen(false);
    setActive(-1);
  };
  return (
    <ModalSurface
      label={editing ? 'Редактировать вариант' : 'Добавить вариант'}
      onClose={() => {
        if (!busy) onClose();
      }}
      initialFocus={heading}
      className="part-editor-layer"
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void onSave();
        }}
        className="part-editor-card"
        style={
          {
            '--visible-height': `${viewport.height}px`,
            '--keyboard-offset': `${viewport.bottomOffset}px`,
          } as React.CSSProperties
        }
      >
        <header>
          <div>
            <p className="ui-eyebrow">{editing ? 'Редактирование варианта' : 'Новый вариант'}</p>
            <h2 ref={heading} tabIndex={-1}>
              {editing ? 'Обновить предложение' : 'Добавить цену поставщика'}
            </h2>
            <p className="ui-description">{partName}</p>
          </div>
          <IconButton label="Закрыть форму варианта" icon={X} disabled={busy} onClick={onClose} />
        </header>
        <div className="part-editor-scroll">
          <fieldset disabled={busy} className="part-editor-fields">
            <legend className="sr-only">Данные предложения</legend>
            <div className="part-editor-required">
              <Field label="Цена закупки, AED" required error={fieldErrors.purchasePriceAed}>
                <input
                  aria-label="Цена закупки, AED"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={form.purchasePriceAed}
                  onChange={(e) => patch('purchasePriceAed', sanitizeMoneyInput(e.target.value))}
                  placeholder="Например, 450,50"
                  className="ui-input part-editor-price"
                />
              </Field>
              <div
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) setSuggestionsOpen(false);
                }}
              >
                <Field label="Название поставщика" required error={fieldErrors.shopName}>
                  <input
                    id="offer-shop-name"
                    aria-label="Название поставщика"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={hasSuggestions}
                    aria-controls={hasSuggestions ? `${id}-suppliers` : undefined}
                    aria-activedescendant={
                      hasSuggestions && active >= 0 ? `${id}-supplier-${active}` : undefined
                    }
                    autoComplete="off"
                    value={form.shopName}
                    onFocus={() => setSuggestionsOpen(true)}
                    onChange={(e) => {
                      patch('shopName', e.target.value);
                      patch('supplierId', undefined);
                      setActive(-1);
                      setSuggestionsOpen(true);
                    }}
                    onKeyDown={(e) => {
                      if (!hasSuggestions) return;
                      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                        e.preventDefault();
                        setActive((prev) =>
                          Math.max(
                            0,
                            Math.min(matches.length - 1, prev + (e.key === 'ArrowDown' ? 1 : -1)),
                          ),
                        );
                      }
                      if (e.key === 'Enter' && active >= 0) {
                        e.preventDefault();
                        choose(matches[active]);
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        e.stopPropagation();
                        setSuggestionsOpen(false);
                      }
                    }}
                    placeholder="Поиск или новый магазин"
                    className="ui-input"
                  />
                </Field>
                {hasSuggestions && (
                  <div
                    role="listbox"
                    id={`${id}-suppliers`}
                    aria-label="Поставщики"
                    className="part-editor-suppliers"
                  >
                    {matches.map((supplier, index) => (
                      <button
                        type="button"
                        role="option"
                        aria-selected={form.supplierId === supplier.id}
                        id={`${id}-supplier-${index}`}
                        tabIndex={-1}
                        data-active={active === index}
                        key={supplier.id}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => choose(supplier)}
                      >
                        <span>{supplier.name}</span>
                        <small>{supplier.phone || supplier.location || 'Из вашей базы'}</small>
                        {form.supplierId === supplier.id && <Check size={17} aria-hidden="true" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <section className="part-editor-section">
              <h3>Состояние и наличие</h3>
              <div className="part-editor-grid">
                <Field label="Состояние">
                  <select
                    className="ui-input"
                    value={form.condition}
                    onChange={(e) => patch('condition', e.target.value as OfferCondition)}
                  >
                    {Object.entries(conditionLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Наличие">
                  <select
                    className="ui-input"
                    value={form.availability}
                    onChange={(e) => patch('availability', e.target.value as OfferAvailability)}
                  >
                    {Object.entries(availabilityLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Когда можно забрать">
                  <select
                    className="ui-input"
                    value={form.deliveryEta}
                    onChange={(e) =>
                      patch('deliveryEta', e.target.value as OfferFormState['deliveryEta'])
                    }
                  >
                    {Object.entries(etaLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </section>
            <section className="part-editor-section">
              <h3>
                Фото предложения <span>{form.photos.length}</span>
              </h3>
              <div className="part-editor-photo-actions">
                <Button variant="secondary" icon={Camera} onClick={() => file.current?.click()}>
                  Добавить фото
                </Button>
                <Button variant="ghost" icon={ClipboardPaste} onClick={() => void onPastePhotos()}>
                  Из буфера
                </Button>
              </div>
              <input
                type="file"
                ref={file}
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  e.target.value = '';
                  if (files.length) void onPhotos(files);
                }}
              />
              {form.photos.length > 0 ? (
                <div className="part-editor-photos">
                  {form.photos.map((photo, index) => (
                    <div key={`${photo}-${index}`}>
                      <button
                        type="button"
                        className="part-editor-photo"
                        aria-label={`Открыть фото варианта ${index + 1}`}
                        onClick={() => onPreview(index)}
                      >
                        <img src={photo} alt={`Фото предложения ${index + 1}`} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Удалить фото варианта ${index + 1}`}
                        className="part-editor-photo-remove"
                        onClick={() => onRemovePhoto(index)}
                      >
                        <Trash2 size={15} aria-hidden="true" /> Удалить
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="part-editor-hint">
                  Покажите состояние детали и крепления. Фото можно добавить позже.
                </p>
              )}
            </section>
            <section className="part-editor-section">
              <h3>
                Контакты и адрес <span>Необязательно</span>
              </h3>
              <Field label="Телефон" error={fieldErrors.phone}>
                <input
                  type="tel"
                  autoComplete="tel"
                  inputMode="tel"
                  value={form.phone}
                  onChange={(e) => patch('phone', e.target.value)}
                  placeholder="+971 50 123 4567"
                  className="ui-input"
                />
              </Field>
              <div className="part-editor-location">
                <Field label="Локация">
                  <input
                    value={form.locationText}
                    onChange={(e) => patch('locationText', e.target.value)}
                    placeholder="Ряд / зона / адрес"
                    className="ui-input"
                  />
                </Field>
                <IconButton
                  label="Определить моё местоположение"
                  icon={locating ? MapPin : Navigation}
                  disabled={locating}
                  onClick={onLocate}
                />
              </div>
              <Field label="Ссылка на карту">
                <input
                  type="url"
                  value={form.mapsUrl}
                  onChange={(e) => patch('mapsUrl', e.target.value)}
                  placeholder="Ссылка Google Maps"
                  className="ui-input"
                />
              </Field>
            </section>
            <section className="part-editor-section">
              <Field label="Комментарий">
                <textarea
                  rows={3}
                  value={form.note}
                  onChange={(e) => patch('note', e.target.value)}
                  maxLength={2000}
                  placeholder="Крепления, цвет, комплектность, договорённости…"
                  className="ui-input"
                />
              </Field>
              <label className={`part-editor-best ${form.isBest ? 'is-checked' : ''}`}>
                <input
                  type="checkbox"
                  checked={form.isBest}
                  onChange={(e) => patch('isBest', e.target.checked)}
                />
                <Star size={18} aria-hidden="true" />
                <span>
                  Выбрать этот вариант<small>Использовать в заказе как основной</small>
                </span>
              </label>
            </section>
          </fieldset>
          {error && (
            <p ref={errorRef} tabIndex={-1} role="alert" className="part-editor-error">
              {error}
            </p>
          )}
        </div>
        <footer>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" loading={busy}>
            {editing ? 'Сохранить изменения' : 'Сохранить вариант'}
          </Button>
        </footer>
      </form>
    </ModalSurface>
  );
}
